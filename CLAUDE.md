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
  · `apexpointe420` (420W hybrid, 39CH, touch panel; from its manual "LED480 POINTE BSW"; two prism wheels, continuous pan).
  · `mega480` (480W BSW, 34/39CH, touch panel; written by the Add-model agent from its manual).
  · `tb5` (AquaVortex TB5: 5 heads on a bar, RGBL + pixel rings, 6 channel modes, own menu tree via `panel.menu`).
- Multi-head: `model.heads = N`; `decode()` returns `heads: [targets]` plus the shared top-level fields; channel keys carry the head number as a suffix (`tilt3`). `fx.heads[i]` (class `Head`) owns axes + optics and is what `BeamImage.render()` / `Beam.update()` take; `fx.pan/tilt/o/tint…` are shortcuts to head 1.
- Scanned manuals have no text layer: render pages with PyMuPDF and read the images.
- A new model must come from its manual: put everything the manual does not state into the model's `assumptions` array (shown in the Guide tab).
- Body shape (`machine.js`) is data too: `yoke` (one-piece U yoke), `head` loft sections (rounded boxes and circles; repeat a `y` for a step), `rings`, `ribs`, `vents`, `hood`, `sink`, `logo` (lettering on arms and head badge), `base.handle`, `controls` (`cross5` / `col4` / `encoder`), `color`. Shape a new model from its manual drawing and product photos with these.
- Do not add model-specific `if (model.id === …)` branches to the core. Add a field to the definition (`features`, `spec`, `body`, `panel`, `settings`) and read it.
- A new kind of front panel = a new menu class with the same interface as `menu.js` / `menu-touch.js`
  (`canvas`, `key()`, `touch()`, `draw()`, `home()`, `asleep`, `lastKey`, `dirty`, `keyLabels`), selected by `panel.type` in `main.js`.

## DMX editor (`web/editor.html`, `web/js/editor/`)
- Follows QLC+: Fixtures → Functions (scene, chaser, efx, collection, audio) → Shows (timeline) → Virtual Console → Simple Desk → Inputs/Outputs. Keep that vocabulary and order.
- `store.js` workspace (JSON, autosave, audio blobs in IndexedDB) · `engine.js` runners + HTP/LTP merge, ticked by a worker timer at 40 Hz · `library.js` fixture definitions built from `models/*.js` + generics · one view module per tab.
- Views render with `fill(el, …)` (skips null children). Debug: `WMX.engine`, `WMX.store`, `WMX.views`.
- Output: virtual cable message `{ t:'dmx', u, data }` (the simulator filters on its cable universe) or ws binary type 3 (per-universe host) → Art-Net / sACN.

## Wincode DMX Studio (separate project)
- `D:\Work\Web\wincodeDmxStudio` / https://github.com/samcho93/wincodeDmxStudio — a stand-alone lighting console. The built-in DMX editor above stays as it is.
- It drives this simulator over the Virtual DMX cable, which needs one origin: next to this site on GitHub Pages, and locally `server/index.js` serves its `web/` under `/studio/`. The `🎚 DMX Studio` links (`#lnkStudio`) point there.
- Shared contract: `BroadcastChannel('wmh-dmx')` message `{ t:'dmx', u, data }`, the stage file format and `localStorage['wmh.stage.v1']` (the studio hands its patch to the stage through it). Its fixture profiles are generated from `web/js/models/*.js` (`npm run import-wincode` there) — regenerate after a model changes.

## Stage editor (`web/stage.html`, `web/js/stage/`)
- Several fixtures on one stage: each is a `Fixture` created with `{ persist: false, settings }` (no localStorage), its own machine and one `Beam` per head. Stage file = `{ app: 'wmh-stage', fixtures: [layout], workspace }`; layout ids = workspace fixture ids.
- Plays the workspace's first show with the editor's `Engine` inside the page (`store.persist = false` so the editor's autosave slot is never touched; hand-over is explicit via `store.handOver` / `store.peekSaved`). Engine clock = worker timer; fixtures and rendering = rAF. When nothing plays, fixtures follow the virtual cable.
- Examples are code (`stage/examples.js`), keyed by channel names — never store channel indexes by hand. A model without a hand-written section (not in `WRITTEN`) gets one generated from its `program` steps, in the showcase and as its own example — so a model added by the agent shows up on the stage by itself. `arrange(file, count, style)` multiplies a single-model example (Units + style in the top bar): per-unit copies of every function and track; EFX `phase` (degrees) is the per-unit offset used by the Wave style. Music: `stage/beat.js`.
- Budget: `MAX_PROJECTED` spot lights (texture units), `MAX_SHADOWS`. Debug: `WST.items`, `WST.engine`, `WST.simulate(dt, now, time)`.
- Do not put per-frame scratch state on a `Beam` under `_v`, `_m`, `_w`, `_d` — those are its own vectors.

## Add-model agent (development only)
- Entry (`web/js/agent-entry.js`, installed by all three pages): Ctrl + double-click the logo area or Ctrl + Alt + M. It asks `/api/agent/info` once at start so `window.open` runs inside the click (opening after an `await` gets pop-up blocked), and shows a toast when the agent is unavailable.
- Ctrl + double-click the logo → `web/agent.html` + `web/js/agent.js` → `server/agent.js` spawns `claude -p --output-format stream-json` with `tools/agent-prompt.md`; `tools/check-model.mjs` validates; discard = undo only the files the job touched; publish (button, after the validator passed) = commit only those files and push the current branch, which starts the Pages deployment.
- Must stay out of distribution: `tools/build-web.js` skips the agent files, `--dist` / `WMH_DIST=1` disables the API. Do not weaken the loopback / origin check.
- When the model contract changes, update `models/index.js` (header), `tools/check-model.mjs` and `tools/agent-prompt.md` together.

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
- Prisms: `decode()` returns `prism: true` (3-facet) or a shape `{ id, rings, line, scale, colors }`; only one prism is drawn at a time. `prismIndex` (deg) indexes it, `panSpin` (deg/s) is continuous pan.
- Wheels a model does not have must stay at slot 0 (`fixture.js` forces this) — a leftover fractional position splits the beam.
- Touch-menu hit areas are rebuilt on every draw; a tap right after a state change needs one draw first.
- On one PC only one process receives unicast on UDP 6454 — `dmx-send.js` binds 127.0.0.2 for RDM/poll replies.
