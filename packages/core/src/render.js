/* Renderer core — camera, palette, adaptive infinite grid, text + path helpers, frame loop body. */
(function (G) {
  'use strict';
  const S = G.S;
  const TAU = Math.PI * 2;

  const SANS = 'Poppins, system-ui, -apple-system, "Segoe UI", sans-serif';
  const SERIF = 'Lora, Georgia, "Times New Roman", serif';

  // Anthropic palette — ivory paper, slate ink, clay / sky / olive / fig accents.
  const PAL = {
    light: { bg: '#faf9f5', ink: '#141413', gray: '#87867f', clay: '#d97757', sky: '#6a9bcc', olive: '#788c5d', fig: '#c46686', kraft: '#c99a6b', heather: '#8f8bb5' },
    dark: { bg: '#1b1a19', ink: '#f0eee6', gray: '#9b9a92', clay: '#e8896a', sky: '#7fb2e3', olive: '#98ad7c', fig: '#dd82a2', kraft: '#dcb08a', heather: '#aaa6d2' },
  };
  const hexCache = {};
  function hexToRgb(h) {
    if (hexCache[h]) return hexCache[h];
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h) || [0, '00', '00', '00'];
    return (hexCache[h] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]);
  }

  const R = (G.R = {
    canvas: null, ctx: null, w: 0, h: 0, dpr: 1,
    theme: 'light', halo: 0, hoverId: null,
    recording: false, caption: '', animCaption: '', overlay: null,
    gridInfo: { major: 1, minor: 0.2, div: 5 },
    SANS, SERIF, TAU, PAL,
  });

  R.color = (name) => (PAL[R.theme][name] || name || PAL[R.theme].ink);
  R.rgb = (name) => hexToRgb(R.color(name));
  R.rgba = (name, a) => {
    const [r, g, b] = hexToRgb(R.color(name));
    return `rgba(${r},${g},${b},${a})`;
  };

  R.init = (canvas) => {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    R.resize();
    window.addEventListener('resize', R.resize);
  };
  R.resize = () => {
    const c = R.canvas;
    R.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
    if (rect && rect.width > 10) {
      R.w = rect.width;
      R.h = rect.height;
    } else {
      // Fallback: compute canvas dimensions from CSS custom properties so we never
      // accidentally use the full viewport width (which squishes content in the split layout).
      const cs = getComputedStyle(document.documentElement);
      const sl = parseFloat(cs.getPropertyValue('--split-left')) || 0;
      const th = parseFloat(cs.getPropertyValue('--topbar-h')) || 0;
      R.w = Math.max(100, window.innerWidth - sl);
      R.h = Math.max(100, window.innerHeight - th);
    }
    R.wrapW = R.w;
    c.width = Math.round(R.w * R.dpr);
    c.height = Math.round(R.h * R.dpr);
    G.invalidate && G.invalidate();
    G.emit && G.emit('resize');
  };

  // ---------- camera ----------
  R.w2s = (x, y) => [(x - S.view.x) * S.view.s + R.w / 2, R.h / 2 - (y - S.view.y) * S.view.s];
  R.s2w = (sx, sy) => [(sx - R.w / 2) / S.view.s + S.view.x, S.view.y - (sy - R.h / 2) / S.view.s];
  R.bounds = () => {
    const [x0, y1] = R.s2w(0, 0), [x1, y0] = R.s2w(R.w, R.h);
    return { x0, x1, y0, y1 };
  };
  R.zoomAt = (sx, sy, factor) => {
    const v = S.view;
    const s = Math.min(1e7, Math.max(1e-5, v.s * factor));
    const f = s / v.s;
    const [wx, wy] = R.s2w(sx, sy);
    v.s = s;
    v.x = wx - (wx - v.x) / f;
    v.y = wy - (wy - v.y) / f;
  };

  // ---------- hit registry ----------
  R.hit = (o, prim) => { (o._hit || (o._hit = [])).push(prim); };

  // ---------- text ----------
  R.text = (str, x, y, opt = {}) => {
    const c = R.ctx;
    const size = opt.size || 16;
    const lh = size * 1.28;
    c.font = `${opt.italic ? 'italic ' : ''}${opt.bold ? '600 ' : '400 '}${size}px ${opt.font === 'sans' ? SANS : SERIF}`;
    // Text keeps its pixel size at every zoom, so on a narrow canvas a long line can be wider than
    // the canvas itself — no camera could show it. Wrap such lines to the REAL canvas width
    // (R.wrapW: unchanged during A.fitCam's off-screen measuring passes, which resize R.w).
    const maxW = Math.max(160, (R.wrapW || R.w) - 56);
    const lines = [];
    String(str).split('\n').forEach((ln) => {
      if (opt.nowrap || c.measureText(ln).width <= maxW || !/\s/.test(ln)) { lines.push(ln); return; }
      let cur = '';
      ln.split(/\s+/).forEach((w) => {
        const t = cur ? cur + ' ' + w : w;
        if (cur && c.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
      });
      if (cur) lines.push(cur);
    });
    c.textAlign = opt.align || 'center';
    c.textBaseline = 'middle';
    const y0 = y - ((lines.length - 1) * lh) / 2;
    let w = 0;
    lines.forEach((l) => { w = Math.max(w, c.measureText(l).width); });
    const h = lines.length * lh;
    const bx = opt.align === 'left' ? x : opt.align === 'right' ? x - w : x - w / 2;
    if (opt.bg) {
      c.fillStyle = R.rgba('bg', 0.92);
      const pad = 6;
      roundRect(c, bx - pad, y - h / 2 - 3, w + pad * 2, h + 6, 8);
      c.fill();
      c.strokeStyle = R.rgba('gray', 0.35);
      c.lineWidth = 1;
      c.stroke();
    }
    lines.forEach((l, i) => {
      if (opt.halo !== false && !opt.bg) {
        c.lineJoin = 'round';
        c.lineWidth = Math.max(3, size / 3.2);
        c.strokeStyle = R.rgba('bg', 0.9);
        c.strokeText(l, x, y0 + i * lh);
      }
      c.fillStyle = R.color(opt.color || 'ink');
      c.fillText(l, x, y0 + i * lh);
    });
    return { x: bx, y: y - h / 2, w, h };
  };

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  R.roundRect = roundRect;

  // Trace a (possibly partial) polyline into the current path.
  R.tracePoly = (pts, closed, prog = 1) => {
    const c = R.ctx;
    c.beginPath();
    if (pts.length < 2) return;
    if (prog >= 0.9999) {
      pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      if (closed) c.closePath();
      return;
    }
    const n = pts.length, segs = closed ? n : n - 1;
    const len = [];
    let total = 0;
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      len.push(l); total += l;
    }
    let left = total * prog;
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (left >= len[i]) { c.lineTo(b[0], b[1]); left -= len[i]; }
      else { const f = len[i] ? left / len[i] : 0; c.lineTo(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f); break; }
    }
  };

  // ---------- adaptive grid ----------
  function niceStep(s, minPx) {
    const raw = minPx / s;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * pow >= raw * 0.999) return { step: m * pow, mant: m === 10 ? 1 : m };
    return { step: 10 * pow, mant: 1 };
  }
  const tickFmt = (v, step) => {
    if (Math.abs(v) < step * 1e-6) return '0';
    if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4)) return v.toExponential(0);
    const d = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    return v.toFixed(d);
  };

  function drawGrid() {
    const c = R.ctx, s = S.view.s, g = S.grid;
    const { step, mant } = niceStep(s, 46);
    const div = mant === 2 ? 4 : 5;
    const minor = step / div;
    R.gridInfo = { major: step, minor, div };
    if (g.type === 'none') { drawAxes(step); return; }

    const { x0, x1, y0, y1 } = R.bounds();
    const minorPx = minor * s;
    const minorA = Math.max(0, Math.min(1, (minorPx - 5) / 14));
    const dark = R.theme === 'dark';
    const majorCol = R.rgba('ink', dark ? 0.2 : 0.16);
    const minorCol = R.rgba('ink', (dark ? 0.09 : 0.075) * minorA);
    c.lineCap = 'butt';
    c.setLineDash([]);

    if (g.type === 'square') {
      const vk0 = Math.floor(x0 / minor), vk1 = Math.ceil(x1 / minor);
      const hk0 = Math.floor(y0 / minor), hk1 = Math.ceil(y1 / minor);
      for (const pass of ['minor', 'major']) {
        if (pass === 'minor' && minorA <= 0) continue;
        c.beginPath();
        for (let k = vk0; k <= vk1; k++) {
          if ((k % div === 0) !== (pass === 'major')) continue;
          const sx = Math.round((k * minor - S.view.x) * s + R.w / 2) + 0.5;
          c.moveTo(sx, 0); c.lineTo(sx, R.h);
        }
        for (let k = hk0; k <= hk1; k++) {
          if ((k % div === 0) !== (pass === 'major')) continue;
          const sy = Math.round(R.h / 2 - (k * minor - S.view.y) * s) + 0.5;
          c.moveTo(0, sy); c.lineTo(R.w, sy);
        }
        c.lineWidth = 1;
        c.strokeStyle = pass === 'major' ? majorCol : minorCol;
        c.stroke();
      }
    } else if (g.type === 'dots') {
      const use = minorA > 0.35 ? minor : step;
      const k0 = Math.floor(x0 / use), k1 = Math.ceil(x1 / use), j0 = Math.floor(y0 / use), j1 = Math.ceil(y1 / use);
      c.fillStyle = R.rgba('ink', dark ? 0.32 : 0.3);
      c.beginPath();
      const every = use === minor ? div : 1;
      for (let i = k0; i <= k1; i++) for (let j = j0; j <= j1; j++) {
        const [sx, sy] = R.w2s(i * use, j * use);
        const r = i % every === 0 && j % every === 0 ? 1.9 : 1.1;
        c.moveTo(sx + r, sy);
        c.arc(sx, sy, r, 0, TAU);
      }
      c.fill();
    } else if (g.type === 'polar') {
      const minorA = Math.max(0, Math.min(1, (minorPx - 10) / 16));
      const minorCol = R.rgba('ink', (dark ? 0.09 : 0.075) * minorA);
      const [ox, oy] = R.w2s(0, 0);
      const far = Math.hypot(Math.max(Math.abs(x0), Math.abs(x1)), Math.max(Math.abs(y0), Math.abs(y1)));
      for (const pass of ['minor', 'major']) {
        if (pass === 'minor' && minorA <= 0) continue;
        const stp = pass === 'major' ? step : minor;
        c.beginPath();
        const kmax = Math.min(400, Math.ceil(far / stp));
        for (let k = 1; k <= kmax; k++) {
          if (pass === 'minor' && (k % div === 0)) continue;
          c.moveTo(ox + k * stp * s, oy);
          c.arc(ox, oy, k * stp * s, 0, TAU);
        }
        c.lineWidth = 1;
        c.strokeStyle = pass === 'major' ? majorCol : minorCol;
        c.stroke();
      }
      c.beginPath();
      const L = far * s * 1.5;
      for (let a = 0; a < 360; a += 15) {
        const r = (a * Math.PI) / 180;
        c.moveTo(ox, oy);
        c.lineTo(ox + Math.cos(r) * L, oy - Math.sin(r) * L);
      }
      c.strokeStyle = R.rgba('ink', dark ? 0.12 : 0.09);
      c.lineWidth = 1;
      c.stroke();
    } else if (g.type === 'iso') {
      const side = minorA > 0.5 ? minor * (div === 4 ? 2 : 1) : step;
      const hgt = (side * Math.sqrt(3)) / 2;
      const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
      const L = Math.hypot(x1 - x0, y1 - y0) * 1.2;
      c.beginPath();
      for (const th of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        const dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
        const proj = corners.map(([x, y]) => x * nx + y * ny);
        const k0 = Math.floor(Math.min(...proj) / hgt), k1 = Math.ceil(Math.max(...proj) / hgt);
        if (k1 - k0 > 900) continue;
        for (let k = k0; k <= k1; k++) {
          const px = nx * k * hgt, py = ny * k * hgt;
          const [ax, ay] = R.w2s(px - dx * L, py - dy * L), [bx, by] = R.w2s(px + dx * L, py + dy * L);
          c.moveTo(ax, ay); c.lineTo(bx, by);
        }
      }
      c.lineWidth = 1;
      c.strokeStyle = R.rgba('ink', dark ? 0.16 : 0.13);
      c.stroke();
    }
    drawAxes(step);
  }

  function drawAxes(step) {
    const c = R.ctx, g = S.grid;
    if (!g.axes) return;
    const [ox, oy] = R.w2s(0, 0);
    c.setLineDash([]);
    c.lineWidth = 1.6;
    c.strokeStyle = R.rgba('ink', R.theme === 'dark' ? 0.6 : 0.55);
    c.beginPath();
    if (oy > -2 && oy < R.h + 2) { c.moveTo(0, oy); c.lineTo(R.w, oy); }
    if (ox > -2 && ox < R.w + 2) { c.moveTo(ox, 0); c.lineTo(ox, R.h); }
    c.stroke();
    if (!g.labels) return;
    const { x0, x1, y0, y1 } = R.bounds();
    const font = { size: 11, font: 'sans', color: 'gray', align: 'center' };
    const ly = Math.min(R.h - 12, Math.max(14, oy + 13));
    const lx = Math.min(R.w - 8, Math.max(24, ox - 7));
    for (let k = Math.ceil(x0 / step); k <= Math.floor(x1 / step); k++) {
      if (k === 0) continue;
      const [sx] = R.w2s(k * step, 0);
      R.text(tickFmt(k * step, step), sx, ly, font);
    }
    for (let k = Math.ceil(y0 / step); k <= Math.floor(y1 / step); k++) {
      if (k === 0) continue;
      const [, sy] = R.w2s(0, k * step);
      R.text(tickFmt(k * step, step), lx, sy, Object.assign({}, font, { align: 'right' }));
    }
    if (ox > 0 && ox < R.w && oy > 0 && oy < R.h) R.text('0', ox - 7, oy + 13, Object.assign({}, font, { align: 'right' }));
  }

  // ---------- frame ----------
  R.frame = () => {
    const c = R.ctx;
    c.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    c.globalAlpha = 1;
    // R.measuring: an off-screen pass used by A.fitCam() to find where content is drawn —
    // transparent background, no grid, no captions/overlays, so every opaque pixel is content.
    if (R.measuring) c.clearRect(0, 0, R.w, R.h);
    else { c.fillStyle = R.color('bg'); c.fillRect(0, 0, R.w, R.h); }
    if (S.mode === '3d') { G.T3.frame(); const _cap3 = R.animCaption || (R.recording ? R.caption : ''); if (_cap3) drawCaptionBar(c, _cap3); return; }
    if (!R.measuring) drawGrid();

    const sel = R.measuring ? new Set() : S.sel;
    const objs = S.objects;
    objs.forEach((o) => { o._hit = null; });
    const shape = (o) => o.type !== 'point' && o.type !== 'text' && !G.is3(o);

    const paint = (o, part) => {
      const h = G.Objs[o.type];
      if (!h) return;
      const a = o.show == null ? 1 : o.show;
      if (a < 0.01) return;
      c.save();
      c.globalAlpha = Math.min(1, a);
      const g = S.geom(o);
      if (part === 'draw') {
        if (sel.has(o.id)) { R.halo = 1; h.draw && h.draw(o, g); R.halo = 0; }
        else if (R.hoverId === o.id && !R.measuring) { R.halo = 2; h.draw && h.draw(o, g); R.halo = 0; }
        h.draw && h.draw(o, g);
      } else if (h.label) h.label(o, g);
      c.restore();
    };
    for (const o of objs) if (shape(o)) paint(o, 'draw');
    for (const o of objs) if (o.type === 'point') paint(o, 'draw');
    for (const o of objs) if (!G.is3(o)) paint(o, 'label');
    for (const o of objs) if (o.type === 'text') paint(o, 'draw');

    if (R.measuring) return;
    if (R.overlay) R.overlay(c);
    const _cap = R.animCaption || (R.recording ? R.caption : '');
    if (_cap) drawCaptionBar(c, _cap);
  };

  function drawCaptionBar(c, text) {
    c.save();
    c.font = `500 20px ${SERIF}`;
    const maxW = Math.min(R.w - 60, 820);
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach((w) => {
      const t = cur ? cur + ' ' + w : w;
      if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    const lh = 28, bw = Math.min(maxW, Math.max(...lines.map((l) => c.measureText(l).width))) + 44, bh = lines.length * lh + 26;
    const bx = (R.w - bw) / 2, by = R.h - bh - 28;
    c.fillStyle = R.rgba('bg', 0.94);
    roundRect(c, bx, by, bw, bh, 16);
    c.fill();
    c.strokeStyle = R.rgba('gray', 0.4);
    c.stroke();
    c.fillStyle = R.color('ink');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach((l, i) => c.fillText(l, R.w / 2, by + 13 + lh / 2 + i * lh));
    c.restore();
  }
})(window.G = window.G || {});
