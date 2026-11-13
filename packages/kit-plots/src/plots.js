/* Data-driven objects — many marks from one formula, plus fractals and tilings.
     dots     n dots at (xe(i), ye(i)), i = 1…n; optional class colour ce(i), radius re(i) → scatter plots, Hinton diagrams, Monte Carlo
     heat     a scalar field e(x, y) as colour cells (+ contour lines)                → loss landscapes, activations
     quiver   arrows (ue(x,y), ve(x,y)) on a grid                                    → gradients, flows
     bars     n bars centred at xe(i) with height he(i) (be(i) = baseline, dir:'h' = sideways) → histograms, grids, staircases
     fractal  koch snowflake · hilbert curve · sierpinski triangle, at level n
     tiling   regular tilings of the plane: tri · square · hex
   Every number is a formula, so sliders drive them. `i` is the index variable inside xe / ye / he / ce. */
(function (G) {
  'use strict';
  const S = G.S, R = G.R, { Expr } = G;
  const Objs = G.Objs;
  const TAU = Math.PI * 2;

  const fin = (...v) => v.every(Number.isFinite);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const prog = (o) => (o.draw == null ? 1 : clamp(o.draw, 0, 1));
  const num = (v, d) => (v == null ? d : S.num(v));
  const sc = (x, y) => R.w2s(x, y);
  const fn = (v) => Expr.compile(String(v));
  const COLS = ['clay', 'sky', 'olive', 'fig', 'kraft', 'heather', 'gray'];

  // =====================================================================
  //  dots
  // =====================================================================
  Objs.dots = {
    eval(o) { return { props: { n: clamp(Math.round(num(o.n, 0)), 0, 6000) } }; },
    draw(o, g) {
      if (R.halo) return;
      const c = R.ctx, e = (o._de = o._de || S.localEnv());
      const fx = fn(o.xe), fy = fn(o.ye), fc = o.ce != null ? fn(o.ce) : null;
      const cols = o.colors || [o.color || 'clay', 'sky', 'olive', 'fig', 'kraft', 'heather'];
      const r = num(o.r, 4), fr = o.re != null ? fn(o.re) : null, i0 = num(o.i0, 1), cnt = Math.floor(g.props.n * prog(o));
      const W = R.w + 20, H = R.h + 20;
      const ring = o.ring != null ? o.ring : 0;
      for (let k = 0; k < cnt; k++) {
        e.vars.i = i0 + k;
        const x = fx(e), y = fy(e);
        if (!fin(x, y)) continue;
        const [sx, sy] = sc(x, y);
        if (sx < -10 || sy < -10 || sx > W || sy > H) continue;
        const cls = fc ? Math.round(fc(e)) : 0, name = cols[((cls % cols.length) + cols.length) % cols.length];
        const rr = fr ? fr(e) : r;
        if (!(rr > 0)) continue;
        c.beginPath(); c.arc(sx, sy, rr, 0, TAU);
        c.fillStyle = R.rgba(name, o.alpha != null ? o.alpha : 0.85); c.fill();
        if (ring) { c.lineWidth = ring; c.strokeStyle = R.color('bg'); c.stroke(); }
      }
    },
  };

  // =====================================================================
  //  bars
  // =====================================================================
  Objs.bars = {
    eval(o) {
      const n = clamp(Math.round(num(o.n, 0)), 0, 2000), e = (o._be = o._be || S.localEnv()), fh = fn(o.he), i0 = num(o.i0, 1);
      let total = 0, max = 0;
      for (let k = 0; k < n; k++) { e.vars.i = i0 + k; const h = fh(e); if (fin(h)) { total += h; max = Math.max(max, h); } }
      return { n, props: { n, total, max } };
    },
    draw(o, g) {
      if (R.halo) return;
      const c = R.ctx, e = (o._be = o._be || S.localEnv());
      const fx = fn(o.xe), fh = fn(o.he), fc = o.ce != null ? fn(o.ce) : null, fb = o.be != null ? fn(o.be) : null;
      const cols = o.colors || [o.color || 'clay', 'sky', 'olive', 'fig'];
      const w = num(o.w, 0.8), y00 = num(o.y0, 0), i0 = num(o.i0, 1), pr = prog(o), horiz = o.dir === 'h';
      const cnt = Math.ceil(g.n * pr - 1e-9);
      for (let k = 0; k < cnt; k++) {
        e.vars.i = i0 + k;
        const x = fx(e), h = fh(e), y0 = fb ? fb(e) : y00;
        if (!fin(x, h, y0)) continue;
        // vertical bars grow up from the baseline y0; horizontal bars (dir 'h') grow right from x = y0 and sit at height x
        const [ax, ay] = horiz ? sc(y0, x + w / 2) : sc(x - w / 2, y0 + h), [bx, by] = horiz ? sc(y0 + h, x - w / 2) : sc(x + w / 2, y0);
        const cls = fc ? Math.round(fc(e)) : 0, name = cols[((cls % cols.length) + cols.length) % cols.length];
        c.fillStyle = R.rgba(name, o.fill != null ? o.fill : 0.6);
        c.fillRect(ax, ay, bx - ax, by - ay);
        if (o.outline !== false) { c.strokeStyle = R.color(name); c.lineWidth = 1.4; c.strokeRect(ax, ay, bx - ax, by - ay); }
      }
    },
  };

  // =====================================================================
  //  fractals
  // =====================================================================
  function kochPts(n, cx, cy, rad) {
    let pts = [0, 1, 2].map((k) => [cx + rad * Math.cos(Math.PI / 2 + (k * TAU) / 3), cy + rad * Math.sin(Math.PI / 2 + (k * TAU) / 3)]);
    for (let it = 0; it < n; it++) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const A = pts[i], B = pts[(i + 1) % pts.length], dx = (B[0] - A[0]) / 3, dy = (B[1] - A[1]) / 3;
        const P1 = [A[0] + dx, A[1] + dy], P2 = [A[0] + 2 * dx, A[1] + 2 * dy];
        const peak = [P1[0] + dx * 0.5 + dy * 0.8660254, P1[1] - dx * 0.8660254 + dy * 0.5];
        out.push(A, P1, peak, P2);
      }
      pts = out;
    }
    return pts;
  }
  function hilbertPts(order, x0, y0, size) {
    const N = 1 << order, pts = [];
    for (let d = 0; d < N * N; d++) {
      let t = d, x = 0, y = 0;
      for (let s = 1; s < N; s *= 2) {
        const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
        if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const tmp = x; x = y; y = tmp; }
        x += s * rx; y += s * ry; t >>= 2;
      }
      pts.push([x0 + ((x + 0.5) / N) * size, y0 + ((y + 0.5) / N) * size]);
    }
    return pts;
  }
  function sierpinskiTris(n, x, y, side, out) {
    if (n === 0) { out.push([x, y, side]); return out; }
    const h = side / 2;
    sierpinskiTris(n - 1, x, y, h, out); sierpinskiTris(n - 1, x + h, y, h, out); sierpinskiTris(n - 1, x + h / 2, y + (h * Math.sqrt(3)) / 2, h, out);
    return out;
  }
  Objs.fractal = {
    eval(o) {
      const kind = o.kind || 'koch', n = clamp(Math.round(num(o.n, 0)), 0, kind === 'hilbert' ? 7 : kind === 'sierpinski' ? 7 : 7);
      const c = S.pt(o.c || [0, 0]), r = num(o.r, 3);
      const side = kind === 'koch' ? r * Math.sqrt(3) : r;
      const props = { n };
      if (kind === 'koch') {
        const A0 = (Math.sqrt(3) / 4) * side * side;
        Object.assign(props, { side, perim: 3 * side * Math.pow(4 / 3, n), area: A0 * (8 / 5 - (3 / 5) * Math.pow(4 / 9, n)), limit: (A0 * 8) / 5, sides: 3 * Math.pow(4, n) });
      } else if (kind === 'sierpinski') {
        const A0 = (Math.sqrt(3) / 4) * r * r;
        Object.assign(props, { count: Math.pow(3, n), area: A0 * Math.pow(0.75, n), frac: Math.pow(0.75, n) });
      } else Object.assign(props, { count: Math.pow(4, n), length: (r * (Math.pow(4, n) - 1)) / Math.pow(2, n) });
      return { kind, n, c, r, props };
    },
    draw(o, g) {
      if (!fin(g.c.x, g.c.y, g.r) || R.halo) return;
      const c = R.ctx, key = [g.kind, g.n, g.c.x, g.c.y, g.r].join('|');
      if (!o._fk || o._fk.key !== key) {
        let data;
        if (g.kind === 'koch') data = kochPts(g.n, g.c.x, g.c.y, g.r);
        else if (g.kind === 'hilbert') data = hilbertPts(g.n, g.c.x, g.c.y, g.r);
        else data = sierpinskiTris(g.n, g.c.x - g.r / 2, g.c.y, g.r, []);
        o._fk = { key, data };
      }
      const data = o._fk.data, pr = prog(o), col = o.color || 'clay';
      c.lineJoin = 'round'; c.lineCap = 'round'; c.setLineDash([]);
      if (g.kind === 'sierpinski') {
        const cnt = Math.ceil(data.length * pr);
        c.fillStyle = R.rgba(col, o.fill != null ? o.fill : 0.75);
        c.beginPath();
        for (let i = 0; i < cnt; i++) {
          const [x, y, s] = data[i], p1 = sc(x, y), p2 = sc(x + s, y), p3 = sc(x + s / 2, y + (s * Math.sqrt(3)) / 2);
          c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.lineTo(p3[0], p3[1]); c.closePath();
        }
        c.fill();
        return;
      }
      const cnt = Math.max(2, Math.ceil(data.length * pr));
      c.beginPath();
      for (let i = 0; i < cnt; i++) { const p = sc(data[i][0], data[i][1]); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }
      if (g.kind === 'koch' && pr >= 0.999) {
        c.closePath();
        c.fillStyle = R.rgba(col, o.fill != null ? o.fill : 0.22); c.fill();
      }
      c.strokeStyle = R.color(col); c.lineWidth = o.w != null ? o.w : (g.kind === 'koch' ? 2 : 2.2);
      c.stroke();
    },
  };

  // =====================================================================
  //  tiling — regular tilings that fill the screen
  //    kind: 'tri' | 'square' | 'hex', a = side length, c = a vertex / origin
  // =====================================================================
  Objs.tiling = {
    eval(o) { return { props: { a: num(o.a, 1) } }; },
    draw(o) {
      if (R.halo) return;
      const kind = o.kind || 'hex', a = num(o.a, 1), org = S.pt(o.c || [0, 0]), b = R.bounds();
      if (!(a > 0) || !fin(org.x, org.y)) return;
      const c = R.ctx, cols = o.colors || ['clay', 'sky', 'olive'], fa = o.fill != null ? o.fill : 0.5, pr = prog(o);
      const polys = [];
      const add = (pts, k) => polys.push([pts.map((p) => sc(p[0], p[1])), k]);
      if (kind === 'square') {
        const i0 = Math.floor((b.x0 - org.x) / a), i1 = Math.ceil((b.x1 - org.x) / a), j0 = Math.floor((b.y0 - org.y) / a), j1 = Math.ceil((b.y1 - org.y) / a);
        if ((i1 - i0) * (j1 - j0) > 6000) return;
        for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const x = org.x + i * a, y = org.y + j * a; add([[x, y], [x + a, y], [x + a, y + a], [x, y + a]], (i + j) & 1); }
      } else if (kind === 'tri') {
        const h = (a * Math.sqrt(3)) / 2, j0 = Math.floor((b.y0 - org.y) / h) - 1, j1 = Math.ceil((b.y1 - org.y) / h) + 1;
        const i0 = Math.floor((b.x0 - org.x) / a) - Math.ceil(j1 / 2) - 1, i1 = Math.ceil((b.x1 - org.x) / a) - Math.floor(j0 / 2) + 1;
        if ((i1 - i0) * (j1 - j0) > 6000) return;
        for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
          const x = org.x + i * a + (j * a) / 2, y = org.y + j * h;
          add([[x, y], [x + a, y], [x + a / 2, y + h]], (((i + j) % 3) + 3) % 3);
          add([[x + a / 2, y + h], [x + (3 * a) / 2, y + h], [x + a, y]], (((i + j + 1) % 3) + 3) % 3);
        }
      } else {
        const w = Math.sqrt(3) * a, j0 = Math.floor((b.y0 - org.y) / (1.5 * a)) - 1, j1 = Math.ceil((b.y1 - org.y) / (1.5 * a)) + 1;
        const i0 = Math.floor((b.x0 - org.x) / w) - Math.ceil(j1 / 2) - 1, i1 = Math.ceil((b.x1 - org.x) / w) - Math.floor(j0 / 2) + 1;
        if ((i1 - i0) * (j1 - j0) > 6000) return;
        for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
          const cx = org.x + w * (i + j / 2), cy = org.y + 1.5 * a * j, pts = [];
          for (let k = 0; k < 6; k++) { const t = Math.PI / 6 + (k * Math.PI) / 3; pts.push([cx + a * Math.cos(t), cy + a * Math.sin(t)]); }
          add(pts, (((i - j) % 3) + 3) % 3);
        }
      }
      const cnt = Math.ceil(polys.length * pr);
      c.lineJoin = 'round'; c.setLineDash([]);
      for (let n = 0; n < cnt; n++) {
        const [pts, k] = polys[n];
        c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath();
        c.fillStyle = R.rgba(cols[k % cols.length], fa); c.fill();
        c.strokeStyle = R.rgba('bg', 0.95); c.lineWidth = 2; c.stroke();
      }
    },
  };

  // =====================================================================
  //  heat — colour a rectangle by a scalar field e(x, y); optional contour lines
  //    x0 x1 y0 y1 (bounds), n (cells across), lo / hi (value range, default auto), color → color2 (low → high),
  //    bands (posterise into that many levels), lines (draw contour lines between bands), alpha
  // =====================================================================
  Objs.heat = {
    eval() { return { props: {} }; },
    draw(o) {
      if (R.halo) return;
      const x0 = num(o.x0, -5), x1 = num(o.x1, 5), y0 = num(o.y0, -3), y1 = num(o.y1, 3);
      if (!fin(x0, x1, y0, y1) || x1 <= x0 || y1 <= y0) return;
      const nx = clamp(Math.round(num(o.n, 48)), 4, 140), ny = clamp(Math.round((nx * (y1 - y0)) / (x1 - x0)), 2, 140);
      const f = fn(o.e), e = (o._he = o._he || S.localEnv()), vals = new Float32Array(nx * ny);
      let mn = Infinity, mx = -Infinity;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        e.vars.x = x0 + ((i + 0.5) / nx) * (x1 - x0); e.vars.y = y0 + ((j + 0.5) / ny) * (y1 - y0);
        const v = f(e); vals[j * nx + i] = v; if (fin(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      }
      const lo = o.lo != null ? num(o.lo) : mn, hi = o.hi != null ? num(o.hi) : mx, span = hi - lo || 1;
      const bands = o.bands ? Math.round(num(o.bands)) : 0, al = o.alpha != null ? o.alpha : 0.75, c = R.ctx;
      const c1 = o.color || 'sky', c2 = o.color2 || 'clay';
      const [ax, ay] = sc(x0, y1), [bx, by] = sc(x1, y0), cw = (bx - ax) / nx, ch = (by - ay) / ny;
      const band = new Int16Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = vals[j * nx + i];
        if (!fin(v)) { band[j * nx + i] = -1; continue; }
        let t = clamp((v - lo) / span, 0, 1);
        if (bands) { const b = Math.min(bands - 1, Math.floor(t * bands)); band[j * nx + i] = b; t = b / Math.max(1, bands - 1); } else band[j * nx + i] = 0;
        const px = ax + i * cw, py = ay + (ny - 1 - j) * ch;
        c.fillStyle = R.rgba(c1, (1 - t) * al); c.fillRect(px, py, cw + 0.6, ch + 0.6);
        c.fillStyle = R.rgba(c2, t * al); c.fillRect(px, py, cw + 0.6, ch + 0.6);
      }
      if (o.lines && bands) {
        c.beginPath();
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const b = band[j * nx + i], px = ax + i * cw, py = ay + (ny - 1 - j) * ch;
          if (i + 1 < nx && band[j * nx + i + 1] !== b) { c.moveTo(px + cw, py); c.lineTo(px + cw, py + ch); }
          if (j + 1 < ny && band[(j + 1) * nx + i] !== b) { c.moveTo(px, py); c.lineTo(px + cw, py); }
        }
        c.strokeStyle = R.rgba('ink', 0.55); c.lineWidth = 1.2; c.stroke();
      }
    },
  };

  // =====================================================================
  //  quiver — arrows (ue(x,y), ve(x,y)) on an nx × ny grid over x0..x1, y0..y1;  len = longest arrow (world units)
  // =====================================================================
  Objs.quiver = {
    eval() { return { props: {} }; },
    draw(o) {
      if (R.halo) return;
      const x0 = num(o.x0, -5), x1 = num(o.x1, 5), y0 = num(o.y0, -3), y1 = num(o.y1, 3), nx = clamp(Math.round(num(o.nx, 12)), 2, 60), ny = clamp(Math.round(num(o.ny, 8)), 2, 60);
      const len = num(o.len, 0.7), fu = fn(o.ue), fv = fn(o.ve), e = (o._qe = o._qe || S.localEnv()), c = R.ctx;
      const col = R.color(o.color || 'olive');
      let mx = 0; const arr = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + ((i + 0.5) / nx) * (x1 - x0), y = y0 + ((j + 0.5) / ny) * (y1 - y0);
        e.vars.x = x; e.vars.y = y;
        const u = fu(e), v = fv(e);
        if (fin(u, v)) { arr.push([x, y, u, v]); mx = Math.max(mx, Math.hypot(u, v)); }
      }
      if (!mx) return;
      const k = o.fixed ? 1 : len / mx;
      c.lineWidth = o.w != null ? o.w : 1.8; c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round';
      arr.forEach(([x, y, u, v]) => {
        const m = Math.hypot(u, v) * (o.fixed ? len : k); if (m < 1e-6) return;
        const dx = (u / Math.hypot(u, v)) * m, dy = (v / Math.hypot(u, v)) * m;
        const [sx, sy] = sc(x - dx / 2, y - dy / 2), [tx, ty] = sc(x + dx / 2, y + dy / 2), a = Math.atan2(ty - sy, tx - sx), hs = Math.min(9, 4 + m * S.view.s * 0.12);
        c.beginPath(); c.moveTo(sx, sy); c.lineTo(tx, ty); c.stroke();
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx - hs * Math.cos(a - 0.45), ty - hs * Math.sin(a - 0.45)); c.lineTo(tx - hs * Math.cos(a + 0.45), ty - hs * Math.sin(a + 0.45)); c.closePath(); c.fill();
      });
    },
  };
})(window.G = window.G || {});
