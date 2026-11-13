/* Lesson kit — infrastructure for all lesson files.
     G.LESSONS  — the shared array every lesson file pushes into
     G.Lessons  — { build } step compiler, called by ui.js
     G.Kit (K)  — helpers so lesson files read as pure data

   Usage in a lesson file:
     const K = G.Kit, LESSONS = G.LESSONS;
     K.add({ id, title, topic, levels, blurb, art, view, params, objects, steps }); */
(function (G) {
  'use strict';
  const K = (G.Kit = {});

  // ===== lesson registry =================================================

  const LESSONS = (G.LESSONS = []);

  // Register a lesson (topic/stage ordering is decided in curriculum.js).
  // When a full lesson file is lazy-loaded, K.add merges the full definition into
  // the existing lightweight metadata object that curriculum.js already sorted into
  // G.LESSONS — so all existing references stay valid and gain objects/params/steps.
  K.add = (def) => {
    const meta = G.LESSONS_META && G.LESSONS_META.find((m) => m.id === def.id);
    if (meta) {
      Object.assign(meta, def);          // enrich in-place; same object reference
      if (!LESSONS.includes(meta)) LESSONS.push(meta);
      return meta;
    }
    LESSONS.push(def);
    return def;
  };

  // ===== lazy file loader ================================================
  // ensureLoaded(meta) → Promise<meta>
  // If meta already has objects it is fully loaded; return immediately.
  // Otherwise inject the lesson's source file as a <script> tag once.
  // Multiple calls for lessons from the same file share one in-flight request.
  const _loadedFiles  = new Set();
  const _pendingFiles = new Map(); // file → Promise<void>

  // After a lesson file loads, some older files use LESSONS.push() directly (bypassing K.add).
  // Those push a standalone full-def object onto the END of G.LESSONS, leaving a duplicate.
  // This reconciles them: merges the full def into the metadata object and removes the extra entry.
  function _reconcileFile() {
    if (!G.LESSONS_META) return;
    const metaSet = new Set(G.LESSONS_META);
    for (let i = G.LESSONS.length - 1; i >= 0; i--) {
      const l = G.LESSONS[i];
      if (metaSet.has(l) || !l.id) continue; // already a metadata object; skip
      const meta = G.LESSONS_META.find((m) => m.id === l.id);
      if (meta) { Object.assign(meta, l); G.LESSONS.splice(i, 1); } // merge + remove dup
    }
  }

  K.ensureLoaded = (meta) => {
    if (meta && meta.objects) return Promise.resolve(meta);
    const file = meta && meta._file;
    if (!file) return Promise.resolve(meta);            // metadata-only fallback
    if (_loadedFiles.has(file)) return Promise.resolve(meta);
    if (_pendingFiles.has(file)) return _pendingFiles.get(file).then(() => meta);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/' + file + (G._v ? '?v=' + G._v : '');
      s.onload  = () => { _loadedFiles.add(file); _pendingFiles.delete(file); _reconcileFile(); resolve(); };
      s.onerror = () => { _pendingFiles.delete(file); reject(new Error('Could not load ' + file)); };
      document.head.appendChild(s);
    });
    _pendingFiles.set(file, p);
    return p.then(() => meta);
  };

  // A step's caption: cap('explorer text', 'student text', 'engineer text').
  // Pass null / '' to omit a level.
  K.cap = (k, s, e) => { const c = {}; if (k) c.k = k; if (s) c.s = s; if (e) c.e = e; return c; };

  // ===== step compiler ===================================================

  // Turns a lesson's delta-based steps into full per-step keyframe snapshots.
  // Each step in a lesson definition is a *delta* from the previous one —
  // reveal/hide objects, set sliders, move points, shift the camera.
  // build() accumulates those deltas and snapshots the full state at each step
  // so the animation engine (anim.js) can tween between them directly.
  function build(def) {
    const objects = JSON.parse(JSON.stringify(def.objects));
    const params  = JSON.parse(JSON.stringify(def.params || []));
    const view    = Object.assign({ x: 0, y: 0, s: 56 }, def.view || {});

    // Objects first revealed in a step start hidden so they can be animated in.
    const shown = {};
    (def.steps || []).forEach((st) =>
      (st.reveal || []).forEach((r) => { shown[Array.isArray(r) ? r[0] : r] = 1; })
    );
    objects.forEach((o) => {
      if (o.id in shown) { if (o.show == null) o.show = 0; if (o.draw == null) o.draw = 0; }
    });

    // Seed the running state from the initial lesson definition.
    const c3 = Object.assign({ yaw: -0.85, pitch: 0.5, dist: 20, tx: 0, ty: 0, tz: 1.5 }, def.cam3 || {});
    const c3arr = (c) => [c.yaw, c.pitch, c.dist, c.tx, c.ty, c.tz];
    const st = { pts: {}, prm: {}, ob: {}, cam: [view.x, view.y, view.s], cam3: c3arr(c3) };
    objects.forEach((o) => {
      st.ob[o.id] = [o.show == null ? 1 : o.show, o.draw == null ? 1 : o.draw];
      if (o.type === 'point' && !o.def && typeof o.x === 'number' && typeof o.y === 'number')
        st.pts[o.id] = [o.x, o.y];
      if (o.type === 'p3' && ['x', 'y', 'z'].every((k) => typeof o[k] === 'number'))
        st.pts[o.id] = [o.x, o.y, o.z];
    });
    params.forEach((p) => { if (!p.anim || p.anim === 'none') st.prm[p.name] = p.value; });

    // Walk each step's delta, mutate the running state, snapshot it.
    const steps = (def.steps || []).map((s) => {
      (s.reveal || []).forEach((r) => {
        const [id, v] = Array.isArray(r) ? r : [r, 1];
        st.ob[id] = [v, 1];
      });
      (s.hide  || []).forEach((id) => { st.ob[id] = [0, 1]; });
      Object.entries(s.draw || {}).forEach(([id, v]) => {
        st.ob[id] = [st.ob[id] ? st.ob[id][0] : 1, v];
      });
      Object.entries(s.set  || {}).forEach(([k, v]) => { st.prm[k] = v; });
      Object.entries(s.move || {}).forEach(([k, v]) => { st.pts[k] = v.slice(); });
      if (s.cam) st.cam = s.cam.slice();
      if (s.cam3) {
        const cur = { yaw: st.cam3[0], pitch: st.cam3[1], dist: st.cam3[2],
                      tx: st.cam3[3], ty: st.cam3[4], tz: st.cam3[5] };
        st.cam3 = c3arr(Object.assign(cur, s.cam3));
      }
      const step = { cap: s.cap, state: JSON.parse(JSON.stringify(st)) };
      ['dur', 'hold', 'ease'].forEach((k) => { if (s[k] != null) step[k] = s[k]; });
      return step;
    });

    return {
      v: 1, title: def.title, mode: def.mode || '2d', cam3: c3, view,
      grid: Object.assign({ type: 'square', axes: true, labels: true, snap: true }, def.grid || {}),
      params, objects, steps,
    };
  }

  K.build = build;
  G.Lessons = { build }; // ui.js calls G.Lessons.build(def)

  // ===== object helpers ==================================================

  K.pt = (id, x, y, o = {}) => Object.assign({ type: 'point', id, x, y, label: id }, o);
  // a formula-driven point with no label (not draggable: x or y is a string)
  K.dep = (id, x, y, o = {}) => Object.assign({ type: 'point', id, x, y, label: '', size: 6 }, o);
  K.dot = (id, x, y, color, size = 8, o = {}) => Object.assign({ type: 'point', id, x, y, label: '', color, size }, o);
  K.seg = (id, a, b, o = {}) => Object.assign({ type: 'seg', id, a, b }, o);
  K.vec = (id, a, b, o = {}) => Object.assign({ type: 'vec', id, a, b }, o);
  K.line = (id, a, b, o = {}) => Object.assign({ type: 'line', id, a, b }, o);
  K.poly = (id, pts, o = {}) => Object.assign({ type: 'poly', id, pts }, o);
  K.circle = (id, c, r, o = {}) => Object.assign({ type: 'circle', id, c, r, fill: 0 }, o);
  K.curve = (id, xe, ye, u0, u1, o = {}) => Object.assign({ type: 'curve', id, xe, ye, u0, u1, n: 400 }, o);
  K.func = (id, e, o = {}) => Object.assign({ type: 'func', id, e }, o);
  K.txt = (id, x, y, text, o = {}) => Object.assign({ type: 'text', id, x, y, text, size: 28, font: 'sans', bold: true }, o);
  K.note = (id, x, y, text, o = {}) => Object.assign({ type: 'text', id, x, y, text, size: 20, it: true }, o);
  K.hop = (id, a, b, o = {}) => Object.assign({ type: 'hop', id, a, b, draw: 1 }, o);
  K.span = (id, a, b, o = {}) => Object.assign({ type: 'span', id, a, b }, o);
  K.nline = (id, o = {}) => Object.assign({ type: 'numline', id, locked: true }, o);
  K.angle = (id, a, v, b, o = {}) => Object.assign({ type: 'angle', id, a, v, b }, o);
  K.param = (name, value, min, max, step) => ({ name, value, min, max, step });
  K.svg = (inner) => `<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  K.ticks = (xs, y = 52, h = 5) => xs.map((x) => `M${x} ${y - h}v${2 * h}`).join('');

  // ===== grid presets ====================================================

  K.CLEAN = { type: 'none',   axes: false, labels: false, snap: false };
  K.GRID  = { type: 'square', axes: false, labels: false, snap: false };
  K.DOTS  = { type: 'dots',   axes: false, labels: false, snap: false };
  K.AXES  = { type: 'square', axes: true,  labels: true,  snap: false };

})(window.G = window.G || {});
