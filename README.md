# Wincode MovingHead Sim — 250W BSW 3D digital twin

A web-based 3D simulator of the **Wincode WOP-LM1012B 250W LED 3-in-1 Beam/Spot/Wash moving head**.
The fixture is modelled from the dimension drawing in the user manual (296 × 224 × 492 mm), is operated
through its own LCD and buttons, and reacts to DMX exactly as the manual's channel chart describes —
colour wheel, two gobo wheels, prism, zoom, focus, frost, strobe, pan/tilt — with a volumetric beam,
a projected spot and shadows.

It also **receives real DMX**: Art-Net, sACN (E1.31), USB-DMX and RDM, so an external console or
transmitter can drive it.

**Easiest start: double-click `start_movinghead.bat`** (installs dependencies, starts the server, opens the browser).

```
npm install      # once (three, ws, serialport)
npm start        # http://127.0.0.1:7740
```

| URL | |
|---|---|
| `http://127.0.0.1:7740/` | 3D simulator |
| `http://127.0.0.1:7740/console.html` | slider-type DMX512 test transmitter |

## Structure

```
 Browser (web/, three.js)                          Server (server/, Node)
 ┌──────────────────────────────────┐  WebSocket  ┌─────────────────────────────────────┐
 │ fixture.js   "firmware": settings, │◀───────────▶│ dmxnet.js    Art-Net 4 + sACN (UDP)  │◀── console / network
 │              run modes, motors     │   /ws       │ dmxserial.js USB-DMX (ENTTEC Pro)    │◀── DMX512 line
 │ personality.js  DMX channel chart  │             │ index.js     static files, relay, TX │
 │ menu.js      LCD menu (320×240)    │             └─────────────────────────────────────┘
 │ machine.js   3D model              │
 │ gobos.js     gobo art + beam image │   BroadcastChannel "virtual DMX cable"
 │ beam.js      spot light, volumetric│◀──────────── console.html (slider transmitter), other simulator tabs
 │ rdm.js       RDM responder         │
 └──────────────────────────────────┘
```

The fixture logic runs entirely in the browser, so the static build works without a server.
The server exists only for what a browser cannot open itself: UDP sockets and (optionally) serial ports.

## Operating the fixture

Buttons as in manual 4.1 — **MENU / UP / DOWN / ENTER** — on the 3D model, in the LCD panel at the bottom,
or on the keyboard (`Esc`/`M`, `↑`, `↓`, `Enter`). ENTER selects (the value blinks), UP/DOWN changes,
ENTER confirms, MENU goes back without saving; holding MENU for 1 s or one idle minute leaves the menu.
The red rocker on the rear panel is the power switch (power-up runs the reset/homing sequence).

Menu tree (manual 4.3): `Dmx Address` · `Fixture` (Dmx Mode STD/EXT, Run Mode DMX/Host/Sound, Pan/Tilt Invert) ·
`Manual` (per-channel values used while there is no DMX signal) · `Information` · `Display` (Language CH/EN,
Display Flip, Display Mode) · `Factory` · `Reset`. Settings persist in the browser (localStorage).

## DMX channels (manual chapter 6)

| 17CH (STD) | 20CH (EXT) | Function |
|---|---|---|
| 1 / 2 | 1 / 2 | Pan / Pan fine (540°) |
| 3 / 4 | 3 / 4 | Tilt / Tilt fine (270°) |
| 5 | 5 | Pan/tilt speed (0 = fastest) |
| 6 | 6 | Strobe: 0–3 off · 4–103 strobe · 104–107 on · 108–207 pulse · 208–212 open · 213–251 random slow/mid/fast · 252–255 open |
| 7 | 7 / 8 | Dimmer / Dimmer fine |
| 8 | 9 / 10 | Colour wheel: steps of 10 = white, white+1, colour 1 … colour 7+white · 160–205 flow fwd · 206–209 stop · 210–255 flow rev / fine |
| 9 | 11 | Static gobo: 0–79 open + gobo 1–7 · 80–184 shake · 185–218 flow fwd · 219–221 stop · 222–255 flow rev |
| 10 | 12 | Rotating gobo: 0–69 open + gobo 1–6 · 70–129 shake · 130–189 flow fwd · 190–195 stop · 196–255 flow rev |
| 11 | 13 | Gobo rotation: 0–63 index · 64–126 fwd · 127–128 stop · 129–191 rev · 192–255 swing |
| 12 | 14 | Zoom (6°–26°) |
| 13 | 15 / 16 | Focus / Focus fine |
| 14 | 17 | Frost |
| 15 | 18 | Prism: 128–255 on (3-facet) |
| 16 | 19 | Prism rotation: 129–191 one way · 192–255 the other |
| 17 | 20 | Reset: 200–250 held for 3 s |

## Communication

Pick **one** input for the fixture's DMX IN socket in the **DMX Input** tab.

| Input | Where | Notes |
|---|---|---|
| Virtual DMX cable | browser | BroadcastChannel between tabs — the slider transmitter and Host-mode masters use it |
| Art-Net 4 | server, UDP 6454 | ArtDmx on the selected universe; answers ArtPoll; RDM via ArtTodRequest / ArtRdm |
| sACN / E1.31 | server, UDP 5568 | multicast `239.255.x.x` and unicast; highest-priority source wins |
| USB-DMX | server, serial | ENTTEC DMX USB Pro compatible widgets (raw RS485 mode is experimental) |
| USB-RS485 direct | browser, Web Serial | 250 kbps 8N2, frames delimited by break detection (Chrome / Edge) |

- **RDM**: UID `7FF0:xxxxxxxx` (ESTA prototype manufacturer ID). Supports DEVICE_INFO, DMX_START_ADDRESS,
  DMX_PERSONALITY (+description), DEVICE_LABEL, IDENTIFY_DEVICE, RESET_DEVICE, PAN/TILT_INVERT, DISPLAY_INVERT,
  DEVICE_HOURS, DEVICE_POWER_CYCLES. Fully working over Art-Net; over a direct RS485 adapter it is best-effort
  (turn-around timing cannot be guaranteed from a browser).
- **Master / slave**: Run Mode `Host` runs the built-in program and sends it on DMX OUT (the virtual cable).
  A second simulator tab at address 001 follows it.
- **Sound**: Run Mode `Sound` steps the program on microphone beats (or the manual Beat button).
- **KlingNet** is listed in the manual as an optional network function, but it is a closed protocol and is not implemented.

### Slider transmitter (for testing)

`console.html`, or **Add DMX Transmitter** in the top bar. A separate device with one fader per fixture
channel (or a raw 512-channel grid). It sends 40 Hz frames over the virtual cable, or — through the local
server — as real Art-Net / sACN packets, so it can also drive real equipment.

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

## Assumptions (not stated in the manual)

- Colour wheel order: Red, Orange, Yellow, Green, Cyan, Blue, Magenta.
- Gobo artwork is redrawn from the small wheel pictures in manual 4.2.
- The fixture has five buttons in a cross; the manual names four functions → left = MENU, centre/right = ENTER.
- `FixGobo` was added to the Manual menu (the manual's list omits the static gobo wheel).
- Factory menu password: `050`. Only the pan/tilt calibration offsets have an effect.
- Zoom 0 = 6° (narrow), 255 = 26°. Prism rotation 129–191 / 192–255 are opposite directions.
- Brightness across the zoom range is compressed compared with the photometric data (22140 lx → 1715 lx @ 5 m)
  so that wide zoom stays visible on screen.
- The linked product page (ApexPointe 420, 39 channels) publishes no channel chart; this simulator follows the
  manual in this project (WOP-LM1012B 250W, 17/20 channels).

The manufacturer's manual PDF is not part of this repository; put it in `docs/` to get the Guide tab link locally.
