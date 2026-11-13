/* Object types — each has eval(o) → geometry (+ props readable from expressions, e.g. "c1.area"),
   draw(o, g) and optionally label(o, g). Also the construction math (Geo) and hit-testing (G.pick). */
(function (G) {
  'use strict';
  const S = G.S, R = G.R, { Expr } = G;
  const TAU = Math.PI * 2;
  const NAN = { x: NaN, y: NaN };
  const Objs = (G.Objs = {});
  const Geo = (G.Geo = {});

  // Register an object type from an external file (loads after objects.js).
  // G.Objs.register('mytype', { eval(o){…}, draw(o){…}, label?(o){…} })
  Objs.register = (type, def) => { Objs[type] = def; };

  const fin = (...v) => v.every(Number.isFinite);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const prog = (o) => (o.draw == null ? 1 : clamp(o.draw, 0, 1));
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const sc = (x, y) => R.w2s(x, y);

  function stroke(o, dw = 2.2) {
    const c = R.ctx;
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (R.halo) {
      c.strokeStyle = R.rgba('clay', R.halo === 1 ? 0.3 : 0.16);
      c.lineWidth = (o.w != null ? o.w : dw) + (R.halo === 1 ? 9 : 7);
      c.setLineDash([]);
    } else {
      c.strokeStyle = R.color(o.color || 'ink');
      c.lineWidth = o.w != null ? (typeof o.w === 'string' ? Math.max(0.001, G.S.num(o.w)) : o.w) : dw;   // w may be a formula
      c.setLineDash(o.dash ? (o.dash === true ? [8, 7] : [+o.dash, +o.dash]) : []);
    }
  }
  const fillStyle = (o, base = 0, k = 1) => R.rgba(o.color || 'ink', (o.fill != null ? (typeof o.fill === 'string' ? G.S.num(o.fill) : o.fill) : base) * k);   // fill may be a formula

  function fmtAngle(rad, o) {
    if (o.unit === 'rad') {
      const k = rad / Math.PI;
      for (const den of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
        const n = Math.round(k * den);
        if (n !== 0 && Math.abs(k * den - n) < 0.004) {
          const top = n === 1 ? 'π' : n + 'π';
          return den === 1 ? top : `${top}/${den}`;
        }
      }
      return Expr.fmt(rad, 2) + ' rad';
    }
    return Expr.fmt((rad * 180) / Math.PI, o.dp != null ? o.dp : 0) + '°';
  }

  function edgeLabel(o, text, ax, ay, bx, by, off = 14, extra = {}) {
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    let nx = dy / l, ny = -dx / l;
    if (ny > 0.05 || (Math.abs(ny) <= 0.05 && nx < 0)) { nx = -nx; ny = -ny; }
    R.text(text, (ax + bx) / 2 + nx * off, (ay + by) / 2 + ny * off, Object.assign({ size: 16, italic: true, color: o.color }, extra));
  }

  // =====================================================================
  //  Construction math
  // =====================================================================
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;

  Geo.intersect = (a, b, i) => {
    if (!a || !b) return NAN;
    const la = S.isLineLike(a), lb = S.isLineLike(b), ca = a.type === 'circle', cb = b.type === 'circle';
    if (la && lb) {
      const A = S.geom(a), B = S.geom(b);
      if (!A || !B) return NAN;
      const d1x = A.L.q.x - A.L.p.x, d1y = A.L.q.y - A.L.p.y, d2x = B.L.q.x - B.L.p.x, d2y = B.L.q.y - B.L.p.y;
      const den = cross(d1x, d1y, d2x, d2y);
      if (Math.abs(den) < 1e-12) return NAN;
      const t = cross(B.L.p.x - A.L.p.x, B.L.p.y - A.L.p.y, d2x, d2y) / den;
      return { x: A.L.p.x + t * d1x, y: A.L.p.y + t * d1y };
    }
    if ((la && cb) || (ca && lb)) {
      const l = S.geom(la ? a : b), c = S.geom(la ? b : a);
      if (!l || !c) return NAN;
      const p = l.L.p, dx = l.L.q.x - p.x, dy = l.L.q.y - p.y, fx = p.x - c.c.x, fy = p.y - c.c.y;
      const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - c.r * c.r;
      const disc = B * B - 4 * A * C;
      if (!(A > 0) || disc < -1e-9) return NAN;
      const sq = Math.sqrt(Math.max(0, disc));
      const t = (-B + (i ? sq : -sq)) / (2 * A);
      return { x: p.x + t * dx, y: p.y + t * dy };
    }
    if (ca && cb) {
      const A = S.geom(a), B = S.geom(b);
      if (!A || !B) return NAN;
      const dx = B.c.x - A.c.x, dy = B.c.y - A.c.y, d = Math.hypot(dx, dy);
      if (d < 1e-12 || d > A.r + B.r + 1e-9 || d < Math.abs(A.r - B.r) - 1e-9) return NAN;
      const aa = (A.r * A.r - B.r * B.r + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, A.r * A.r - aa * aa));
      const ex = dx / d, ey = dy / d, s = i ? -1 : 1;
      return { x: A.c.x + aa * ex - s * h * ey, y: A.c.y + aa * ey + s * h * ex };
    }
    return NAN;
  };
  Geo.intersectable = (o) => !!o && (S.isLineLike(o) || o.type === 'circle');

  const curveAt = (o, u) => {
    const e = (o._ce = o._ce || S.localEnv());
    e.vars.u = u;
    return { x: Expr.num(o.xe, e), y: Expr.num(o.ye, e) };
  };
  const funcAt = (o, x) => {
    const e = (o._fe = o._fe || S.localEnv());
    e.vars.x = x;
    return Expr.num(o.e, e);
  };

  Geo.pointOn = (host, t) => {
    const g = S.geom(host);
    if (!g) return NAN;
    switch (host.type) {
      case 'circle': return { x: g.c.x + g.r * Math.cos(t), y: g.c.y + g.r * Math.sin(t) };
      case 'seg': case 'line': case 'ray': case 'vec':
        return { x: g.L.p.x + t * (g.L.q.x - g.L.p.x), y: g.L.p.y + t * (g.L.q.y - g.L.p.y) };
      case 'func': return { x: t, y: funcAt(host, t) };
      case 'curve': return curveAt(host, t);
      case 'poly': case 'ngon': {
        const n = g.pts.length;
        if (n < 2) return NAN;
        const closed = host.closed !== false;
        const m = closed ? n : n - 1;
        let tt = closed ? ((t % m) + m) % m : clamp(t, 0, m);
        let i = Math.min(m - 1, Math.floor(tt));
        const f = tt - i, a = g.pts[i], b = g.pts[(i + 1) % n];
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return NAN;
  };

  // Closest parameter on a host for a world position.
  Geo.paramFor = (host, x, y) => {
    const g = S.geom(host);
    if (!g) return 0;
    switch (host.type) {
      case 'circle': return Math.atan2(y - g.c.y, x - g.c.x);
      case 'seg': case 'line': case 'ray': case 'vec': {
        const dx = g.L.q.x - g.L.p.x, dy = g.L.q.y - g.L.p.y, l2 = dx * dx + dy * dy || 1;
        const t = ((x - g.L.p.x) * dx + (y - g.L.p.y) * dy) / l2;
        return host.type === 'seg' || host.type === 'vec' ? clamp(t, 0, 1) : host.type === 'ray' ? Math.max(0, t) : t;
      }
      case 'func': return x;
      case 'curve': {
        const u0 = S.num(host.u0 != null ? host.u0 : 0), u1 = S.num(host.u1 != null ? host.u1 : TAU);
        let best = u0, bd = Infinity;
        for (let i = 0; i <= 480; i++) {
          const u = u0 + ((u1 - u0) * i) / 480, p = curveAt(host, u), d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d < bd) { bd = d; best = u; }
        }
        return best;
      }
      case 'poly': case 'ngon': {
        const pts = g.pts, n = pts.length, m = host.closed !== false ? n : n - 1;
        let best = 0, bd = Infinity;
        for (let i = 0; i < m; i++) {
          const a = pts[i], b = pts[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
          const f = clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1);
          const d = (a.x + dx * f - x) ** 2 + (a.y + dy * f - y) ** 2;
          if (d < bd) { bd = d; best = i + f; }
        }
        return best;
      }
    }
    return 0;
  };
  Geo.glideable = (o) => !!o && (S.isLineLike(o) || ['circle', 'func', 'curve', 'poly', 'ngon'].includes(o.type));

  // =====================================================================
  //  Point
  // =====================================================================
  Objs.point = {
    draw(o) {
      const p = S.evalPoint(o);
      if (!fin(p.x, p.y)) return;
      const [sx, sy] = sc(p.x, p.y);
      const c = R.ctx, r = o.size != null ? o.size : 5;
      if (R.halo) {
        c.beginPath(); c.arc(sx, sy, r + 8, 0, TAU);
        c.fillStyle = R.rgba('clay', R.halo === 1 ? 0.3 : 0.18); c.fill();
        return;
      }
      if (r <= 0) return;
      const free = S.isFree(o) || (o.def && o.def.k === 'on' && typeof o.def.t === 'number');
      if (free) { c.beginPath(); c.arc(sx, sy, r + 4.5, 0, TAU); c.fillStyle = R.rgba(o.color || 'ink', 0.14); c.fill(); }
      c.beginPath(); c.arc(sx, sy, r, 0, TAU);
      c.fillStyle = R.color(o.color || 'ink'); c.fill();
      c.lineWidth = 2; c.strokeStyle = R.color('bg'); c.stroke();
      R.hit(o, { k: 'p', x: sx, y: sy, r: Math.max(r + 5, 10) });
    },
    label(o) {
      if (!o.label) return;
      const p = S.evalPoint(o);
      if (!fin(p.x, p.y)) return;
      const [sx, sy] = sc(p.x, p.y), lo = o.lo || [11, -12];
      R.text(Expr.interp(o.label, S.env), sx + lo[0], sy + lo[1], { size: 17, italic: true, color: o.color || 'ink' });
    },
  };

  // =====================================================================
  //  Line-like: seg / ray / line / vec
  // =====================================================================
  function lineEval(o) {
    const L = S.lineOf(o);
    if (!L) return null;
    const dx = L.q.x - L.p.x, dy = L.q.y - L.p.y;
    return { L, props: { len: Math.hypot(dx, dy), dx, dy, slope: dy / dx, angle: Math.atan2(dy, dx) } };
  }
  function lineDraw(o, g) {
    if (!g || !fin(g.L.p.x, g.L.p.y, g.L.q.x, g.L.q.y)) return;
    const c = R.ctx;
    const [px, py] = sc(g.L.p.x, g.L.p.y), [qx, qy] = sc(g.L.q.x, g.L.q.y);
    const dx = qx - px, dy = qy - py, l = Math.hypot(dx, dy);
    if (l < 1e-6) return;
    const big = (R.w + R.h) * 4, ux = dx / l, uy = dy / l;
    let ax = px, ay = py, bx = qx, by = qy;
    if (o.type === 'line') { ax = px - ux * big; ay = py - uy * big; bx = px + ux * big; by = py + uy * big; }
    else if (o.type === 'ray') { bx = px + ux * big; by = py + uy * big; }
    const pr = prog(o);
    const ex = ax + (bx - ax) * pr, ey = ay + (by - ay) * pr;
    stroke(o);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ex, ey); c.stroke();
    if (o.type === 'vec' && !R.halo && pr > 0.05) {
      const w = o.w != null ? o.w : 2.4, hs = 9 + w * 2.2, a = Math.atan2(ey - ay, ex - ax);
      c.beginPath();
      c.moveTo(ex, ey);
      c.lineTo(ex - hs * Math.cos(a - 0.4), ey - hs * Math.sin(a - 0.4));
      c.lineTo(ex - hs * 0.7 * Math.cos(a), ey - hs * 0.7 * Math.sin(a));
      c.lineTo(ex - hs * Math.cos(a + 0.4), ey - hs * Math.sin(a + 0.4));
      c.closePath();
      c.fillStyle = R.color(o.color || 'ink'); c.fill();
    }
    if (o.ticks && !R.halo) {
      const mx = (px + qx) / 2, my = (py + qy) / 2, nx = -uy, ny = ux, n = o.ticks | 0;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 6;
        c.moveTo(mx + ux * off + nx * 6, my + uy * off + ny * 6);
        c.lineTo(mx + ux * off - nx * 6, my + uy * off - ny * 6);
      }
      c.lineWidth = 2; c.stroke();
    }
    if (!R.halo) R.hit(o, { k: 's', x1: ax, y1: ay, x2: bx, y2: by });
  }
  function lineLabel(o, g) {
    if (!g || prog(o) < 0.6) return;
    const parts = [];
    if (o.label) parts.push(Expr.interp(o.label, S.env));
    if (o.meas) parts.push(Expr.fmt(g.props.len, o.dp != null ? o.dp : 2));
    if (!parts.length) return;
    const [px, py] = sc(g.L.p.x, g.L.p.y), [qx, qy] = sc(g.L.q.x, g.L.q.y);
    if (!fin(px, py, qx, qy)) return;
    edgeLabel(o, parts.join(o.label && o.meas ? ' = ' : ''), px, py, qx, qy, 15);
  }
  ['seg', 'ray', 'line', 'vec'].forEach((t) => { Objs[t] = { eval: lineEval, draw: lineDraw, label: lineLabel }; });

  // =====================================================================
  //  Circle
  // =====================================================================
  Objs.circle = {
    eval(o) {
      const c = S.pt(o.c);
      const r = o.thru != null ? Math.hypot(S.pt(o.thru).x - c.x, S.pt(o.thru).y - c.y) : S.num(o.r);
      return { c, r, props: { r, d: 2 * r, circ: TAU * r, area: Math.PI * r * r } };
    },
    draw(o, g) {
      if (!fin(g.c.x, g.c.y, g.r)) return;
      const c = R.ctx, [cx, cy] = sc(g.c.x, g.c.y), rp = g.r * S.view.s, pr = prog(o);
      if (rp < 0.3 || rp > 4e6) return;
      if (!R.halo && o.fill > 0 && pr > 0.5) {
        c.beginPath(); c.arc(cx, cy, rp, 0, TAU);
        c.fillStyle = fillStyle(o, 0, smooth((pr - 0.5) * 2)); c.fill();
      }
      stroke(o);
      c.beginPath();
      if (pr >= 0.9999) c.arc(cx, cy, rp, 0, TAU); else c.arc(cx, cy, rp, 0, -TAU * pr, true);
      c.stroke();
      if (!R.halo) R.hit(o, { k: 'c', x: cx, y: cy, r: rp, fill: o.fill > 0 });
    },
    label(o, g) {
      if (!o.label || !fin(g.c.x, g.r)) return;
      const [cx, cy] = sc(g.c.x, g.c.y), rp = g.r * S.view.s, a = 0.7;
      R.text(Expr.interp(o.label, S.env), cx + (rp + 16) * Math.cos(a), cy - (rp + 16) * Math.sin(a), { size: 16, italic: true, color: o.color });
    },
  };

  // =====================================================================
  //  Sector / arc
  // =====================================================================
  Objs.sector = {
    eval(o) {
      const c = S.pt(o.c), r = S.num(o.r), a0 = S.num(o.a0), a1 = S.num(o.a1), ang = a1 - a0;
      return { c, r, a0, a1, props: { ang, deg: (ang * 180) / Math.PI, arc: r * ang, area: (r * r * ang) / 2 } };
    },
    draw(o, g) {
      if (!fin(g.c.x, g.c.y, g.r, g.a0, g.a1)) return;
      const c = R.ctx, [cx, cy] = sc(g.c.x, g.c.y), rp = g.r * S.view.s, pr = prog(o);
      const sweep = (g.a1 - g.a0) * pr, pie = o.pie !== false;
      if (rp < 0.3) return;
      c.beginPath();
      if (pie) c.moveTo(cx, cy);
      c.arc(cx, cy, rp, -g.a0, -(g.a0 + sweep), true);
      if (pie) c.closePath();
      if (!R.halo) { c.fillStyle = fillStyle(o, 0.28); c.fill(); }
      stroke(o);
      c.stroke();
      if (!R.halo) {
        const pts = [[cx, cy]];
        for (let i = 0; i <= 24; i++) { const a = g.a0 + (sweep * i) / 24; pts.push([cx + rp * Math.cos(a), cy - rp * Math.sin(a)]); }
        R.hit(o, { k: 'poly', pts, fill: pie });
      }
    },
    label(o, g) {
      if (!o.label || !fin(g.r, g.a0, g.a1)) return;
      const [cx, cy] = sc(g.c.x, g.c.y), rp = g.r * S.view.s, am = (g.a0 + g.a1) / 2;
      R.text(Expr.interp(o.label, S.env), cx + (rp * 0.62) * Math.cos(am), cy - (rp * 0.62) * Math.sin(am), { size: 16, italic: true, color: o.color });
    },
  };

  // =====================================================================
  //  Polygon / regular n-gon
  // =====================================================================
  function polyProps(pts) {
    let a2 = 0, per = 0, cx = 0, cy = 0;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      a2 += p.x * q.y - q.x * p.y;
      per += Math.hypot(q.x - p.x, q.y - p.y);
      cx += p.x; cy += p.y;
    });
    return { area: Math.abs(a2) / 2, perim: per, n: pts.length, cx: cx / pts.length, cy: cy / pts.length };
  }
  function polyDraw(o, g) {
    const pts = g.pts;
    if (!pts.length || !pts.every((p) => fin(p.x, p.y))) return;
    const c = R.ctx, sp = pts.map((p) => sc(p.x, p.y)), closed = o.closed !== false, pr = prog(o);
    if (!R.halo && o.fill !== 0 && closed) {
      const fa = (o.fill != null ? (typeof o.fill === 'string' ? S.num(o.fill) : o.fill) : 0.12) * smooth((pr - 0.55) / 0.45);   // fill may be a formula
      if (fa > 0) { R.tracePoly(sp, true, 1); c.fillStyle = R.rgba(o.color || 'ink', fa); c.fill(); }
    }
    stroke(o);
    R.tracePoly(sp, closed, pr);
    c.stroke();
    if (!R.halo) {
      const n = sp.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = sp[i], b = sp[(i + 1) % n];
        R.hit(o, { k: 's', x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      }
      if (closed && (o.fill == null || o.fill > 0)) R.hit(o, { k: 'poly', pts: sp, fill: true });
    }
  }
  function polyLabel(o, g) {
    const pts = g.pts;
    if (!pts.length || !pts.every((p) => fin(p.x, p.y)) || prog(o) < 0.6) return;
    const sp = pts.map((p) => sc(p.x, p.y));
    if (o.edges) {
      sp.forEach((a, i) => {
        const b = sp[(i + 1) % sp.length];
        if (o.closed === false && i === sp.length - 1) return;
        const l = Math.hypot(pts[(i + 1) % pts.length].x - pts[i].x, pts[(i + 1) % pts.length].y - pts[i].y);
        // push labels outward, away from the centroid
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const ccx = sp.reduce((s, p) => s + p[0], 0) / sp.length, ccy = sp.reduce((s, p) => s + p[1], 0) / sp.length;
        let nx = mx - ccx, ny = my - ccy; const nl = Math.hypot(nx, ny) || 1;
        R.text(Expr.fmt(l, o.dp != null ? o.dp : 1), mx + (nx / nl) * 15, my + (ny / nl) * 15, { size: 15, italic: true, color: o.color });
      });
    }
    const parts = [];
    if (o.label) parts.push(Expr.interp(o.label, S.env));
    if (o.meas) parts.push('area ' + Expr.fmt(g.props.area, o.dp != null ? o.dp : 1));
    if (!parts.length) return;
    const cx = sp.reduce((s, p) => s + p[0], 0) / sp.length, cy = sp.reduce((s, p) => s + p[1], 0) / sp.length;
    R.text(parts.join('\n'), cx, cy, { size: 16, italic: !o.meas, color: o.color });
  }
  Objs.poly = {
    eval(o) { const pts = (o.pts || []).map((r) => S.pt(r)); return { pts, props: polyProps(pts) }; },
    draw: polyDraw, label: polyLabel,
  };
  Objs.ngon = {
    eval(o) {
      const c = S.pt(o.c);
      const n = clamp(Math.round(S.num(o.n != null ? o.n : 5)), 3, 240);
      let bx, by;
      if (o.v != null) { const v = S.pt(o.v); bx = v.x - c.x; by = v.y - c.y; }
      else { const r = S.num(o.r), rot = S.num(o.rot != null ? o.rot : Math.PI / 2); bx = r * Math.cos(rot); by = r * Math.sin(rot); }
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = (TAU * k) / n, ca = Math.cos(a), sa = Math.sin(a);
        pts.push({ x: c.x + bx * ca - by * sa, y: c.y + bx * sa + by * ca });
      }
      const r = Math.hypot(bx, by);
      const props = polyProps(pts);
      Object.assign(props, { r, side: 2 * r * Math.sin(Math.PI / n), apothem: r * Math.cos(Math.PI / n), interior: ((n - 2) * 180) / n, cx: c.x, cy: c.y });
      return { pts, c, props };
    },
    draw: polyDraw,
    label(o, g) { polyLabel(o, g); },
  };

  // =====================================================================
  //  Angle marker
  // =====================================================================
  Objs.angle = {
    eval(o) {
      const A = S.pt(o.a), V = S.pt(o.v), B = S.pt(o.b);
      const t1 = Math.atan2(A.y - V.y, A.x - V.x), t2 = Math.atan2(B.y - V.y, B.x - V.x);
      let d = (((t2 - t1) % TAU) + TAU) % TAU, s = t1;
      if (d > Math.PI) { s = t2; d = TAU - d; }
      if (o.reflex) { s = s + d; d = TAU - d; }
      return { V, s, d, props: { rad: d, deg: (d * 180) / Math.PI } };
    },
    draw(o, g) {
      if (!fin(g.V.x, g.V.y, g.s, g.d)) return;
      const c = R.ctx, [vx, vy] = sc(g.V.x, g.V.y), pr = prog(o);
      const rp = o.r != null ? o.r : 30;
      const sweep = g.d * pr;
      const right = Math.abs(g.d - Math.PI / 2) < 0.006 && !o.reflex;
      if (!R.halo) {
        c.beginPath(); c.moveTo(vx, vy);
        if (right) {
          const k = rp * 0.72, ca = Math.cos(g.s), sa = -Math.sin(g.s), cb = Math.cos(g.s + g.d), sb = -Math.sin(g.s + g.d);
          c.lineTo(vx + ca * k, vy + sa * k); c.lineTo(vx + (ca + cb) * k, vy + (sa + sb) * k); c.lineTo(vx + cb * k, vy + sb * k);
        } else c.arc(vx, vy, rp, -g.s, -(g.s + sweep), true);
        c.closePath();
        c.fillStyle = fillStyle(o, 0.2); c.fill();
      }
      stroke(o, 1.8);
      c.beginPath();
      if (right) {
        const k = rp * 0.72, ca = Math.cos(g.s), sa = -Math.sin(g.s), cb = Math.cos(g.s + g.d), sb = -Math.sin(g.s + g.d);
        c.moveTo(vx + ca * k, vy + sa * k); c.lineTo(vx + (ca + cb) * k, vy + (sa + sb) * k); c.lineTo(vx + cb * k, vy + sb * k);
      } else {
        const n = Math.max(1, o.ticks | 0);
        for (let i = 0; i < n; i++) { const rr = rp + i * 5; c.moveTo(vx + rr * Math.cos(g.s), vy - rr * Math.sin(g.s)); c.arc(vx, vy, rr, -g.s, -(g.s + sweep), true); }
      }
      c.stroke();
      if (!R.halo) {
        const pts = [[vx, vy]];
        for (let i = 0; i <= 12; i++) { const a = g.s + (g.d * i) / 12; pts.push([vx + rp * Math.cos(a), vy - rp * Math.sin(a)]); }
        R.hit(o, { k: 'poly', pts, fill: true });
      }
    },
    label(o, g) {
      if (!fin(g.V.x, g.d) || prog(o) < 0.6) return;
      const parts = [];
      if (o.label) parts.push(Expr.interp(o.label, S.env));
      if (o.val !== false) parts.push(fmtAngle(g.d, o));
      if (!parts.length) return;
      const [vx, vy] = sc(g.V.x, g.V.y), rp = (o.r != null ? o.r : 30) + 16 + Math.max(0, (o.ticks | 0) - 1) * 5, am = g.s + g.d / 2;
      // for narrow angles, push the label out further so it doesn't sit on the arms
      const extra = g.d < 0.6 ? 10 : 0;
      R.text(parts.join(o.label && o.val !== false ? ' = ' : ''), vx + (rp + extra) * Math.cos(am), vy - (rp + extra) * Math.sin(am), { size: 15, color: o.color || 'ink', font: 'sans' });
    },
  };

  // =====================================================================
  //  Function graph  y = f(x)
  // =====================================================================
  function splitPieces(sample, N, nmax, breakFn) {
    const pieces = [];
    let cur = [];
    for (let i = 0; i <= nmax; i++) {
      const p = sample(i);
      if (!p || !fin(p[0], p[1]) || Math.abs(p[1]) > 1e5) { if (cur.length > 1) pieces.push(cur); cur = []; continue; }
      if (cur.length && breakFn(cur[cur.length - 1], p)) { if (cur.length > 1) pieces.push(cur); cur = []; }
      cur.push(p);
    }
    if (cur.length > 1) pieces.push(cur);
    return pieces;
  }
  function drawPieces(o, pieces) {
    const c = R.ctx;
    stroke(o);
    pieces.forEach((pc) => {
      c.beginPath();
      pc.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.stroke();
      if (!R.halo) R.hit(o, { k: 'poly', pts: pc, fill: false });
    });
  }
  Objs.func = {
    eval(o) { return { props: {} }; },
    draw(o) {
      const b = R.bounds(), s = S.view.s, pr = prog(o);
      const d0 = o.x0 != null ? S.num(o.x0) : -Infinity, d1 = o.x1 != null ? S.num(o.x1) : Infinity;
      const lo = Math.max(b.x0, d0), hi = Math.min(b.x1, d1);
      if (!(hi > lo)) return;
      const N = clamp(Math.ceil(((hi - lo) * s) / 1.4), 2, 2600);
      const nmax = Math.floor(N * pr);
      const e = (o._fe = o._fe || S.localEnv());
      const f = Expr.compile(o.e);
      const pieces = splitPieces((i) => {
        const x = lo + ((hi - lo) * i) / N;
        e.vars.x = x;
        const y = f(e);
        const [sx, sy] = sc(x, y);
        return [sx, sy, x, y];
      }, N, nmax, (a, p) => Math.abs(p[1] - a[1]) > R.h * 2.5);
      o._pieces = pieces;
      drawPieces(o, pieces);
    },
    label(o) {
      if (!o.label || !o._pieces || !o._pieces.length || prog(o) < 0.6) return;
      const pc = o._pieces[o._pieces.length - 1];
      const p = pc[Math.floor(pc.length * (o.la != null ? o.la : 0.8))];
      if (p) R.text(Expr.interp(o.label, S.env), p[0], p[1] - 16, { size: 16, italic: true, color: o.color });
    },
  };

  // =====================================================================
  //  Parametric curve  (x(u), y(u))
  // =====================================================================
  Objs.curve = {
    eval(o) { return { props: {} }; },
    draw(o) {
      const u0 = S.num(o.u0 != null ? o.u0 : 0), u1 = S.num(o.u1 != null ? o.u1 : TAU);
      if (!fin(u0, u1)) return;
      const n = clamp(Math.round(o.n || 480), 8, 4000), pr = prog(o), nmax = Math.floor(n * pr);
      const pieces = splitPieces((i) => {
        const p = curveAt(o, u0 + ((u1 - u0) * i) / n);
        const [sx, sy] = sc(p.x, p.y);
        return [sx, sy];
      }, n, nmax, (a, p) => Math.hypot(p[0] - a[0], p[1] - a[1]) > Math.max(R.w, R.h));
      o._pieces = pieces;
      drawPieces(o, pieces);
    },
    label(o) {
      if (!o.label || !o._pieces || !o._pieces.length) return;
      const pc = o._pieces[0], p = pc[Math.floor(pc.length * 0.12)];
      if (p) R.text(Expr.interp(o.label, S.env), p[0], p[1] - 16, { size: 16, italic: true, color: o.color });
    },
  };

  // =====================================================================
  //  Text
  // =====================================================================
  Objs.text = {
    eval() { return { props: {} }; },
    draw(o) {
      if (R.halo && !o._box) return;
      const x = S.num(o.x), y = S.num(o.y);
      if (!fin(x, y)) return;
      let [sx, sy] = o.pin ? [R.w / 2, 34] : sc(x, y);
      if (o.dx) sx += o.dx;
      if (o.dy) sy += o.dy;
      let str = Expr.interp(o.text != null ? o.text : '', S.env);
      const pr = prog(o);
      if (pr < 1) str = str.slice(0, Math.ceil(str.length * pr));
      if (R.halo) {
        const b = o._box;
        R.ctx.strokeStyle = R.rgba('clay', 0.5); R.ctx.lineWidth = 2; R.ctx.setLineDash([5, 4]);
        R.ctx.strokeRect(b.x - 6, b.y - 4, b.w + 12, b.h + 8);
        R.ctx.setLineDash([]);
        return;
      }
      const box = R.text(str, sx, sy, { size: o.size || 20, italic: !!o.it, bold: !!o.bold, font: o.font, color: o.color, align: o.align || 'center', bg: !!o.bg });
      o._box = box;
      R.hit(o, { k: 'box', x: box.x - 6, y: box.y - 4, w: box.w + 12, h: box.h + 8 });
    },
  };

  // =====================================================================
  //  Riemann sums
  // =====================================================================
  Objs.riemann = {
    eval(o) {
      const e = S.localEnv(), f = Expr.compile(o.e);
      const fx = (x) => { e.vars.x = x; return f(e); };
      const a = S.num(o.a), b = S.num(o.b), n = clamp(Math.round(S.num(o.n)), 1, 2000);
      const mode = o.mode || 'left', dx = (b - a) / n;
      const rects = [];
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const xl = a + i * dx, xr = xl + dx;
        let h;
        if (mode === 'left') h = fx(xl);
        else if (mode === 'right') h = fx(xr);
        else if (mode === 'mid') h = fx(xl + dx / 2);
        else if (mode === 'trap') { h = (fx(xl) + fx(xr)) / 2; rects.push([xl, xr, fx(xl), fx(xr)]); sum += h * dx; continue; }
        else {
          let hi = -Infinity, lo = Infinity;
          for (let k = 0; k <= 10; k++) { const v = fx(xl + (dx * k) / 10); hi = Math.max(hi, v); lo = Math.min(lo, v); }
          h = mode === 'upper' ? hi : lo;
        }
        rects.push([xl, xr, h, h]);
        sum += h * dx;
      }
      let ex = 0;
      const M = 600, hh = (b - a) / M;
      for (let i = 0; i <= M; i++) ex += fx(a + i * hh) * (i === 0 || i === M ? 1 : i % 2 ? 4 : 2);
      ex *= hh / 3;
      return { rects, props: { sum, exact: ex, err: sum - ex, n, dx } };
    },
    draw(o, g) {
      if (!g.rects.length) return;
      const c = R.ctx, cnt = Math.ceil(g.rects.length * prog(o));
      for (let i = 0; i < cnt; i++) {
        const [xl, xr, h1, h2] = g.rects[i];
        if (!fin(xl, xr, h1, h2)) continue;
        const [ax, ay0] = sc(xl, 0), [bx, ay1] = sc(xr, h1), [, by1] = sc(xr, h2);
        c.beginPath();
        c.moveTo(ax, ay0); c.lineTo(ax, ay1); c.lineTo(bx, by1); c.lineTo(bx, ay0); c.closePath();
        if (!R.halo) { c.fillStyle = fillStyle(o, 0.3); c.fill(); }
        stroke(o, 1); c.stroke();
      }
    },
  };

  // =====================================================================
  //  Tiles — unit squares that fill a rectangle (counting area)
  // =====================================================================
  Objs.tiles = {
    eval(o) {
      const x = S.num(o.x), y = S.num(o.y), cols = clamp(Math.round(S.num(o.cols)), 0, 200), rows = clamp(Math.round(S.num(o.rows)), 0, 200);
      const total = cols * rows, shown = Math.min(total, Math.floor(total * prog(o) + 1e-9));
      return { x, y, cols, rows, total, shown, props: { total, n: shown, cols, rows } };
    },
    draw(o, g) {
      if (!fin(g.x, g.y) || !g.total) return;
      const c = R.ctx;
      if (R.halo) {
        const [ax, ay] = sc(g.x, g.y + g.rows), [bx, by] = sc(g.x + g.cols, g.y);
        c.strokeStyle = R.rgba('clay', 0.35); c.lineWidth = 8; c.strokeRect(ax, ay, bx - ax, by - ay);
        return;
      }
      const s = S.view.s;
      c.fillStyle = R.rgba(o.color || 'clay', o.fill != null ? o.fill : 0.55);
      c.strokeStyle = R.rgba('bg', 0.95);
      c.lineWidth = Math.min(2.5, Math.max(0.6, s * 0.03));
      for (let i = 0; i < g.shown; i++) {
        const cx = g.x + (i % g.cols), cy = g.y + Math.floor(i / g.cols);
        const [ax, ay] = sc(cx, cy + 1);
        c.fillRect(ax, ay, s, s);
        c.strokeRect(ax, ay, s, s);
      }
      const [ax, ay] = sc(g.x, g.y + g.rows), [bx, by] = sc(g.x + g.cols, g.y);
      c.strokeStyle = R.color(o.color || 'clay'); c.lineWidth = 2;
      c.strokeRect(ax, ay, bx - ax, by - ay);
      R.hit(o, { k: 'poly', pts: [[ax, ay], [bx, ay], [bx, by], [ax, by]], fill: true });
    },
  };

  // =====================================================================
  //  Linear-transformation grid
  // =====================================================================
  Objs.xfgrid = {
    eval(o) {
      const m = (o.m || [1, 0, 0, 1]).map((v) => S.num(v));
      return { m, props: { det: m[0] * m[3] - m[1] * m[2], a: m[0], b: m[1], c: m[2], d: m[3] } };
    },
    draw(o, g) {
      if (!g.m.every(Number.isFinite)) return;
      const c = R.ctx, [a, b, cc, d] = g.m, N = o.range || 8;
      const T = (x, y) => sc(a * x + b * y, cc * x + d * y);
      if (o.unit && !R.halo) {
        c.beginPath();
        [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y], i) => { const [sx, sy] = T(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); });
        c.closePath();
        c.fillStyle = R.rgba(o.color2 || 'clay', 0.3); c.fill();
        c.strokeStyle = R.color(o.color2 || 'clay'); c.lineWidth = 2; c.stroke();
      }
      if (R.halo) return;
      c.lineCap = 'butt';
      for (const axis of [0, 1]) {
        c.beginPath();
        for (let k = -N; k <= N; k++) {
          if (k === 0) continue;
          const [x1, y1] = axis ? T(-N, k) : T(k, -N), [x2, y2] = axis ? T(N, k) : T(k, N);
          c.moveTo(x1, y1); c.lineTo(x2, y2);
        }
        c.lineWidth = 1.2; c.strokeStyle = R.rgba(o.color || 'sky', 0.55); c.stroke();
      }
      c.beginPath();
      let p = T(-N, 0); c.moveTo(p[0], p[1]); p = T(N, 0); c.lineTo(p[0], p[1]);
      p = T(0, -N); c.moveTo(p[0], p[1]); p = T(0, N); c.lineTo(p[0], p[1]);
      c.lineWidth = 2; c.strokeStyle = R.rgba(o.color || 'sky', 0.95); c.stroke();
    },
  };

  // =====================================================================
  //  Slices — a circle cut into n sectors that unroll into a rectangle
  // =====================================================================
  Objs.slices = {
    eval(o) {
      const c = S.pt(o.c), r = S.num(o.r), n = clamp(Math.round(S.num(o.n)), 2, 120), s = clamp(S.num(o.s), 0, 1);
      const tx = c.x + (o.dx != null ? S.num(o.dx) : r * (1 + Math.PI / 2 + 0.6)), ty = c.y + (o.dy != null ? S.num(o.dy) : 0);
      return { c, r, n, s, tx, ty, props: { n, r, tx, ty, width: Math.PI * r, area: Math.PI * r * r, s } };
    },
    draw(o, g) {
      if (!fin(g.c.x, g.c.y, g.r) || R.halo) return;
      const ctx = R.ctx, sp = S.view.s, w = TAU / g.n, sp2 = g.r * Math.sin(w / 2);
      const x0 = g.tx - ((g.n - 1) * sp2) / 2;
      for (let k = 0; k < g.n; k++) {
        const theta = (k + 0.5) * w, up = k % 2 === 0, phi = up ? Math.PI / 2 : -Math.PI / 2;
        let dl = ((phi - theta) % TAU + TAU) % TAU;
        if (dl > Math.PI) dl -= TAU;
        const ang = theta + g.s * dl;
        const ax = g.c.x + g.s * (x0 + k * sp2 - g.c.x), ay = g.c.y + g.s * (g.ty + (up ? -g.r / 2 : g.r / 2) - g.c.y);
        const [sx, sy] = sc(ax, ay), rp = g.r * sp;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, rp, -(ang - w / 2), -(ang + w / 2), true);
        ctx.closePath();
        ctx.fillStyle = R.rgba(up ? (o.color || 'clay') : (o.color2 || 'kraft'), 0.78); ctx.fill();
        ctx.lineWidth = 1.4; ctx.strokeStyle = R.color('bg'); ctx.stroke();
      }
      if (g.s > 0.9) {
        const a = (g.s - 0.9) * 10, wd = Math.PI * g.r;
        const [ax, ay] = sc(g.tx - wd / 2, g.ty + g.r / 2), [bx, by] = sc(g.tx + wd / 2, g.ty - g.r / 2);
        ctx.setLineDash([7, 6]); ctx.lineWidth = 1.8; ctx.strokeStyle = R.rgba('ink', 0.7 * a);
        ctx.strokeRect(ax, ay, bx - ax, by - ay); ctx.setLineDash([]);
      }
    },
  };

  // =====================================================================
  //  Rings — a circle cut into n concentric rings (an onion) that peel off, straighten and stack into a triangle
  //  Each ring is drawn as a thick stroke along an arc of curvature (1 − s)/ρ, so s = 0 is the circle and s = 1 is a
  //  straight strip of length 2πρ. Ring i (mean radius ρ = (i − ½)·r/n) lands at height ty − (i − ½)·r/n, left end tx.
  // =====================================================================
  Objs.rings = {
    eval(o) {
      const c = S.pt(o.c), r = S.num(o.r), n = clamp(Math.round(S.num(o.n)), 1, 200), s = clamp(S.num(o.s), 0, 1);
      const tx = o.tx != null ? S.num(o.tx) : c.x + r * 1.6, ty = o.ty != null ? S.num(o.ty) : c.y + r / 2;
      return { c, r, n, s, tx, ty, props: { n, r, dr: r / n, tx, ty, base: TAU * r, area: Math.PI * r * r, s } };
    },
    draw(o, g) {
      if (!fin(g.c.x, g.c.y, g.r, g.tx, g.ty) || R.halo || g.r <= 0) return;
      const ctx = R.ctx, sp = S.view.s, dr = g.r / g.n;
      ctx.lineCap = 'butt'; ctx.setLineDash([]);
      ctx.lineWidth = Math.max(0.6, dr * sp - 1.4);
      for (let i = 1; i <= g.n; i++) {
        const rho = (i - 0.5) * dr, L = TAU * rho, curv = (1 - g.s) / rho;
        const x0 = g.c.x + g.s * (g.tx - g.c.x), yA = g.c.y - rho, y0 = yA + g.s * (g.ty - (i - 0.5) * dr - yA);
        const pts = [];
        if (curv * L < 1e-3) pts.push(sc(x0, y0), sc(x0 + L, y0));
        else {
          const rc = 1 / curv, phi = L * curv, m = clamp(Math.ceil(phi * 12), 2, 160);
          for (let j = 0; j <= m; j++) { const a = (phi * j) / m; pts.push(sc(x0 + rc * Math.sin(a), y0 + rc * (1 - Math.cos(a)))); }
        }
        ctx.beginPath();
        pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.strokeStyle = R.rgba(i % 2 ? (o.color || 'clay') : (o.color2 || 'kraft'), 0.8);
        ctx.stroke();
      }
    },
  };

  // =====================================================================
  //  Trail — the locus of a point as some variable (slider or time) sweeps
  // =====================================================================
  Objs.trail = {
    eval() { return { props: {} }; },
    draw(o) {
      const host = S.get(o.of);
      if (!host || host.type !== 'point') return;
      const over = o.over || 't';
      const cur = S.vars[over];
      if (typeof cur !== 'number') return;
      const to = o.to != null ? S.num(o.to) : cur;
      const from = o.tail != null ? to - S.num(o.tail) : (o.from != null ? S.num(o.from) : 0);
      if (!fin(from, to) || Math.abs(to - from) < 1e-9) return;
      const n = clamp(o.n || 260, 8, 1500), pts = [];
      for (let i = 0; i <= n; i++) {
        const v = from + ((to - from) * i) / n;
        const p = S.withVar(over, v, () => S.evalPoint(host));
        if (fin(p.x, p.y)) { const [sx, sy] = sc(p.x, p.y); pts.push([sx, sy]); } else pts.push(null);
      }
      const c = R.ctx;
      stroke(o, 2.6);
      const chunks = o.fade ? 8 : 1;
      let seg = [];
      const flush = (alpha) => {
        if (seg.length > 1) {
          c.globalAlpha *= 1;
          c.beginPath(); seg.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke();
        }
        seg = [];
      };
      if (chunks === 1) {
        pts.forEach((p) => { if (p) seg.push(p); else flush(); });
        flush();
      } else {
        const per = Math.ceil(pts.length / chunks), base = R.ctx.globalAlpha;
        for (let k = 0; k < chunks; k++) {
          c.globalAlpha = base * (0.12 + 0.88 * ((k + 1) / chunks));
          seg = [];
          for (let i = k * per; i <= Math.min(pts.length - 1, (k + 1) * per); i++) if (pts[i]) seg.push(pts[i]);
          flush();
        }
        c.globalAlpha = base;
      }
      if (!R.halo) {
        const line = pts.filter(Boolean);
        if (line.length > 1) R.hit(o, { k: 'poly', pts: line, fill: false });
      }
    },
  };

  // =====================================================================
  //  Pen — freehand strokes
  // =====================================================================
  Objs.pen = {
    eval() { return { props: {} }; },
    draw(o) {
      const pts = (o.pts || []).map((p) => sc(p[0], p[1]));
      if (pts.length < 2) return;
      const c = R.ctx;
      stroke(o, 3);
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      c.stroke();
      if (!R.halo) R.hit(o, { k: 'poly', pts, fill: false });
    },
  };

  // =====================================================================
  //  Hit testing
  // =====================================================================
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function inPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function primDist(pr, x, y, tol) {
    switch (pr.k) {
      case 'p': return Math.max(0, Math.hypot(x - pr.x, y - pr.y) - pr.r);
      case 's': return segDist(x, y, pr.x1, pr.y1, pr.x2, pr.y2);
      case 'c': {
        const d = Math.hypot(x - pr.x, y - pr.y);
        if (pr.fill && d < pr.r) return tol * 0.92;
        return Math.abs(d - pr.r);
      }
      case 'poly': {
        let m = Infinity;
        for (let i = 0; i < pr.pts.length - 1; i++) {
          const a = pr.pts[i], b = pr.pts[i + 1];
          m = Math.min(m, segDist(x, y, a[0], a[1], b[0], b[1]));
        }
        if (pr.fill && m > tol && inPoly(pr.pts, x, y)) return tol * 0.92;
        return m;
      }
      case 'box': return x >= pr.x && x <= pr.x + pr.w && y >= pr.y && y <= pr.y + pr.h ? 0 : Infinity;
    }
    return Infinity;
  }
  const objDist = (o, x, y, tol) => {
    if (!o._hit) return Infinity;
    let m = Infinity;
    for (const pr of o._hit) m = Math.min(m, primDist(pr, x, y, tol));
    return m;
  };

  // pick(sx, sy, {tol, only:(o)=>bool, exclude:Set})
  G.pick = (sx, sy, opt = {}) => {
    const tol = opt.tol || 9;
    let best = null, bd = Infinity;
    const ok = (o) => (o.show == null || o.show > 0.05) && !o.locked && !(opt.exclude && opt.exclude.has(o.id)) && (!opt.only || opt.only(o));
    // points win over anything else
    if (!opt.noPoints) {
      for (let i = S.objects.length - 1; i >= 0; i--) {
        const o = S.objects[i];
        if ((o.type !== 'point' && o.type !== 'p3') || !ok(o)) continue;
        const d = objDist(o, sx, sy, tol);
        if (d <= 0.5 + tol * 0.4 && d < bd) { bd = d; best = o; }
      }
      if (best) return best;
    }
    bd = Infinity;
    for (let i = S.objects.length - 1; i >= 0; i--) {
      const o = S.objects[i];
      if (o.type === 'point' || o.type === 'p3' || !ok(o)) continue;
      const d = objDist(o, sx, sy, tol);
      if (d <= tol && d < bd - 0.01) { bd = d; best = o; }
    }
    return best;
  };
})(window.G = window.G || {});
