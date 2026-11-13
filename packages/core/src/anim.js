/* Animation — two complementary systems:
   1. LIVE motion: a clock (`t`), sliders that loop / ping-pong, and per-point motions.
   2. STEPS (keyframes): capture the whole scene (positions, sliders, what's visible, how much of each
      shape is "drawn", the camera) and tween between captures — a storyboard for a lesson. */
(function (G) {
  'use strict';
  const S = G.S, R = G.R;

  const lerp = (a, b, k) => a + (b - a) * k;
  const EASE = {
    linear: (k) => k,
    inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    out: (k) => 1 - Math.pow(1 - k, 3),
    in: (k) => k * k * k,
    spring: (k) => { const c = 1.70158 * 1.525; return k < 0.5 ? (Math.pow(2 * k, 2) * ((c + 1) * 2 * k - c)) / 2 : (Math.pow(2 * k - 2, 2) * ((c + 1) * (k * 2 - 2) + c) + 2) / 2; },
  };

  const P = { idx: 0, phase: 'idle', from: null, target: 0, t: 0, dur: 1, holdT: 0, hold: 2, auto: false };
  const A = (G.A = { P, EASE });

  // ---------- capture / apply ----------
  A.capture = () => {
    const c3 = S.cam3;
    const st = { pts: {}, prm: {}, ob: {}, cam: [S.view.x, S.view.y, S.view.s], cam3: [c3.yaw, c3.pitch, c3.dist, c3.tx, c3.ty, c3.tz] };
    for (const o of S.objects) {
      st.ob[o.id] = [o.show == null ? 1 : o.show, o.draw == null ? 1 : o.draw];
      if (S.isFree(o)) st.pts[o.id] = S.ptState(o);
    }
    for (const p of S.params) if (!p.anim || p.anim === 'none') st.prm[p.name] = p.value;
    return st;
  };

  // `cam` (optional) overrides to.cam — the step's designed camera — with the camera fitted to
  // this canvas (see A.fitCam below).
  A.blend = (from, to, k, cam) => {
    for (const o of S.objects) {
      const fv = from.ob[o.id] || [1, 1], tv = to.ob[o.id] || [0, 1];
      const appearing = tv[0] > fv[0];
      o.show = lerp(fv[0], tv[0], appearing ? Math.min(1, k * 3) : k);
      o.draw = lerp(fv[1], tv[1], k);
      if (k >= 1) { o.show = tv[0]; o.draw = tv[1]; }
      const tp = to.pts[o.id];
      if (tp && S.isFree(o)) {
        const fp = from.pts[o.id] || S.ptState(o);
        o.x = lerp(fp[0], tp[0], k); o.y = lerp(fp[1], tp[1], k);
        if (o.type === 'p3') o.z = lerp(fp[2], tp[2], k);
      }
    }
    for (const name in to.prm) {
      const p = S.param(name);
      if (!p || (p.anim && p.anim !== 'none')) continue;
      const fv = from.prm[name] != null ? from.prm[name] : p.value;
      p.value = lerp(fv, to.prm[name], k);
      S.vars[name] = p.value;
    }
    const tc = cam || to.cam;
    if (tc && from.cam) {
      const v = S.view;
      v.x = lerp(from.cam[0], tc[0], k);
      v.y = lerp(from.cam[1], tc[1], k);
      v.s = Math.exp(lerp(Math.log(from.cam[2]), Math.log(tc[2]), k));
    }
    if (to.cam3 && from.cam3) {
      const c = S.cam3, f = from.cam3, t = to.cam3;
      c.yaw = lerp(f[0], t[0], k); c.pitch = lerp(f[1], t[1], k); c.dist = Math.exp(lerp(Math.log(f[2]), Math.log(t[2]), k));
      c.tx = lerp(f[3], t[3], k); c.ty = lerp(f[4], t[4], k); c.tz = lerp(f[5], t[5], k);
    }
    S.bump();
  };

  // ---------- steps ----------
  const stepOf = (i) => S.steps[i];
  A.captionOf = (step, level) => {
    if (!step || !step.cap) return '';
    if (typeof step.cap === 'string') return step.cap;
    const order = { k: ['k', 's', 'e'], s: ['s', 'k', 'e'], e: ['e', 's', 'k'] }[level] || ['s', 'k', 'e'];
    for (const key of order) if (step.cap[key]) return step.cap[key];
    return '';
  };
  A.autoHold = (step, level) => {
    const words = A.captionOf(step, level).split(/\s+/).length;
    return Math.min(9, Math.max(2, 1.2 + words * 0.3));
  };

  // ---------- auto-fit: every step's content fills the canvas, whatever its size ----------
  // A step's camera (state.cam) is DESIGNED for a reference viewport of REF_W × REF_H css px.
  // Scaling it by "canvas width / 1400" is wrong both ways: a lesson whose content occupies the
  // middle 60% of that viewport ends up tiny in a split pane, and the scale never grows on a big
  // screen. Instead we MEASURE: render the step's end state off-screen (transparent background,
  // no grid, quarter resolution) and find the box of drawn pixels — which covers labels, text and
  // charts of every object type, and is clipped to what the author framed — then fit that box into
  // the part of the canvas not covered by the caption and dock. Text is a fixed pixel size and
  // does not shrink with zoom, so the fit is re-measured at the candidate scale (≤ 3 passes).
  const REF_W = 1400, REF_H = 880, MDPR = 0.25, MAX_UP = 1.6, MIN_DOWN = 0.15;
  let mcv = null;
  A.userCam = false; // the learner zoomed/panned by hand since the last step: don't refit on resize

  // Pixel box of everything drawn at camera `cam` in a W × H viewport (css px), or null.
  function measure(cam, W, H) {
    const pw = Math.max(8, Math.round(W * MDPR)), ph = Math.max(8, Math.round(H * MDPR));
    if (!mcv) mcv = document.createElement('canvas');
    if (mcv.width !== pw || mcv.height !== ph) { mcv.width = pw; mcv.height = ph; }
    const ctx = mcv.getContext('2d', { willReadFrequently: true });
    Object.assign(S.view, { x: cam[0], y: cam[1], s: cam[2] });
    Object.assign(R, { ctx, w: W, h: H, dpr: MDPR, halo: 0, measuring: true });
    S.bump();
    R.frame();
    const d = ctx.getImageData(0, 0, pw, ph).data;
    let x0 = pw, y0 = ph, x1 = -1, y1 = -1;
    for (let y = 0; y < ph; y++) {
      let i = y * pw * 4 + 3;
      for (let x = 0; x < pw; x++, i += 4) {
        if (d[i] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    return x1 < x0 ? null : { x0: x0 / MDPR, x1: (x1 + 1) / MDPR, y0: y0 / MDPR, y1: (y1 + 1) / MDPR };
  }

  // The canvas rectangle content may use: clear of the floating caption/dock at the bottom and
  // the panel toggles at the top.
  A.safeArea = () => {
    const pad = Math.max(16, Math.min(48, R.w * 0.04));
    let bottom = R.h - 16;
    const cr = R.canvas && R.canvas.getBoundingClientRect();
    if (cr) {
      for (const id of ['caption', 'dock']) {
        const el = document.getElementById(id);
        if (!el || !el.offsetParent || getComputedStyle(el).opacity === '0') continue;
        const r = el.getBoundingClientRect();
        if (r.height > 4 && r.top > cr.top + cr.height * 0.5 && r.left < cr.right && r.right > cr.left) bottom = Math.min(bottom, r.top - cr.top - 12);
      }
    }
    bottom = Math.max(bottom, R.h * 0.55); // never squeeze content into a sliver
    return { x0: pad, x1: R.w - pad, y0: 56, y1: bottom };
  };

  // The camera that fits step `state` to this canvas. Falls back to the designed camera when
  // nothing measurable is drawn (or in 3D, which has its own camera).
  A.fitCam = (state) => {
    if (S.mode === '3d' || !state || !state.cam || !(R.w > 100) || !R.canvas) return state && state.cam ? state.cam.slice() : null;
    const a = A.safeArea(), aw = a.x1 - a.x0, ah = a.y1 - a.y0;
    const [cx0, cy0, s0] = state.cam;
    const save = A.capture(), view = Object.assign({}, S.view);
    const keep = { ctx: R.ctx, w: R.w, h: R.h, dpr: R.dpr, halo: R.halo };
    const hits = S.objects.map((o) => o._hit);
    let out = state.cam.slice();
    try {
      A.blend(save, state, 1, state.cam);
      // Content size on each axis ≈ fixed + scalable·s (text and markers keep their pixel size;
      // geometry scales). One sample assumes all-scalable; later samples solve the line through
      // the last two — so a wide caption that can never fit doesn't drive the zoom to nothing.
      const solve = (avail, k) => {
        const n = smp.length, q = smp[n - 1];
        let a = 0, b = q[k] / q.s;
        if (n > 1) { const p = smp[n - 2]; if (Math.abs(q.s - p.s) > 1e-9) { b = (q[k] - p[k]) / (q.s - p.s); a = q[k] - b * q.s; } }
        return b > 1e-6 && avail > a ? (avail - a) / b : Infinity; // Infinity: zoom can't help this axis
      };
      const smp = [];
      let s = s0, m = null, ms = s0, W = REF_W, H = REF_H;
      for (let pass = 0; pass < 3; pass++) {
        // the author's frame, scaled to s — content outside it stays out of the fit
        W = REF_W * s / s0; H = REF_H * s / s0;
        m = measure([cx0, cy0, s], W, H); ms = s;
        if (!m) break;
        smp.push({ s, w: m.x1 - m.x0, h: m.y1 - m.y0 });
        let ns = Math.min(solve(aw, 'w'), solve(ah, 'h'));
        if (!isFinite(ns)) break;
        ns = Math.max(s0 * MIN_DOWN, Math.min(s0 * MAX_UP, ns));
        const done = Math.abs(ns / s - 1) < 0.02;
        s = ns;
        if (done) break;
      }
      if (m) {
        const mx = cx0 + ((m.x0 + m.x1) / 2 - W / 2) / ms, my = cy0 - ((m.y0 + m.y1) / 2 - H / 2) / ms;
        const sx = (a.x0 + a.x1) / 2, sy = (a.y0 + a.y1) / 2;
        out = [mx - (sx - keep.w / 2) / s, my + (sy - keep.h / 2) / s, s];
      }
    } catch (e) { out = state.cam.slice(); }
    finally {
      Object.assign(R, keep); R.measuring = false;
      A.blend(state, save, 1, save.cam);
      Object.assign(S.view, view);
      S.objects.forEach((o, i) => { o._hit = hits[i]; });
      S.bump();
    }
    return out;
  };

  // Re-fit the current step (resize, panel toggle, caption change, "reset zoom").
  A.refit = (animate) => {
    if (S.mode === '3d' || !S.steps.length || P.phase === 'tween') return false;
    const st = stepOf(P.idx);
    if (!st || !st.state.cam) return false;
    const c = A.fitCam(st.state);
    if (!c) return false;
    A.userCam = false;
    const target = { x: c[0], y: c[1], s: c[2] };
    if (animate) A.animateView(target); else { Object.assign(S.view, target); G.invalidate(); }
    return true;
  };
  // ResizeObserver fires every frame while a splitter is dragged — coalesce to one refit per frame.
  let refitQueued = false;
  G.on('resize', () => {
    if (A.userCam || P.phase === 'tween' || refitQueued) return;
    refitQueued = true;
    requestAnimationFrame(() => { refitQueued = false; if (!A.userCam && P.phase !== 'tween') A.refit(false); });
  });

  A.applyStep = (i) => {
    const st = stepOf(i);
    if (!st) return;
    A.userCam = false;
    A.blend(A.capture(), st.state, 1);
    P.idx = i; P.phase = 'idle'; P.auto = false;
    G.emit('step');
    A.refit(false); // the caption just changed height — fit again around it
  };
  A.goto = (i, opts = {}) => {
    i = Math.max(0, Math.min(S.steps.length - 1, i));
    const st = stepOf(i);
    if (!st) return;
    if (opts.instant) { A.applyStep(i); G.invalidate(); return; }
    P.from = A.capture();
    P.toCam = null;
    A.userCam = false;
    P.target = i;
    P.t = 0;
    P.dur = st.dur != null ? st.dur : 1.4;
    P.phase = P.dur > 0 ? 'tween' : 'idle';
    if (P.dur <= 0) A.applyStep(i);
    G.emit('step');
    if (P.phase === 'tween') P.toCam = A.fitCam(st.state); // measured after the caption updated, so it fits around it
    G.invalidate();
  };
  A.next = () => { const base = P.phase === 'tween' ? P.target : P.idx; if (base < S.steps.length - 1) A.goto(base + 1); };
  A.prev = () => { const base = P.phase === 'tween' ? P.target : P.idx; if (base > 0) A.goto(base - 1); };
  A.playLesson = (level) => {
    if (S.steps.length < 2) return;
    if (P.idx >= S.steps.length - 1 && P.phase === 'idle') A.applyStep(0);
    P.auto = true; P.level = level;
    A.goto(P.idx + 1);
  };
  A.stopAuto = () => { P.auto = false; if (P.phase === 'hold') P.phase = 'idle'; G.emit('step'); };
  A.currentStep = () => (P.phase === 'tween' ? P.target : P.idx);

  A.addStep = () => {
    const at = Math.min(S.steps.length, P.idx + (S.steps.length ? 1 : 0));
    const step = { cap: {}, dur: 1.4, state: A.capture() };
    S.steps.splice(at, 0, step);
    P.idx = at; P.phase = 'idle';
    G.emit('step');
    return at;
  };
  A.updateStep = (i) => { const st = stepOf(i); if (st) { st.state = A.capture(); G.emit('step'); } };
  A.deleteStep = (i) => {
    S.steps.splice(i, 1);
    P.idx = Math.max(0, Math.min(S.steps.length - 1, P.idx > i ? P.idx - 1 : P.idx));
    P.phase = 'idle';
    G.emit('step');
  };
  A.moveStep = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= S.steps.length) return;
    [S.steps[i], S.steps[j]] = [S.steps[j], S.steps[i]];
    P.idx = j;
    G.emit('step');
  };
  // Something new was drawn while standing on step k: it appears at k and stays after.
  A.onCreated = (o) => {
    if (!S.steps.length) return;
    const k = A.currentStep();
    S.steps.forEach((st, j) => {
      if (j < k) return;
      st.state.ob[o.id] = [o.show == null ? 1 : o.show, o.draw == null ? 1 : o.draw];
      if (S.isFree(o)) st.state.pts[o.id] = S.ptState(o);
    });
  };

  // ---------- camera tween ----------
  A.viewTween = null;
  A.animateView = (target, dur = 0.6) => {
    A.viewTween = { from: Object.assign({}, S.view), to: target, t: 0, dur };
    G.invalidate();
  };
  A.fit = (animate = true) => {
    if (S.mode === '3d') {
      const t = { yaw: -0.85, pitch: 0.5, dist: 20, tx: 0, ty: 0, tz: 1.5 };
      if (animate) A.camTween = { from: Object.assign({}, S.cam3), to: t, t: 0, dur: 0.6 }; else Object.assign(S.cam3, t);
      G.invalidate(); return;
    }
    if (A.refit(animate)) return;
    const xs = [], ys = [];
    S.bump();
    for (const o of S.objects) {
      if (o.show != null && o.show < 0.05 && !(o.draw === 0)) continue;
      if (o.type === 'point') { const p = S.evalPoint(o); if (isFinite(p.x) && isFinite(p.y)) { xs.push(p.x); ys.push(p.y); } }
      else if (o.type === 'circle') { const g = S.geom(o); if (g && isFinite(g.r)) { xs.push(g.c.x - g.r, g.c.x + g.r); ys.push(g.c.y - g.r, g.c.y + g.r); } }
      else if (o.type === 'poly' || o.type === 'ngon') { const g = S.geom(o); g.pts.forEach((p) => { if (isFinite(p.x)) { xs.push(p.x); ys.push(p.y); } }); }
      else if (o.type === 'text') { const x = S.num(o.x), y = S.num(o.y); if (isFinite(x)) { xs.push(x); ys.push(y); } }
      else if (o.type === 'pen') (o.pts || []).forEach((p) => { xs.push(p[0]); ys.push(p[1]); });
    }
    let target;
    if (!xs.length) target = { x: 0, y: 0, s: 56 };
    else {
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1);
      // Dead-zone constants scale with canvas width so the fit button gives a sensible
      // result on both a full-viewport canvas (~1530px) and the narrower split canvas (~890px).
      const hPad = Math.min(460, Math.max(120, R.w * 0.25));
      const vPad = Math.min(300, Math.max(100, R.h * 0.22));
      const s = Math.min((R.w - hPad) / w, (R.h - vPad) / h);
      target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s: Math.max(8, Math.min(200, s)) };
    }
    if (animate) A.animateView(target); else { Object.assign(S.view, target); G.invalidate(); }
  };

  // ---------- clock + sliders ----------
  A.play = (on) => {
    S.clock.playing = on == null ? !S.clock.playing : on;
    G.emit('clock'); G.invalidate();
  };
  A.reset = () => {
    S.clock.t = 0;
    S.params.forEach((p) => { if (p.anim && p.anim !== 'none') { p.value = p.start != null ? p.start : p.min; p._dir = 1; } });
    S.syncVars(); S.bump();
    G.emit('clock'); G.invalidate();
  };
  A.hasLive = () => S.params.some((p) => p.anim && p.anim !== 'none') || S.objects.some((o) => o.type === 'point' && o.motion);

  A.tick = (dt) => {
    let animating = false;
    if (A.viewTween) {
      const vt = A.viewTween;
      vt.t += dt;
      const k = EASE.inOut(Math.min(1, vt.t / vt.dur));
      S.view.x = lerp(vt.from.x, vt.to.x, k);
      S.view.y = lerp(vt.from.y, vt.to.y, k);
      S.view.s = Math.exp(lerp(Math.log(vt.from.s), Math.log(vt.to.s), k));
      if (k >= 1) A.viewTween = null;
      animating = true;
    }
    if (A.camTween) {
      const ct = A.camTween;
      ct.t += dt;
      const k = EASE.inOut(Math.min(1, ct.t / ct.dur));
      for (const key of ['yaw', 'pitch', 'tx', 'ty', 'tz']) S.cam3[key] = lerp(ct.from[key], ct.to[key], k);
      S.cam3.dist = Math.exp(lerp(Math.log(ct.from.dist), Math.log(ct.to.dist), k));
      if (k >= 1) A.camTween = null;
      animating = true;
    }
    if (S.clock.playing) {
      const d = dt * S.clock.speed;
      S.clock.t += d;
      for (const p of S.params) {
        if (!p.anim || p.anim === 'none' || p._done) continue;
        const range = p.max - p.min || 1;
        let v = p.value + p.speed * d * (p._dir || 1);
        if (p.anim === 'loop') { if (v > p.max) v = p.min + ((v - p.min) % range); else if (v < p.min) v = p.max - ((p.min - v) % range); }
        else if (p.anim === 'ping') {
          if (v > p.max) { v = p.max - (v - p.max); p._dir = -1; }
          else if (v < p.min) { v = p.min + (p.min - v); p._dir = 1; }
        } else if (p.anim === 'once') { if (v >= p.max) { v = p.max; p._done = true; } }
        p.value = v;
      }
      S.syncVars();
      animating = true;
    }
    if (P.phase === 'tween') {
      P.t += dt;
      const st = stepOf(P.target);
      const k = Math.min(1, P.dur > 0 ? P.t / P.dur : 1);
      A.blend(P.from, st.state, (EASE[st.ease] || EASE.inOut)(k), P.toCam);
      if (k >= 1) {
        P.idx = P.target;
        P.phase = P.auto ? 'hold' : 'idle';
        P.holdT = 0;
        P.hold = st.hold != null ? st.hold : A.autoHold(st, P.level || 's');
        G.emit('step');
      }
      animating = true;
    } else if (P.phase === 'hold') {
      P.holdT += dt;
      if (P.holdT >= P.hold) {
        if (P.idx < S.steps.length - 1) A.goto(P.idx + 1);
        else { P.auto = false; P.phase = 'idle'; G.emit('step'); }
      }
      animating = true;
    }
    if (animating) { S.bump(); G.emit('tick'); }
    return animating;
  };

  // ---------- recording (WebM) ----------
  const rec = (A.rec = { active: false, mr: null, chunks: [] });
  A.startRecording = () => {
    if (rec.active || !window.MediaRecorder) return false;
    const stream = R.canvas.captureStream(60);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    rec.chunks = [];
    rec.mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9e6 });
    rec.mr.ondataavailable = (e) => { if (e.data.size) rec.chunks.push(e.data); };
    rec.mr.onstop = () => {
      const blob = new Blob(rec.chunks, { type: 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (S.title || 'elements').replace(/[^\w]+/g, '-').toLowerCase() + '.webm';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    rec.mr.start(200);
    rec.active = true; R.recording = true;
    G.emit('rec');
    return true;
  };
  A.stopRecording = () => {
    if (!rec.active) return;
    rec.mr.stop();
    rec.active = false; R.recording = false;
    G.emit('rec'); G.invalidate();
  };
})(window.G = window.G || {});
