/* Chukki boot — the frame loop and a small public API for hosting a scene on any page.
   Load last, after core/src/* and any kits:
     expr → scene → render → objects → [kits] → lesson_kit → three → anim → interact → boot

     Chukki.mount(canvas, { theme })   start the engine on a <canvas>
     Chukki.play(def, { autoplay })    load a scene definition ({ title, view, params, objects, steps })
     Chukki.next() / prev() / go(i)    step through it
     Chukki.setTheme('light'|'dark')

   The engine is still a single global scene per page (G.S, G.R); an instance-based API
   (several scenes per page) is the next refactor — see README. */
(function (G) {
  'use strict';
  const S = G.S, R = G.R, A = G.A;
  let dirty = true, last = 0, mounted = false;

  G.invalidate = () => { dirty = true; };
  G.render = () => { S.bump(); R.frame(); };

  function loop(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    const animating = A.tick(dt);
    if (dirty || animating) { dirty = false; S.bump(); R.frame(); }
    requestAnimationFrame(loop);
  }

  const Chukki = (window.Chukki = {
    version: '0.0.1',
    mount(canvas, opts = {}) {
      if (mounted) throw new Error('Chukki: one scene per page for now');
      mounted = true;
      R.init(canvas);
      if (G.I && G.I.init) G.I.init(canvas);
      Chukki.setTheme(opts.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
      if (window.ResizeObserver) new ResizeObserver(() => R.resize()).observe(canvas);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(G.invalidate);
      requestAnimationFrame(loop);
      return Chukki;
    },
    setTheme(theme) { R.theme = theme === 'dark' ? 'dark' : 'light'; G.invalidate(); },
    play(def, opts = {}) {
      const built = G.Lessons.build(def);
      S.load(built);
      A.P.idx = 0; A.P.phase = 'idle'; A.P.auto = false;
      S.clock.playing = opts.autoplay != null ? !!opts.autoplay : !!def.autoplay;
      if (S.steps.length) A.applyStep(0);
      S.resetHistory();
      G.emit('scene'); G.emit('step'); G.invalidate();
      return Chukki;
    },
    next() { A.next(); },
    prev() { A.prev(); },
    go(i) { A.goto(i); },
    step() { return A.currentStep(); },
    steps() { return S.steps.length; },
    caption(level = 's') { return A.captionOf(S.steps[A.currentStep()], level); },
    on: G.on,
  });
})(window.G = window.G || {});
