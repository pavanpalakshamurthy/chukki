/* Expression engine — tiny, safe math parser.
   Lets every number in the app be a live formula:  "cos(a)*2",  "A.x + 1",  "dist(A,B)/2",  "2x^2".
   Compiles to closures; identifiers resolve through an `env` ({vars, ref, prop}). */
(function (G) {
  'use strict';

  const CONST = { pi: Math.PI, 'π': Math.PI, tau: Math.PI * 2, e: Math.E, inf: Infinity, phi: (1 + Math.sqrt(5)) / 2 };

  const fact = (n) => { n = Math.round(n); if (n < 0 || n > 170) return NaN; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

  // angle at vertex B between rays B→A and B→C, in radians, 0..π
  const angleAt = (a, b, c) => {
    const ux = a.x - b.x, uy = a.y - b.y, uz = (a.z || 0) - (b.z || 0), vx = c.x - b.x, vy = c.y - b.y, vz = (c.z || 0) - (b.z || 0);
    const d = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
    if (!d) return NaN;
    return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / d)));
  };
  const polyArea = (...p) => {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  };

  const FN = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, log2: Math.log2,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, trunc: Math.trunc,
    min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot,
    mod: (a, b) => ((a % b) + b) % b,
    deg: (a) => a * 180 / Math.PI, rad: (a) => a * Math.PI / 180,
    clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
    lerp: (a, b, t) => a + (b - a) * t,
    fract: (x) => x - Math.floor(x),
    step: (x) => (x >= 0 ? 1 : 0),
    // standard normal CDF (Abramowitz–Stegun 7.1.26, error < 1.5e-7)
    ncdf: (x) => { const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z), y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y); },
    smooth, fact,
    if: (c, a, b) => (c ? a : b),
    rand: (n) => { const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); },
    gauss: (n) => { const r = (m) => { const v = Math.sin(m * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); }; return Math.sqrt(-2 * Math.log(Math.max(1e-9, r(2 * n + 1)))) * Math.cos(2 * Math.PI * r(2 * n + 2)); },
    choose: (n, k) => { n = Math.round(n); k = Math.round(k); if (k < 0 || k > n || n > 1000) return 0; k = Math.min(k, n - k); let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; },
    gcd: (a, b) => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) [a, b] = [b, a % b]; return a; },
    lcm: (a, b) => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); let x = a, y = b; while (y) [x, y] = [y, x % y]; return x ? (a / x) * b : 0; },
    med: (...v) => { const a = v.filter(Number.isFinite).sort((x, y) => x - y), n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : NaN; },
    pick: (i, ...v) => { const k = Math.round(i) - 1; return k >= 0 && k < v.length ? v[k] : NaN; },
    isprime: (n) => { n = Math.round(n); if (n < 2) return 0; for (let i = 2; i * i <= n; i++) if (n % i === 0) return 0; return 1; },
    rotx: (x, y, cx, cy, a) => cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
    roty: (x, y, cx, cy, a) => cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
    dist: (p, q) => Math.hypot(p.x - q.x, p.y - q.y, (p.z || 0) - (q.z || 0)),
    angle: angleAt,
    area: polyArea,
  };

  // ---------- tokenizer ----------
  const isL = (ch) => ch !== undefined && /[\p{L}_]/u.test(ch);
  const isD = (ch) => ch !== undefined && ch >= '0' && ch <= '9';

  function tokenize(src) {
    src = src.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (isD(ch) || (ch === '.' && isD(src[i + 1]))) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        toks.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (isL(ch)) {
        let j = i + 1;
        while (j < n && (isL(src[j]) || isD(src[j]))) j++;
        const name = src.slice(i, j);
        let prop = null;
        if (src[j] === '.' && isL(src[j + 1])) {
          let k = j + 1;
          while (k < n && (isL(src[k]) || isD(src[k]))) k++;
          prop = src.slice(j + 1, k);
          j = k;
        }
        toks.push({ t: 'id', v: name, prop });
        i = j;
        continue;
      }
      const two = src.substr(i, 2);
      if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/^%(),<>!'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
      throw new SyntaxError(`Unexpected "${ch}"`);
    }
    return toks;
  }

  // ---------- parser (precedence climbing) ----------
  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
    const eat = (v) => { if (!isOp(v)) throw new SyntaxError(`Expected "${v}"`); p++; };

    function parseOr() {
      let l = parseAnd();
      while (isOp('||')) { p++; l = { t: 'bin', op: '||', l, r: parseAnd() }; }
      return l;
    }
    function parseAnd() {
      let l = parseCmp();
      while (isOp('&&')) { p++; l = { t: 'bin', op: '&&', l, r: parseCmp() }; }
      return l;
    }
    function parseCmp() {
      let l = parseAdd();
      while (peek() && peek().t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) {
        const op = toks[p++].v;
        l = { t: 'bin', op, l, r: parseAdd() };
      }
      return l;
    }
    function parseAdd() {
      let l = parseTerm();
      while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = { t: 'bin', op, l, r: parseTerm() }; }
      return l;
    }
    function startsFactor() {
      const k = peek();
      return k && (k.t === 'num' || k.t === 'id' || (k.t === 'op' && k.v === '('));
    }
    function parseTerm() {
      let l = parseUnary();
      for (;;) {
        if (isOp('*') || isOp('/') || isOp('%')) { const op = toks[p++].v; l = { t: 'bin', op, l, r: parseUnary() }; }
        else if (startsFactor()) l = { t: 'bin', op: '*', l, r: parseUnary() }; // implicit multiplication: 2x, 3(a+b)
        else break;
      }
      return l;
    }
    function parseUnary() {
      if (isOp('-')) { p++; return { t: 'neg', v: parseUnary() }; }
      if (isOp('+')) { p++; return parseUnary(); }
      if (isOp('!')) { p++; return { t: 'not', v: parseUnary() }; }
      return parsePower();
    }
    function parsePower() {
      const base = parsePrimary();
      if (isOp('^')) { p++; return { t: 'bin', op: '^', l: base, r: parseUnary() }; }
      return base;
    }
    function parsePrimary() {
      const k = toks[p];
      if (!k) throw new SyntaxError('Unexpected end');
      if (k.t === 'num') { p++; return { t: 'num', v: k.v }; }
      if (k.t === 'id') {
        p++;
        if (k.prop) return { t: 'prop', name: k.v, prop: k.prop };
        if ((k.v === 'sum' || k.v === 'prod') && isOp('(')) {
          // sum(k, from, to, expr) / prod(k, from, to, expr) — k is a local index variable
          p++;
          const v = toks[p];
          if (!v || v.t !== 'id') throw new SyntaxError(`${k.v}(k, from, to, expr)`);
          p++; eat(',');
          const from = parseOr(); eat(',');
          const to = parseOr(); eat(',');
          const body = parseOr(); eat(')');
          return { t: 'sum', name: v.v, prod: k.v === 'prod', from, to, body };
        }
        if (isOp('(') && Object.prototype.hasOwnProperty.call(FN, k.v)) {
          p++;
          const args = [];
          if (!isOp(')')) { args.push(parseOr()); while (isOp(',')) { p++; args.push(parseOr()); } }
          eat(')');
          return { t: 'call', fn: k.v, args };
        }
        return { t: 'var', name: k.v };
      }
      if (isOp('(')) { p++; const e = parseOr(); eat(')'); return e; }
      throw new SyntaxError(`Unexpected "${k.v}"`);
    }

    if (!toks.length) throw new SyntaxError('Empty');
    const ast = parseOr();
    if (p < toks.length) throw new SyntaxError(`Unexpected "${toks[p].v}"`);
    return ast;
  }

  // ---------- compiler ----------
  function build(n) {
    switch (n.t) {
      case 'num': { const v = n.v; return () => v; }
      case 'var': {
        const nm = n.name;
        if (Object.prototype.hasOwnProperty.call(CONST, nm)) { const v = CONST[nm]; return () => v; }
        return (env) => { const v = env.vars[nm]; return v !== undefined ? v : env.ref(nm); };
      }
      case 'prop': return (env) => env.prop(n.name, n.prop);
      case 'neg': { const f = build(n.v); return (env) => -f(env); }
      case 'not': { const f = build(n.v); return (env) => (f(env) ? 0 : 1); }
      case 'sum': {
        const lo = build(n.from), hi = build(n.to), body = build(n.body), nm = n.name, prod = n.prod;
        return (env) => {
          const a = Math.round(lo(env)), z = Math.round(hi(env));
          if (!Number.isFinite(a) || !Number.isFinite(z) || z - a > 20000) return NaN;
          const had = Object.prototype.hasOwnProperty.call(env.vars, nm), old = env.vars[nm];
          let acc = prod ? 1 : 0;
          for (let k = a; k <= z; k++) { env.vars[nm] = k; acc = prod ? acc * body(env) : acc + body(env); }
          if (had) env.vars[nm] = old; else delete env.vars[nm];
          return acc;
        };
      }
      case 'call': {
        const fn = FN[n.fn];
        const a = n.args.map(build);
        if (a.length === 1) { const a0 = a[0]; return (env) => fn(a0(env)); }
        if (a.length === 2) { const [a0, a1] = a; return (env) => fn(a0(env), a1(env)); }
        return (env) => fn(...a.map((f) => f(env)));
      }
      case 'bin': {
        const l = build(n.l), r = build(n.r);
        switch (n.op) {
          case '+': return (e) => l(e) + r(e);
          case '-': return (e) => l(e) - r(e);
          case '*': return (e) => l(e) * r(e);
          case '/': return (e) => l(e) / r(e);
          case '%': return (e) => { const b = r(e); return ((l(e) % b) + b) % b; };
          case '^': return (e) => Math.pow(l(e), r(e));
          case '<': return (e) => (l(e) < r(e) ? 1 : 0);
          case '>': return (e) => (l(e) > r(e) ? 1 : 0);
          case '<=': return (e) => (l(e) <= r(e) ? 1 : 0);
          case '>=': return (e) => (l(e) >= r(e) ? 1 : 0);
          case '==': return (e) => (Math.abs(l(e) - r(e)) < 1e-9 ? 1 : 0);
          case '!=': return (e) => (Math.abs(l(e) - r(e)) < 1e-9 ? 0 : 1);
          case '&&': return (e) => (l(e) && r(e) ? 1 : 0);
          case '||': return (e) => (l(e) || r(e) ? 1 : 0);
        }
      }
    }
    throw new Error('bad node');
  }

  const cache = new Map();
  const BAD = () => NaN;

  function compile(src) {
    let f = cache.get(src);
    if (f) return f;
    try { f = build(parse(src)); f.err = null; }
    catch (e) { f = () => NaN; f.err = e.message || String(e); }
    if (cache.size > 4000) cache.clear();
    cache.set(src, f);
    return f;
  }

  // Number or expression string → number.
  function num(v, env) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return compile(v)(env);
    return NaN;
  }

  const check = (src) => (typeof src === 'string' ? compile(src).err : null);

  function fmt(x, d = 2) {
    if (typeof x !== 'number' || !isFinite(x)) return '?';
    const s = x.toFixed(d);
    let out = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
    if (out === '-0') out = '0';
    return out;
  }

  // "Angle = {deg(a):1}°"  →  "Angle = 47.3°"
  function interp(str, env) {
    return String(str).replace(/\{([^{}]+)\}/g, (_, body) => {
      let d = 2, src = body, signed = false;
      const m = /^(.*):(\+?)(\d)$/.exec(body);
      if (m) { src = m[1]; signed = m[2] === '+'; d = +m[3]; }
      let f;
      try { f = compile(src); } catch (e) { return '{' + body + '}'; } // not a formula: leave the text as written
      const v = f(env);
      // {x:+1} → "+ 3" or "− 3", so "y = 2x {b:+1}" never reads "+ −3"
      if (signed && typeof v === 'number' && isFinite(v)) return (v < -1e-12 && fmt(-v, d) !== '0' ? '− ' : '+ ') + fmt(Math.abs(v), d);
      return fmt(v, d);
    });
  }

  G.Expr = { compile, num, check, fmt, interp, FN, CONST, BAD };
})(window.G = window.G || {});
