/* Interaction — pointer + keyboard handling, tools, selection, dragging, construction. */
(function (G) {
  'use strict';
  const S = G.S, R = G.R, { Expr } = G;

  const I = (G.I = {
    tool: 'select',
    opts: { sides: 5, lineKind: 'seg', wheelZoom: false },
    pend: null,
    hoverId: null,
    drag: null,
    pointers: new Map(),
    mouse: { sx: -1, sy: -1, wx: 0, wy: 0, inside: false },
    space: false, spacePanned: false,
  });

  const TOOLS = {
    select: { key: 'v', name: 'Select', hint: 'Click to select · drag to move · drag empty space to pan · Shift+drag for box select' },
    hand: { key: 'h', name: 'Pan', hint: 'Drag to pan the infinite canvas' },
    point: { key: 'p', name: 'Point', hint: 'Click to place a point · click on a shape to make a point that slides along it (Alt = free point)' },
    line: { key: 's', name: 'Line', hint: 'Click two points (or drag) to draw · choose segment, ray or line above' },
    circle: { key: 'c', name: 'Circle', hint: 'Click the centre, then click a point on the circle' },
    poly: { key: 'g', name: 'Polygon', hint: 'Click corners · click the first point (or press Enter) to close' },
    ngon: { key: 'n', name: 'Regular polygon', hint: 'Click the centre, then a corner · set the number of sides above' },
    rect: { key: 'r', name: 'Rectangle', hint: 'Click two opposite corners' },
    angle: { key: 'a', name: 'Angle', hint: 'Click a point on one arm, then the vertex, then a point on the other arm' },
    vec: { key: 'w', name: 'Vector', hint: 'Click the tail, then the head' },
    mid: { key: 'm', name: 'Midpoint', hint: 'Click a segment — or two points' },
    perp: { key: 'd', name: 'Perpendicular', hint: 'Click a line, then a point it should pass through' },
    par: { key: 'q', name: 'Parallel', hint: 'Click a line, then a point it should pass through' },
    int: { key: 'x', name: 'Intersection', hint: 'Click two lines / circles that cross' },
    func: { key: 'f', name: 'Function graph', hint: 'Click to add y = f(x) — then type your formula in the panel' },
    text: { key: 't', name: 'Text', hint: 'Click to add a label · use {expr} for live numbers, e.g. {dist(A,B)}' },
    pen: { key: 'b', name: 'Pen', hint: 'Draw freehand — annotate while you teach' },
    eraser: { key: 'e', name: 'Eraser', hint: 'Click (or drag over) anything to delete it' },
  };
  const TOOLS3 = {
    select: { key: 'v', name: 'Select', hint: 'Click to select · drag a point along the floor (hold Alt to lift it) · drag empty space to orbit' },
    hand: { key: 'h', name: 'Orbit', hint: 'Drag to orbit · Shift/right-drag to pan · scroll to zoom' },
    p3: { key: 'p', name: 'Point', hint: 'Click the floor to place a point · then set its height (z) in the panel or Alt-drag it' },
    seg3: { key: 's', name: 'Segment', hint: 'Click two points (or floor spots) to join them' },
    vec3: { key: 'w', name: 'Vector', hint: 'Click the tail, then the head' },
    box: { key: 'b', name: 'Box', hint: 'Click the floor to drop a box' },
    sphere: { key: 'o', name: 'Sphere', hint: 'Click the floor to drop a sphere' },
    cyl: { key: 'y', name: 'Cylinder', hint: 'Click the floor to drop a cylinder' },
    cone: { key: 'k', name: 'Cone', hint: 'Click the floor to drop a cone' },
    surf: { key: 'f', name: 'Surface z = f(x, y)', hint: 'Click to add a surface — then type your formula in the panel' },
    curve3: { key: 'u', name: '3D curve', hint: 'Click to add a parametric curve (x(u), y(u), z(u))' },
    text3: { key: 't', name: 'Text', hint: 'Click the floor to place a label · {expr} shows live numbers' },
    eraser: { key: 'e', name: 'Eraser', hint: 'Click anything to delete it' },
  };
  I.TOOLS = TOOLS;
  I.TOOLS3 = TOOLS3;
  I.toolsFor = () => (S.mode === '3d' ? TOOLS3 : TOOLS);
  I.toolInfo = (n) => I.toolsFor()[n] || TOOLS[n] || TOOLS3[n] || TOOLS.select;

  // Register a tool from an external file (loads after interact.js).
  // G.I.registerTool('mytool', { key, name, hint, onDown?, onMove?, onUp?, onDbl?, onKey? }, is3d?)
  I.registerTool = (name, def, is3d = false) => { (is3d ? TOOLS3 : TOOLS)[name] = def; };
  G.zoomBy = (f) => { G.A.userCam = true; if (S.mode === '3d') G.T3.zoom(f); else R.zoomAt(R.w / 2, R.h / 2, f); S.bump(); G.invalidate(); G.emit('view'); };

  const clean = (v) => +v.toFixed(9);
  const isTouch = (e) => e.pointerType === 'touch';

  // ---------- coordinates ----------
  function pos(e) {
    const r = R.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const [wx, wy] = R.s2w(sx, sy);
    return { sx, sy, wx, wy };
  }
  const snapStep = () => (S.grid.snapMajor ? R.gridInfo.major : R.gridInfo.minor);
  function snapped(p, e) {
    if (S.grid.snap && !(e && e.altKey) && S.grid.type !== 'none') {
      const m = snapStep();
      return [clean(Math.round(p.wx / m) * m), clean(Math.round(p.wy / m) * m)];
    }
    return [clean(p.wx), clean(p.wy)];
  }

  // ---------- tool state ----------
  I.setTool = (name) => {
    if (!I.toolsFor()[name]) return;
    cancelPending();
    I.tool = name;
    I.drag = null;
    updateCursor();
    G.emit('tool');
    G.invalidate();
  };
  function updateCursor() {
    const c = R.canvas;
    c.style.cursor = I.tool === 'select' ? 'default' : I.tool === 'hand' ? 'grab' : I.tool === 'eraser' ? 'cell' : 'crosshair';
    if (S.mode === '3d' && I.tool === 'select') c.style.cursor = 'grab';
  }
  function cancelPending() {
    const p = I.pend;
    I.pend = null;
    if (!p) return;
    const used = new Set();
    S.objects.forEach((o) => S.refsOf(o).forEach((r) => used.add(r)));
    const gone = p.created.filter((id) => !used.has(id));
    if (gone.length) { S.remove(gone); }
    G.emit('scene');
  }
  I.cancel = cancelPending;
  const pend = () => (I.pend = I.pend && I.pend.tool === I.tool ? I.pend : { tool: I.tool, refs: [], created: [], objs: [] });

  function create(o, opts = {}) {
    S.add(o);
    G.A.onCreated(o);
    if (!opts.keepSel) { S.sel.clear(); S.sel.add(o.id); }
    return o;
  }
  function newPoint(x, y, extra = {}) {
    const base = { type: 'point' };
    if (x != null) { base.x = x; base.y = y; }
    const o = create(Object.assign(base, extra), { keepSel: true });
    o.label = o.id;
    return o;
  }
  function pointAt(p, e) {
    const hit = G.pick(p.sx, p.sy, { tol: isTouch(e) ? 16 : 10, only: (o) => o.type === 'point' });
    return hit || null;
  }
  // an existing point under the cursor, or a fresh free point
  function pickOrCreate(p, e) {
    const ex = pointAt(p, e);
    if (ex) return ex.id;
    const [x, y] = snapped(p, e);
    const o = newPoint(x, y);
    pend().created.push(o.id);
    return o.id;
  }
  const commit = () => { S.commit(); G.emit('scene'); G.invalidate(); };
  const toast = (m) => G.emit('toast', m);

  // ---------- creation tools ----------
  function finishShape(o) {
    const p = I.pend;
    // points that are now referenced by a real shape are kept
    I.pend = null;
    if (p) p.created = [];
    create(o);
    commit();
  }

  function toolDown(e, p) {
    const t = I.tool;
    if (t === 'point') {
      const ex = pointAt(p, e);
      if (ex) { S.sel.clear(); S.sel.add(ex.id); G.emit('select'); return; }
      const host = !e.altKey && G.pick(p.sx, p.sy, { tol: isTouch(e) ? 14 : 9, noPoints: true, only: G.Geo.glideable });
      if (host) {
        const tt = clean(G.Geo.paramFor(host, p.wx, p.wy));
        const o = newPoint(null, null, { def: { k: 'on', o: host.id, t: tt } });
        S.sel.clear(); S.sel.add(o.id);
      } else {
        const [x, y] = snapped(p, e);
        const o = newPoint(x, y);
        S.sel.clear(); S.sel.add(o.id);
      }
      commit();
      return;
    }
    if (t === 'func') {
      const o = create({ type: 'func', e: 'x^2/4', color: 'clay', w: 2.6 });
      commit(); G.emit('focus', 'e');
      return;
    }
    if (t === 'text') {
      const [x, y] = snapped(p, e);
      create({ type: 'text', x, y, text: 'Text', size: 22 });
      commit(); G.emit('focus', 'text');
      return;
    }
    if (t === 'pen') {
      I.drag = { kind: 'pen', pts: [[clean(p.wx), clean(p.wy)]], obj: null };
      return;
    }
    if (t === 'eraser') { I.drag = { kind: 'erase' }; erase(p, e); return; }

    if (t === 'mid') {
      const P = pend();
      if (!P.refs.length) {
        const ptHit = pointAt(p, e);
        if (!ptHit) {
          const seg = G.pick(p.sx, p.sy, { noPoints: true, only: (o) => S.isLineLike(o) && typeof o.a === 'string' && typeof o.b === 'string' });
          if (seg) { makeMid(seg.a, seg.b); return; }
        }
      }
    }
    if (t === 'perp' || t === 'par') {
      const P = pend();
      const ptHit = pointAt(p, e);
      const lineHit = !ptHit && G.pick(p.sx, p.sy, { noPoints: true, only: S.isLineLike });
      if (lineHit) P.line = lineHit.id;
      else P.pt = ptHit ? ptHit.id : pickOrCreate(p, e);
      if (P.line && P.pt) {
        finishShape({ type: 'line', a: P.pt, [t === 'perp' ? 'perp' : 'par']: P.line, color: 'sky', dash: t === 'par' ? false : false });
      }
      return;
    }
    if (t === 'int') {
      const P = pend();
      const hit = G.pick(p.sx, p.sy, { noPoints: true, only: G.Geo.intersectable, tol: 10 });
      if (!hit) { toast('Click a line or circle'); return; }
      if (P.objs.includes(hit.id)) return;
      P.objs.push(hit.id);
      if (P.objs.length === 2) {
        const [A, B] = P.objs.map((id) => S.get(id));
        S.bump();
        const c0 = G.Geo.intersect(A, B, 0), c1 = G.Geo.intersect(A, B, 1);
        const ok0 = isFinite(c0.x), ok1 = isFinite(c1.x);
        if (!ok0 && !ok1) { toast("Those two don't cross"); I.pend = null; return; }
        const d = (c) => (isFinite(c.x) ? Math.hypot(c.x - p.wx, c.y - p.wy) : Infinity);
        const i = d(c1) < d(c0) ? 1 : 0;
        I.pend = null;
        const o = newPoint(null, null, { def: { k: 'int', a: A.id, b: B.id, i } });
        S.sel.clear(); S.sel.add(o.id);
        commit();
      }
      return;
    }

    // ---- multi-click point tools ----
    const P = pend();
    const id = pickOrCreate(p, e);
    if (t === 'poly') {
      if (P.refs.length >= 3 && id === P.refs[0]) { finishPoly(); return; }
      if (!P.refs.includes(id)) P.refs.push(id);
      return;
    }
    if (!P.refs.length) { P.refs.push(id); P.down = { sx: p.sx, sy: p.sy }; return; }
    if (id === P.refs[0] && t !== 'angle') return;
    P.refs.push(id);
    const need = t === 'angle' ? 3 : 2;
    if (P.refs.length < need) return;
    const [a, b, c] = P.refs;
    switch (t) {
      case 'line': finishShape({ type: I.opts.lineKind, a, b }); break;
      case 'vec': finishShape({ type: 'vec', a, b, color: 'clay', w: 2.6 }); break;
      case 'circle': finishShape({ type: 'circle', c: a, thru: b, fill: 0.07 }); break;
      case 'ngon': finishShape({ type: 'ngon', c: a, v: b, n: I.opts.sides, fill: 0.12 }); break;
      case 'angle': finishShape({ type: 'angle', a, v: b, b: c, color: 'clay' }); break;
      case 'mid': makeMid(a, b); break;
      case 'rect': {
        const A = S.get(a), C = S.get(b);
        I.pend = null;
        const B = newPoint(`${C.id}.x`, `${A.id}.y`);
        const D = newPoint(`${A.id}.x`, `${C.id}.y`);
        create({ type: 'poly', pts: [A.id, B.id, C.id, D.id], fill: 0.12 });
        commit();
        break;
      }
    }
  }
  function makeMid(a, b) {
    I.pend = null;
    const o = newPoint(`(${a}.x+${b}.x)/2`, `(${a}.y+${b}.y)/2`, { color: 'clay' });
    S.sel.clear(); S.sel.add(o.id);
    commit();
  }
  function finishPoly() {
    const P = I.pend;
    if (!P || P.refs.length < 3) { cancelPending(); return; }
    finishShape({ type: 'poly', pts: P.refs.slice(), fill: 0.12 });
  }
  function erase(p, e) {
    const hit = G.pick(p.sx, p.sy, { tol: 10 });
    if (hit) { S.remove([hit.id]); G.emit('scene'); G.invalidate(); I.drag.erased = true; }
  }

  function toolUp(e, p) {
    const d = I.drag;
    if (d && d.kind === 'pen') {
      if (d.pts.length > 1) { create({ type: 'pen', pts: d.pts, color: 'clay', w: 3.2 }); commit(); }
      I.drag = null;
      return;
    }
    if (d && d.kind === 'erase') { if (d.erased) commit(); I.drag = null; return; }
    // click-and-drag style creation: pointer travelled → treat release as second click
    const P = I.pend;
    if (P && P.down && P.refs.length === 1 && Math.hypot(p.sx - P.down.sx, p.sy - P.down.sy) > 10 && ['line', 'vec', 'circle', 'ngon', 'rect', 'mid'].includes(I.tool)) {
      P.down = null;
      toolDown(e, p);
    } else if (P) P.down = null;
  }

  // ---------- select tool ----------
  function translatable(ids) {
    // gather everything a selection can move: free points + literal-number fields
    const pts = new Set(), other = [];
    const addRef = (r) => { if (typeof r === 'string') { const q = S.get(r); if (q && q.type === 'point') pts.add(q.id); } };
    ids.forEach((id) => {
      const o = S.get(id);
      if (!o) return;
      if (o.type === 'point') { pts.add(o.id); return; }
      ['a', 'b', 'c', 'v', 'thru'].forEach((k) => {
        addRef(o[k]);
        if (Array.isArray(o[k]) && o[k].every((n) => typeof n === 'number')) other.push({ o, k });
      });
      (o.pts || []).forEach((r) => { if (o.type !== 'pen') addRef(r); });
      if (o.type === 'pen' || ((o.type === 'text' || o.type === 'tiles') && typeof o.x === 'number' && typeof o.y === 'number')) other.push({ o });
    });
    return { pts: [...pts].map((id) => S.get(id)).filter((o) => S.isFree(o)), other };
  }
  function beginMove(p, e, hit) {
    const ids = [...S.sel];
    if (hit.type === 'point' && ids.length === 1) {
      if (S.isFree(hit)) I.drag = { kind: 'pt', o: hit, ox: hit.x, oy: hit.y, moved: false };
      else if (hit.def && hit.def.k === 'on' && typeof hit.def.t === 'number') I.drag = { kind: 'glide', o: hit, moved: false };
      else { toast(hit.def ? 'This point is defined by a construction — move what it depends on' : 'This point is driven by a formula — edit it in the panel'); I.drag = null; }
      return;
    }
    const T = translatable(ids);
    if (!T.pts.length && !T.other.length) { I.drag = null; return; }
    I.drag = {
      kind: 'move', start: [p.wx, p.wy], moved: false,
      pts: T.pts.map((o) => [o, o.x, o.y]),
      other: T.other.map((r) => (r.k ? { r, v: r.o[r.k].slice() } : r.o.type === 'pen' ? { r, pts: r.o.pts.map((q) => q.slice()) } : { r, x: r.o.x, y: r.o.y })),
    };
  }
  function selectDown(e, p) {
    const hit = G.pick(p.sx, p.sy, { tol: isTouch(e) ? 16 : 9 });
    if (hit) {
      if (e.shiftKey) { S.sel.has(hit.id) ? S.sel.delete(hit.id) : S.sel.add(hit.id); }
      else if (!S.sel.has(hit.id)) { S.sel.clear(); S.sel.add(hit.id); }
      G.emit('select');
      beginMove(p, e, hit);
    } else {
      if (e.shiftKey) I.drag = { kind: 'marquee', x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy };
      else {
        if (S.sel.size) { S.sel.clear(); G.emit('select'); }
        I.drag = { kind: 'pan', sx: p.sx, sy: p.sy, vx: S.view.x, vy: S.view.y };
      }
    }
    G.invalidate();
  }
  function dragMove(e, p) {
    const d = I.drag;
    if (!d) return;
    switch (d.kind) {
      case 'pan':
        G.A.userCam = true;
        S.view.x = d.vx - (p.sx - d.sx) / S.view.s;
        S.view.y = d.vy + (p.sy - d.sy) / S.view.s;
        break;
      case 'pt': {
        let [x, y] = snapped(p, e);
        d.moved = true;
        if (d.o.motion) [x, y] = S.invMotion(d.o.motion, x, y);
        d.o.x = x; d.o.y = y;
        break;
      }
      case 'glide': {
        const host = S.get(d.o.def.o);
        if (host) { S.bump(); d.o.def.t = clean(G.Geo.paramFor(host, p.wx, p.wy)); d.moved = true; }
        break;
      }
      case 'move': {
        let dx = p.wx - d.start[0], dy = p.wy - d.start[1];
        if (S.grid.snap && !e.altKey && S.grid.type !== 'none') {
          const m = snapStep();
          dx = Math.round(dx / m) * m; dy = Math.round(dy / m) * m;
        }
        d.moved = d.moved || Math.abs(dx) + Math.abs(dy) > 0;
        d.pts.forEach(([o, x, y]) => { o.x = clean(x + dx); o.y = clean(y + dy); });
        d.other.forEach((r) => {
          if (r.r.k) r.r.o[r.r.k] = [clean(r.v[0] + dx), clean(r.v[1] + dy)];
          else if (r.pts) r.r.o.pts = r.pts.map((q) => [clean(q[0] + dx), clean(q[1] + dy)]);
          else { r.r.o.x = clean(r.x + dx); r.r.o.y = clean(r.y + dy); }
        });
        break;
      }
      case 'marquee': d.x1 = p.sx; d.y1 = p.sy; break;
      case 'pen': {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot((p.wx - last[0]) * S.view.s, (p.wy - last[1]) * S.view.s) > 3) d.pts.push([clean(p.wx), clean(p.wy)]);
        break;
      }
      case 'erase': erase(p, e); break;
    }
    S.bump();
    G.invalidate();
  }
  function dragUp(e, p) {
    const d = I.drag;
    I.drag = null;
    if (!d) return;
    if (d.kind === 'marquee') {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      S.objects.forEach((o) => {
        if (!o._hit || o.locked) return;
        const inside = o._hit.some((pr) => {
          const q = pr.k === 'p' || pr.k === 'c' ? [pr.x, pr.y] : pr.k === 's' ? [(pr.x1 + pr.x2) / 2, (pr.y1 + pr.y2) / 2] : pr.k === 'box' ? [pr.x + pr.w / 2, pr.y + pr.h / 2] : pr.pts[0];
          return q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
        });
        if (inside) S.sel.add(o.id);
      });
      G.emit('select');
    } else if (d.moved) commit();
    else if (d.kind === 'pt' || d.kind === 'move' || d.kind === 'glide') G.emit('select');
    G.invalidate();
  }

  // ---------- pointer events ----------
  function onDown(e) {
    R.canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    I.pointers.set(e.pointerId, { sx: p.sx, sy: p.sy });
    if (I.pointers.size === 2) {
      // pinch / two-finger pan
      I.drag = null;
      const [a, b] = [...I.pointers.values()];
      I.pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2 };
      return;
    }
    if (S.mode === '3d') {
      if (I.space) I.spacePanned = true;
      G.T3.down(e, p); G.invalidate(); return;
    }
    if (e.button === 1 || e.button === 2 || I.space || I.tool === 'hand') {
      I.drag = { kind: 'pan', sx: p.sx, sy: p.sy, vx: S.view.x, vy: S.view.y };
      R.canvas.style.cursor = 'grabbing';
      if (I.space) I.spacePanned = true;
      return;
    }
    if (I.tool === 'select') selectDown(e, p);
    else toolDown(e, p);
    G.invalidate();
  }
  function onMove(e) {
    const p = pos(e);
    I.mouse = { sx: p.sx, sy: p.sy, wx: p.wx, wy: p.wy, inside: true, alt: e.altKey };
    if (I.pointers.has(e.pointerId)) I.pointers.set(e.pointerId, { sx: p.sx, sy: p.sy });
    if (I.pointers.size === 2 && I.pinch) {
      const [a, b] = [...I.pointers.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy), cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2;
      if (S.mode === '3d') {
        G.T3.zoom(d / I.pinch.d); G.T3.pan(cx - I.pinch.cx, cy - I.pinch.cy);
        I.pinch = { d, cx, cy }; S.bump(); G.invalidate(); return;
      }
      G.A.userCam = true;
      R.zoomAt(cx, cy, d / I.pinch.d);
      S.view.x -= (cx - I.pinch.cx) / S.view.s;
      S.view.y += (cy - I.pinch.cy) / S.view.s;
      I.pinch = { d, cx, cy };
      G.invalidate();
      return;
    }
    if (I.drag) { if (S.mode === '3d') G.T3.move(e, p); else { dragMove(e, p); if (I.drag && I.drag.kind === 'pan') { S.bump(); } } }
    else {
      const h = S.mode === '3d' ? (['select', 'eraser'].includes(I.tool) ? G.pick(p.sx, p.sy, { tol: 9 }) : null) : (I.tool === 'select' || I.tool === 'eraser' ? G.pick(p.sx, p.sy, { tol: 9 }) : (I.tool === 'point' ? null : pointAt(p, e)));
      const id = h ? h.id : null;
      if (id !== I.hoverId) { I.hoverId = id; R.hoverId = id; }
      if (I.tool === 'select') R.canvas.style.cursor = h ? 'pointer' : 'default';
      G.invalidate();
    }
    G.emit('mouse');
  }
  function onUp(e) {
    const p = pos(e);
    I.pointers.delete(e.pointerId);
    if (I.pinch) { if (I.pointers.size < 2) I.pinch = null; return; }
    if (S.mode === '3d') { G.T3.up(); updateCursor(); G.invalidate(); return; }
    if (I.drag && I.drag.kind === 'pan') { I.drag = null; updateCursor(); G.invalidate(); return; }
    if (I.tool === 'select') dragUp(e, p);
    else toolUp(e, p);
    G.invalidate();
  }
  function onLeave() { I.mouse.inside = false; I.hoverId = null; R.hoverId = null; G.invalidate(); G.emit('mouse'); }
  function onDbl(e) {
    if (I.tool === 'poly') { finishPoly(); }
  }

  function onWheel(e) {
    e.preventDefault();
    if (S.mode === '3d') { G.T3.wheel(e); return; }
    const p = pos(e);
    let dy = e.deltaY, dx = e.deltaX;
    if (e.deltaMode === 1) { dy *= 33; dx *= 33; }
    G.A.userCam = true;
    const trackpadPan = !e.ctrlKey && !e.metaKey && !I.opts.wheelZoom && e.deltaMode === 0 && (dx !== 0 || Math.abs(dy) < 38) && Math.abs(dy) < 60;
    if (trackpadPan) {
      S.view.x += dx / S.view.s;
      S.view.y -= dy / S.view.s;
    } else {
      const k = e.ctrlKey ? 0.012 : 0.0016;
      R.zoomAt(p.sx, p.sy, Math.exp(-dy * k));
    }
    S.bump();
    G.invalidate();
    G.emit('view');
  }

  // ---------- keyboard ----------
  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };

  I._ = { create, commit, pend, toast };
  I.translatable = translatable;
  I.deleteSelection = () => {
    if (!S.sel.size) return;
    S.remove([...S.sel]);
    S.sel.clear();
    commit();
    G.emit('select');
  };
  I.duplicate = () => {
    if (!S.sel.size) return;
    const ids = new Set(S.sel);
    // include the free points that the selected shapes are built from
    [...ids].forEach((id) => S.refsOf(S.get(id)).forEach((r) => { const q = S.get(r); if (q && q.type === 'point' && S.isFree(q)) ids.add(r); }));
    const map = {};
    const off = R.gridInfo.minor * (R.gridInfo.div === 4 ? 2 : 1) * 2 || 1;
    const chosen = S.objects.filter((o) => ids.has(o.id));
    chosen.forEach((o) => { map[o.id] = S.newId(o.type); S._idx.set(map[o.id], { id: map[o.id] }); });
    const SKIP = new Set(['id', 'type', 'label', 'text', 'color', 'kind', 'mode', 'font', 'anchor', 'unit']);
    const remap = (v, key) => {
      if (typeof v === 'string' && !SKIP.has(key)) return v.replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (w) => (map[w] ? map[w] : w));
      if (Array.isArray(v)) return v.map((x) => remap(x, key));
      if (v && typeof v === 'object') { const r = {}; for (const k in v) r[k] = remap(v[k], k); return r; }
      return v;
    };
    const news = [];
    chosen.forEach((o) => {
      const c = JSON.parse(JSON.stringify(o, (k, v) => (k[0] === '_' ? undefined : v)));
      const n = remap(c);
      n.id = map[o.id];
      if (n.type === 'point') { n.label = n.id; if (S.isFree(n)) { n.x = clean(n.x + off); n.y = clean(n.y - off); } }
      if (n.type === 'p3') { n.label = n.id; if (S.isFree(n)) { n.x += 1; n.y -= 1; } }
      for (const k of ['c', 'p']) if (G.is3(n) && Array.isArray(n[k]) && n[k].every((v) => typeof v === 'number')) { n[k] = [n[k][0] + 1, n[k][1] - 1, n[k][2]]; }
      news.push(n);
    });
    news.forEach((n) => S._idx.delete(n.id));
    S.sel.clear();
    news.forEach((n) => { S.add(n); G.A.onCreated(n); S.sel.add(n.id); });
    commit();
    G.emit('select');
  };

  function onKey(e) {
    if (typing(e)) {
      if (e.key === 'Escape') { e.target.blur(); G.invalidate(); }
      return;
    }
    const k = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (e.target && e.target.tagName === 'BUTTON') {
      if (k === 'enter') return;               // let a focused button handle its own Enter
      if (k === ' ') e.target.blur();           // Space belongs to pan / play
    }
    if (k === ' ') {
      e.preventDefault();
      if (!I.space) { I.space = true; I.spacePanned = false; R.canvas.style.cursor = 'grab'; }
      return;
    }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? S.redo() : S.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); S.redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); I.duplicate(); return; }
    if (mod && k === 'a') { e.preventDefault(); S.objects.forEach((o) => S.sel.add(o.id)); G.emit('select'); G.invalidate(); return; }
    if (mod) return;
    if (k === 'escape') {
      if (document.body.classList.contains('focus')) { G.emit('focus-toggle'); return; }
      if (I.pend) cancelPending(); else if (S.sel.size) { S.sel.clear(); G.emit('select'); } else I.setTool('select');
      G.invalidate();
      return;
    }
    if (k === 'enter') {
      if (I.tool === 'poly' && I.pend) finishPoly(); else G.A.play();
      return;
    }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); I.deleteSelection(); return; }
    if (k === 'arrowright') { e.preventDefault(); G.A.next(); return; }
    if (k === 'arrowleft') { e.preventDefault(); G.A.prev(); return; }
    if (k === 'z') { G.emit('focus-toggle'); return; }
    if (k === '0') { G.A.fit(); return; }
    if (k === '=' || k === '+') { G.zoomBy(1.25); return; }
    if (k === '-') { G.zoomBy(0.8); return; }
    if (k === '?') { G.emit('help'); return; }
    const set = I.toolsFor();
    for (const name in set) if (set[name].key === k) { I.setTool(name); return; }
  }
  function onKeyUp(e) {
    if (e.key === ' ' && I.space) {
      I.space = false;
      updateCursor();
      if (!I.spacePanned && !typing(e)) G.A.play();
    }
  }

  // ---------- overlay (rubber bands, snapping cue, marquee) ----------
  function overlay(c) {
    const P = I.pend, m = I.mouse;
    const d = I.drag;
    if (d && d.kind === 'marquee') {
      c.fillStyle = R.rgba('clay', 0.08); c.strokeStyle = R.rgba('clay', 0.8); c.lineWidth = 1.2; c.setLineDash([5, 4]);
      c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); c.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); c.setLineDash([]);
    }
    if (d && d.kind === 'pen') {
      c.strokeStyle = R.color('clay'); c.lineWidth = 3.2; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); d.pts.forEach((q, i) => { const [x, y] = R.w2s(q[0], q[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    }
    if (!m.inside || I.tool === 'select' || I.tool === 'hand' || d) return;
    const create = !['func', 'text', 'pen', 'eraser', 'int', 'select'].includes(I.tool);
    const ex = create && pointAt(m, { pointerType: 'mouse' });
    let cx, cy;
    if (ex) { const q = S.evalPoint(ex); [cx, cy] = R.w2s(q.x, q.y); }
    else {
      const [wx, wy] = snapped(m, { altKey: m.alt });
      [cx, cy] = R.w2s(wx, wy);
      if (create) {
        c.beginPath(); c.arc(cx, cy, 3.5, 0, Math.PI * 2); c.fillStyle = R.rgba('clay', 0.85); c.fill();
      }
    }
    if (ex) { c.beginPath(); c.arc(cx, cy, 11, 0, Math.PI * 2); c.strokeStyle = R.rgba('clay', 0.9); c.lineWidth = 2; c.stroke(); }
    if (!P || !P.refs.length) return;
    const pts = P.refs.map((id) => S.evalPoint(S.get(id))).map((q) => R.w2s(q.x, q.y));
    c.strokeStyle = R.rgba('clay', 0.85); c.lineWidth = 2; c.setLineDash([7, 6]); c.lineCap = 'round';
    c.beginPath();
    const t = I.tool;
    if (t === 'circle') { const r = Math.hypot(cx - pts[0][0], cy - pts[0][1]); c.moveTo(pts[0][0], pts[0][1]); c.lineTo(cx, cy); c.moveTo(pts[0][0] + r, pts[0][1]); c.arc(pts[0][0], pts[0][1], r, 0, Math.PI * 2); }
    else if (t === 'rect') { c.rect(pts[0][0], pts[0][1], cx - pts[0][0], cy - pts[0][1]); }
    else if (t === 'ngon') {
      const n = I.opts.sides, bx = cx - pts[0][0], by = cy - pts[0][1];
      for (let k = 0; k <= n; k++) { const a = (2 * Math.PI * k) / n, x = pts[0][0] + bx * Math.cos(a) + by * Math.sin(a), y = pts[0][1] - bx * Math.sin(a) + by * Math.cos(a); k ? c.lineTo(x, y) : c.moveTo(x, y); }
    } else {
      pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
      c.lineTo(cx, cy);
      if (t === 'poly' && pts.length >= 2) c.lineTo(pts[0][0], pts[0][1]);
    }
    c.stroke(); c.setLineDash([]);
  }
  R.overlay = overlay;

  // ---------- init ----------
  I.init = (canvas) => {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    updateCursor();
  };
})(window.G = window.G || {});
