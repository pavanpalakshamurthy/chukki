/* The shower that scalds you: a balancing loop with a delay, as a plain scene definition.
   Ported from the Elements lesson st_delays. This raw object form is what the DSL in
   packages/lang will compile to. */
window.SHOWER = (function () {
  const T = (id, x, y, text, o = {}) => ({ type: 'text', id, x, y, text, size: 14, font: 'sans', color: 'ink', ...o });
  const PRED = { size: 15, bold: true, color: 'fig' };
  return {
    title: 'Delays: the shower that scalds you',
    autoplay: true,
    view: { x: 0, y: 0.4, s: 52 },
    grid: { axes: false, labels: false, type: 'none' },
    params: [
      { name: 'ph', value: 0, min: 0, max: 1, anim: 'loop', speed: 0.1, start: 0 },
      { name: 'tt', value: 0, min: 0, max: 40, step: 0.1 },
      { name: 'D', value: 0.3, min: 0.3, max: 6, step: 0.1 },
      { name: 'g', value: 0.5, min: 0.05, max: 1, step: 0.01 },
    ],
    objects: [
      { type: 'node', id: 'you', x: -6.4, y: 3.3, w: 2.6, h: 1.1, title: 'You', color: 'fig', sub: 'feels {dS.temp:0} °C', glow: 'min(1, abs(38-dS.temp)/12)', glowColor: 'clay' },
      { type: 'node', id: 'knob', x: -6.4, y: 0, w: 2.6, h: 1.1, title: 'Tap setting', color: 'kraft', val: '{dS.K:0} °C' },
      { type: 'node', id: 'head', x: -1.6, y: 3.3, w: 2.6, h: 1.1, title: 'Shower water', color: 'clay', val: '{dS.temp:0} °C' },
      { type: 'flow', id: 'd1', a: [-6.4, 2.75], b: [-6.4, 0.55], color: 'fig', pol: '+', label: 'too cold → turn hotter', labelSide: -1, size: 11.5, rate: '(38-dS.temp)/10' },
      { type: 'flow', kind: 'pipe', id: 'd2', a: [-5.1, 0], b: [-1.6, 2.75], color: 'clay', via: [[-1.6, 0]], rate: 1, pw: 12, delay: true, delayAt: 0.45, delayLabel: 'pipe delay {D:1} s' },
      { type: 'flow', id: 'd3', a: [-2.9, 3.3], b: [-5.1, 3.3], color: 'clay', pol: '+', rate: 0.5, label: 'you feel it', labelSide: 1, size: 11.5 },
      { type: 'loopm', id: 'dB', x: -4.0, y: 1.65, kind: 'B', r: 15, color: 'sky', dir: -1 },
      { type: 'tank', id: 'th', x: -8.1, y: -4.2, w: 0.8, h: 3.0, color: 'clay', level: 'dS.temp/60', mark: '38/60', markLabel: '', ticks: true },
      T('thL', -7.7, -4.65, '{dS.temp:0} °C', { size: 13, bold: true, color: 'clay' }),
      {
        type: 'sim', id: 'dS',
        vars: { K: 15, d1: 15, d2: 15, temp: 15 },
        d: { K: 'g*(38 - temp)', d1: '(K - d1)/(D/3)', d2: '(d1 - d2)/(D/3)', temp: '(d2 - temp)/(D/3)' },
        T: 40, steps: 1000, upto: 'tt', box: [1.3, -3.8, 7.8, 2.0], ymin: 0, ymax: 60, yticks: [0, 20, 40, 60], xticks: [0, 10, 20, 30, 40],
        series: [{ v: 'temp', color: 'clay', label: 'water' }, { v: 'K', color: 'kraft', w: 1.8, dash: [5, 4] }],
        refs: [{ y: 38, color: 'sky', label: 'just right: 38 °C' }, { y: 50, color: 'fig', label: 'ouch!' }], xlabel: 'seconds', ylabel: '°C',
      },
      T('key', 4.4, 2.9, '— water temperature    - - tap setting', { size: 12.5, color: 'gray' }),
      T('pr1', 0, 5.3, 'Predict: the hot water now takes 4 seconds to arrive. You still turn the tap the same way. What happens?', PRED),
      T('pr2', 0, 5.3, 'Predict: to stop the swinging, should you turn the tap FASTER or SLOWER?', PRED),
    ],
    steps: [
      { reveal: ['you', 'knob', 'head', 'd1', 'd2', 'd3', 'dB'], set: { tt: 0, D: 0.3, g: 0.5 }, cap: 'A shower is a balancing loop: you feel the water, turn the tap, the water changes, you feel that. Goal: 38 °C.' },
      { reveal: ['dS', 'key', 'th', 'thL'], set: { tt: 20 }, dur: 4, cap: 'With a short pipe (0.3 s) the water glides up to 38 °C and stops.' },
      { reveal: ['pr1'], cap: 'Predict: the hot water now takes 4 seconds to arrive. What happens?' },
      { hide: ['pr1'], set: { D: 4, tt: 0 }, dur: 0.5, cap: '4-second pipe. Watch the tap (dashed) and the water (solid)…' },
      { set: { tt: 40 }, dur: 8, cap: 'You act on old information: overshoot, undershoot, oscillation. Ouch!' },
      { reveal: ['pr2'], cap: 'Predict: to stop the swinging, turn the tap faster or slower?' },
      { hide: ['pr2'], set: { g: 0.12, tt: 0 }, dur: 0.5, cap: 'Gentle hands: g = 0.12. Replaying…' },
      { set: { tt: 40 }, dur: 8, cap: 'Slower! When feedback is late, react less, not more.' },
    ],
  };
})();
