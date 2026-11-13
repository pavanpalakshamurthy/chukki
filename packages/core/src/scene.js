/* Scene model — the single source of truth.
   Everything is plain JSON: objects, sliders (params), steps (keyframes), view, grid.
   Points evaluate lazily so that dependent constructions (midpoints, intersections,
   formula-driven points…) always follow whatever they depend on. */
(function (G) {
  'use strict';
  const { Expr } = G;

  // ---------- tiny pub/sub ----------
  const handlers = {};
  G.on = (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); };
  G.emit = (evt, data) => { (handlers[evt] || []).forEach((fn) => fn(data)); };

  const NAN_PT = { x: NaN, y: NaN };

  const S = (G.S = {
    title: 'Untitled canvas',
    objects: [],
    params: [],
    steps: [],
    view: { x: 0, y: 0, s: 56 },
    grid: { type: 'square', axes: true, labels: true, snap: true, extent: 6, floor: true, ortho: false },
    mode: '2d',
    cam3: { yaw: -0.85, pitch: 0.5, dist: 20, tx: 0, ty: 0, tz: 1.5 },
    vars: { t: 0 },
    epoch: 1,
    clock: { t: 0, playing: false, speed: 1 },
    sel: new Set(),
    _idx: new Map(),
  });

  // ---------- lookup ----------
  S.reindex = () => { S._idx = new Map(S.objects.map((o) => [o.id, o])); };
  S.get = (id) => S._idx.get(id);
  S.bump = () => { S.epoch++; };

  // ---------- variables (sliders + time) ----------
  S.syncVars = () => {
    S.vars.t = S.clock.t;
    S.params.forEach((p) => { S.vars[p.name] = p.value; });
  };
  S.param = (name) => S.params.find((p) => p.name === name);
  S.setParam = (name, v) => {
    const p = S.param(name);
    if (p) { p.value = v; S.vars[name] = v; }
  };
  S.withVar = (name, val, fn) => {
    const old = S.vars[name];
    S.vars[name] = val; S.epoch++;
    try { return fn(); } finally { S.vars[name] = old; S.epoch++; }
  };

  const RESERVED = new Set(['t', 'x', 'u', 'e', 'pi', 'tau', 'phi', 'inf', ...Object.keys(Expr.FN)]);
  S.nextParamName = () => {
    const pool = 'abcdhkmnpqrsw'.split('');
    for (const n of pool) if (!S.param(n) && !RESERVED.has(n)) return n;
    let i = 1;
    while (S.param('k' + i)) i++;
    return 'k' + i;
  };
  S.addParam = (p) => {
    const q = Object.assign({ name: S.nextParamName(), value: 1, min: 0, max: 10, anim: 'none', speed: 1 }, p);
    S.params.push(q);
    S.vars[q.name] = q.value;
    return q;
  };

  // ---------- evaluation environment for expressions ----------
  const env = (S.env = {
    vars: S.vars,
    ref(name) {
      const o = S.get(name);
      if (!o) return NaN;
      if (o.type === 'point') return evalPoint(o);
      if (o.type === 'p3') return G.T3.evalP3(o);
      return NaN;
    },
    prop(name, prop) {
      const o = S.get(name);
      if (!o) return NaN;
      if (o.type === 'point') { const p = evalPoint(o); return prop === 'x' ? p.x : prop === 'y' ? p.y : NaN; }
      if (o.type === 'p3') { const p = G.T3.evalP3(o); return prop === 'x' ? p.x : prop === 'y' ? p.y : prop === 'z' ? p.z : NaN; }
      const g = S.geom(o);
      const v = g && g.props ? g.props[prop] : undefined;
      return v === undefined ? NaN : v;
    },
  });

  // Local scope with extra loop variables (x, u…) without touching the shared vars.
  S.localEnv = () => {
    const e = Object.create(env);
    e.vars = Object.create(S.vars);
    return e;
  };
  S.num = (v) => Expr.num(v, env);

  // ---------- points ----------
  const isNum = (v) => typeof v === 'number';
  S.isFree = (o) => (o.type === 'point' && !o.def && isNum(o.x) && isNum(o.y)) || (o.type === 'p3' && isNum(o.x) && isNum(o.y) && isNum(o.z));
S.ptState = (o) => (o.type === 'p3' ? [o.x, o.y, o.z] : [o.x, o.y]);

  function applyMotion(m, x, y) {
    const t = S.vars.t || 0;
    switch (m.k) {
      case 'rot': {
        const cx = S.num(m.cx), cy = S.num(m.cy), a = (m.w * Math.PI / 180) * t;
        const c = Math.cos(a), s = Math.sin(a);
        return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
      }
      case 'slide': {
        const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (m.T || 4));
        return [x + m.dx * k, y + m.dy * k];
      }
      case 'pulse': {
        const cx = S.num(m.cx), cy = S.num(m.cy), k = 1 + m.amp * Math.sin((2 * Math.PI * t) / (m.T || 3));
        return [cx + (x - cx) * k, cy + (y - cy) * k];
      }
    }
    return [x, y];
  }
  // Inverse, so dragging a moving point edits its *base* position.
  S.invMotion = (m, x, y) => {
    const t = S.vars.t || 0;
    switch (m.k) {
      case 'rot': {
        const cx = S.num(m.cx), cy = S.num(m.cy), a = -(m.w * Math.PI / 180) * t;
        const c = Math.cos(a), s = Math.sin(a);
        return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
      }
      case 'slide': {
        const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (m.T || 4));
        return [x - m.dx * k, y - m.dy * k];
      }
      case 'pulse': {
        const cx = S.num(m.cx), cy = S.num(m.cy), k = 1 + m.amp * Math.sin((2 * Math.PI * t) / (m.T || 3));
        return [cx + (x - cx) / k, cy + (y - cy) / k];
      }
    }
    return [x, y];
  };

  function evalPoint(o) {
    if (o._ev === S.epoch) return o._p;
    if (o._busy) return NAN_PT;
    o._busy = true;
    let x = NaN, y = NaN;
    try {
      const d = o.def;
      if (!d) { x = S.num(o.x); y = S.num(o.y); }
      else if (d.k === 'on') {
        const host = S.get(d.o);
        if (host) { const q = G.Geo.pointOn(host, S.num(d.t)); x = q.x; y = q.y; }
      } else if (d.k === 'int') {
        const q = G.Geo.intersect(S.get(d.a), S.get(d.b), d.i | 0);
        x = q.x; y = q.y;
      }
      if (o.motion && isFinite(x) && isFinite(y)) [x, y] = applyMotion(o.motion, x, y);
    } finally { o._busy = false; }
    o._p = { x, y };
    o._ev = S.epoch;
    return o._p;
  }
  S.evalPoint = evalPoint;

  // A "point reference" is an id string, an [xExpr, yExpr] pair, or an {x,y} object.
  S.pt = (ref) => {
    if (ref == null) return NAN_PT;
    if (typeof ref === 'string') { const o = S.get(ref); return o && o.type === 'point' ? evalPoint(o) : NAN_PT; }
    if (Array.isArray(ref)) return { x: S.num(ref[0]), y: S.num(ref[1]) };
    if (typeof ref === 'object' && 'x' in ref) return ref;
    return NAN_PT;
  };

  // Line-like objects (seg / ray / line / vec) resolve to two world points.
  S.lineOf = (o, depth = 0) => {
    if (!o || depth > 6) return null;
    if (o.a != null && o.b != null) return { p: S.pt(o.a), q: S.pt(o.b) };
    if (o.a != null && (o.par || o.perp)) {
      const base = S.lineOf(S.get(o.par || o.perp), depth + 1);
      if (!base) return null;
      const p = S.pt(o.a);
      let dx = base.q.x - base.p.x, dy = base.q.y - base.p.y;
      if (o.perp) [dx, dy] = [-dy, dx];
      return { p, q: { x: p.x + dx, y: p.y + dy } };
    }
    return null;
  };
  S.isLineLike = (o) => !!o && (o.type === 'seg' || o.type === 'ray' || o.type === 'line' || o.type === 'vec');

  // Cached per-frame geometry for an object (computed by its type handler).
  S.geom = (o) => {
    if (o._ge === S.epoch) return o._g;
    const h = G.Objs[o.type] || (G.Objs3 && G.Objs3[o.type]);
    o._g = h && h.eval ? h.eval(o) : null;
    o._ge = S.epoch;
    return o._g;
  };

  // ---------- ids ----------
  const PREFIX = { seg: 's', ray: 'r', line: 'l', vec: 'v', circle: 'c', poly: 'pg', ngon: 'ng', angle: 'ang', sector: 'sec', func: 'f', curve: 'k', text: 'txt', riemann: 'rs', tiles: 'tl', xfgrid: 'xf', slices: 'sl', rings: 'rg', dots: 'dt', heat: 'ht', quiver: 'qv', bars: 'br', fractal: 'fr', tiling: 'tg', numline: 'nl', hop: 'hp', span: 'sp', trail: 'tr', pen: 'pen', node: 'nd', flow: 'fl', loopm: 'lm', tank: 'tk', sim: 'sim', flock: 'fk', net: 'net', traffic: 'tf', ring: 'rg2', queue: 'qu', wire: 'wr', comp: 'cp', gate: 'gt', wave: 'wv', seg3: 's', vec3: 'v', sphere: 'ball', box: 'box', cyl: 'cyl', cone: 'cone', surf: 'surf', curve3: 'k', text3: 'txt', poly3: 'pg' };
  S.newId = (type) => {
    if (type === 'point' || type === 'p3') {
      for (let round = 0; ; round++) {
        for (let i = 0; i < 26; i++) {
          const id = String.fromCharCode(65 + i) + (round ? round : '');
          if (!S.get(id)) return id;
        }
      }
    }
    const pre = PREFIX[type] || 'o';
    let i = 1;
    while (S.get(pre + i)) i++;
    return pre + i;
  };

  S.add = (o) => {
    if (!o.id) o.id = S.newId(o.type);
    S.objects.push(o);
    S._idx.set(o.id, o);
    S.bump();
    return o;
  };

  // ---------- dependencies ----------
  const SKIP = new Set(['id', 'type', 'label', 'text', 'color', 'kind', 'mode', 'font', 'anchor', 'unit', 'over']);
  const WORD = /[\p{L}_][\p{L}\p{N}_]*/gu;
  function scan(v, out) {
    if (typeof v === 'string') { for (const w of v.match(WORD) || []) if (S._idx.has(w)) out.add(w); }
    else if (Array.isArray(v)) v.forEach((e) => scan(e, out));
    else if (v && typeof v === 'object') for (const k in v) if (!SKIP.has(k) && k[0] !== '_') scan(v[k], out);
  }
  S.refsOf = (o) => {
    const out = new Set();
    for (const k in o) if (!SKIP.has(k) && k[0] !== '_' && k !== 'motion') scan(o[k], out);
    if (o.of) out.add(o.of);
    if (o.over && S._idx.has(o.over)) out.add(o.over);
    out.delete(o.id);
    return out;
  };
  S.dependentsOf = (ids) => {
    const dead = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of S.objects) {
        if (dead.has(o.id)) continue;
        for (const r of S.refsOf(o)) if (dead.has(r)) { dead.add(o.id); grew = true; break; }
      }
    }
    return dead;
  };
  S.remove = (ids) => {
    const dead = S.dependentsOf(ids);
    S.objects = S.objects.filter((o) => !dead.has(o.id));
    dead.forEach((id) => S.sel.delete(id));
    S.reindex();
    S.bump();
    return dead;
  };

  // ---------- (de)serialization ----------
  const replacer = (k, v) => (k[0] === '_' ? undefined : v);
  S.data = () => ({ v: 1, title: S.title, mode: S.mode, cam3: S.cam3, view: S.view, grid: S.grid, params: S.params, objects: S.objects, steps: S.steps, stepIdx: G.A ? G.A.P.idx : 0 });
  S.serialize = () => JSON.stringify(S.data(), replacer);
  S.snapshot = () => JSON.stringify({ title: S.title, params: S.params, objects: S.objects, steps: S.steps }, replacer);

  S.load = (data, opts = {}) => {
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    S.title = d.title || 'Untitled canvas';
    S.objects = (d.objects || []).map((o) => JSON.parse(JSON.stringify(o, replacer)));
    S.params = (d.params || []).map((p) => Object.assign({ min: 0, max: 10, anim: 'none', speed: 1 }, p));
    S.steps = d.steps ? JSON.parse(JSON.stringify(d.steps)) : [];
    if (d.view && !opts.keepView) S.view = Object.assign({ x: 0, y: 0, s: 56 }, d.view);
    if (d.grid) S.grid = Object.assign({ type: 'square', axes: true, labels: true, snap: true, extent: 6, floor: true, ortho: false }, d.grid);
    S.mode = d.mode || '2d';
    if (d.cam3 && !opts.keepView) S.cam3 = Object.assign({ yaw: -0.85, pitch: 0.5, dist: 20, tx: 0, ty: 0, tz: 1.5 }, d.cam3);
    S.sel.clear();
    S.clock.t = 0;
    S.vars = { t: 0 };
    env.vars = S.vars;
    S.syncVars();
    S.reindex();
    S.bump();
    G.emit('load');
  };

  // ---------- undo / redo ----------
  const H = (S.history = { undo: [], redo: [], last: null });
  S.resetHistory = () => { H.undo = []; H.redo = []; H.last = S.snapshot(); };
  S.commit = () => {
    const s = S.snapshot();
    if (s === H.last) return false;
    if (H.last != null) H.undo.push(H.last);
    if (H.undo.length > 120) H.undo.shift();
    H.last = s;
    H.redo = [];
    G.emit('commit');
    return true;
  };
  function restore(snap) {
    const d = JSON.parse(snap);
    S.title = d.title;
    S.objects = d.objects;
    S.params = d.params;
    S.steps = d.steps;
    S.reindex();
    S.syncVars();
    [...S.sel].forEach((id) => { if (!S.get(id)) S.sel.delete(id); });
    S.bump();
    G.emit('restore');
  }
  S.undo = () => { if (!H.undo.length) return; H.redo.push(H.last); H.last = H.undo.pop(); restore(H.last); G.emit('commit'); };
  S.redo = () => { if (!H.redo.length) return; H.undo.push(H.last); H.last = H.redo.pop(); restore(H.last); G.emit('commit'); };

  S.blank = () => S.load({ title: 'Untitled canvas', mode: S.mode, objects: [], params: [], steps: [], view: { x: 0, y: 0, s: 56 } });
  S.setMode = (m) => { S.mode = m; S.sel.clear(); S.bump(); G.emit('mode'); };
})(window.G = window.G || {});
