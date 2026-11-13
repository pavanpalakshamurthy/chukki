# Chukki

*ಚುಕ್ಕಿ: the dots a rangoli grows from.* Dots are joined into lines, lines into figures, and the figures move.

Chukki is a small drawing language and animation engine for **live diagrams**: flowcharts, system-design diagrams, feedback loops, circuits, number lines and geometry. Its vocabulary is designed to be written by **people and by AI agents** (including small models running locally).

```
npm start          # → http://localhost:8020/  (the shower-delay demo)
```

No build step and no dependencies. It's plain JavaScript on an HTML5 canvas.

## Layout

| Path | What it is |
|---|---|
| `packages/core/src` | Engine: formulas (`expr`), scene state (`scene`), camera and renderer (`render`), 2D primitives (`objects`), step compiler (`lesson_kit`), 3D (`three`), animation and auto-fit (`anim`), pointer/keyboard (`interact`), public API (`boot`) |
| `packages/kit-systems` | Nodes, causal links with pulses, loop markers, tanks, a stock-and-flow simulator, boids, networks |
| `packages/kit-circuits` | Wires with drifting electrons, component symbols, logic gates, timing diagrams |
| `packages/kit-plots` | Heat maps, vector fields, dot and bar charts, fractals, tilings |
| `packages/kit-numline` | Number lines, hops, spans |
| `examples/` | Demo pages; later also the evaluation set for the local model |

**Script order matters** (each file may only use what earlier files exposed):
`expr → scene → render → objects → kits… → lesson_kit → three → anim → interact → boot`

## API (for now)

```js
Chukki.mount(canvas, { theme: 'dark' });
Chukki.play({ title, view, params, objects, steps });   // see examples/shower.js
Chukki.next(); Chukki.prev(); Chukki.go(3);
Chukki.on('step', () => console.log(Chukki.caption()));
```

A scene is plain data: **objects** (every number can be a formula), **params** (sliders, which can animate), and **steps**. Each step is a delta (`reveal`, `hide`, `set`, `move`, `cam`) plus a caption. Every step's camera is fitted automatically to the canvas by measuring what is actually drawn.

## Roadmap

1. **`lang`**: a line-oriented DSL that compiles to scene data. It's forgiving (a bad line is dropped and the rest still renders), has aliases, and describes relations rather than coordinates, with layout done by the engine.
2. **Eval harness**: about 30 prompts per kit, run against a local model (Ollama) to measure parse rate, dropped lines, and whether the result renders cleanly.
3. **Instance API**: several scenes per page (today there is one global scene per page).
4. **`<chukki-scene>`**: a web component for embedding a scene in any page.
5. **MCP server**: lets agents draw. A `draw` tool returns a rendered image plus line-level errors, so an agent can check and fix its own diagram.
6. **New kits**: flowcharts and system design.

## Origin

The engine was extracted from **Elements**, an animated geometry canvas for teaching (from commit `821e849` plus the uncommitted step auto-fit work). Elements will switch over to using Chukki once the instance API exists.
