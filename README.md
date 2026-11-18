# Wincode MovingHead Sim — 3D digital twin of Wincode moving heads

A web-based 3D simulator of Wincode moving head fixtures. Each model is built from its user manual: the body,
the panel (LCD menu, buttons / touch / encoder) and the DMX channel chart — colour wheel, CMY, gobos, framing
blades, prism, zoom, focus, frost, strobe, pan/tilt — with a volumetric beam, a projected spot and shadows.

It also **receives real DMX**: Art-Net, sACN (E1.31), USB-DMX and RDM, so an external console or
transmitter can drive it.

**Web version:** https://samcho93.github.io/wincodeMovingHead/

**Easiest local start: double-click `start_movinghead.bat`** (installs dependencies, starts the server, opens the browser).

```
npm install      # once (three, ws, serialport)
npm start        # http://127.0.0.1:7740
```

| URL | |
|---|---|
| `http://127.0.0.1:7740/` | 3D simulator (`?model=<id>` opens a specific model) |
| `http://127.0.0.1:7740/console.html` | slider-type DMX512 test transmitter |
| `http://127.0.0.1:7740/stage.html` | stage editor: several fixtures of any model on one 3D stage, example shows |
| `http://127.0.0.1:7740/editor.html` | DMX editor: patch, scenes, chasers, EFX, timeline shows with music, virtual console |

## Models

Pick the model with the selector at the top left (the page reloads with that fixture; settings are kept per model).

| id | Model | Channels | Panel | Features |
|---|---|---|---|---|
| `lm1012b` | **WOP-LM1012B** 250W LED 3-in-1 Beam/Spot/Wash | 17CH (STD) / 20CH (EXT) | colour LCD + buttons | colour wheel, static + rotating gobo wheels, 3-facet prism, zoom 6–26°, frost |
| `lm500wf` | **WOP-LM500WF** 500W LED Framing Moving Head Wash | 26CH | touch LCD + rotary encoder | colour wheel, linear CMY, CTO, 4 framing blades (8 channels) + rotation, zoom 6–48°, frost, 10 editable scenes, master/slave selection |
| `apexpointe420` | **ApexPointe 420** 420W LED beam / spot / wash hybrid | 39CH | display + buttons (assumed) | zoom 3.2–42.6°, continuous pan rotation, 13-colour wheel + CMY + CTO, 66 virtual colour presets, 7 static gobos + 4 beam reducers, 9 rotating gobos, two prism wheels (18-facet circular, 6-facet linear, multicoloured linear, 8-facet circular), light / medium frost. **No Wincode manual exists**: the channel chart is that of the Robe LEDPointe, which the product page names as library-compatible — see the Guide tab for every assumption |
| `tb5` | **WOP-AVortex TB5** AquaVortex TB5 IP65 multi-head, 5 × 120W RGBL | 21 / 41 / 71 / 75 / 85 / 170CH | display + buttons | five heads on a bar, each with pan 59° / tilt 221°, zoom 4–32°, RGBL colour mixing and an 8-block RGB pixel ring; LEE colour presets, CTO, ring macros, function channel |

Channel charts, panel operation and the assumptions made for each model are shown in the **Guide** tab of the simulator.

### Adding a model

1. Copy the closest file in `web/js/models/` to `web/js/models/<id>.js` and edit it from the new model's manual:
   channel modes and names, `decode()` (channel values → targets), `describe()` (labels), colour wheel / gobos,
   defaults, built-in program, panel type, RDM identity, and the `body` dimensions for the 3D model.
2. Import it in `web/js/models/index.js` and add it to `LIST`.

Nothing else changes: the fixture core, beam renderer, panels, RDM responder, side panel and transmitter all read
the model definition. The definition contract is documented at the top of `web/js/models/index.js`.
A new kind of front panel means a new menu class next to `menu.js` (buttons) and `menu-touch.js` (touch + encoder).

## Structure

```
 Browser (web/, three.js)                          Server (server/, Node)
 ┌──────────────────────────────────┐  WebSocket  ┌─────────────────────────────────────┐
 │ models/*.js  one file per model    │◀───────────▶│ dmxnet.js    Art-Net 4 + sACN (UDP)  │◀── console / network
 │ fixture.js   generic "firmware":   │   /ws       │ dmxserial.js USB-DMX (ENTTEC Pro)    │◀── DMX512 line
 │              settings, run modes,  │             │ index.js     static files, relay, TX │
 │              motors, scenes        │             └─────────────────────────────────────┘
 │ menu.js / menu-touch.js  LCD panels│
 │ machine.js   procedural 3D model   │   BroadcastChannel "virtual DMX cable"
 │ gobos.js     beam-section image    │◀──────────── console.html (slider transmitter), other simulator tabs
 │ beam.js      spot light, volumetric│
 │ rdm.js       RDM responder         │
 └──────────────────────────────────┘
```

The fixture logic runs entirely in the browser, so the static build works without a server.
The server exists only for what a browser cannot open itself: UDP sockets and (optionally) serial ports.

## Operating the fixture

Use the 3D fixture itself, the enlarged LCD panel at the bottom, or the keyboard (`↑` `↓` `Enter` `Esc`).
The red rocker on the rear panel is the power switch (power-up runs the reset/homing sequence).

Two simulator shortcuts drive the fixture directly, ignoring DMX and the run mode until released:

- **▶ Demo** (top bar) — a sequence that walks through every function of the selected model
  (zoom, colour wheel, CMY, gobos, prism, framing blades, frost, strobe; scenes a model has no channels for are skipped).
- **Channel values sliders** (Status tab) — drag a slider to set that channel; **Release** hands control back.

Panel operation per model:

- **WOP-LM1012B** — MENU / UP / DOWN / ENTER. ENTER selects (the value blinks), UP/DOWN changes, ENTER confirms,
  MENU goes back without saving. Menu: `Dmx Address` · `Fixture` · `Manual` · `Information` · `Display` · `Factory` · `Reset`.
- **WOP-AVortex TB5** — same button operation as the 250W; menu: `Dmx Address` · `Fixture` (CH Mode, Run Mode, inverts, fan, dim curve, dim speed, No DMX State, LED refresh) · `Manual` · `Information` · `Factory` · `FixReset` · `Display`.
- **WOP-LM500WF** — tap the LCD, or turn/press the encoder (mouse wheel over the knob = turn, click = press).
  Pages: `Address` · `WorkMode` · `Display` · `Scene` · `Advanced` · `Status`.

## DMX channels

**WOP-LM1012B** (manual chapter 6)

| 17CH | 20CH | Function |
|---|---|---|
| 1 / 2 | 1 / 2 | Pan / Pan fine (540°) |
| 3 / 4 | 3 / 4 | Tilt / Tilt fine (270°) |
| 5 | 5 | Pan/tilt speed (0 = fastest) |
| 6 | 6 | Strobe: 0–3 off · 4–103 strobe · 104–107 on · 108–207 pulse · 208–212 open · 213–251 random · 252–255 open |
| 7 | 7 / 8 | Dimmer / Dimmer fine |
| 8 | 9 / 10 | Colour wheel: steps of 10 = white, white+1, colour 1 … · 160–205 flow fwd · 206–209 stop · 210–255 flow rev / fine |
| 9 | 11 | Static gobo: 0–79 open + gobo 1–7 · 80–184 shake · 185–218 flow fwd · 219–221 stop · 222–255 flow rev |
| 10 | 12 | Rotating gobo: 0–69 open + gobo 1–6 · 70–129 shake · 130–189 flow fwd · 190–195 stop · 196–255 flow rev |
| 11 | 13 | Gobo rotation: 0–63 index · 64–126 fwd · 127–128 stop · 129–191 rev · 192–255 swing |
| 12 | 14 | Zoom (6°–26°) |
| 13 | 15 / 16 | Focus / Focus fine |
| 14 | 17 | Frost |
| 15 | 18 | Prism: 128–255 on |
| 16 | 19 | Prism rotation |
| 17 | 20 | Reset: 200–250 held for 3 s |

**WOP-LM500WF** (manual chapter 3, 26CH)

| CH | Function |
|---|---|
| 1 / 2 · 3 / 4 | Pan / fine · Tilt / fine |
| 5 | Pan/tilt speed (fast to slow) |
| 6 | Dimmer |
| 7 | Strobe: 0–3 dark · 4–103 strobe · 104–107 open · 108–155 fade-in · 156–207 random · 208–212 open · 213–251 random · 252–255 open |
| 8 / 9 | Colour wheel: 0–127 linear · 128–154 colour 1–6 · 155–187 split colours · 188–220 rotate fwd · 221–225 stop · 226–255 rotate rev / fine |
| 10 / 11 / 12 | Cyan / Magenta / Yellow |
| 13 | Color2 (treated as CTO) |
| 14 | Frost: 128–255 in |
| 15 | Zoom (large to small, 48°–6°) |
| 16 | Focus |
| 17–24 | CUT1–CUT8: four framing blades, two ends each |
| 25 | Cut Rot: framing module rotation |
| 26 | Reset (held 4 s): 210–215 pan/tilt · 220–235 effects · 240–255 all |

**WOP-AVortex TB5** (manual chapter 7) — channels repeat per head; the shared ones follow at the end

| Mode | Per head | Shared |
|---|---|---|
| 21CH | — (all heads together: pan/fine, tilt/fine, zoom) | RGBL, CTO, LED colour, ring RGB, ring macro, dimmer/fine, LED strobe, ring strobe, P/T speed, function |
| 41CH | pan/fine, tilt/fine, zoom | as 21CH from RGBL on |
| 71CH | pan/fine, tilt/fine, RGBL, zoom, ring RGB, ring macro | dimmer/fine, LED strobe, ring strobe, P/T speed, function |
| 75CH | as 71CH + LED strobe | dimmer/fine, ring strobe, P/T speed, function |
| 85CH | as 75CH + LED dimmer/fine | dimmer/fine, ring strobe, P/T speed, function |
| 170CH | pan/fine, tilt/fine, RGBL, zoom, 8 ring blocks × RGB | dimmer/fine, LED strobe, P/T speed, function |

## Stage Editor

`stage.html` (button **🎭 Stage**) puts any number of fixtures, of any mix of models, on one 3D stage and runs them
from one DMX patch.

- **Examples**: pick one in the top bar and press *Load example* — it loads and plays.
  *All three models — showcase* has two 250W BSW, the 500W Frame and the AquaVortex TB5 in a 48-second programmed
  show (scenes, EFX, a chaser, on a timeline against a backing track); the other three examples show one model each.
  The backing track is synthesised in the browser, so no audio file is shipped.
- **Transport**: Play / Pause, Stop, a position slider and Loop. The show keeps time from a worker clock and the audio,
  so it does not stall when the window is in the background.
- **Editing the stage**: add fixtures (model list at the right), click one to select it, drag it across the floor,
  or type its position, rotation, DMX address and channel mode; mount it on the floor or inverted on the truss; remove it.
- **Files**: *Save* writes a `.stage.json` with the layout, the patch and the show; *Open* loads one; the last stage is
  kept in the browser.
- **Programming the show**: *Edit show* opens the stage's patch and show in the DMX editor. While the stage is not
  playing its own show it follows the virtual DMX cable, so the editor drives the stage live from the other window.
  *From editor* brings the edited patch and show back into the stage (fixtures keep their positions).
- A stage file's show is an ordinary DMX editor workspace; the examples are generated in code
  (`web/js/stage/examples.js`) from the model definitions, so they follow any change in a channel layout.
- Limits: the first 9 heads light the floor and walls (the rest still show their beam in the air); only single-head
  fixtures cast shadows. Generic fixtures in the patch have no 3D model and are not shown.

## DMX Editor

`editor.html` (button **🎛 DMX Editor** in the simulator) is a lighting-control program in its own window. Its working
method follows [QLC+](https://www.qlcplus.org/): the tabs run in the same order and mean the same things.

| Tab | What you do there |
|---|---|
| **Fixtures** | Patch fixtures to a universe and address. Every simulator model is in the library (so a newly added model appears here too), plus generic dimmers, RGB/RGBW, moving heads and plain channel blocks. Overlaps are flagged. |
| **Functions** | **Scene** (values per fixture channel, tick the channels it controls, fade in / out, live edit) · **Chaser** (steps of functions with fade in / hold / fade out, loop / single / ping-pong) · **EFX** (pan / tilt patterns for any number of heads, with spread) · **Collection** (several functions at once) · **Audio**. |
| **Shows** | Multitrack timeline. Add tracks, drop functions and audio at the cursor, drag and resize them (snap to time or BPM grid), lock / colour / mute / solo, play from the cursor. A playing audio item is the clock, so lights stay on the music; its waveform is drawn on the track. |
| **Virtual Console** | Design mode: place buttons, sliders (playback level or grand master), cue lists and labels. Operate mode: run them. |
| **Simple Desk** | One fader per DMX channel; a moved fader overrides the functions until it is released. |
| **Inputs / Outputs** | Up to 32 universes (16,384 channels). Each universe goes to the virtual DMX cable, Art-Net or sACN, with its own output universe and target IP. DMX monitor. |

- **Merge rules**: intensity and colour-mixing channels are HTP (highest value wins, scaled by the grand master, zeroed by Blackout); everything else is LTP (latest value, fades from where the channel was).
- **Linking to the simulator**: set a universe's output to *Virtual DMX cable* and note its output universe. In the simulator's **DMX Input** tab choose the virtual cable and the same *cable universe*, and give the fixture the address it has in the patch. Open one simulator window per fixture you want to see. Pages must come from the same site and run in the same browser; for other computers or real fixtures use Art-Net / sACN (local server).
- **Files**: the workspace is saved as JSON (Save / Open) and autosaved in the browser. Audio files are kept in the browser's storage, not in the workspace file — choose them again after moving to another computer.
- The clock runs in a worker, so the editor keeps sending 40 Hz while its window is in the background.

## Add-model agent (development only)

**Ctrl + double-click the WINCODE logo** (anywhere on the logo area at the top left) or **Ctrl + Alt + M** opens the
agent in its own window — from the simulator, the DMX editor or the stage editor. If it cannot open, a message says why
(web version, distribution mode, or the browser blocked the pop-up; `agent.html` can also be opened directly). Give it the product page
link, the user manual (PDF, text or scanned) and optionally a mechanical drawing (PDF / PNG / JPG / SVG / DXF). The
Claude Code CLI installed on this computer reads them, writes `web/js/models/<id>.js`, registers it, and runs the
validator; the page shows the log, the validator result, the agent's summary with its assumptions, a button to open the
model in the simulator and one to discard the changes. Nothing is committed for you.

- Needs `npm start` (local server) and a signed-in `claude` CLI. It uses your Claude account; a run takes several minutes.
- Only this computer can use it (loopback + same-origin check). The CLI may edit files and run `python` / `node` only.
- A drawing makes the 3D body match the real fixture more closely; without one the body is estimated from the manual
  and photos. The body is still built from the three parametric styles (box head, round head, bar) — the agent reports
  fixtures those cannot represent instead of changing the simulator core.
- **Distribution mode** removes it: the static web build (`npm run build-web`) does not contain the agent page, and
  `npm run start:dist` (or `WMH_DIST=1`) starts the local server with the agent API switched off.
- `node tools/check-model.mjs [id]` validates model definitions by hand; `python tools/pdf-pages.py <pdf> <dir>` renders a manual to text + page images.

## Communication

Pick **one** input for the fixture's DMX IN socket in the **DMX Input** tab.

| Input | Where | Notes |
|---|---|---|
| Virtual DMX cable | browser | BroadcastChannel between tabs — the slider transmitter and master fixtures use it |
| Art-Net 4 | server, UDP 6454 | ArtDmx on the selected universe; answers ArtPoll; RDM via ArtTodRequest / ArtRdm |
| sACN / E1.31 | server, UDP 5568 | multicast `239.255.x.x` and unicast; highest-priority source wins |
| USB-DMX | server, serial | ENTTEC DMX USB Pro compatible widgets (raw RS485 mode is experimental) |
| USB-RS485 direct | browser, Web Serial | 250 kbps 8N2, frames delimited by break detection (Chrome / Edge) |

- **RDM**: UID `7FF0:xxxxxxxx` (ESTA prototype manufacturer ID). Supports DEVICE_INFO, DMX_START_ADDRESS,
  DMX_PERSONALITY (+description), DEVICE_LABEL, IDENTIFY_DEVICE, RESET_DEVICE, PAN/TILT_INVERT, DISPLAY_INVERT,
  DEVICE_HOURS, DEVICE_POWER_CYCLES. Fully working over Art-Net; over a direct RS485 adapter it is best-effort
  (turn-around timing cannot be guaranteed from a browser).
- **Master / slave**: a fixture running stand-alone (Host / Auto Run / Sound / Scene) sends its values on DMX OUT
  (the virtual cable); a second simulator tab with the same model at address 001 follows it.
  On the WOP-LM500WF this obeys `M/S Choose` (Master / Slave / Auto).
- **Sound**: steps the built-in program on microphone beats (or the manual Beat button).
- **KlingNet** is listed in the 250W manual as an optional network function, but it is a closed protocol and is not implemented.

### Slider transmitter (for testing)

`console.html`, or **Add DMX Transmitter** in the top bar. A separate device with one fader per fixture channel
(choose the **Fixture profile** and channel mode) or a raw 512-channel grid. It sends 40 Hz frames over the virtual
cable, or — through the local server — as real Art-Net / sACN packets, so it can also drive real equipment.

### Command-line test tool

```
node tools/dmx-send.js artnet 1=128 3=70 6=255 7=255 9=40      # slot=value …
node tools/dmx-send.js sacn --universe 1 7=255 6=255
node tools/dmx-send.js artnet --poll --rdm                      # ArtPollReply, RDM device list, DEVICE_INFO
node tools/dmx-send.js artnet --rdm --rdm-addr 21               # set the DMX start address over RDM
```

## Web version (static build)

```
npm run build-web     # → dist/
npm run serve-dist    # http://127.0.0.1:7741
```

Published by GitHub Actions (`.github/workflows/pages.yml`) on every push to `main`.
Without a server only the virtual cable and Web Serial inputs are available.

## Notes

- Everything a manual does not state (colour names, blade order, body size of the 500W, passwords …) is an assumption;
  each model lists its own in `assumptions` (shown in the Guide tab).
- Brightness across the zoom range is compressed compared with real photometric data so that wide zoom stays visible on screen.
- The manufacturer's manual PDFs are not part of this repository.
