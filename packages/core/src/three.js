/* 3D mode — orbit camera, x/y/z axes, floor grid, and a small set of 3D objects.
   Z is "up". Objects reuse the same expression engine, sliders, steps and animation as 2D.
   Rendering is a painter's algorithm on the 2D canvas: shaded faces sorted far→near, then lines, points, labels. */
(function (G) {
  'use strict';
  const S = G.S, R = G.R, { Expr } = G;
  const TAU = Math.PI * 2;
  const T3 = (G.T3 = {});
  const Objs3 = (G.Objs3 = {});
  const TYPES3 = new Set(['p3', 'seg3', 'vec3', 'sphere', 'box', 'cyl', 'cone', 'surf', 'curve3', 'text3', 'poly3', 'cubes', 'discs']);
  G.is3 = (o) => TYPES3.has(o.type);

  const fin = (...v) => v.every(Number.isFinite);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const prog = (o) => (o.draw == null ? 1 : clamp(o.draw, 0, 1));
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // =====================================================================
  //  Camera
  // =====================================================================
  const FOV = 0.72;
  function camera() {
    const c = S.cam3, cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const dir = [cp * cy, cp * sy, sp];
    const pos = [c.tx + c.dist * dir[0], c.ty + c.dist * dir[1], c.tz + c.dist * dir[2]];
    const f = [-dir[0], -dir[1], -dir[2]];
    const r = norm([f[1], -f[0], 0]);
    const u = cross(r, f);
    const focal = R.h / 2 / Math.tan(FOV / 2);
    return { pos, f, r, u, focal, ortho: !!S.grid.ortho, dist: c.dist, k: focal / c.dist };
  }
  T3.camera = camera;

  let CAM = null;
  function proj(p) {
    const d = sub(p, CAM.pos);
    const zc = dot(d, CAM.f);
    if (CAM.ortho) {
      const k = CAM.k;
      return [R.w / 2 + dot(d, CAM.r) * k, R.h / 2 - dot(d, CAM.u) * k, zc + CAM.dist];
    }
    if (zc < 0.1) return null;
    const k = CAM.focal / zc;
    return [R.w / 2 + dot(d, CAM.r) * k, R.h / 2 - dot(d, CAM.u) * k, zc];
  }
  T3.proj = (p) => { CAM = CAM || camera(); return proj(p); };
  // pixels per world unit at a point (for vertical dragging)
  const scaleAt = (p) => { if (CAM.ortho) return CAM.k; const zc = dot(sub(p, CAM.pos), CAM.f); return CAM.focal / Math.max(0.1, zc); };

  // screen → world ray
  function ray(sx, sy) {
    const cam = camera();
    const px = (sx - R.w / 2), py = -(sy - R.h / 2);
    if (cam.ortho) {
      const o = [0, 1, 2].map((i) => cam.pos[i] + (cam.r[i] * px + cam.u[i] * py) / cam.k);
      return { o, d: cam.f };
    }
    const d = norm([0, 1, 2].map((i) => cam.f[i] + (cam.r[i] * px + cam.u[i] * py) / cam.focal));
    return { o: cam.pos, d };
  }
  function floorHit(sx, sy, z = 0) {
    const r = ray(sx, sy);
    if (Math.abs(r.d[2]) < 1e-6) return null;
    const t = (z - r.o[2]) / r.d[2];
    if (t < 0) return null;
    return [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, z];
  }
  T3.floorHit = floorHit;

  // =====================================================================
  //  Points and references
  // =====================================================================
  function evalP3(o) {
    if (o._ev === S.epoch) return o._p;
    const p = { x: S.num(o.x), y: S.num(o.y), z: S.num(o.z) };
    o._p = p; o._ev = S.epoch;
    return p;
  }
  T3.evalP3 = evalP3;
  // reference: id of a p3 (or 2D point → z = 0), [x,y,z] expressions, or {x,y,z}
  function pt3(ref) {
    const NAN = [NaN, NaN, NaN];
    if (ref == null) return NAN;
    if (typeof ref === 'string') {
      const o = S.get(ref);
      if (!o) return NAN;
      if (o.type === 'p3') { const p = evalP3(o); return [p.x, p.y, p.z]; }
      if (o.type === 'point') { const p = S.evalPoint(o); return [p.x, p.y, 0]; }
      return NAN;
    }
    if (Array.isArray(ref)) return [S.num(ref[0]), S.num(ref[1]), S.num(ref[2] != null ? ref[2] : 0)];
    return NAN;
  }
  T3.pt3 = pt3;

  // =====================================================================
  //  Queue + shading
  // =====================================================================
  const LIGHT = norm([0.45, -0.55, 0.85]);
  function shade(base, n, alpha, rgbOverride) {
    const [r, g, b] = rgbOverride || R.rgb(base);
    const k = 0.62 + 0.38 * Math.abs(dot(n, LIGHT));
    return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${alpha})`;
  }
  function faceNormal(pts) {
    for (let i = 2; i < pts.length; i++) {
      const n = cross(sub(pts[1], pts[0]), sub(pts[i], pts[0]));
      if (Math.hypot(n[0], n[1], n[2]) > 1e-12) return norm(n);
    }
    return [0, 0, 1];
  }
  const face = (Q, o, pts, extra = {}) => Q.faces.push(Object.assign({ pts, o, base: o.color || 'clay', alpha: (o.fill != null ? o.fill : 0.85) * (o.show == null ? 1 : o.show) }, extra));
  const line = (Q, o, a, b, extra = {}) => Q.lines.push(Object.assign({ a, b, o, color: o.color || 'ink', w: o.w != null ? o.w : 2.4, alpha: o.show == null ? 1 : o.show, dash: o.dash }, extra));
  const label = (Q, o, p, text, extra = {}) => Q.labels.push(Object.assign({ p, text, o, color: o.color || 'ink' }, extra));

  // =====================================================================
  //  Object types
  // =====================================================================
  Objs3.p3 = {
    eval() { return { props: {} }; },
    build(o, g, Q) {
      const p = evalP3(o);
      if (!fin(p.x, p.y, p.z)) return;
      Q.pts.push({ p: [p.x, p.y, p.z], o, size: o.size != null ? o.size : 6, color: o.color || 'ink', alpha: o.show == null ? 1 : o.show * clamp(prog(o) * 2, 0, 1) });
      if (o.drop) {
        const f = [p.x, p.y, 0];
        line(Q, o, [p.x, p.y, p.z], f, { color: 'gray', w: 1.4, dash: true, alpha: 0.7 * (o.show == null ? 1 : o.show), nohit: true });
        Q.rings.push({ p: f, color: o.color || 'ink', alpha: 0.7 * (o.show == null ? 1 : o.show) });
      }
      if (o.label) label(Q, o, [p.x, p.y, p.z], Expr.interp(o.label, S.env), { dx: 11, dy: -12, italic: true, size: 17 });
    },
  };

  function segEval(o) {
    const a = pt3(o.a), b = pt3(o.b);
    const d = sub(b, a);
    return { a, b, props: { len: Math.hypot(d[0], d[1], d[2]), dx: d[0], dy: d[1], dz: d[2] } };
  }
  function segBuild(o, g, Q) {
    if (!fin(...g.a, ...g.b)) return;
    const pr = prog(o);
    const e = [0, 1, 2].map((i) => g.a[i] + (g.b[i] - g.a[i]) * pr);
    line(Q, o, g.a, e, { arrow: o.type === 'vec3' && pr > 0.05 });
    if (o.label || o.meas) {
      const parts = [];
      if (o.label) parts.push(Expr.interp(o.label, S.env));
      if (o.meas) parts.push(Expr.fmt(g.props.len, o.dp != null ? o.dp : 2));
      label(Q, o, [0, 1, 2].map((i) => (g.a[i] + e[i]) / 2), parts.join(o.label && o.meas ? ' = ' : ''), { dy: -14, italic: true, size: 16 });
    }
  }
  Objs3.seg3 = { eval: segEval, build: segBuild };
  Objs3.vec3 = { eval: segEval, build: segBuild };

  // ----- meshes -----
  function quadsOf(grid) { // grid[i][j] → quads
    const out = [];
    for (let i = 0; i < grid.length - 1; i++) for (let j = 0; j < grid[i].length - 1; j++) out.push([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]);
    return out;
  }
  // subdivide a quad into n×n bilinear sub-quads (finer depth sorting for big faces)
  function subQuads(q, n) {
    const out = [];
    const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const P = (u, v) => lerp3(lerp3(q[0], q[1], u), lerp3(q[3], q[2], u), v);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([P(i / n, j / n), P((i + 1) / n, j / n), P((i + 1) / n, (j + 1) / n), P(i / n, (j + 1) / n)]);
    return out;
  }
  // triangle fan around the centroid for a convex polygon
  function fan(pts) {
    const c = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);
    return pts.map((p, i) => [c, p, pts[(i + 1) % pts.length]]);
  }
  const scaleAbout = (pts, c, k) => pts.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k, c[2] + (p[2] - c[2]) * k]);

  Objs3.sphere = {
    eval(o) {
      const c = pt3(o.c), r = S.num(o.r);
      return { c, r, props: { r, d: 2 * r, vol: (4 / 3) * Math.PI * r ** 3, area: 4 * Math.PI * r * r } };
    },
    build(o, g, Q) {
      if (!fin(...g.c, g.r) || g.r <= 0) return;
      const k = smooth(prog(o)), NL = 14, NM = 26, grid = [];
      for (let i = 0; i <= NL; i++) {
        const th = (Math.PI * i) / NL, row = [];
        for (let j = 0; j <= NM; j++) {
          const ph = (TAU * j) / NM;
          row.push([g.c[0] + g.r * k * Math.sin(th) * Math.cos(ph), g.c[1] + g.r * k * Math.sin(th) * Math.sin(ph), g.c[2] + g.r * k * Math.cos(th)]);
        }
        grid.push(row);
      }
      quadsOf(grid).forEach((q) => face(Q, o, q, { seam: true }));
      if (o.label) label(Q, o, [g.c[0], g.c[1], g.c[2] + g.r * k], Expr.interp(o.label, S.env), { dy: -16, italic: true, size: 17 });
    },
  };

  Objs3.box = {
    eval(o) {
      const p = pt3(o.p), s = (o.s || [1, 1, 1]).map((v) => S.num(v));
      return { p, s, props: { vol: Math.abs(s[0] * s[1] * s[2]), dx: s[0], dy: s[1], dz: s[2], diag: Math.hypot(s[0], s[1], s[2]) } };
    },
    build(o, g, Q) {
      if (!fin(...g.p, ...g.s)) return;
      const k = smooth(prog(o)), [x, y, z] = g.p, [a, b, c] = g.s;
      const ctr = [x + a / 2, y + b / 2, z + c / 2];
      const V = scaleAbout([[x, y, z], [x + a, y, z], [x + a, y + b, z], [x, y + b, z], [x, y, z + c], [x + a, y, z + c], [x + a, y + b, z + c], [x, y + b, z + c]], ctr, k);
      [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]].forEach((f) => subQuads(f.map((i) => V[i]), 5).forEach((q) => face(Q, o, q, { seam: true })));
      // crisp outline of the 12 edges
      [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => Q.lines.push({ a: V[a], b: V[b], o, color: 'ink', w: 1.2, alpha: 0.35 * (o.show == null ? 1 : o.show), nohit: true }));
      if (o.label) label(Q, o, V[6], Expr.interp(o.label, S.env), { dy: -14, italic: true, size: 17 });
    },
  };

  function roundSolid(o, g, Q, cone) {
    if (!fin(...g.c, g.r, g.h)) return;
    const k = smooth(prog(o)), N = 36, [cx, cy, cz] = g.c, r = g.r * k, h = g.h * k;
    const base = [], top = [];
    for (let i = 0; i < N; i++) {
      const a = (TAU * i) / N;
      base.push([cx + r * Math.cos(a), cy + r * Math.sin(a), cz]);
      top.push(cone ? [cx, cy, cz + h] : [cx + r * Math.cos(a), cy + r * Math.sin(a), cz + h]);
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      face(Q, o, cone ? [base[i], base[j], top[i]] : [base[i], base[j], top[j], top[i]], { seam: true });
    }
    fan(base.slice().reverse()).forEach((t) => face(Q, o, t, { seam: true }));
    if (!cone) fan(top).forEach((t) => face(Q, o, t, { seam: true }));
    if (o.label) label(Q, o, [cx, cy, cz + h], Expr.interp(o.label, S.env), { dy: -16, italic: true, size: 17 });
  }
  Objs3.cyl = {
    eval(o) { const c = pt3(o.c), r = S.num(o.r), h = S.num(o.h); return { c, r, h, props: { r, h, vol: Math.PI * r * r * h, area: 2 * Math.PI * r * (r + h) } }; },
    build(o, g, Q) { roundSolid(o, g, Q, false); },
  };
  Objs3.cone = {
    eval(o) { const c = pt3(o.c), r = S.num(o.r), h = S.num(o.h); return { c, r, h, props: { r, h, vol: (Math.PI * r * r * h) / 3, slant: Math.hypot(r, h) } }; },
    build(o, g, Q) { roundSolid(o, g, Q, true); },
  };

  Objs3.poly3 = {
    eval(o) { const pts = (o.pts || []).map(pt3); return { pts, props: { n: pts.length } }; },
    build(o, g, Q) {
      if (g.pts.length < 3 || !g.pts.every((p) => fin(...p))) return;
      if (o.fill !== 0) {
        const al = (o.fill != null ? o.fill : 0.45) * (o.show == null ? 1 : o.show) * smooth(prog(o));
        (g.pts.length === 3 ? [g.pts] : fan(g.pts)).forEach((t) => face(Q, o, t, { alpha: al, seam: true }));
      }
      g.pts.forEach((p, i) => line(Q, o, p, g.pts[(i + 1) % g.pts.length], { w: o.w != null ? o.w : 2.4 }));
    },
  };

  // unit cubes filling an a × b × c block, layer by layer (draw = how many are placed)
  Objs3.cubes = {
    eval(o) {
      const p = pt3(o.p), n = (o.n || [1, 1, 1]).map((v) => Math.max(0, Math.round(S.num(v))));
      const total = n[0] * n[1] * n[2], base = n[0] * n[1];
      const shown = Math.min(total, Math.floor(total * prog(o) + 1e-9));
      return { p, n, total, base, shown, props: { total, n: shown, base, layers: n[2], full: base ? Math.floor(shown / base) : 0, part: base ? shown % base : 0 } };
    },
    build(o, g, Q) {
      if (!fin(...g.p) || !g.total || g.total > 900) return;
      const c1 = R.rgb(o.color || 'sky'), c2 = R.rgb(o.color2 || o.color || 'clay'), [n0, n1, n2] = g.n;
      const alpha = (o.fill != null ? o.fill : 0.96) * (o.show == null ? 1 : o.show);
      for (let idx = 0; idx < g.shown; idx++) {
        const i = idx % n0, j = Math.floor(idx / n0) % n1, k = Math.floor(idx / g.base);
        const x = g.p[0] + i, y = g.p[1] + j, z = g.p[2] + k, t = n2 > 1 ? k / (n2 - 1) : 0;
        const rgb = [0, 1, 2].map((m) => c1[m] + (c2[m] - c1[m]) * t);
        const V = [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z], [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]];
        const F = [];
        if (i === 0) F.push([0, 4, 7, 3]);
        if (!(i < n0 - 1 && idx + 1 < g.shown)) F.push([1, 2, 6, 5]);
        if (j === 0) F.push([0, 1, 5, 4]);
        if (!(j < n1 - 1 && idx + n0 < g.shown)) F.push([2, 3, 7, 6]);
        if (k === 0) F.push([0, 3, 2, 1]);
        if (!(k < n2 - 1 && idx + g.base < g.shown)) F.push([4, 5, 6, 7]);
        F.forEach((f) => face(Q, o, f.map((q) => V[q]), { rgb, alpha, edge: true }));
      }
    },
  };

  // a stack of thin discs ("coins") that can be spread apart (gap) or pushed together into a cylinder
  Objs3.discs = {
    eval(o) {
      const c = pt3(o.c), r = S.num(o.r), h = S.num(o.h), n = clamp(Math.round(S.num(o.n != null ? o.n : 12)), 1, 40), gap = S.num(o.gap != null ? o.gap : 0);
      return { c, r, h, n, gap, props: { r, h, n, area: Math.PI * r * r, vol: Math.PI * r * r * h, coin: (Math.PI * r * r * h) / n } };
    },
    build(o, g, Q) {
      if (!fin(...g.c, g.r, g.h, g.gap) || g.r <= 0) return;
      const k = smooth(prog(o)), N = 28, t = g.h / g.n, r = g.r * k;
      const c1 = R.rgb(o.color || 'sky'), c2 = R.rgb(o.color2 || 'kraft');
      const alpha = (o.fill != null ? o.fill : 0.95) * (o.show == null ? 1 : o.show);
      for (let d = 0; d < g.n; d++) {
        const z0 = g.c[2] + d * (t + g.gap), z1 = z0 + t, rgb = d % 2 ? c1 : c2;
        const lo = [], hi = [];
        for (let i = 0; i < N; i++) { const a = (TAU * i) / N; lo.push([g.c[0] + r * Math.cos(a), g.c[1] + r * Math.sin(a), z0]); hi.push([g.c[0] + r * Math.cos(a), g.c[1] + r * Math.sin(a), z1]); }
        for (let i = 0; i < N; i++) { const j = (i + 1) % N; face(Q, o, [lo[i], lo[j], hi[j], hi[i]], { rgb, alpha, seam: true }); }
        face(Q, o, hi, { rgb, alpha, edge: true });
        if (d === 0) face(Q, o, lo.slice().reverse(), { rgb, alpha, seam: true });
      }
    },
  };

  // surface z = f(x, y), coloured by height
  Objs3.surf = {
    eval() { return { props: {} }; },
    build(o, g, Q) {
      const x0 = S.num(o.x0 != null ? o.x0 : -4), x1 = S.num(o.x1 != null ? o.x1 : 4), y0 = S.num(o.y0 != null ? o.y0 : -4), y1 = S.num(o.y1 != null ? o.y1 : 4);
      const n = clamp(Math.round(o.n || 36), 4, 90);
      if (!fin(x0, x1, y0, y1)) return;
      const e = (o._fe = o._fe || S.localEnv()), f = Expr.compile(o.e);
      const grid = [];
      let zmin = Infinity, zmax = -Infinity;
      for (let i = 0; i <= n; i++) {
        const row = [];
        for (let j = 0; j <= n; j++) {
          const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * j) / n;
          e.vars.x = x; e.vars.y = y;
          let z = f(e);
          if (!isFinite(z) || Math.abs(z) > 1e4) z = NaN; else { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
          row.push([x, y, z]);
        }
        grid.push(row);
      }
      const c1 = R.rgb(o.color || 'sky'), c2 = R.rgb(o.color2 || 'clay'), span = zmax - zmin || 1;
      const cols = Math.ceil(n * prog(o));
      const alpha = (o.fill != null ? o.fill : 0.9) * (o.show == null ? 1 : o.show);
      for (let i = 0; i < Math.min(cols, n); i++) for (let j = 0; j < n; j++) {
        const q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
        if (!q.every((p) => isFinite(p[2]))) continue;
        const t = clamp((((q[0][2] + q[2][2]) / 2) - zmin) / span, 0, 1);
        face(Q, o, q, { rgb: [0, 1, 2].map((m) => c1[m] + (c2[m] - c1[m]) * t), alpha, wire: o.wire !== false });
      }
    },
  };

  Objs3.curve3 = {
    eval() { return { props: {} }; },
    build(o, g, Q) {
      const e = (o._ce = o._ce || S.localEnv());
      const u0 = S.num(o.u0 != null ? o.u0 : 0), u1 = S.num(o.u1 != null ? o.u1 : TAU);
      if (!fin(u0, u1)) return;
      const n = clamp(Math.round(o.n || 300), 8, 2000), nmax = Math.floor(n * prog(o));
      let prev = null;
      for (let i = 0; i <= nmax; i++) {
        e.vars.u = u0 + ((u1 - u0) * i) / n;
        const p = [Expr.num(o.xe, e), Expr.num(o.ye, e), Expr.num(o.ze, e)];
        if (fin(...p) && prev) line(Q, o, prev, p, { w: o.w != null ? o.w : 2.8, seg: true });
        prev = fin(...p) ? p : null;
      }
    },
  };

  Objs3.text3 = {
    eval() { return { props: {} }; },
    build(o, g, Q) {
      const p = [S.num(o.x), S.num(o.y), S.num(o.z)];
      if (!fin(...p)) return;
      let str = Expr.interp(o.text != null ? o.text : '', S.env);
      const pr = prog(o);
      if (pr < 1) str = str.slice(0, Math.ceil(str.length * pr));
      label(Q, o, p, str, { size: o.size || 20, italic: !!o.it, bold: !!o.bold, font: o.font, bg: !!o.bg, own: true });
    },
  };

  // =====================================================================
  //  Frame
  // =====================================================================
  const AXC = { x: 'clay', y: 'olive', z: 'sky' };
  const nice = (E) => (E <= 8 ? 1 : E <= 20 ? 2 : E <= 50 ? 5 : 10);

  function drawFloor(c) {
    const g = S.grid;
    if (g.floor === false) return;
    const E = g.extent || 6, st = nice(E);
    c.lineWidth = 1;
    c.strokeStyle = R.rgba('ink', R.theme === 'dark' ? 0.16 : 0.14);
    c.beginPath();
    for (let v = -E; v <= E + 1e-9; v += st) {
      for (const [a, b] of [[[v, -E, 0], [v, E, 0]], [[-E, v, 0], [E, v, 0]]]) {
        const pa = proj(a), pb = proj(b);
        if (pa && pb) { c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); }
      }
    }
    c.stroke();
    // finer half-step lines when zoomed in
    if (CAM.dist < 12 && st === 1) {
      c.strokeStyle = R.rgba('ink', R.theme === 'dark' ? 0.06 : 0.05);
      c.beginPath();
      for (let v = -E + 0.5; v < E; v += 1) {
        for (const [a, b] of [[[v, -E, 0], [v, E, 0]], [[-E, v, 0], [E, v, 0]]]) {
          const pa = proj(a), pb = proj(b);
          if (pa && pb) { c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); }
        }
      }
      c.stroke();
    }
  }

  function drawAxes(c) {
    const g = S.grid;
    if (g.axes === false) return;
    const E = g.extent || 6;
    c.lineCap = 'round';
    for (const [name, dir] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]]) {
      const a = dir.map((d) => -d * E), b = dir.map((d) => d * E);
      const pa = proj(a), pb = proj(b), p0 = proj([0, 0, 0]);
      if (!pa || !pb) continue;
      // negative half is dimmer, positive half is solid with an arrowhead
      c.lineWidth = 2;
      c.strokeStyle = R.rgba(AXC[name], 0.35);
      if (p0) { c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(p0[0], p0[1]); c.stroke(); }
      c.strokeStyle = R.color(AXC[name]);
      c.lineWidth = 2.4;
      if (p0) { c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(pb[0], pb[1]); c.stroke(); }
      const tip = proj(dir.map((d) => d * (E + 0.8)));
      if (tip) {
        const ang = Math.atan2(tip[1] - pb[1], tip[0] - pb[0]);
        c.fillStyle = R.color(AXC[name]);
        c.beginPath();
        c.moveTo(tip[0], tip[1]);
        c.lineTo(tip[0] - 12 * Math.cos(ang - 0.4), tip[1] - 12 * Math.sin(ang - 0.4));
        c.lineTo(tip[0] - 12 * Math.cos(ang + 0.4), tip[1] - 12 * Math.sin(ang + 0.4));
        c.closePath(); c.fill();
      }
    }
  }
  function drawAxisLetters() {
    const g = S.grid, E = g.extent || 6;
    if (g.axes === false) return;
    for (const [name, dir] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]]) {
      const tip = proj(dir.map((d) => d * (E + 1.6)));
      if (tip) R.text(name, tip[0], tip[1], { size: 20, italic: true, color: AXC[name], bold: true });
    }
  }
  function drawAxisNumbers() {
    const g = S.grid, E = g.extent || 6, st = nice(E);
    if (g.axes === false) return;
    for (const [name, dir] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]]) {
      if (g.labels === false) continue;
      for (let v = -E; v <= E + 1e-9; v += st) {
        if (v === 0) continue;
        const p = proj(dir.map((d) => d * v));
        if (!p) continue;
        const off = name === 'z' ? [-14, 0] : name === 'x' ? [0, 14] : [14, 0];
        R.text(String(v), p[0] + off[0], p[1] + off[1], { size: 11, font: 'sans', color: 'gray', halo: true });
      }
    }
    const o = proj([0, 0, 0]);
    if (o && g.labels !== false) R.text('0', o[0] - 9, o[1] + 12, { size: 11, font: 'sans', color: 'gray' });
  }

  T3.frame = () => {
    const c = R.ctx;
    CAM = camera();
    S.objects.forEach((o) => { o._hit = null; });
    c.lineCap = 'round'; c.lineJoin = 'round';
    drawFloor(c);
    drawAxes(c);
    drawAxisNumbers();

    const Q = { faces: [], lines: [], pts: [], labels: [], rings: [] };
    for (const o of S.objects) {
      if (!G.is3(o) || (o.show != null && o.show < 0.01)) continue;
      const h = Objs3[o.type];
      if (h) h.build(o, S.geom(o), Q);
    }

    // ---- faces, far → near ----
    const fs = [];
    for (const f of Q.faces) {
      const sp = f.pts.map(proj);
      if (sp.some((q) => !q)) continue;
      f.sp = sp;
      f.depth = sp.reduce((s, q) => s + q[2], 0) / sp.length;
      fs.push(f);
    }
    fs.sort((a, b) => b.depth - a.depth);
    const stride = {};
    for (const f of fs) {
      c.beginPath();
      f.sp.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
      c.closePath();
      c.fillStyle = shade(f.base, faceNormal(f.pts), f.alpha, f.rgb);
      c.fill();
      if (f.wire) { c.lineWidth = 0.8; c.strokeStyle = R.rgba('ink', 0.22 * f.alpha); c.stroke(); }
      else if (f.seam) { c.lineWidth = 0.7; c.strokeStyle = c.fillStyle; c.stroke(); }
      else if (f.edge) { c.lineWidth = 1.3; c.strokeStyle = R.rgba('ink', 0.5 * f.alpha); c.stroke(); }
      const id = f.o.id;
      stride[id] = (stride[id] || 0) + 1;
      if (stride[id] % 3 === 1) R.hit(f.o, { k: 'poly', pts: f.sp.map((q) => [q[0], q[1]]).concat([[f.sp[0][0], f.sp[0][1]]]), fill: true });
    }

    // ---- lines ----
    const drawLine = (l) => {
      const pa = proj(l.a), pb = proj(l.b);
      if (!pa || !pb) return;
      c.globalAlpha = l.alpha;
      c.strokeStyle = R.color(l.color); c.lineWidth = l.w;
      c.setLineDash(l.dash ? (l.dash === true ? [7, 6] : [+l.dash, +l.dash]) : []);
      c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); c.stroke();
      c.setLineDash([]);
      if (l.arrow) {
        const a = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]), hs = 9 + l.w * 2.2;
        c.fillStyle = R.color(l.color);
        c.beginPath();
        c.moveTo(pb[0], pb[1]);
        c.lineTo(pb[0] - hs * Math.cos(a - 0.4), pb[1] - hs * Math.sin(a - 0.4));
        c.lineTo(pb[0] - hs * 0.7 * Math.cos(a), pb[1] - hs * 0.7 * Math.sin(a));
        c.lineTo(pb[0] - hs * Math.cos(a + 0.4), pb[1] - hs * Math.sin(a + 0.4));
        c.closePath(); c.fill();
      }
      c.globalAlpha = 1;
      if (!l.nohit && l.o) R.hit(l.o, { k: 's', x1: pa[0], y1: pa[1], x2: pb[0], y2: pb[1] });
    };
    Q.lines.forEach(drawLine);
    for (const r of Q.rings) {
      const p = proj(r.p);
      if (!p) continue;
      c.globalAlpha = r.alpha; c.strokeStyle = R.color(r.color); c.lineWidth = 1.6;
      c.beginPath(); c.ellipse(p[0], p[1], 7, 3.5, 0, 0, TAU); c.stroke(); c.globalAlpha = 1;
    }

    // ---- points ----
    Q.pts.sort((a, b) => { const pa = proj(a.p), pb = proj(b.p); return (pb ? pb[2] : 0) - (pa ? pa[2] : 0); });
    for (const q of Q.pts) {
      const p = proj(q.p);
      if (!p) continue;
      c.globalAlpha = q.alpha;
      c.beginPath(); c.arc(p[0], p[1], q.size + 4.5, 0, TAU); c.fillStyle = R.rgba(q.color, 0.14); c.fill();
      c.beginPath(); c.arc(p[0], p[1], q.size, 0, TAU); c.fillStyle = R.color(q.color); c.fill();
      c.lineWidth = 2; c.strokeStyle = R.color('bg'); c.stroke();
      c.globalAlpha = 1;
      R.hit(q.o, { k: 'p', x: p[0], y: p[1], r: Math.max(q.size + 5, 10) });
    }

    // ---- selection / hover halos ----
    const halo = (o, a, w) => {
      if (!o._hit) return;
      c.strokeStyle = R.rgba('clay', a); c.fillStyle = R.rgba('clay', a); c.lineWidth = w;
      for (const pr of o._hit) {
        if (pr.k === 'p') { c.beginPath(); c.arc(pr.x, pr.y, pr.r + 3, 0, TAU); c.fill(); }
        else if (pr.k === 's') { c.beginPath(); c.moveTo(pr.x1, pr.y1); c.lineTo(pr.x2, pr.y2); c.stroke(); }
        else if (pr.k === 'poly') { c.beginPath(); pr.pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke(); }
        else if (pr.k === 'box') c.strokeRect(pr.x, pr.y, pr.w, pr.h);
      }
    };
    for (const o of S.objects) {
      if (S.sel.has(o.id)) halo(o, 0.5, 5);
      else if (R.hoverId === o.id) halo(o, 0.25, 4);
    }

    // ---- labels ----
    drawAxisLetters();
    for (const l of Q.labels) {
      const p = l.o.pin ? [R.w / 2, 34 + (+l.o.pin > 1 ? +l.o.pin : 0)] : proj(l.p);
      if (!p) continue;
      c.save(); c.globalAlpha = l.o.show == null ? 1 : l.o.show;
      const box = R.text(l.text, p[0] + (l.dx || 0), p[1] + (l.dy || 0), { size: l.size || 16, italic: l.italic, bold: l.bold, font: l.font, color: l.color, bg: l.bg });
      c.restore();
      if (l.own) R.hit(l.o, { k: 'box', x: box.x - 6, y: box.y - 4, w: box.w + 12, h: box.h + 8 });
    }
    CAM = camera();
    if (T3.overlay) T3.overlay(c);
  };

  // =====================================================================
  //  Interaction
  // =====================================================================
  const I = () => G.I;
  const snap3 = (v, e) => (S.grid.snap && !(e && e.altKey) ? Math.round(v * 2) / 2 : +v.toFixed(6));
  const NUMARR = (a) => Array.isArray(a) && a.every((v) => typeof v === 'number');
  const posKey = { sphere: 'c', box: 'p', cyl: 'c', cone: 'c' };

  T3.orbit = (dx, dy) => {
    const c = S.cam3;
    c.yaw -= dx * 0.008;
    c.pitch = clamp(c.pitch + dy * 0.008, -1.5, 1.5);
  };
  T3.pan = (dx, dy) => {
    const cam = camera(), c = S.cam3, k = cam.ortho ? 1 / cam.k : cam.dist / cam.focal;
    for (const [i, key] of [[0, 'tx'], [1, 'ty'], [2, 'tz']]) c[key] += (-cam.r[i] * dx + cam.u[i] * dy) * k;
  };
  T3.zoom = (f) => { S.cam3.dist = clamp(S.cam3.dist / f, 0.6, 400); };

  function pickOrCreate(p, e) {
    const hit = G.pick(p.sx, p.sy, { tol: 12, only: (o) => o.type === 'p3' });
    if (hit) return hit.id;
    const fp = floorHit(p.sx, p.sy);
    if (!fp) return null;
    const o = I()._.create({ type: 'p3', x: snap3(fp[0], e), y: snap3(fp[1], e), z: 0 }, { keepSel: true });
    o.label = o.id;
    I()._.pend().created.push(o.id);
    return o.id;
  }

  const DEFAULTS = {
    sphere: (x, y) => ({ type: 'sphere', c: [x, y, 1.2], r: 1.2, color: 'sky', fill: 0.9 }),
    box: (x, y) => ({ type: 'box', p: [x - 1, y - 1, 0], s: [2, 2, 2], color: 'clay', fill: 0.9 }),
    cyl: (x, y) => ({ type: 'cyl', c: [x, y, 0], r: 1.1, h: 2.5, color: 'olive', fill: 0.9 }),
    cone: (x, y) => ({ type: 'cone', c: [x, y, 0], r: 1.2, h: 2.6, color: 'fig', fill: 0.9 }),
    surf: () => ({ type: 'surf', e: '1.5*sin(sqrt(x^2+y^2))', x0: -5, x1: 5, y0: -5, y1: 5, n: 40, color: 'sky', color2: 'clay' }),
    curve3: () => ({ type: 'curve3', xe: '2*cos(u)', ye: '2*sin(u)', ze: 'u/3', u0: 0, u1: '6*pi', color: 'fig', w: 3 }),
    text3: (x, y) => ({ type: 'text3', x, y, z: 0.5, text: 'Text', size: 22 }),
  };

  T3.down = (e, p) => {
    const io = I(), t = io.tool;
    if (e.button === 1 || e.button === 2 || io.space || (e.shiftKey && (t === 'hand' || t === 'select'))) {
      io.drag = { kind: 'pan3', sx: p.sx, sy: p.sy }; return;
    }
    if (t === 'hand') { io.drag = { kind: 'orbit3', sx: p.sx, sy: p.sy }; return; }
    if (t === 'select') {
      const hit = G.pick(p.sx, p.sy, { tol: e.pointerType === 'touch' ? 16 : 10 });
      if (!hit) {
        if (S.sel.size) { S.sel.clear(); G.emit('select'); }
        io.drag = { kind: 'orbit3', sx: p.sx, sy: p.sy }; return;
      }
      if (e.shiftKey) S.sel.has(hit.id) ? S.sel.delete(hit.id) : S.sel.add(hit.id);
      else if (!S.sel.has(hit.id)) { S.sel.clear(); S.sel.add(hit.id); }
      G.emit('select');
      if (hit.type === 'p3') {
        if (!S.isFree(hit)) { io._.toast('This point is driven by a formula — edit it in the panel'); io.drag = null; return; }
        io.drag = { kind: 'pt3', o: hit, sy0: p.sy, z0: hit.z, moved: false };
      } else if (posKey[hit.type] && NUMARR(hit[posKey[hit.type]])) {
        const arr = hit[posKey[hit.type]], fp = floorHit(p.sx, p.sy, arr[2]);
        io.drag = fp ? { kind: 'move3', o: hit, key: posKey[hit.type], start: fp, orig: arr.slice(), moved: false } : null;
      } else if (hit.type === 'text3' && typeof hit.x === 'number' && typeof hit.y === 'number') {
        const fp = floorHit(p.sx, p.sy, hit.z);
        io.drag = fp ? { kind: 'move3t', o: hit, start: fp, x: hit.x, y: hit.y, moved: false } : null;
      } else io.drag = null;
      return;
    }
    if (t === 'eraser') {
      io.drag = { kind: 'erase3' };
      const hit = G.pick(p.sx, p.sy, { tol: 10 });
      if (hit) { S.remove([hit.id]); G.emit('scene'); io.drag.erased = true; }
      return;
    }
    const fp = floorHit(p.sx, p.sy);
    if (DEFAULTS[t]) {
      if (!fp && t !== 'surf' && t !== 'curve3') return;
      const x = fp ? snap3(fp[0], e) : 0, y = fp ? snap3(fp[1], e) : 0;
      io._.create(DEFAULTS[t](x, y));
      io._.commit();
      if (t === 'surf' || t === 'curve3' || t === 'text3') G.emit('focus', t === 'surf' ? 'e' : t === 'curve3' ? 'xe' : 'text');
      return;
    }
    if (t === 'p3') {
      const hit = G.pick(p.sx, p.sy, { tol: 12, only: (o) => o.type === 'p3' });
      if (hit) { S.sel.clear(); S.sel.add(hit.id); G.emit('select'); return; }
      if (!fp) return;
      const o = io._.create({ type: 'p3', x: snap3(fp[0], e), y: snap3(fp[1], e), z: 0, color: 'clay' });
      o.label = o.id;
      io._.commit();
      return;
    }
    if (t === 'seg3' || t === 'vec3') {
      const id = pickOrCreate(p, e);
      if (!id) return;
      const P = io._.pend();
      if (!P.refs.length) { P.refs.push(id); return; }
      if (id === P.refs[0]) return;
      P.refs.push(id);
      const [a, b] = P.refs;
      io.pend = null; P.created = [];
      io._.create(t === 'vec3' ? { type: 'vec3', a, b, color: 'clay', w: 3 } : { type: 'seg3', a, b, w: 2.8 });
      io._.commit();
    }
  };

  T3.move = (e, p) => {
    const io = I(), d = io.drag;
    if (!d) return false;
    switch (d.kind) {
      case 'orbit3': T3.orbit(p.sx - d.sx, p.sy - d.sy); d.sx = p.sx; d.sy = p.sy; break;
      case 'pan3': T3.pan(p.sx - d.sx, p.sy - d.sy); d.sx = p.sx; d.sy = p.sy; break;
      case 'pt3': {
        d.moved = true;
        if (e.altKey || e.ctrlKey) {
          const k = scaleAt([d.o.x, d.o.y, d.o.z]);
          d.o.z = snap3(d.z0 - (p.sy - d.sy0) / k, e);
        } else {
          const fp = floorHit(p.sx, p.sy, d.o.z);
          if (fp) { d.o.x = snap3(fp[0], e); d.o.y = snap3(fp[1], e); }
        }
        break;
      }
      case 'move3': {
        const fp = floorHit(p.sx, p.sy, d.orig[2]);
        if (fp) { d.moved = true; d.o[d.key] = [snap3(d.orig[0] + fp[0] - d.start[0], e), snap3(d.orig[1] + fp[1] - d.start[1], e), d.orig[2]]; }
        break;
      }
      case 'move3t': {
        const fp = floorHit(p.sx, p.sy, d.o.z);
        if (fp) { d.moved = true; d.o.x = snap3(d.x + fp[0] - d.start[0], e); d.o.y = snap3(d.y + fp[1] - d.start[1], e); }
        break;
      }
      case 'erase3': {
        const hit = G.pick(p.sx, p.sy, { tol: 10 });
        if (hit) { S.remove([hit.id]); G.emit('scene'); d.erased = true; }
        break;
      }
    }
    S.bump(); G.invalidate();
    return true;
  };
  T3.up = () => {
    const io = I(), d = io.drag;
    io.drag = null;
    if (!d) return;
    if (d.moved || d.erased) io._.commit();
    else if (d.kind === 'pt3' || d.kind === 'move3') G.emit('select');
  };

  T3.wheel = (e) => {
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 33;
    if (e.shiftKey) { T3.pan(-e.deltaX, -dy); }
    else T3.zoom(Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016)));
    S.bump(); G.invalidate(); G.emit('view');
  };

  // rubber band while creating segments / vectors
  T3.overlay = (c) => {
    const io = I(), m = io.mouse, P = io.pend;
    if (!m.inside || io.drag) return;
    if (['select', 'hand', 'eraser'].includes(io.tool)) return;
    const fp = floorHit(m.sx, m.sy);
    if (!fp) return;
    const sx = snap3(fp[0], { altKey: m.alt }), sy = snap3(fp[1], { altKey: m.alt });
    const p = proj([sx, sy, 0]);
    if (!p) return;
    c.beginPath(); c.arc(p[0], p[1], 3.5, 0, TAU); c.fillStyle = R.rgba('clay', 0.85); c.fill();
    if (P && P.refs.length && (io.tool === 'seg3' || io.tool === 'vec3')) {
      const a = proj(pt3(P.refs[0]));
      if (!a) return;
      c.strokeStyle = R.rgba('clay', 0.85); c.lineWidth = 2; c.setLineDash([7, 6]);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(p[0], p[1]); c.stroke(); c.setLineDash([]);
    }
  };
  R.overlay3 = T3.overlay;
})(window.G = window.G || {});
