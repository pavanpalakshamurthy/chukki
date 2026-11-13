/* Number line — the most basic picture in mathematics, as three object types:
     numline  a labelled line: whole numbers, or cut into n equal parts (fractions, decimals, percent, scaled amounts)
     hop      an arc from one number to another with an arrowhead — "add 3" is a hop of +3
     span     a thick bar over an interval — "the part from 0 to 3/4"
   Everything is live: any number is a formula, so sliders and points can drive them. */
(function (G) {
  'use strict';
  const S = G.S, R = G.R, { Expr } = G;
  const Objs = G.Objs;

  const fin = (...v) => v.every(Number.isFinite);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const prog = (o) => (o.draw == null ? 1 : clamp(o.draw, 0, 1));
  const num = (v, d) => (v == null ? d : S.num(v));
  const sc = (x, y) => R.w2s(x, y);
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
  const MINUS = '−';
  const SUP = { 0: '\u2070', 1: '\u00b9', 2: '\u00b2', 3: '\u00b3', 4: '\u2074', 5: '\u2075', 6: '\u2076', 7: '\u2077', 8: '\u2078', 9: '\u2079', '-': '\u207b' };
  const sup = (n) => String(n).split('').map((ch) => SUP[ch] || ch).join('');
  const signed = (s) => s.replace('-', MINUS);

  function strokeStyle(o, dw) {
    const c = R.ctx;
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (R.halo) {
      c.strokeStyle = R.rgba('clay', R.halo === 1 ? 0.3 : 0.16);
      c.lineWidth = (o.w != null ? o.w : dw) + (R.halo === 1 ? 9 : 7);
      c.setLineDash([]);
    } else {
      c.strokeStyle = R.color(o.color || 'ink');
      c.lineWidth = o.w != null ? o.w : dw;
      c.setLineDash(o.dash ? [8, 7] : []);
    }
  }

  function arrowHead(x, y, ang, size, color) {
    const c = R.ctx;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - size * Math.cos(ang - 0.42), y - size * Math.sin(ang - 0.42));
    c.lineTo(x - size * 0.7 * Math.cos(ang), y - size * 0.7 * Math.sin(ang));
    c.lineTo(x - size * Math.cos(ang + 0.42), y - size * Math.sin(ang + 0.42));
    c.closePath();
    c.fillStyle = color; c.fill();
  }

  // A stacked fraction: numerator over a bar over the denominator, centred on (sx, sy).
  function drawFraction(n, d, sx, sy, size, color) {
    const c = R.ctx, opt = { size, font: 'sans', color, halo: false };
    const gap = size * 0.62;
    const a = R.text(String(Math.abs(n)), sx, sy - gap, opt), b = R.text(String(d), sx, sy + gap, opt);
    const w = Math.max(a.w, b.w) + 6;
    c.beginPath(); c.moveTo(sx - w / 2, sy); c.lineTo(sx + w / 2, sy);
    c.lineWidth = 1.6; c.strokeStyle = R.color(color); c.setLineDash([]); c.stroke();
    if (n < 0) R.text(MINUS, sx - w / 2 - 7, sy, opt);
  }

  // =====================================================================
  //  numline
  //    y, from, to      where it sits and how far it runs (default: the whole screen)
  //    step, div        a labelled mark every `step`, each step cut into `div` equal parts
  //    fmt              'num' (default) | 'frac' (k/div) | 'pct' (×100 and %)
  //    labels           'major' | 'all' | 'none'   (frac defaults to 'all')
  //    mul, suffix, dp  scale the printed value (double number lines), add a unit, decimals
  //    red              reduce fractions (2/4 → 1/2);  side: 'up' puts labels above
  // =====================================================================
  Objs.numline = {
    eval(o) { return { props: { y: num(o.y, 0) } }; },
    draw(o) {
      const y = num(o.y, 0);
      if (!fin(y)) return;
      const c = R.ctx, s = S.view.s, b = R.bounds(), pr = prog(o);
      const lo = o.from != null ? S.num(o.from) : -Infinity, hi = o.to != null ? S.num(o.to) : Infinity;
      const a = Math.max(b.x0 - 0.5, lo), z = Math.min(b.x1 + 0.5, hi);
      if (!(z > a)) return;
      const [ax, ay] = sc(a, y), [zx] = sc(z, y);
      const ex = ax + (zx - ax) * pr, col = o.color || 'ink', lw = o.w != null ? o.w : 3;

      // the line itself (+ arrowheads where it ends)
      strokeStyle(o, 3);
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ex, ay); c.stroke();
      if (R.halo) return;
      R.hit(o, { k: 's', x1: ax, y1: ay, x2: zx, y2: ay });
      if (o.arrows !== false && pr > 0.97) {
        if (Number.isFinite(hi) && hi <= b.x1 + 0.5) arrowHead(zx + 4, ay, 0, 9 + lw * 1.6, R.color(col));
        if (Number.isFinite(lo) && lo >= b.x0 - 0.5) arrowHead(ax - 4, ay, Math.PI, 9 + lw * 1.6, R.color(col));
      }

      const step = Math.abs(num(o.step, 1)) || 1, div = clamp(Math.round(num(o.div, 1)) || 1, 1, 1000);
      const minor = step / div, fmt = o.fmt || 'num';
      const k0 = Math.ceil(a / minor - 1e-9), k1 = Math.floor(z / minor + 1e-9);
      if (k1 - k0 > 3000) return;
      const tick = o.tick != null ? o.tick : 9, minorPx = minor * s;

      // tick marks (minor ones fade out when they would crowd)
      const drawTicks = (major) => {
        c.beginPath();
        for (let k = k0; k <= k1; k++) {
          if ((k % div === 0) !== major) continue;
          const [tx] = sc(k * minor, y);
          if (tx > ex + 1) continue;
          const zero = k === 0 && o.zero !== false;
          const h = major ? tick * (zero ? 1.5 : 1) : tick * 0.55;
          c.moveTo(tx, ay - h); c.lineTo(tx, ay + h);
        }
        c.lineWidth = major ? Math.max(2, lw * 0.8) : 1.5;
        c.strokeStyle = major ? R.color(col) : R.rgba(col, 0.6);
        c.setLineDash([]);
        c.stroke();
      };
      if (minorPx >= 5 && div > 1) drawTicks(false);
      drawTicks(true);

      // labels
      const mode = o.labels || (fmt === 'frac' ? 'all' : 'major');
      if (mode === 'none') return;
      const mul = num(o.mul, 1), off = num(o.off, 0), dp = o.dp != null ? o.dp : 4, sfx = o.suffix || (fmt === 'pct' ? '%' : '');
      const size = o.size || 15, dir = o.side === 'up' ? -1 : 1;
      const lk = mode === 'all' ? 1 : div;
      const lab = (v) => (fmt === 'pct' ? Expr.fmt(v * 100, dp) : Expr.fmt(off + v * mul, dp)) + sfx;
      const fw = fmt === 'pow10' ? 44 : fmt === 'frac' ? 24 : 12 + 8.6 * Math.max(...[a, z, k0 * minor, k1 * minor, (a + z) / 2].map((v) => lab(v).length));
      const need = (fw + 8) / (lk * minorPx), stride = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((m) => m >= need - 1e-9) || 1000;
      const ly = ay + dir * (tick * 1.5 + 11);
      for (let k = Math.ceil(k0 / lk) * lk; k <= k1; k += lk) {
        if ((k / lk) % stride !== 0) continue;
        const [tx] = sc(k * minor, y);
        if (tx > ex + 1) continue;
        const isMajor = k % div === 0, color = isMajor ? col : 'gray';
        if (fmt === 'frac') {
          if (isMajor) { R.text(signed(String(k / div)), tx, ay + dir * (tick * 1.5 + 12), { size: size + 1, font: 'sans', color, bold: true }); continue; }
          let n = k, d = div;
          if (o.red) { const g = gcd(n, d); n /= g; d /= g; }
          drawFraction(n, d, tx, ay + dir * (tick * 1.5 + size * 1.5), size - 1, color);
        } else {
          const v = fmt === 'pct' ? k * minor * 100 : off + k * minor * mul;
          const str = fmt === 'pow10' ? '10' + sup(Math.round(v)) : signed(Expr.fmt(v, dp)) + sfx;
          R.text(str, tx, ly, { size, font: 'sans', color, bold: isMajor });
        }
      }
    },
  };

  // =====================================================================
  //  hop — an arc from number a to number b, arrowhead at b
  //    y (line height), h (arc height, signed), label (may contain {formulas}), dash
  // =====================================================================
  const hopH = (o, d) => (o.h != null ? S.num(o.h) : (o.below ? -1 : 1) * clamp(Math.abs(d) * 0.32, 0.42, 1.5));
  Objs.hop = {
    eval(o) {
      const a = S.num(o.a), b = S.num(o.b);
      return { a, b, props: { len: b - a, from: a, to: b } };
    },
    draw(o, g) {
      if (!g || !fin(g.a, g.b)) return;
      const y = num(o.y, 0), d = g.b - g.a;
      if (Math.abs(d) < 1e-3) return;
      const hh = hopH(o, d), pr = prog(o), N = 44, nmax = Math.max(1, Math.floor(N * pr));
      const pts = [];
      for (let i = 0; i <= nmax; i++) {
        const u = i / N;
        pts.push(sc(g.a + (d * (1 - Math.cos(Math.PI * u))) / 2, y + hh * Math.sin(Math.PI * u)));
      }
      const c = R.ctx;
      strokeStyle(o, 3);
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.stroke();
      if (R.halo) return;
      R.hit(o, { k: 'poly', pts, fill: false });
      if (o.arrow !== false && pr > 0.08 && pts.length > 2) {
        const p = pts[pts.length - 1], q = pts[pts.length - 3];
        arrowHead(p[0], p[1], Math.atan2(p[1] - q[1], p[0] - q[0]), 12 + (o.w != null ? o.w : 3) * 1.2, R.color(o.color || 'clay'));
      }
    },
    label(o, g) {
      if (!o.label || !g || !fin(g.a, g.b) || prog(o) < 0.6 || Math.abs(g.b - g.a) < 1e-3) return;
      const y = num(o.y, 0), hh = hopH(o, g.b - g.a);
      const [sx, sy] = sc((g.a + g.b) / 2, y + hh);
      const up = hh >= 0;
      R.text(Expr.interp(o.label, S.env), sx, sy + (up ? -15 : 15), { size: o.size || 18, font: 'sans', bold: true, color: o.color || 'clay' });
    },
  };

  // =====================================================================
  //  span — a thick bar over the interval a…b of a line at height y
  //    t (thickness in px), label, below (label under the bar)
  // =====================================================================
  Objs.span = {
    eval(o) {
      const a = S.num(o.a), b = S.num(o.b);
      return { a, b, props: { len: b - a, from: a, to: b } };
    },
    draw(o, g) {
      if (!g || !fin(g.a, g.b)) return;
      const y = num(o.y, 0), t = o.t != null ? o.t : 16, pr = prog(o);
      const [ax, ay] = sc(g.a, y), [bx] = sc(g.b, y);
      const x0 = Math.min(ax, bx), w = Math.abs(bx - ax) * pr, left = bx >= ax ? x0 : x0 + Math.abs(bx - ax) * (1 - pr);
      if (w < 0.5) return;
      const c = R.ctx;
      R.roundRect(c, left, ay - t / 2, w, t, Math.min(6, t / 2));
      if (R.halo) { c.strokeStyle = R.rgba('clay', 0.35); c.lineWidth = 8; c.stroke(); return; }
      c.fillStyle = R.rgba(o.color || 'clay', o.fill != null ? o.fill : 0.5); c.fill();
      c.strokeStyle = R.color(o.color || 'clay'); c.lineWidth = 2; c.setLineDash([]); c.stroke();
      R.hit(o, { k: 'poly', pts: [[left, ay - t / 2], [left + w, ay - t / 2], [left + w, ay + t / 2], [left, ay + t / 2]], fill: true });
    },
    label(o, g) {
      if (!o.label || !g || !fin(g.a, g.b) || prog(o) < 0.6) return;
      const y = num(o.y, 0), t = o.t != null ? o.t : 16;
      if (Math.abs(g.b - g.a) * S.view.s < 4) return;
      const [sx, sy] = sc((g.a + g.b) / 2, y);
      R.text(Expr.interp(o.label, S.env), sx, sy + (o.below ? 1 : -1) * (t / 2 + 16), { size: o.size || 18, font: 'sans', bold: true, color: o.color || 'clay' });
    },
  };
})(window.G = window.G || {});
