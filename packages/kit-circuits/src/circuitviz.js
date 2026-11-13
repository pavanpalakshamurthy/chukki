/* circuitviz — live circuit and logic pictures (used by the Electronics & Computing course).
     wire   a polyline wire; electrons (blue dots) drift along it at a speed set by the current `i`;
            or, for logic, `level` lights the wire when it is 1
     comp   a component symbol between two terminals: resistor, battery, bulb (glows), cap (charges),
            diode / led, switch (opens/closes), ground, nmos / pmos (channel lights when on), meter
     gate   a logic gate (AND OR NOT NAND NOR XOR BUF) computing its output from formula inputs;
            exposes props out / a / b so other gates and wires can use them
     wave   a scrolling timing diagram of digital signals written as formulas in s (time)
   Every number is a formula, so sliders and the clock drive them. */
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
  const txt = (s) => Expr.interp(String(s), S.env);
  let calm = false;
  try { calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
  const clockT = () => (calm ? 0 : S.vars.t || 0);
  const LIT = 'clay', DIM = 'gray';

  // ===================================================================== wire
  function polyLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; }
  function atLen(P, d) {
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= l || i === P.length - 1) { const f = l ? clamp(d / l, 0, 1) : 0; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
      d -= l;
    }
    return P[0];
  }
  Objs.wire = {
    eval(o) { return { props: { level: o.level != null ? (S.num(o.level) > 0.5 ? 1 : 0) : 0 } }; },
    draw(o, g) {
      const W = (o.pts || []).map((p) => S.pt(p));
      if (W.length < 2 || !W.every((p) => fin(p.x, p.y))) return;
      const c = R.ctx, P = W.map((p) => sc(p.x, p.y)), pr = prog(o);
      const L = polyLen(P), end = L * pr;
      const trace = (d1) => { c.beginPath(); let acc = 0; c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (acc + l >= d1) { const q = atLen(P, d1); c.lineTo(q[0], q[1]); break; } c.lineTo(P[i][0], P[i][1]); acc += l; } };
      c.lineCap = 'round'; c.lineJoin = 'round';
      if (R.halo) { c.strokeStyle = R.rgba('clay', 0.25); c.lineWidth = 12; trace(end); c.stroke(); return; }
      const logic = o.level != null, hi = logic && g.props.level;
      const col = logic ? (hi ? o.onColor || LIT : DIM) : o.color || 'ink';
      if (hi) { c.strokeStyle = R.rgba(col, 0.25); c.lineWidth = (o.w || 3) + 7; trace(end); c.stroke(); }
      c.strokeStyle = R.color(col); c.lineWidth = o.w || 3; trace(end); c.stroke();
      if (pr < 0.98) return;
      // electrons drift opposite to conventional current (from the end back to the start)
      if (o.i != null) {
        const cur = S.num(o.i), imax = num(o.imax, 1), gap = (o.gap || 0.42) * S.view.s;
        const v = (calm ? 0 : 1) * (cur / imax) * (o.speed || 1.2) * S.view.s;
        const off = ((-clockT() * v) % gap + gap) % gap;
        for (let d = off; d < L; d += gap) {
          const q = atLen(P, d);
          c.beginPath(); c.arc(q[0], q[1], o.er || 3.6, 0, TAU); c.fillStyle = R.color(o.ecolor || 'sky'); c.fill();
        }
      }
      if (hi && o.pulse !== false) {
        const gap = 70, off = (clockT() * 90) % gap;
        for (let d = off; d < L; d += gap) { const q = atLen(P, d); c.beginPath(); c.arc(q[0], q[1], 3.2, 0, TAU); c.fillStyle = R.rgba('bg', 0.8); c.fill(); }
      }
      if (o.label) { const q = atLen(P, L * (o.labelAt != null ? o.labelAt : 0.5)); R.text(txt(o.label), q[0] + (o.ldx || 0), q[1] + (o.ldy != null ? o.ldy : -14), { size: o.size || 12.5, bold: true, font: 'sans', color: o.lcolor || col }); }
    },
  };

  // ===================================================================== comp
  function frame(o) {
    const x = S.num(o.x), y = S.num(o.y), L = num(o.len, 1.6) * S.view.s, a = -(num(o.rot, 0) * Math.PI) / 180;
    const [cx, cy] = sc(x, y), ca = Math.cos(a), sa = Math.sin(a);
    // local units: 1 = L/2; +y local is screen-up
    const P = (lx, ly) => [cx + (lx * ca + ly * sa) * (L / 2), cy + (lx * sa - ly * ca) * (L / 2)];
    return { P, L, cx, cy, a };
  }
  function line(c, pts) { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); }
  Objs.comp = {
    eval(o) { return { props: { on: o.on != null ? (S.num(o.on) > 0.5 ? 1 : 0) : 1 } }; },
    draw(o, g) {
      if (!fin(S.num(o.x), S.num(o.y))) return;
      const c = R.ctx, { P, L, cx, cy } = frame(o), col = o.color || 'ink', pr = prog(o), k = o.kind;
      if (R.halo) { c.beginPath(); c.arc(cx, cy, L * 0.45, 0, TAU); c.fillStyle = R.rgba('clay', 0.18); c.fill(); return; }
      c.globalAlpha *= Math.min(1, pr * 1.5);
      c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = R.color(col); c.lineWidth = o.w || 3;
      const glow = o.glow != null ? clamp(S.num(o.glow), 0, 1.5) : 0;
      if (k === 'resistor') {
        line(c, [P(-1, 0), P(-0.55, 0)]); line(c, [P(0.55, 0), P(1, 0)]);
        const z = [P(-0.55, 0)]; for (let i = 0; i < 6; i++) z.push(P(-0.55 + (i + 0.5) * (1.1 / 6), i % 2 ? -0.22 : 0.22)); z.push(P(0.55, 0));
        if (glow > 0.02) { c.save(); c.strokeStyle = R.rgba('clay', 0.35 * Math.min(1, glow)); c.lineWidth = 14; line(c, z); c.restore(); }
        line(c, z);
      } else if (k === 'battery') {
        line(c, [P(-1, 0), P(-0.12, 0)]); line(c, [P(0.12, 0), P(1, 0)]);
        c.lineWidth = 3.5; line(c, [P(-0.12, -0.42), P(-0.12, 0.42)]); c.lineWidth = 6; line(c, [P(0.12, -0.22), P(0.12, 0.22)]);
        const pp = P(-0.32, 0.42), pm = P(0.34, 0.42);
        R.text('+', pp[0], pp[1], { size: 15, bold: true, font: 'sans', color: 'clay' }); R.text('−', pm[0], pm[1], { size: 15, bold: true, font: 'sans', color: 'sky' });
      } else if (k === 'bulb') {
        line(c, [P(-1, 0), P(-0.36, 0)]); line(c, [P(0.36, 0), P(1, 0)]);
        const r = L * 0.18;
        if (glow > 0.01) {
          const gr = c.createRadialGradient(cx, cy, 0, cx, cy, r * (2 + 2.5 * glow));
          gr.addColorStop(0, R.rgba('kraft', 0.75 * Math.min(1, glow))); gr.addColorStop(1, R.rgba('kraft', 0));
          c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, r * (2 + 2.5 * glow), 0, TAU); c.fill();
        }
        c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fillStyle = R.rgba('kraft', 0.15 + 0.6 * Math.min(1, glow)); c.fill(); c.stroke();
        c.lineWidth = 2; line(c, [P(-0.36, 0), P(-0.2, 0.12), P(-0.07, -0.12), P(0.07, 0.12), P(0.2, -0.12), P(0.36, 0)]);
      } else if (k === 'cap') {
        line(c, [P(-1, 0), P(-0.1, 0)]); line(c, [P(0.1, 0), P(1, 0)]);
        c.lineWidth = 4; line(c, [P(-0.1, -0.5), P(-0.1, 0.5)]); line(c, [P(0.1, -0.5), P(0.1, 0.5)]);
        const q = o.q != null ? clamp(S.num(o.q), -1, 1) : 0, n = Math.round(Math.abs(q) * 5);
        for (let i = 0; i < n; i++) {
          const yy = -0.4 + (i + 0.5) * (0.8 / 5);
          const a = P(-0.24, yy), b = P(0.24, yy);
          R.text(q > 0 ? '+' : '−', a[0], a[1], { size: 12, bold: true, font: 'sans', color: q > 0 ? 'clay' : 'sky', halo: false });
          R.text(q > 0 ? '−' : '+', b[0], b[1], { size: 12, bold: true, font: 'sans', color: q > 0 ? 'sky' : 'clay', halo: false });
        }
      } else if (k === 'diode' || k === 'led') {
        line(c, [P(-1, 0), P(-0.3, 0)]); line(c, [P(0.3, 0), P(1, 0)]);
        const tri = [P(-0.3, -0.32), P(-0.3, 0.32), P(0.28, 0)];
        if (k === 'led' && glow > 0.01) { c.save(); c.shadowColor = R.color(o.ledColor || 'clay'); c.shadowBlur = 25 * glow; c.beginPath(); tri.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fillStyle = R.rgba(o.ledColor || 'clay', 0.85 * Math.min(1, glow)); c.fill(); c.restore(); }
        c.beginPath(); tri.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fillStyle = R.rgba(col, 0.2); c.fill(); c.stroke();
        line(c, [P(0.3, -0.34), P(0.3, 0.34)]);
        if (k === 'led') { c.lineWidth = 1.8; [0, 0.18].forEach((d) => { line(c, [P(-0.05 + d, 0.42), P(0.12 + d, 0.66)]); }); }
      } else if (k === 'switch') {
        const on = g.props.on;
        line(c, [P(-1, 0), P(-0.4, 0)]); line(c, [P(0.4, 0), P(1, 0)]);
        line(c, [P(-0.4, 0), on ? P(0.4, 0) : P(0.3, 0.5)]);
        [P(-0.4, 0), P(0.4, 0)].forEach((p) => { c.beginPath(); c.arc(p[0], p[1], 4, 0, TAU); c.fillStyle = R.color('bg'); c.fill(); c.stroke(); });
      } else if (k === 'ground') {
        line(c, [P(-1, 0), P(0, 0)]); line(c, [P(0, -0.5), P(0, 0.5)]); line(c, [P(0.18, -0.32), P(0.18, 0.32)]); line(c, [P(0.36, -0.14), P(0.36, 0.14)]);
      } else if (k === 'nmos' || k === 'pmos') {
        const on = g.props.on, ch = on ? (o.onColor || 'olive') : DIM;
        // source (-1) and drain (+1) along local x; gate comes in from local +y
        line(c, [P(-1, 0), P(-0.45, 0), P(-0.45, 0.35)]); line(c, [P(1, 0), P(0.45, 0), P(0.45, 0.35)]);
        c.save(); c.strokeStyle = R.color(ch); c.lineWidth = 4; if (!on) c.setLineDash([5, 5]);
        if (on) { c.shadowColor = R.color(ch); c.shadowBlur = 10; }
        line(c, [P(-0.55, 0.35), P(0.55, 0.35)]); c.restore();
        c.lineWidth = 3; line(c, [P(-0.5, 0.55), P(0.5, 0.55)]); line(c, [P(0, 0.55), P(0, 1.1)]);
        if (k === 'pmos') { const b = P(0, 0.66); c.beginPath(); c.arc(b[0], b[1], 5, 0, TAU); c.fillStyle = R.color('bg'); c.fill(); c.stroke(); }
      } else if (k === 'meter') {
        line(c, [P(-1, 0), P(-0.36, 0)]); line(c, [P(0.36, 0), P(1, 0)]);
        c.beginPath(); c.arc(cx, cy, L * 0.18, 0, TAU); c.fillStyle = R.color('bg'); c.fill(); c.stroke();
        R.text(o.letter || 'A', cx, cy + 1, { size: L * 0.17, bold: true, font: 'sans', color: col, halo: false });
      }
      c.globalAlpha = 1;
      if (pr > 0.6) {
        const side = o.labelSide || 1, lp = P(0, 0.75 * side + (side > 0 ? 0.1 : -0.1));
        if (o.label) R.text(txt(o.label), lp[0] + (o.ldx || 0), lp[1] - (o.val ? 8 : 0) + (o.ldy || 0), { size: o.size || 13, bold: true, font: 'sans', color: o.lcolor || col });
        if (o.val) R.text(txt(o.val), lp[0] + (o.ldx || 0), lp[1] + (o.label ? 9 : 0) + (o.ldy || 0), { size: o.vsize || 13, bold: true, font: 'sans', color: o.vcolor || 'clay' });
      }
      R.hit(o, { k: 'p', x: cx, y: cy, r: L * 0.45 });
    },
  };

  // ===================================================================== gate
  const LOGIC = {
    AND: (a, b) => a & b, OR: (a, b) => a | b, NOT: (a) => 1 - a, NAND: (a, b) => 1 - (a & b), NOR: (a, b) => 1 - (a | b), XOR: (a, b) => a ^ b, BUF: (a) => a, XNOR: (a, b) => 1 - (a ^ b),
  };
  const bit = (v) => (S.num(v) > 0.5 ? 1 : 0);
  Objs.gate = {
    eval(o) {
      const k = (o.kind || 'AND').toUpperCase(), a = o.a != null ? bit(o.a) : 0, b = o.b != null ? bit(o.b) : 0;
      return { props: { a, b, out: (LOGIC[k] || LOGIC.AND)(a, b) } };
    },
    draw(o, g) {
      const x = S.num(o.x), y = S.num(o.y); if (!fin(x, y)) return;
      const c = R.ctx, s = num(o.s, 1.2) * S.view.s, [cx, cy] = sc(x, y), k = (o.kind || 'AND').toUpperCase(), pr = prog(o);
      const one = k === 'NOT' || k === 'BUF', inv = k === 'NOT' || k === 'NAND' || k === 'NOR' || k === 'XNOR';
      const L = cx - s * 0.5, Rx = cx + s * 0.5, T = cy - s * 0.42, B = cy + s * 0.42;
      if (R.halo) { c.beginPath(); c.arc(cx, cy, s * 0.7, 0, TAU); c.fillStyle = R.rgba('clay', 0.18); c.fill(); return; }
      c.globalAlpha *= Math.min(1, pr * 1.5);
      const P = g.props, hiC = o.onColor || LIT, pin = (v) => (v ? hiC : DIM);
      c.lineCap = 'round'; c.lineWidth = 3;
      // input stubs
      const ins = one ? [[cy, P.a]] : [[cy - s * 0.22, P.a], [cy + s * 0.22, P.b]];
      ins.forEach(([yy, v]) => { c.strokeStyle = R.color(pin(v)); c.beginPath(); c.moveTo(L - s * 0.35, yy); c.lineTo(L + s * 0.08, yy); c.stroke(); });
      // body
      c.beginPath();
      if (one) { c.moveTo(L, T); c.lineTo(Rx - s * 0.1, cy); c.lineTo(L, B); c.closePath(); }
      else if (k === 'AND' || k === 'NAND') { c.moveTo(L, T); c.lineTo(cx, T); c.arc(cx, cy, s * 0.42, -Math.PI / 2, Math.PI / 2); c.lineTo(L, B); c.closePath(); }
      else { c.moveTo(L, T); c.quadraticCurveTo(cx + s * 0.1, T, Rx, cy); c.quadraticCurveTo(cx + s * 0.1, B, L, B); c.quadraticCurveTo(L + s * 0.22, cy, L, T); c.closePath(); }
      if (P.out) { c.save(); c.shadowColor = R.color(hiC); c.shadowBlur = 16; c.fillStyle = R.rgba(hiC, 0.22); c.fill(); c.restore(); }
      else { c.fillStyle = R.rgba(o.color || 'heather', 0.12); c.fill(); }
      c.strokeStyle = R.color(o.color || 'heather'); c.stroke();
      if (k === 'XOR' || k === 'XNOR') { c.beginPath(); c.moveTo(L - s * 0.12, T); c.quadraticCurveTo(L + s * 0.1, cy, L - s * 0.12, B); c.stroke(); }
      let ox = one ? Rx - s * 0.1 : Rx;
      if (inv) { c.beginPath(); c.arc(ox + 6, cy, 6, 0, TAU); c.fillStyle = R.color('bg'); c.fill(); c.stroke(); ox += 12; }
      c.strokeStyle = R.color(pin(P.out)); c.beginPath(); c.moveTo(ox, cy); c.lineTo(Rx + s * 0.4, cy); c.stroke();
      // pin values
      if (o.pins !== false) {
        ins.forEach(([yy, v]) => R.text(String(v), L - s * 0.42, yy - 1, { size: 12, bold: true, font: 'sans', color: pin(v), align: 'right' }));
        R.text(String(P.out), Rx + s * 0.47, cy - 1, { size: 13, bold: true, font: 'sans', color: pin(P.out), align: 'left' });
      }
      if (o.label !== '') R.text(o.label != null ? txt(o.label) : k, cx - (one ? s * 0.12 : 0), B + 13, { size: o.size || 12.5, bold: true, font: 'sans', color: o.color || 'heather' });
      c.globalAlpha = 1;
      R.hit(o, { k: 'box', x: L, y: T, w: Rx - L, h: B - T });
    },
  };

  // ===================================================================== wave
  Objs.wave = {
    eval() { return { props: {} }; },
    draw(o) {
      const c = R.ctx, [x0, y0, x1, y1] = o.box.map((v) => S.num(v)), [L, B] = sc(x0, y0), [Rr, T] = sc(x1, y1), pr = prog(o);
      if (R.halo) return;
      const sig = o.sig || [], n = sig.length || 1, lane = (B - T) / n, span = num(o.T, 8), now = o.now != null ? S.num(o.now) : clockT();
      const t0 = o.scroll === false ? 0 : Math.max(0, now - span);
      c.globalAlpha *= pr;
      R.roundRect(c, L - 10, T - 8, Rr - L + 20, B - T + 16, 12); c.fillStyle = R.rgba('gray', 0.06); c.fill();
      const e = (o._we = o._we || S.localEnv());
      sig.forEach((sg, j) => {
        const f = Expr.compile(String(sg.e)), yH = T + lane * j + lane * 0.2, yL = T + lane * (j + 1) - lane * 0.2, col = sg.color || 'sky';
        R.text(txt(sg.label || ''), L - 16, (yH + yL) / 2, { size: 12.5, bold: true, font: 'sans', color: col, align: 'right' });
        c.strokeStyle = R.rgba('gray', 0.25); c.lineWidth = 1; c.beginPath(); c.moveTo(L, yL); c.lineTo(Rr, yL); c.stroke();
        c.strokeStyle = R.color(col); c.lineWidth = 2.6; c.beginPath();
        const N = 400, tEnd = Math.min(now, t0 + span);
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const s = t0 + ((tEnd - t0) * i) / N; e.vars.s = s;
          const v = f(e) > 0.5 ? 1 : 0, xx = L + ((s - t0) / span) * (Rr - L), yy = v ? yH : yL;
          if (i === 0) c.moveTo(xx, yy); else { if (v !== prev) c.lineTo(xx, prev ? yH : yL); c.lineTo(xx, yy); }
          prev = v;
        }
        c.stroke();
        if (sg.fillHi) { /* reserved */ }
      });
      (o.marks || []).forEach((m) => { // vertical markers (e.g. rising clock edges) at times m(s) within the window
        const f = Expr.compile(String(m.every)), per = S.num(m.every);
        for (let s = Math.ceil(t0 / per) * per + (m.at || 0); s <= Math.min(now, t0 + span); s += per) {
          const xx = L + ((s - t0) / span) * (Rr - L);
          c.setLineDash([3, 4]); c.strokeStyle = R.rgba(m.color || 'clay', 0.6); c.lineWidth = 1.4; c.beginPath(); c.moveTo(xx, T - 4); c.lineTo(xx, B + 4); c.stroke(); c.setLineDash([]);
        }
        void f;
      });
      const nx = L + ((Math.min(now, t0 + span) - t0) / span) * (Rr - L);
      c.strokeStyle = R.color('clay'); c.lineWidth = 2; c.beginPath(); c.moveTo(nx, T - 6); c.lineTo(nx, B + 6); c.stroke();
      if (o.xlabel) R.text(txt(o.xlabel), Rr, B + 18, { size: 12, font: 'sans', color: 'gray', align: 'right' });
      c.globalAlpha = 1;
      R.hit(o, { k: 'box', x: L, y: T, w: Rr - L, h: B - T });
    },
  };
})(window.G = window.G || {});
