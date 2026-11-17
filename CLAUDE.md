# Wincode MovingHead Sim

3D digital twin of the Wincode WOP-LM1012B 250W BSW moving head. Details: [README.md](README.md).
Structure mirrors `D:\ESP\AuraSim` (Node server + `web/` three.js, no bundler).

## Run / build
- `npm start` → http://127.0.0.1:7740 (Claude preview: `.claude/launch.json` → `movinghead`). Transmitter: `/console.html`.
- Static build: `npm run build-web` → `dist/` (sets `window.WMH_STATIC`; deployed by `.github/workflows/pages.yml`).
- Server also binds UDP 6454 (Art-Net) and 5568 (sACN).

## Rules
- All user-visible text is English.
- The DMX behaviour must follow the manual's channel chart — it lives in `web/js/personality.js` only
  (`decode()` for behaviour, `describe()` for labels). Anything the manual does not state goes in README "Assumptions".
- Fixture logic stays in the browser (`fixture.js`) so the static build works; the server only bridges UDP / serial.
- One canvas (`BeamImage.out` in `gobos.js`) feeds the projected spot, the volumetric beam and the lens — keep them in sync through it.
- `docs/*.pdf` (manufacturer manual) is git-ignored; do not publish it.

## Verifying
- `node tools/dmx-send.js artnet --poll --rdm` (ArtPollReply, TOD, RDM GET) and `… artnet 7=255 6=255` (ArtDmx) against a running server.
- In the page console, `WMH.fx` (state), `WMH.menu.key('menu'|'up'|'down'|'enter')`, `WMH.dmx.setSource(id)`.

## Pitfalls
- Menu keys are ignored while the fixture is resetting (about 5–9 s after power-up).
- `SpotLight.map` orientation follows the shadow camera's `up`; `beam.js` overrides `shadow.updateMatrices` so the image rotates with the head.
- The volumetric pass reads a depth pre-pass; the lens glass has `depthWrite = false` so it does not cut the beam.
- On one PC only one process receives unicast on UDP 6454 — `dmx-send.js` binds 127.0.0.2 for RDM/poll replies.
