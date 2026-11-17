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

## Models

Pick the model with the selector at the top left (the page reloads with that fixture; settings are kept per model).

| id | Model | Channels | Panel | Features |
|---|---|---|---|---|
| `lm1012b` | **WOP-LM1012B** 250W LED 3-in-1 Beam/Spot/Wash | 17CH (STD) / 20CH (EXT) | colour LCD + buttons | colour wheel, static + rotating gobo wheels, 3-facet prism, zoom 6–26°, frost |
| `lm500wf` | **WOP-LM500WF** 500W LED Framing Moving Head Wash | 26CH | touch LCD + rotary encoder | colour wheel, linear CMY, CTO, 4 framing blades (8 channels) + rotation, zoom 6–48°, frost, 10 editable scenes, master/slave selection |
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
