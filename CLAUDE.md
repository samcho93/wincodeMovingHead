# Wincode MovingHead Sim

3D digital twin of Wincode moving heads (multi-model). Details: [README.md](README.md).
Structure mirrors `D:\ESP\AuraSim` (Node server + `web/` three.js, no bundler).

## Run / build
- `npm start` → http://127.0.0.1:7740 (Claude preview: `.claude/launch.json` → `movinghead`). `?model=<id>` picks a model. Transmitter: `/console.html`.
- Static build: `npm run build-web` → `dist/` (sets `window.WMH_STATIC`; deployed by `.github/workflows/pages.yml`).
- Server also binds UDP 6454 (Art-Net) and 5568 (sACN).

## Models
- One file per model in `web/js/models/` + one line in `models/index.js` (`LIST`). The contract is documented at the top of `index.js`.
- Current: `lm1012b` (250W BSW, buttons panel, gobos/prism) · `lm500wf` (500W Frame, touch + encoder panel, CMY/CTO/framing blades, scenes, M/S).
  · `tb5` (AquaVortex TB5: 5 heads on a bar, RGBL + pixel rings, 6 channel modes, own menu tree via `panel.menu`).
- Multi-head: `model.heads = N`; `decode()` returns `heads: [targets]` plus the shared top-level fields; channel keys carry the head number as a suffix (`tilt3`). `fx.heads[i]` (class `Head`) owns axes + optics and is what `BeamImage.render()` / `Beam.update()` take; `fx.pan/tilt/o/tint…` are shortcuts to head 1.
- Scanned manuals have no text layer: render pages with PyMuPDF and read the images.
- A new model must come from its manual: put everything the manual does not state into the model's `assumptions` array (shown in the Guide tab).
- Do not add model-specific `if (model.id === …)` branches to the core. Add a field to the definition (`features`, `spec`, `body`, `panel`, `settings`) and read it.
- A new kind of front panel = a new menu class with the same interface as `menu.js` / `menu-touch.js`
  (`canvas`, `key()`, `touch()`, `draw()`, `home()`, `asleep`, `lastKey`, `dirty`, `keyLabels`), selected by `panel.type` in `main.js`.

## Rules
- All user-visible text and all code comments are English.
- Fixture logic stays in the browser (`fixture.js`) so the static build works; the server only bridges UDP / serial.
- One canvas (`BeamImage.out` in `gobos.js`) feeds the projected spot, the volumetric beam and the lens — keep them in sync through it.
- Manufacturer manual PDFs (`docs/*.pdf`) are git-ignored; do not publish them.

## Verifying
- `node tools/dmx-send.js artnet --poll --rdm` (ArtPollReply, TOD, RDM GET) and `… artnet 7=255 6=255` (ArtDmx) against a running server.
- In the page console: `WMH.fx` (state), `WMH.model`, `WMH.menu.key('menu'|'up'|'down'|'enter')`, `WMH.menu.touch(x, y)`, `WMH.dmx.setSource(id)`.
- If the preview pane is in the background its rAF drops to ~1 fps: advance the simulation with `for (…) WMH.fx.update(0.05)` and wait for one frame before a screenshot.

## Pitfalls
- Menu keys are ignored while the fixture is resetting (about 5–9 s after power-up).
- `SpotLight.map` orientation follows the shadow camera's `up`; `beam.js` overrides `shadow.updateMatrices` so the image rotates with the head.
- The volumetric pass reads a depth pre-pass; the lens glass has `depthWrite = false` so it does not cut the beam.
- A program step field must not share a name with a channel key if it holds a function (`runProgram` takes `step[key]` as the channel value first).
- Wheels a model does not have must stay at slot 0 (`fixture.js` forces this) — a leftover fractional position splits the beam.
- Touch-menu hit areas are rebuilt on every draw; a tap right after a state change needs one draw first.
- On one PC only one process receives unicast on UDP 6454 — `dmx-send.js` binds 127.0.0.2 for RDM/poll replies.
