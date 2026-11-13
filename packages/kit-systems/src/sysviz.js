/* sysviz — animated building blocks for systems diagrams (used by the Systems Thinking course).
     node   rounded box: title, subtitle, live value line, optional pulsing glow
     flow   causal link or material pipe between two points: curved, arrowhead, travelling
            pulses (speed ∝ rate), +/− polarity badge, || delay mark
     loopm  feedback-loop marker: a spinning circular arrow around R or B
     tank   a stock drawn as a tank of water: level 0…1, rippling surface, tap inflow and
            drain outflow whose stream thickness shows the flow rate, dashed goal/limit mark
     sim    a small system-dynamics engine: integrates dX/dt formulas (RK4) and draws them as a
            time chart or phase portrait up to time `upto`; values at `upto` are props (sim.X)
     flock  boids (cohesion, alignment, separation) — emergence you can watch; props.order
     net    generated or given network; modes: degree view, threshold cascade, hub/random attack
   Every number is a formula, so sliders drive them. Ambient motion runs off the clock `t`. */
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
  const easeOut = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
  let calm = false;
  try { calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
  const clockT = () => (calm ? 0 : S.vars.t || 0);
  const txt = (s) => Expr.interp(String(s), S.env);

  function arrowHead(c, x, y, ang, size, color) {
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - size * Math.cos(ang - 0.42), y - size * Math.sin(ang - 0.42));
    c.lineTo(x - size * 0.62 * Math.cos(ang), y - size * 0.62 * Math.sin(ang));
    c.lineTo(x - size * Math.cos(ang + 0.42), y - size * Math.sin(ang + 0.42));
    c.closePath();
    c.fillStyle = R.color(color); c.fill();
  }
  function badge(c, x, y, s, color, r = 10) {
    c.beginPath(); c.arc(x, y, r, 0, TAU);
    c.fillStyle = R.color('bg'); c.fill();
    c.lineWidth = 2; c.strokeStyle = R.color(color); c.stroke();
    R.text(s, x, y + 0.5, { size: r * 1.45, bold: true, font: 'sans', color, halo: false });
  }
  function haloBox(o, x, y, w, h) {
    const c = R.ctx;
    c.strokeStyle = R.rgba('clay', R.halo === 1 ? 0.45 : 0.25); c.lineWidth = 6; c.setLineDash([]);
    R.roundRect(c, x - 5, y - 5, w + 10, h + 10, 14); c.stroke();
  }

  // =====================================================================
  //  node
  // =====================================================================
  Objs.node = {
    eval() { return { props: {} }; },
    draw(o) {
      const x = S.num(o.x), y = S.num(o.y), w = num(o.w, 3), h = num(o.h, 1);
      if (!fin(x, y, w, h)) return;
      const c = R.ctx, pr = prog(o), k = 0.88 + 0.12 * easeOut(pr);
      const [cx, cy] = sc(x, y), W = w * S.view.s * k, H = h * S.view.s * k;
      const bx = cx - W / 2, by = cy - H / 2, col = o.color || 'ink';
      const rad = o.shape === 'pill' ? H / 2 : o.shape === 'circle' ? Math.min(W, H) / 2 : Math.min(o.r != null ? o.r : 12, H / 2);
      if (R.halo) { haloBox(o, bx, by, W, H); return; }
      const glow = o.glow != null ? clamp(S.num(o.glow), 0, 1) : 0;
      if (glow > 0.01) {
        const pulse = 0.5 + 0.5 * Math.sin(clockT() * 4);
        const g = 6 + 10 * glow * (0.6 + 0.4 * pulse);
        c.save(); c.shadowColor = R.rgba(o.glowColor || col, 0.55 * glow); c.shadowBlur = g * 2;
        R.roundRect(c, bx, by, W, H, rad); c.fillStyle = R.rgba(o.glowColor || col, 0.25 * glow); c.fill(); c.restore();
      }
      if (o.shape === 'circle') { c.beginPath(); c.arc(cx, cy, Math.min(W, H) / 2, 0, TAU); }
      else R.roundRect(c, bx, by, W, H, rad);
      const lwv = o.lw != null ? num(o.lw, 2) : 2;   // lw may be a formula; 0 = no outline
      if (o.opaque !== false && o.lw !== 0) { c.fillStyle = R.color('bg'); c.fill(); }
      c.fillStyle = R.rgba(col, clamp(num(o.fill, 0.14), 0, 1)); c.fill();
      if (lwv > 0) {
        c.lineWidth = lwv; c.strokeStyle = R.color(col);
        if (o.dash) c.setLineDash(o.dash);
        c.stroke(); c.setLineDash([]);
      }
      if (pr > 0.5 && !(o.minpx && W < o.minpx)) {
        const a = c.globalAlpha; c.globalAlpha = a * clamp((pr - 0.5) * 2, 0, 1);
        const lines = [];
        if (o.title) lines.push([txt(o.title), { size: o.size || 15, bold: true, font: 'sans', color: o.tcolor || 'ink' }]);
        if (o.sub) lines.push([txt(o.sub), { size: o.ssize || 11.5, font: 'sans', color: 'gray' }]);
        if (o.val) lines.push([txt(o.val), { size: o.vsize || 14, bold: true, font: 'sans', color: o.vcolor || col }]);
        // shrink text that would overflow the box (narrow screens scale boxes but not fonts)
        const room = (o.shape === 'circle' ? Math.min(W, H) * 0.8 : W) - 12;
        lines.forEach(([s, f]) => {
          c.font = `${f.bold ? '600 ' : '400 '}${f.size}px ${R.SANS}`;
          const wmax = Math.max(...s.split('\n').map((l) => c.measureText(l).width));
          if (wmax > room && room > 0) f.size = Math.max(8, (f.size * room) / wmax);
        });
        const hs = lines.map(([s, f]) => s.split('\n').length * f.size * 1.28);
        let yy = o.valign === 'top' ? by + 10 : cy - hs.reduce((p, q) => p + q, 0) / 2;
        lines.forEach(([s, f], i) => { R.text(s, cx, yy + hs[i] / 2, f); yy += hs[i]; });
        c.globalAlpha = a;
      }
      R.hit(o, { k: 'box', x: bx, y: by, w: W, h: H });
    },
  };

  // =====================================================================
  //  flow — causal link (kind 'link') or material pipe (kind 'pipe')
  // =====================================================================
  function flowPath(o) {
    const a = S.pt(o.a), b = S.pt(o.b);
    if (!fin(a.x, a.y, b.x, b.y)) return null;
    let pts;
    if (o.via) {
      // orthogonal / poly route through world waypoints, slightly rounded
      const w = [a, ...o.via.map((p) => S.pt(p)), b].map((p) => sc(p.x, p.y));
      pts = [];
      for (let i = 0; i < w.length - 1; i++) {
        const p = w[i], q = w[i + 1], n = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 12));
        for (let j = i ? 1 : 0; j <= n; j++) pts.push([p[0] + ((q[0] - p[0]) * j) / n, p[1] + ((q[1] - p[1]) * j) / n]);
      }
    } else {
      const bend = num(o.bend, 0), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const cxw = (a.x + b.x) / 2 - (dy / L) * bend * L, cyw = (a.y + b.y) / 2 + (dx / L) * bend * L;
      const P0 = sc(a.x, a.y), C = sc(cxw, cyw), P1 = sc(b.x, b.y);
      const N = 48;
      pts = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N, v = 1 - u;
        pts.push([v * v * P0[0] + 2 * v * u * C[0] + u * u * P1[0], v * v * P0[1] + 2 * v * u * C[1] + u * u * P1[1]]);
      }
    }
    // cumulative length for arc-length positions
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function at(P, f) {
    const d = clamp(f, 0, 1) * P.len, { cum, pts } = P;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1, k = (d - cum[lo]) / seg;
    const p = pts[lo], q = pts[hi];
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, Math.atan2(q[1] - p[1], q[0] - p[0])];
  }
  function slice(P, f0, f1) {
    const out = [at(P, f0)];
    const d0 = f0 * P.len, d1 = f1 * P.len;
    for (let i = 0; i < P.pts.length; i++) if (P.cum[i] > d0 && P.cum[i] < d1) out.push(P.pts[i]);
    out.push(at(P, f1));
    return out;
  }
  function strokePts(c, pts) { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); }

  Objs.flow = {
    eval() { return { props: {} }; },
    draw(o) {
      const P = flowPath(o);
      if (!P || P.len < 2) return;
      const c = R.ctx, pr = prog(o), col = o.color || 'ink', pipe = o.kind === 'pipe';
      const rate = o.rate != null ? S.num(o.rate) : 1, rmax = num(o.rmax, 1);
      const w = o.w != null ? o.w : 2.2, head = o.head !== false;
      const hs = pipe ? 0 : 8 + w * 2.2, end = clamp(pr - (head ? hs / P.len : 0) * 0.9, 0, 1);
      c.lineCap = 'round'; c.lineJoin = 'round';
      if (R.halo) {
        c.strokeStyle = R.rgba('clay', R.halo === 1 ? 0.3 : 0.16); c.lineWidth = (pipe ? num(o.pw, 16) : w) + 9;
        strokePts(c, slice(P, 0, pr)); return;
      }
      const body = slice(P, 0, end);
      if (pipe) {
        const pw = num(o.pw, 16), th = Math.max(0, pw * clamp(Math.abs(rate) / rmax, 0, 1));
        c.strokeStyle = R.rgba('gray', 0.55); c.lineWidth = pw + 4; strokePts(c, body);
        c.strokeStyle = R.color('bg'); c.lineWidth = pw; strokePts(c, body);
        if (th > 0.5) {
          c.strokeStyle = R.rgba(col, 0.6); c.lineWidth = th; strokePts(c, body);
          c.setLineDash([3, 13]); c.lineDashOffset = -clockT() * 46 * Math.sign(rate) * (0.4 + Math.min(2, Math.abs(rate) / rmax));
          c.strokeStyle = R.rgba('bg', 0.75); c.lineWidth = Math.max(1.5, th * 0.4); strokePts(c, body);
          c.setLineDash([]); c.lineDashOffset = 0;
        }
        if (head && pr > 0.95) { const e = at(P, 1); arrowHead(c, e[0] + Math.cos(e[2]) * 10, e[1] + Math.sin(e[2]) * 10, e[2], 18, col); }
      } else {
        c.strokeStyle = R.color(col); c.lineWidth = w;
        if (o.dash) c.setLineDash(o.dash);
        strokePts(c, body); c.setLineDash([]);
        if (head && pr > 0.05) { const e = at(P, pr); arrowHead(c, e[0], e[1], e[2], hs, col); }
        // travelling pulses — information moving round the loop
        if (pr > 0.98 && rate !== 0 && o.pulses !== false) {
          const n = Math.max(1, Math.round(P.len / (o.gap || 95))), spd = num(o.speed, 0.5) * rate * 90 / P.len;
          for (let i = 0; i < n; i++) {
            let f = (i / n + clockT() * spd) % 1; if (f < 0) f += 1;
            if (f > 0.93) continue;
            const p = at(P, f), r = 2.6 + w * 0.7, fade = Math.min(1, f * 8, (0.93 - f) * 10, 0.25 + Math.abs(rate) * 2.5);
            c.beginPath(); c.arc(p[0], p[1], r + 4, 0, TAU); c.fillStyle = R.rgba(col, 0.18 * fade); c.fill();
            c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.fillStyle = R.rgba(col, 0.95 * fade); c.fill();
          }
        }
      }
      if (pr > 0.9) {
        if (o.delay) {
          const m = at(P, o.delayAt != null ? o.delayAt : 0.5), nx = -Math.sin(m[2]), ny = Math.cos(m[2]);
          c.strokeStyle = R.color(o.delayColor || 'kraft'); c.lineWidth = 3;
          [-4, 4].forEach((d) => {
            const x = m[0] + Math.cos(m[2]) * d, y = m[1] + Math.sin(m[2]) * d;
            c.beginPath(); c.moveTo(x - nx * 10, y - ny * 10); c.lineTo(x + nx * 10, y + ny * 10); c.stroke();
          });
          if (o.delayLabel) R.text(txt(o.delayLabel), m[0] + nx * 22, m[1] + ny * 22, { size: 11.5, font: 'sans', bold: true, color: o.delayColor || 'kraft' });
        }
        if (o.pol) {
          const f = o.polAt != null ? o.polAt : 0.8, p = at(P, f), side = o.polSide || (o.label ? -(o.labelSide || 1) : 1);
          const nx = -Math.sin(p[2]) * side, ny = Math.cos(p[2]) * side;
          badge(c, p[0] - nx * 15, p[1] - ny * 15, o.pol === '-' ? '−' : o.pol, o.polColor || col, 9.5);
        }
        if (o.label) {
          const f = o.labelAt != null ? o.labelAt : 0.5, p = at(P, f), side = o.labelSide || 1;
          const nx = -Math.sin(p[2]) * side, ny = Math.cos(p[2]) * side, off = o.labelOff || (pipe ? num(o.pw, 16) / 2 + 13 : 15);
          R.text(txt(o.label), p[0] - nx * off, p[1] - ny * off, { size: o.size || 12.5, font: 'sans', bold: !!o.bold, color: o.lcolor || col });
        }
      }
      R.hit(o, { k: 'poly', pts: P.pts, fill: false });
    },
  };

  // =====================================================================
  //  loopm — loop marker
  // =====================================================================
  Objs.loopm = {
    eval() { return { props: {} }; },
    draw(o) {
      const x = S.num(o.x), y = S.num(o.y);
      if (!fin(x, y)) return;
      const c = R.ctx, [cx, cy] = sc(x, y), r = o.rw ? clamp(S.num(o.rw) * S.view.s, 4, o.rmax || 26) : o.r || 22, pr = prog(o), col = o.color || (o.kind === 'B' ? 'sky' : 'clay');
      if (R.halo) { c.beginPath(); c.arc(cx, cy, r + 8, 0, TAU); c.fillStyle = R.rgba('clay', 0.2); c.fill(); return; }
      const dir = o.dir || 1, spin = clockT() * (o.spin != null ? o.spin : 1.2) * dir;
      const a0 = spin + 0.4, sweep = TAU * 0.8 * easeOut(pr);
      c.beginPath(); c.arc(cx, cy, r + 6, 0, TAU); c.fillStyle = R.rgba(col, 0.1); c.fill();
      c.lineWidth = 2.6; c.strokeStyle = R.color(col); c.lineCap = 'round';
      c.beginPath();
      if (dir > 0) c.arc(cx, cy, r, a0, a0 + sweep); else c.arc(cx, cy, r, a0 + sweep, a0, true);
      c.stroke();
      if (pr > 0.3) {
        const ae = dir > 0 ? a0 + sweep : a0, ex = cx + r * Math.cos(ae), ey = cy + r * Math.sin(ae);
        arrowHead(c, ex, ey, ae + (dir > 0 ? Math.PI / 2 : -Math.PI / 2), 11, col);
      }
      if (r >= 7) R.text(o.kind || 'R', cx, cy + 1, { size: r * 0.95, bold: true, font: 'sans', color: col, halo: false });
      if (o.label && pr > 0.6 && r >= 9) R.text(txt(o.label), o.labelBelow ? cx : cx + r + 9, o.labelBelow ? cy + r + 16 : cy, { size: 12, font: 'sans', bold: true, color: col, align: o.labelBelow ? 'center' : 'left' });
      R.hit(o, { k: 'p', x: cx, y: cy, r: r + 4 });
    },
  };

  // =====================================================================
  //  tank — a stock you can see fill and drain
  // =====================================================================
  Objs.tank = {
    eval(o) { return { props: { level: clamp(num(o.level, 0.5), 0, 1) } }; },
    draw(o, g) {
      const x = S.num(o.x), y = S.num(o.y), w = num(o.w, 3), h = num(o.h, 2);
      if (!fin(x, y, w, h)) return;
      const c = R.ctx, col = o.color || 'sky', pr = prog(o), t = clockT();
      const [L, B] = sc(x, y), [Rr, T] = sc(x + w, y + h), W = Rr - L, H = B - T;
      if (R.halo) { haloBox(o, L, T, W, H); return; }
      const lev = g.props.level * easeOut(pr), top = B - H * lev;
      // inflow stream from a tap above the left of the tank
      if (o.inflow != null && pr > 0.6) {
        const f = clamp(S.num(o.inflow) / num(o.fmax, 1), 0, 1.5), tx = L + W * 0.2, ty = T - 34;
        c.fillStyle = R.color('gray'); R.roundRect(c, tx - 26, ty - 9, 34, 12, 4); c.fill();
        c.fillRect(tx - 6, ty - 2, 12, 9);
        if (f > 0.01) {
          const sw = 2 + 12 * f;
          c.fillStyle = R.rgba(col, 0.55); c.fillRect(tx - sw / 2, ty + 7, sw, top - ty - 7);
          c.setLineDash([4, 10]); c.lineDashOffset = -t * 120; c.strokeStyle = R.rgba('bg', 0.7); c.lineWidth = Math.max(1.2, sw * 0.3);
          c.beginPath(); c.moveTo(tx, ty + 7); c.lineTo(tx, top); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
          for (let k = 0; k < 2; k++) {
            const ph = ((t * 1.3 + k * 0.5) % 1), rr = 6 + ph * (16 + 20 * f);
            c.beginPath(); c.ellipse(tx, top, rr, rr * 0.28, 0, 0, TAU);
            c.strokeStyle = R.rgba(col, 0.5 * (1 - ph)); c.lineWidth = 1.5; c.stroke();
          }
        }
        if (o.inLabel) R.text(txt(o.inLabel), tx - 34, ty - 3, { size: 12.5, bold: true, font: 'sans', color: o.inColor || 'olive', align: 'right' });
      }
      // water body with a rippling surface
      if (lev > 0.002) {
        c.save(); R.roundRect(c, L, T - 40, W, H + 40, 10); c.clip();
        const amp = calm ? 0 : Math.min(3.5, H * lev * 0.08);
        c.beginPath(); c.moveTo(L, B);
        for (let sx = 0; sx <= W; sx += 6) c.lineTo(L + sx, top + amp * Math.sin(sx * 0.045 + t * 2.4) + amp * 0.5 * Math.sin(sx * 0.11 - t * 1.7));
        c.lineTo(Rr, B); c.closePath();
        const gr = c.createLinearGradient(0, top, 0, B);
        gr.addColorStop(0, R.rgba(col, 0.42)); gr.addColorStop(1, R.rgba(col, 0.72));
        c.fillStyle = gr; c.fill();
        c.restore();
      }
      // outflow drain at the bottom right
      if (o.outflow != null && pr > 0.6) {
        const f = clamp(S.num(o.outflow) / num(o.fmax, 1), 0, 1.5), len = 46;
        c.fillStyle = R.rgba('gray', 0.9); c.fillRect(Rr, B - 16, len, 4); c.fillRect(Rr, B + 0, len, 4);
        if (f > 0.01 && lev > 0.002) {
          const sw = Math.min(12, 2 + 10 * f);
          c.fillStyle = R.rgba(col, 0.6); c.fillRect(Rr, B - 6 - sw / 2, len, sw);
          c.beginPath(); c.moveTo(Rr + len, B - 6 - sw / 2);
          c.quadraticCurveTo(Rr + len + 14, B - 6, Rr + len + 12, B + 34); c.lineTo(Rr + len + 12 - sw * 0.6, B + 34);
          c.quadraticCurveTo(Rr + len + 6, B + 2, Rr + len, B - 6 + sw / 2); c.closePath(); c.fill();
          c.setLineDash([4, 10]); c.lineDashOffset = -t * 90; c.strokeStyle = R.rgba('bg', 0.7); c.lineWidth = Math.max(1.2, sw * 0.3);
          c.beginPath(); c.moveTo(Rr, B - 6); c.lineTo(Rr + len, B - 6); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
        }
        if (o.outLabel) R.text(txt(o.outLabel), Rr + len + 18, B + 22, { size: 12.5, bold: true, font: 'sans', color: o.outColor || 'fig', align: 'left' });
      }
      // walls (open top) with ticks
      c.lineWidth = 3; c.strokeStyle = R.color(o.wall || 'ink'); c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath(); c.moveTo(L, T); c.lineTo(L, B - 10); c.arcTo(L, B, L + 10, B, 10); c.lineTo(Rr - 10, B); c.arcTo(Rr, B, Rr, B - 10, 10); c.lineTo(Rr, T); c.stroke();
      if (o.ticks !== false) {
        c.lineWidth = 1.2; c.strokeStyle = R.rgba('gray', 0.7);
        for (let k = 1; k < 5; k++) { const yy = B - (H * k) / 5; c.beginPath(); c.moveTo(L, yy); c.lineTo(L + 7, yy); c.stroke(); }
      }
      if (o.mark != null) {
        const my = B - H * clamp(S.num(o.mark), 0, 1);
        c.setLineDash([7, 5]); c.lineWidth = 2; c.strokeStyle = R.color(o.markColor || 'clay');
        c.beginPath(); c.moveTo(L - 8, my); c.lineTo(Rr + 8, my); c.stroke(); c.setLineDash([]);
        if (o.markLabel) R.text(txt(o.markLabel), L - 12, my, { size: 12, bold: true, font: 'sans', color: o.markColor || 'clay', align: 'right' });
      }
      if (o.title && pr > 0.5) R.text(txt(o.title), (L + Rr) / 2, B + 18, { size: o.size || 15, bold: true, font: 'sans', color: o.tcolor || col });
      if (o.val && pr > 0.5) R.text(txt(o.val), (L + Rr) / 2, Math.min(B - 14, Math.max(T + 12, top + 16)), { size: 14, bold: true, font: 'sans', color: 'ink' });
      R.hit(o, { k: 'box', x: L, y: T, w: W, h: H });
    },
  };

  // =====================================================================
  //  sim — integrate a stock-and-flow model and chart it
  // =====================================================================
  function simKey(o) {
    let k = '';
    for (const p of S.params) if (!p.anim || p.anim === 'none') k += p.value.toFixed(6) + ',';
    return k + S.num(o.T);
  }
  function simulate(o) {
    const names = Object.keys(o.vars || {});
    const aux = Object.entries(o.aux || {}).map(([k, v]) => [k, fn(v)]);
    const der = names.map((k) => fn((o.d && o.d[k]) || '0'));
    const ser = (o.series || []).map((s) => fn(s.v));
    const e = S.localEnv();
    const T = num(o.T, 10), N = clamp(o.steps || 600, 20, 6000), h = T / N;
    const pos = new Set(o.pos || []);
    let y = names.map((k) => S.num(o.vars[k]));
    const out = { T, N, time: new Float64Array(N + 1), v: {}, s: ser.map(() => new Float64Array(N + 1)) };
    [...names, ...aux.map((a) => a[0])].forEach((k) => { out.v[k] = new Float64Array(N + 1); });
    const setv = (tt, yy) => {
      e.vars.time = tt;
      names.forEach((k, i) => { e.vars[k] = yy[i]; });
      aux.forEach(([k, g]) => { e.vars[k] = g(e); });
    };
    const f = (tt, yy) => { setv(tt, yy); return der.map((g) => g(e)); };
    const rec = (i, tt) => {
      setv(tt, y);
      out.time[i] = tt;
      names.forEach((k, j) => { out.v[k][i] = y[j]; });
      aux.forEach(([k]) => { out.v[k][i] = e.vars[k]; });
      ser.forEach((g, j) => { out.s[j][i] = g(e); });
    };
    rec(0, 0);
    for (let i = 1; i <= N; i++) {
      const t0 = (i - 1) * h;
      const k1 = f(t0, y);
      const k2 = f(t0 + h / 2, y.map((v, j) => v + (h / 2) * k1[j]));
      const k3 = f(t0 + h / 2, y.map((v, j) => v + (h / 2) * k2[j]));
      const k4 = f(t0 + h, y.map((v, j) => v + h * k3[j]));
      y = y.map((v, j) => {
        let n = v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
        if (!Number.isFinite(n)) n = v;
        if (pos.has(names[j]) && n < 0) n = 0;
        return n;
      });
      rec(i, i * h);
    }
    return out;
  }
  Objs.sim = {
    eval(o) {
      const key = simKey(o);
      if (o._key !== key || !o._run) { o._run = simulate(o); o._key = key; }
      const run = o._run, upto = clamp(num(o.upto, run.T), 0, run.T);
      const i = Math.round((upto / run.T) * run.N), props = { time: upto };
      for (const k in run.v) props[k] = run.v[k][i];
      run.s.forEach((arr, j) => { props['s' + (j + 1)] = arr[i]; props['peak' + (j + 1)] = Math.max(...arr.slice(0, i + 1)); });
      return { props, run, i };
    },
    draw(o, g) {
      if (!g || !g.run || o.hidden) return;
      const c = R.ctx, run = g.run, pr = prog(o), [x0, y0, x1, y1] = o.box.map((v) => S.num(v));
      const [L, B] = sc(x0, y0), [Rr, T] = sc(x1, y1);
      if (R.halo) { haloBox(o, L, T, Rr - L, B - T); return; }
      const ph = o.phase, i1 = Math.min(g.i, Math.floor(run.N * pr) + (pr >= 1 ? 0 : 0));
      let X, Y, ymin, ymax, xmin, xmax;
      if (ph) {
        xmin = num(ph.x0, 0); xmax = num(ph.x1, 1); ymin = num(ph.y0, 0); ymax = num(ph.y1, 1);
        X = (v) => L + ((v - xmin) / (xmax - xmin)) * (Rr - L);
      } else {
        ymin = num(o.ymin, 0); ymax = num(o.ymax, 1);
        X = (tt) => L + (tt / run.T) * (Rr - L);
      }
      Y = (v) => B - ((v - ymin) / (ymax - ymin)) * (B - T);
      // panel + axes
      if (o.panel !== false) { R.roundRect(c, L - 14, T - 14, Rr - L + 28, B - T + 28, 14); c.fillStyle = R.rgba('gray', 0.06); c.fill(); }
      c.strokeStyle = R.rgba('gray', 0.9); c.lineWidth = 1.6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(L, T - 4); c.lineTo(L, B); c.lineTo(Rr + 4, B); c.stroke();
      arrowHead(c, Rr + 10, B, 0, 9, 'gray'); arrowHead(c, L, T - 10, -Math.PI / 2, 9, 'gray');
      c.lineWidth = 1; c.strokeStyle = R.rgba('gray', 0.18);
      (o.yticks || []).forEach((v) => {
        const yy = Y(v); if (yy < T - 1 || yy > B + 1) return;
        if (v !== ymin) { c.beginPath(); c.moveTo(L, yy); c.lineTo(Rr, yy); c.stroke(); }
        R.text(String(v), L - 6, yy, { size: 11, font: 'sans', color: 'gray', align: 'right' });
      });
      (o.xticks || []).forEach((v) => {
        const xx = X(v); if (xx < L - 1 || xx > Rr + 1) return;
        R.text(String(v), xx, B + 11, { size: 11, font: 'sans', color: 'gray' });
      });
      if (o.xlabel) R.text(txt(o.xlabel), Rr, B + (o.xticks ? 27 : 16), { size: 12, font: 'sans', color: 'gray', align: 'right' });
      if (o.ylabel) R.text(txt(o.ylabel), L + 6, T - 12, { size: 12, font: 'sans', color: 'gray', align: 'left' });
      const late = [];
      (o.refs || []).forEach((r) => {
        const v = S.num(r.y); if (!fin(v)) return;
        const yy = Y(v); if (yy < T - 2 || yy > B + 2) return;
        c.setLineDash([7, 5]); c.lineWidth = 1.8; c.strokeStyle = R.color(r.color || 'clay');
        c.beginPath(); c.moveTo(L, yy); c.lineTo(Rr, yy); c.stroke(); c.setLineDash([]);
        if (r.label) late.push(() => R.text(txt(r.label), Rr - 8, yy - 13, { size: 11.5, bold: true, font: 'sans', color: r.color || 'clay', align: 'right', bg: true }));
      });
      (o.marks || []).forEach((m) => {
        const tt = S.num(m.t); if (!fin(tt) || tt > run.time[g.i] + 1e-9) return;
        const xx = X(tt);
        c.setLineDash([4, 5]); c.lineWidth = 1.4; c.strokeStyle = R.color(m.color || 'gray');
        c.beginPath(); c.moveTo(xx, B); c.lineTo(xx, T); c.stroke(); c.setLineDash([]);
        if (m.label) R.text(txt(m.label), xx + 4, T + 8, { size: 11.5, bold: true, font: 'sans', color: m.color || 'gray', align: 'left' });
      });
      const clipY = (v) => clamp(v, T - 8, B + 2);
      (o.series || []).forEach((s, j) => {
        const arr = run.s[j], col = s.color || 'ink';
        const pt = (i) => (ph ? [X(run.v[ph.x][i]), clipY(Y(run.v[ph.y][i]))] : [X(run.time[i]), clipY(Y(arr[i]))]);
        if (ph && j > 0) return;
        if (o.ghost) {
          c.setLineDash([3, 5]); c.strokeStyle = R.rgba(col, 0.28); c.lineWidth = 1.6;
          c.beginPath(); for (let i = 0; i <= run.N; i += 2) { const p = pt(i); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } c.stroke(); c.setLineDash([]);
        }
        if (s.fill && !ph) {
          c.beginPath(); c.moveTo(X(0), B);
          for (let i = 0; i <= i1; i++) { const p = pt(i); c.lineTo(p[0], p[1]); }
          c.lineTo(X(run.time[i1]), B); c.closePath(); c.fillStyle = R.rgba(col, 0.12); c.fill();
        }
        c.strokeStyle = R.color(col); c.lineWidth = s.w || 3; c.lineJoin = 'round';
        if (s.dash) c.setLineDash(s.dash);
        const out = (i) => !ph && (arr[i] > ymax + (ymax - ymin) * 0.04 || arr[i] < ymin - (ymax - ymin) * 0.04);
        c.beginPath(); let pen = false;
        for (let i = 0; i <= i1; i++) { if (out(i)) { pen = false; continue; } const p = pt(i); pen ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); pen = true; }
        c.stroke(); c.setLineDash([]);
        if (o.head !== false && i1 > 0 && !out(i1)) {
          const p = pt(i1), pulse = 0.5 + 0.5 * Math.sin(clockT() * 5);
          c.beginPath(); c.arc(p[0], p[1], 8 + 3 * pulse, 0, TAU); c.fillStyle = R.rgba(col, 0.18); c.fill();
          c.beginPath(); c.arc(p[0], p[1], 5, 0, TAU); c.fillStyle = R.color(col); c.fill();
          c.lineWidth = 2; c.strokeStyle = R.color('bg'); c.stroke();
          if (s.label) R.text(txt(s.label), p[0] + 10, p[1] - 14, { size: 12.5, bold: true, font: 'sans', color: col, align: 'left' });
        }
      });
      late.forEach((f) => f());
      R.hit(o, { k: 'box', x: L, y: T, w: Rr - L, h: B - T });
    },
  };

  // =====================================================================
  //  flock — boids
  // =====================================================================
  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  Objs.flock = {
    eval(o) {
      const [x0, y0, x1, y1] = o.box.map((v) => S.num(v)), W = x1 - x0, H = y1 - y0;
      const n = clamp(Math.round(num(o.n, 80)), 0, 400);
      if (!o._b || o._b.length !== n || o._bw !== W) {
        const r = rng(o.seed || 7);
        o._b = Array.from({ length: n }, () => { const a = r() * TAU; return { x: x0 + r() * W, y: y0 + r() * H, vx: Math.cos(a), vy: Math.sin(a) }; });
        o._bw = W; o._tl = S.vars.t || 0;
      }
      const t = S.vars.t || 0;
      let dt = t - (o._tl == null ? t : o._tl);
      o._tl = t;
      if (calm) dt = 0;
      if (dt < 0 || dt > 0.25) dt = 0;
      const sep = num(o.sep, 1), ali = num(o.ali, 1), coh = num(o.coh, 1), v0 = num(o.speed, 1.6), R1 = num(o.radius, 1.1), Rs = 0.32;
      const hawk = num(o.hawk, 0) > 0.5, hx = x0 + W / 2 + W * 0.38 * Math.cos(t * 0.55), hy = y0 + H / 2 + H * 0.34 * Math.sin(t * 0.9);
      const wrap = (d, span) => (d > span / 2 ? d - span : d < -span / 2 ? d + span : d);
      const B = o._b;
      if (dt > 0) {
        const steps = Math.ceil(dt / 0.02), h = dt / steps;
        for (let s = 0; s < steps; s++) {
          const acc = B.map((b, i) => {
            let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, k = 0;
            for (let j = 0; j < B.length; j++) {
              if (i === j) continue;
              const q = B[j], dx = wrap(q.x - b.x, W), dy = wrap(q.y - b.y, H), d2 = dx * dx + dy * dy;
              if (d2 < R1 * R1) { cx += dx; cy += dy; ax += q.vx; ay += q.vy; k++; if (d2 < Rs * Rs) { const d = Math.sqrt(d2) || 1e-3; sx -= dx / (d * d); sy -= dy / (d * d); } }
            }
            let fx = 0, fy = 0;
            if (k) { fx += coh * 1.2 * (cx / k) + ali * 2.2 * (ax / k - b.vx) ; fy += coh * 1.2 * (cy / k) + ali * 2.2 * (ay / k - b.vy); }
            fx += sep * 0.18 * sx; fy += sep * 0.18 * sy;
            const jitter = 2.4 * (1 - Math.min(1, ali)) + 0.5;
            fx += (Math.random() - 0.5) * jitter; fy += (Math.random() - 0.5) * jitter;
            if (hawk) { const dx = b.x - hx, dy = b.y - hy, d2 = dx * dx + dy * dy; if (d2 < 2.2) { fx += 9 * dx / (d2 + 0.05); fy += 9 * dy / (d2 + 0.05); } }
            return [fx, fy];
          });
          B.forEach((b, i) => {
            b.vx += acc[i][0] * h; b.vy += acc[i][1] * h;
            const sp = Math.hypot(b.vx, b.vy) || 1; b.vx /= sp; b.vy /= sp;
            b.x += b.vx * v0 * h; b.y += b.vy * v0 * h;
            if (b.x < x0) b.x += W; else if (b.x > x1) b.x -= W;
            if (b.y < y0) b.y += H; else if (b.y > y1) b.y -= H;
          });
        }
      }
      let mx = 0, my = 0;
      B.forEach((b) => { mx += b.vx; my += b.vy; });
      return { props: { order: n ? Math.hypot(mx, my) / n : 0, hx, hy, hawk } };
    },
    draw(o, g) {
      const c = R.ctx, [x0, y0, x1, y1] = o.box.map((v) => S.num(v));
      const [L, Bt] = sc(x0, y0), [Rr, T] = sc(x1, y1);
      if (R.halo) { haloBox(o, L, T, Rr - L, Bt - T); return; }
      if (o.panel !== false) { R.roundRect(c, L, T, Rr - L, Bt - T, 16); c.fillStyle = R.rgba(o.sky || 'sky', 0.07); c.fill(); }
      c.save(); R.roundRect(c, L, T, Rr - L, Bt - T, 16); c.clip();
      const col = o.color || 'ink', sz = o.size || 7, pr = prog(o), cnt = Math.floor(o._b.length * pr);
      for (let i = 0; i < cnt; i++) {
        const b = o._b[i], [sx, sy] = sc(b.x, b.y), a = Math.atan2(-b.vy, b.vx);
        c.beginPath();
        c.moveTo(sx + Math.cos(a) * sz, sy + Math.sin(a) * sz);
        c.lineTo(sx + Math.cos(a + 2.5) * sz * 0.65, sy + Math.sin(a + 2.5) * sz * 0.65);
        c.lineTo(sx + Math.cos(a - 2.5) * sz * 0.65, sy + Math.sin(a - 2.5) * sz * 0.65);
        c.closePath(); c.fillStyle = R.rgba(i % 9 === 0 ? (o.accent || 'clay') : col, 0.85); c.fill();
      }
      if (g.props.hawk) {
        const [hx, hy] = sc(g.props.hx, g.props.hy);
        c.beginPath(); c.arc(hx, hy, 1.48 * S.view.s, 0, TAU); c.fillStyle = R.rgba('clay', 0.07); c.fill();
        c.beginPath(); c.moveTo(hx - 16, hy - 4); c.quadraticCurveTo(hx - 6, hy - 10, hx, hy); c.quadraticCurveTo(hx + 6, hy - 10, hx + 16, hy - 4);
        c.lineWidth = 3.4; c.strokeStyle = R.color('clay'); c.stroke();
      }
      c.restore();
      R.hit(o, { k: 'box', x: L, y: T, w: Rr - L, h: Bt - T });
    },
  };

  // =====================================================================
  //  net — networks, cascades, attacks
  // =====================================================================
  function buildNet(o) {
    const r = rng(o.seed || 3), kind = o.kind || 'random';
    let nodes, edges = [];
    if (kind === 'given') {
      nodes = o.nodes.map((p) => ({ x: p[0], y: p[1], fixed: true }));
      edges = o.edges.map((e) => [e[0], e[1]]);
    } else {
      const n = o.n || 40, m = o.m || 1;
      nodes = Array.from({ length: n }, () => ({ x: r(), y: r() }));
      const has = new Set(), add = (i, j) => { if (i === j) return false; const k = i < j ? i + ',' + j : j + ',' + i; if (has.has(k)) return false; has.add(k); edges.push([i, j]); return true; };
      if (kind === 'scale') {
        const deg = new Array(n).fill(0), m0 = m + 1;
        for (let i = 0; i < m0; i++) for (let j = i + 1; j < m0; j++) { add(i, j); deg[i]++; deg[j]++; }
        for (let i = m0; i < n; i++) {
          let made = 0, guard = 0;
          while (made < m && guard++ < 200) {
            const tot = deg.slice(0, i).reduce((a, b) => a + b, 0);
            let pick = r() * tot, j = 0;
            while (j < i - 1 && pick > deg[j]) { pick -= deg[j]; j++; }
            if (add(i, j)) { deg[i]++; deg[j]++; made++; }
          }
        }
      } else {
        const k = o.k || 3, p = k / (n - 1);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < p) add(i, j);
      }
      // force-directed layout in the unit square
      const N = nodes.length;
      const kk = Math.sqrt(1 / N) * 0.9;
      for (let it = 0; it < 260; it++) {
        const temp = 0.08 * (1 - it / 260) + 0.002, disp = nodes.map(() => [0, 0]);
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d = Math.hypot(dx, dy) || 1e-3, f = (kk * kk) / d;
          disp[i][0] += (dx / d) * f; disp[i][1] += (dy / d) * f; disp[j][0] -= (dx / d) * f; disp[j][1] -= (dy / d) * f;
        }
        edges.forEach(([i, j]) => {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d = Math.hypot(dx, dy) || 1e-3, f = (d * d) / kk;
          disp[i][0] -= (dx / d) * f; disp[i][1] -= (dy / d) * f; disp[j][0] += (dx / d) * f; disp[j][1] += (dy / d) * f;
        });
        nodes.forEach((p, i) => {
          const [dx, dy] = disp[i], d = Math.hypot(dx, dy) || 1e-9, s = Math.min(d, temp) / d;
          p.x = clamp(p.x + dx * s + (0.5 - p.x) * 0.03, -1, 2); p.y = clamp(p.y + dy * s + (0.5 - p.y) * 0.03, -1, 2);
        });
      }
      // fit the layout to the unit square
      const xs = nodes.map((p) => p.x), ys = nodes.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      nodes.forEach((p) => { p.x = 0.03 + (0.94 * (p.x - x0)) / (x1 - x0 || 1); p.y = 0.03 + (0.94 * (p.y - y0)) / (y1 - y0 || 1); });
    }
    const adj = nodes.map(() => []);
    edges.forEach(([i, j]) => { adj[i].push(j); adj[j].push(i); });
    return { nodes, edges, adj, deg: adj.map((a) => a.length) };
  }
  function cascade(net, seeds, thr) {
    const n = net.nodes.length, fr = new Array(n).fill(Infinity);
    seeds.forEach((s) => { if (s >= 0 && s < n) fr[s] = 0; });
    for (let round = 1; round < 60; round++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (fr[i] < Infinity || !net.deg[i]) continue;
        const bad = net.adj[i].filter((j) => fr[j] < round).length;
        if (bad / net.deg[i] >= thr - 1e-9) { fr[i] = round; changed = true; }
      }
      if (!changed) break;
    }
    return fr;
  }
  function giant(net, removed) {
    const n = net.nodes.length, comp = new Array(n).fill(-1);
    let best = -1, bestSize = 0, id = 0;
    for (let i = 0; i < n; i++) {
      if (removed[i] || comp[i] >= 0) continue;
      const st = [i]; comp[i] = id; let size = 0;
      while (st.length) { const u = st.pop(); size++; net.adj[u].forEach((v) => { if (!removed[v] && comp[v] < 0) { comp[v] = id; st.push(v); } }); }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    return { comp, best, size: bestSize };
  }
  Objs.net = {
    eval(o) {
      if (!o._net) o._net = buildNet(o);
      const net = o._net, n = net.nodes.length, mode = o.mode || 'degree';
      const props = { n, edges: net.edges.length, maxdeg: Math.max(0, ...net.deg) };
      let state = null;
      if (mode === 'cascade') {
        const thr = num(o.thr, 0.5), key = thr.toFixed(4);
        if (o._ck !== key) { o._fr = cascade(net, o.seeds || [0], thr); o._ck = key; }
        const rd = num(o.round, 0), fr = o._fr;
        const amt = fr.map((f) => (f === Infinity ? 0 : clamp(rd - f + 1, 0, 1)));
        props.failed = amt.filter((a) => a >= 1).length;
        props.frac = props.failed / n;
        props.total = fr.filter((f) => f < Infinity).length;
        props.rounds = Math.max(0, ...fr.filter((f) => f < Infinity));
        state = { amt, fr, rd };
      } else if (mode === 'attack') {
        const k = clamp(Math.floor(num(o.remove, 0)), 0, n), target = o.target === 'random' ? 'random' : 'hubs';
        if (!o._order || o._ot !== target) {
          const idx = [...Array(n).keys()];
          if (target === 'hubs') idx.sort((a, b) => net.deg[b] - net.deg[a]);
          else { const r = rng((o.seed || 3) + 99); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } }
          o._order = idx; o._ot = target;
        }
        const removed = new Array(n).fill(false);
        for (let i = 0; i < k; i++) removed[o._order[i]] = true;
        const gc = giant(net, removed);
        props.giant = gc.size / n; props.removed = k;
        state = { removed, gc };
      }
      return { props, state };
    },
    draw(o, g) {
      const net = o._net; if (!net) return;
      const c = R.ctx, [x0, y0, x1, y1] = o.box.map((v) => S.num(v)), pr = prog(o), t = clockT();
      const given = (o.kind || 'random') === 'given';
      const P = net.nodes.map((p) => (given ? sc(p.x, p.y) : sc(x0 + p.x * (x1 - x0), y0 + p.y * (y1 - y0))));
      const [L, Bt] = sc(x0, y0), [Rr, T] = sc(x1, y1);
      if (R.halo) { haloBox(o, Math.min(L, Rr), Math.min(T, Bt), Math.abs(Rr - L), Math.abs(Bt - T)); return; }
      const col = o.color || 'olive', bad = o.badColor || 'clay', st = g.state, mode = o.mode || 'degree';
      const rad = (i) => (o.size || 4) + (o.grow != null ? o.grow : 1.6) * Math.sqrt(net.deg[i]) * (o.sizeBy === 'none' ? 0 : 1);
      const ne = Math.floor(net.edges.length * clamp(pr * 1.4 - 0.2, 0, 1));
      // edges
      for (let e = 0; e < ne; e++) {
        const [i, j] = net.edges[e], a = P[i], b = P[j];
        let ec = R.rgba('gray', 0.45), lw = o.ew || 1.4;
        if (st && st.removed && (st.removed[i] || st.removed[j])) { ec = R.rgba('gray', 0.08); }
        else if (st && st.gc && (st.gc.comp[i] !== st.gc.best)) ec = R.rgba('gray', 0.25);
        else if (st && st.amt && st.amt[i] >= 1 && st.amt[j] >= 1) { ec = R.rgba(bad, 0.55); lw += 0.6; }
        c.strokeStyle = ec; c.lineWidth = lw; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
        // shock travelling from a failed node to one about to fail
        if (st && st.amt) {
          [[i, j], [j, i]].forEach(([u, v]) => {
            const k = st.amt[v];
            if (st.fr[u] < st.fr[v] && st.fr[v] === st.fr[u] + 1 && k > 0 && k < 1) {
              const f = Math.min(1, k * 1.6), x = P[u][0] + (P[v][0] - P[u][0]) * f, y = P[u][1] + (P[v][1] - P[u][1]) * f;
              c.beginPath(); c.arc(x, y, 4, 0, TAU); c.fillStyle = R.color(bad); c.fill();
            }
          });
        }
      }
      // nodes
      const nn = Math.floor(net.nodes.length * clamp(pr * 1.2, 0, 1));
      for (let i = 0; i < nn; i++) {
        const [sx, sy] = P[i], r = rad(i);
        let fc = col, alpha = 0.92;
        if (st && st.removed) {
          if (st.removed[i]) {
            c.strokeStyle = R.rgba('gray', 0.6); c.lineWidth = 2;
            c.beginPath(); c.moveTo(sx - 5, sy - 5); c.lineTo(sx + 5, sy + 5); c.moveTo(sx + 5, sy - 5); c.lineTo(sx - 5, sy + 5); c.stroke();
            continue;
          }
          if (st.gc.comp[i] !== st.gc.best) { fc = 'gray'; alpha = 0.6; }
        }
        if (mode === 'degree' && o.hubColor && net.deg[i] >= (o.hubMin || 6)) fc = o.hubColor;
        c.beginPath(); c.arc(sx, sy, r, 0, TAU); c.fillStyle = R.rgba(fc, alpha); c.fill();
        if (st && st.amt && st.amt[i] > 0) {
          const k = st.amt[i];
          c.beginPath(); c.arc(sx, sy, r, 0, TAU); c.fillStyle = R.rgba(bad, k); c.fill();
          if (k < 1) { c.beginPath(); c.arc(sx, sy, r + 4 + 18 * k, 0, TAU); c.strokeStyle = R.rgba(bad, 0.7 * (1 - k)); c.lineWidth = 2.5; c.stroke(); }
          else if (st.fr[i] === 0) { const p = (t * 0.8) % 1; c.beginPath(); c.arc(sx, sy, r + 3 + 14 * p, 0, TAU); c.strokeStyle = R.rgba(bad, 0.6 * (1 - p)); c.lineWidth = 2; c.stroke(); }
        }
        c.lineWidth = 1.6; c.strokeStyle = R.color('bg'); c.beginPath(); c.arc(sx, sy, r, 0, TAU); c.stroke();
        if (o.labels && o.labels[i]) R.text(o.labels[i], sx, sy - r - 11, { size: 12.5, bold: true, font: 'sans', color: 'ink' });
      }
      // degree histogram
      if (o.hist && pr > 0.6) {
        const [hx0, hy0, hx1, hy1] = o.hist.map((v) => S.num(v)), maxK = o.histMax || 12;
        const cnt = new Array(maxK + 1).fill(0);
        net.deg.forEach((d) => { cnt[Math.min(d, maxK)]++; });
        const top = Math.max(...cnt) || 1, bw = (hx1 - hx0) / (maxK + 1);
        const [hl, hb] = sc(hx0, hy0), [hr] = sc(hx1, hy0);
        c.strokeStyle = R.rgba('gray', 0.9); c.lineWidth = 1.4; c.beginPath(); c.moveTo(hl, hb); c.lineTo(hr, hb); c.stroke();
        cnt.forEach((v, k) => {
          if (!k && !v) return;
          const [ax, ay] = sc(hx0 + k * bw + bw * 0.12, hy0 + ((hy1 - hy0) * v) / top), [bx] = sc(hx0 + (k + 1) * bw - bw * 0.12, hy0);
          c.fillStyle = R.rgba(k >= (o.hubMin || 6) && o.hubColor ? o.hubColor : col, 0.7); c.fillRect(ax, ay, bx - ax, hb - ay);
          if (k % 2 === 1 || k === maxK) R.text(k === maxK ? maxK + '+' : String(k), (ax + bx) / 2, hb + 11, { size: 10.5, font: 'sans', color: 'gray' });
        });
        if (o.histLabel) R.text(txt(o.histLabel), (hl + hr) / 2, hb + 27, { size: 11.5, font: 'sans', color: 'gray' });
      }
      R.hit(o, { k: 'box', x: Math.min(L, Rr), y: Math.min(T, Bt), w: Math.abs(Rr - L), h: Math.abs(Bt - T) });
    },
  };
  // =====================================================================
  //  traffic — request packets streaming along routes
  //  routes: [{ pts: [[x,y],…], color, back?: colour for the response leg, hold?: s at the far end, drop?: true }]
  //  pick: formula in k (packet number) → route 1…n.  rate: packets / s.  speed: world units / s.
  //  Stateless: packet k leaves at k/rate, so pausing / scrubbing the clock never drifts.
  // =====================================================================
  const plen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; };
  function along(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= l || i === pts.length - 1) { const f = l ? clamp(d / l, 0, 1) : 0; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
      d -= l;
    }
    return pts[0];
  }
  Objs.traffic = {
    eval() { return { props: {} }; },
    draw(o) {
      if (R.halo) return;
      const on = o.on != null ? S.num(o.on) : 1;
      if (!(on > 0.01)) return;
      const c = R.ctx, t = S.vars.t || 0, rate = num(o.rate, 2), speed = num(o.speed, 3), pr = prog(o);
      if (!(rate > 0) || !(speed > 0)) return;
      const routes = (o.routes || []).map((r) => {
        const pts = r.pts.map((p) => S.pt(p));
        const L = plen(pts), hold = num(r.hold, 0), back = r.back != null;
        return { r, pts, L, hold, back, life: L / speed + hold + (back ? L / speed : 0) };
      });
      if (!routes.length) return;
      const maxLife = Math.max(...routes.map((q) => q.life)) + 0.6;
      const e = (o._te = o._te || S.localEnv()), pick = o.pick != null ? fn(o.pick) : null;
      const k0 = Math.floor((t - maxLife) * rate), k1 = Math.floor(t * rate), sz = o.size || 5;
      for (let k = k0; k <= k1; k++) {
        let ri = 0;
        if (pick) { e.vars.k = k; ri = Math.round(pick(e)) - 1; }
        else ri = ((k % routes.length) + routes.length) % routes.length;
        const q = routes[ri];
        if (!q || q.L <= 0) continue;
        const age = t - k / rate;
        if (age < 0 || age > q.life + 0.5) continue;
        const go = q.L / speed;
        let pos, col = q.r.color || 'sky', alpha = Math.min(1, pr * 1.2), rad = sz;
        if (age <= go) pos = along(q.pts, age * speed);
        else if (age <= go + q.hold) {
          pos = q.pts[q.pts.length - 1];
          if (q.r.drop) { const f = (age - go) / Math.max(q.hold, 0.01); alpha *= 1 - f; rad = sz * (1 + f); col = q.r.dropColor || 'clay'; }
        } else if (q.back) { const d = q.L - (age - go - q.hold) * speed; if (d < 0) continue; pos = along(q.pts, d); col = q.r.back; }
        else if (q.r.drop) continue;
        else { const f = (age - go - q.hold) / 0.5; if (f > 1) continue; pos = q.pts[q.pts.length - 1]; alpha *= 1 - f; }
        if (!fin(pos.x, pos.y)) continue;
        const [sx, sy] = sc(pos.x, pos.y);
        c.globalAlpha = alpha;
        c.beginPath(); c.arc(sx, sy, rad + 4, 0, TAU); c.fillStyle = R.rgba(col, 0.18); c.fill();
        c.beginPath(); c.arc(sx, sy, rad, 0, TAU); c.fillStyle = R.color(col); c.fill();
        if (q.r.drop && age > go && age <= go + q.hold) {
          c.strokeStyle = R.color('clay'); c.lineWidth = 2.4; const d = rad + 3;
          c.beginPath(); c.moveTo(sx - d, sy - d); c.lineTo(sx + d, sy + d); c.moveTo(sx + d, sy - d); c.lineTo(sx - d, sy + d); c.stroke();
        }
        c.globalAlpha = 1;
      }
      if (o.lanes) {
        c.save(); c.globalAlpha = 0.35 * pr; c.setLineDash([2, 6]); c.lineWidth = 1.5;
        routes.forEach((q) => { c.strokeStyle = R.color(q.r.color || 'gray'); c.beginPath(); q.pts.forEach((p, i) => { const [x, y] = sc(p.x, p.y); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); });
        c.restore();
      }
    },
  };

  // =====================================================================
  //  ring — consistent hashing (or mod-N) with virtual nodes
  // =====================================================================
  const h01 = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
  function owners(n, v, keys, mode) {
    if (n < 1) return { own: keys.map(() => -1), pts: [] };
    if (mode === 'mod') return { own: keys.map((k) => Math.floor(k * 1e6) % n), pts: [] };
    const pts = [];
    for (let s = 0; s < n; s++) for (let j = 0; j < v; j++) pts.push({ p: h01('srv' + s + '#' + j), s });
    pts.sort((a, b) => a.p - b.p);
    const own = keys.map((k) => { for (const q of pts) if (q.p >= k) return q.s; return pts[0].s; });
    return { own, pts };
  }
  Objs.ring = {
    eval(o) {
      const n = clamp(Math.round(num(o.n, 4)), 1, 12), v = clamp(Math.round(num(o.v, 1)), 1, 64), nk = clamp(Math.round(num(o.keys, 60)), 1, 600);
      const mode = o.mode === 'mod' || num(o.modOn, 0) > 0.5 ? 'mod' : 'ring';
      const key = [n, v, nk, mode].join(',');
      if (o._rk !== key) {
        const keys = Array.from({ length: nk }, (_, i) => h01('key' + i));
        const cur = owners(n, v, keys, mode), prev = owners(n - 1, v, keys, mode);
        const now = S.vars.t || 0;
        if (o._own && o._own.length === nk) { o._chg = cur.own.map((s, i) => (s !== o._own[i] ? now : (o._chg && o._chg[i]) || -9)); }
        else o._chg = keys.map(() => -9);
        const cnt = new Array(n).fill(0); cur.own.forEach((s) => { if (s >= 0) cnt[s]++; });
        o._r = { keys, cur, n, v, mode, cnt, moved: n > 1 ? cur.own.filter((s, i) => s !== prev.own[i]).length / nk : 0 };
        o._own = cur.own.slice(); o._rk = key;
      }
      const r = o._r, fair = nk / r.n;
      return { props: { moved: r.moved, maxShare: Math.max(...r.cnt) / fair, minShare: Math.min(...r.cnt) / fair, n: r.n } };
    },
    draw(o) {
      const r = o._r; if (!r) return;
      const c = R.ctx, x = S.num(o.x), y = S.num(o.y), [cx, cy] = sc(x, y), rad = num(o.r, 3) * S.view.s, pr = prog(o), t = S.vars.t || 0;
      if (R.halo) { c.beginPath(); c.arc(cx, cy, rad + 10, 0, TAU); c.strokeStyle = R.rgba('clay', 0.3); c.lineWidth = 8; c.stroke(); return; }
      const cols = o.colors || ['sky', 'clay', 'olive', 'fig', 'kraft', 'heather', 'gray', 'ink'];
      const ang = (p) => -Math.PI / 2 + p * TAU;
      if (r.mode === 'mod') {
        // buckets drawn as columns
        const bw = (rad * 2) / r.n;
        for (let s = 0; s < r.n; s++) {
          const bx = cx - rad + s * bw;
          c.fillStyle = R.rgba(cols[s % cols.length], 0.1); R.roundRect(c, bx + 4, cy - rad, bw - 8, rad * 2, 10); c.fill();
          c.strokeStyle = R.color(cols[s % cols.length]); c.lineWidth = 2; c.stroke();
          R.text('server ' + (s + 1), bx + bw / 2, cy + rad + 14, { size: 12, bold: true, font: 'sans', color: cols[s % cols.length] });
        }
        const slot = new Array(r.n).fill(0);
        r.keys.forEach((k, i) => {
          const s = r.cur.own[i]; const j = slot[s]++, per = Math.max(1, Math.floor((bw - 16) / 12));
          const kx = cx - rad + s * bw + 10 + (j % per) * 12, ky = cy + rad - 10 - Math.floor(j / per) * 12;
          const age = t - r_chg(o, i);
          c.beginPath(); c.arc(kx, ky, 4, 0, TAU); c.fillStyle = R.color(cols[s % cols.length]); c.globalAlpha = pr; c.fill();
          if (age >= 0 && age < 2.5) { c.beginPath(); c.arc(kx, ky, 4 + 8 * (age / 2.5), 0, TAU); c.strokeStyle = R.rgba('clay', 1 - age / 2.5); c.lineWidth = 2; c.stroke(); }
          c.globalAlpha = 1;
        });
        return;
      }
      c.globalAlpha = pr;
      c.beginPath(); c.arc(cx, cy, rad, 0, TAU); c.strokeStyle = R.rgba('gray', 0.5); c.lineWidth = 2; c.stroke();
      // owner arcs
      const pts = r.cur.pts;
      pts.forEach((q, i) => {
        const prev = pts[(i - 1 + pts.length) % pts.length];
        let a0 = ang(prev.p), a1 = ang(q.p); if (a1 <= a0) a1 += TAU;
        c.beginPath(); c.arc(cx, cy, rad, a0, a1); c.strokeStyle = R.rgba(cols[q.s % cols.length], 0.75); c.lineWidth = 7; c.stroke();
      });
      // keys
      r.keys.forEach((k, i) => {
        const s = r.cur.own[i], a = ang(k), kr = rad - 16;
        const kx = cx + kr * Math.cos(a), ky = cy + kr * Math.sin(a), age = t - r_chg(o, i);
        c.beginPath(); c.arc(kx, ky, 3.6, 0, TAU); c.fillStyle = R.color(cols[s % cols.length]); c.fill();
        if (age >= 0 && age < 2.5) { c.beginPath(); c.arc(kx, ky, 4 + 9 * (age / 2.5), 0, TAU); c.strokeStyle = R.rgba('clay', 1 - age / 2.5); c.lineWidth = 2; c.stroke(); }
      });
      // server tokens
      pts.forEach((q) => {
        const a = ang(q.p), sx = cx + rad * Math.cos(a), sy = cy + rad * Math.sin(a), big = r.v <= 3;
        c.beginPath(); c.arc(sx, sy, big ? 9 : 5.5, 0, TAU); c.fillStyle = R.color(cols[q.s % cols.length]); c.fill();
        c.lineWidth = 2; c.strokeStyle = R.color('bg'); c.stroke();
        if (big) R.text(String(q.s + 1), sx, sy + 0.5, { size: 10.5, bold: true, font: 'sans', color: 'bg', halo: false });
      });
      if (o.legend !== false) {
        r.cnt.forEach((v, s) => R.text('server ' + (s + 1) + ': ' + v + ' keys', cx + rad + 26, cy - rad + 8 + s * 19, { size: 12.5, bold: true, font: 'sans', color: cols[s % cols.length], align: 'left' }));
      }
      c.globalAlpha = 1;
      R.hit(o, { k: 'p', x: cx, y: cy, r: rad + 8 });
    },
  };
  function r_chg(o, i) { return o._chg ? o._chg[i] : -9; }

  // =====================================================================
  //  queue — a buffer of waiting items drawn as chips
  // =====================================================================
  Objs.queue = {
    eval(o) { return { props: { n: Math.max(0, num(o.n, 0)) } }; },
    draw(o, g) {
      const x = S.num(o.x), y = S.num(o.y), w = num(o.w, 4), h = num(o.h, 0.8);
      if (!fin(x, y, w, h)) return;
      const c = R.ctx, [L, Tp] = sc(x - w / 2, y + h / 2), W = w * S.view.s, H = h * S.view.s, col = o.color || 'kraft', pr = prog(o), t = calm ? 0 : S.vars.t || 0;
      if (R.halo) { haloBox(o, L, Tp, W, H); return; }
      R.roundRect(c, L, Tp, W, H, Math.min(10, H / 2)); c.fillStyle = R.rgba(col, 0.06); c.fill();
      c.lineWidth = 2; c.strokeStyle = R.rgba(col, 0.9); c.stroke();
      const cap = Math.max(1, Math.round(num(o.cap, 12))), n = g.props.n, shown = Math.min(cap, Math.floor(n + 1e-6)), frac = n - Math.floor(n);
      const cw = (W - 8) / cap, chW = Math.max(3, cw - 4), chH = H - 10;
      for (let i = 0; i < shown + (frac > 0.05 && shown < cap ? 1 : 0); i++) {
        const isFrac = i === shown, xx = Rx(i);
        function Rx(j) { return o.dir === -1 ? L + 4 + j * cw : L + W - 4 - (j + 1) * cw; }
        const wob = Math.sin(t * 3 + i * 0.9) * 1.2;
        c.globalAlpha = pr * (isFrac ? frac : 1);
        R.roundRect(c, xx + 2, Tp + 5 + wob, chW, chH, Math.min(5, chW / 3)); c.fillStyle = R.rgba(col, 0.75); c.fill();
        c.globalAlpha = 1;
      }
      if (n > cap + 0.5) R.text('+' + Math.round(n - cap) + ' more', L + W / 2, Tp - 11, { size: 12, bold: true, font: 'sans', color: 'clay' });
      if (o.title) R.text(txt(o.title), L + W / 2, Tp + H + 14, { size: o.size || 13, bold: true, font: 'sans', color: o.tcolor || col });
      R.hit(o, { k: 'box', x: L, y: Tp, w: W, h: H });
    },
  };
})(window.G = window.G || {});
