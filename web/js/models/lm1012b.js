// models/lm1012b.js — Wincode WOP-LM1012B 250W LED 3-in-1 Beam/Spot/Wash
//  Source: "WOP-LM1012B 250W BSW LED Moving Head Light User Manual" — chapter 2 (specification), 3 (photometrics),
//  4.1–4.3 (panel, gobo wheels, menu), 6 (DMX channel chart). Anything the manual does not state is listed in `assumptions`.
import { lerp, frac, rng, TAU } from './util.js';

const SPEC = {
  panRange: 540, tiltRange: 270,
  zoomMin: 6, zoomMax: 26,          // full beam angle, degrees
  ledWhite: [0.90, 0.95, 1.0],      // 7500–8500K
  cd: 1100,                         // on-screen intensity at the narrowest zoom (manual: 22140 lx @ 5 m)
  focus: [0.33, 0.22],              // in-focus position = a + b·zoom
  tempRise: 38,
};

// Colour wheel: open (white) + 7 colours. The manual only says "Color 1–7".
const COLORS = [
  { name: 'White',   rgb: [1.00, 1.00, 1.00] },
  { name: 'Red',     rgb: [1.00, 0.05, 0.03] },
  { name: 'Orange',  rgb: [1.00, 0.42, 0.02] },
  { name: 'Yellow',  rgb: [1.00, 0.92, 0.08] },
  { name: 'Green',   rgb: [0.05, 0.95, 0.15] },
  { name: 'Cyan',    rgb: [0.05, 0.75, 1.00] },
  { name: 'Blue',    rgb: [0.04, 0.10, 1.00] },
  { name: 'Magenta', rgb: [1.00, 0.05, 0.75] },
];
const FIX_GOBOS = ['Open', 'Triangle', 'Tri-Ring', 'Four Dots', 'Flower', 'Bubbles', 'Reducer M', 'Reducer S'];   // 4.2 GOBO1
const ROT_GOBOS = ['Open', 'Five Dots', 'Rose', 'Waves', 'Brush', 'Stars', 'Grid'];                              // 4.2 GOBO2

const CH = {
  pan: 'Pan', panFine: 'Pan Fine', tilt: 'Tilt', tiltFine: 'Tilt Fine', ptSpeed: 'PTSpeed', strobe: 'Strobe', dimmer: 'Dimmer', dimmerFine: 'Dimmer Fine',
  color: 'Color', colorFine: 'Color Fine', gobo: 'FixGobo', rotGobo: 'RotGobo', goboRot: 'GoboRot', zoom: 'Zoom', focus: 'Focus', focusFine: 'Focus Fine',
  frost: 'Frost', prism: 'Prism', prismRot: 'PrismRot', reset: 'Reset',
};
const MODES = {
  STD: { id: 'STD', label: '17CH', channels: ['pan', 'panFine', 'tilt', 'tiltFine', 'ptSpeed', 'strobe', 'dimmer', 'color', 'gobo', 'rotGobo', 'goboRot', 'zoom', 'focus', 'frost', 'prism', 'prismRot', 'reset'] },
  EXT: { id: 'EXT', label: '20CH', channels: ['pan', 'panFine', 'tilt', 'tiltFine', 'ptSpeed', 'strobe', 'dimmer', 'dimmerFine', 'color', 'colorFine', 'gobo', 'rotGobo', 'goboRot', 'zoom', 'focus', 'focusFine', 'frost', 'prism', 'prismRot', 'reset'] },
};

/** Channel values (key → 0..255) → motion/optics targets. Channels missing in 17CH mode count as 0. */
function decode(v) {
  const g = k => v[k] | 0;
  const t = {};
  t.pan = (g('pan') * 256 + g('panFine')) / 65535;        // 0..1
  t.tilt = (g('tilt') * 256 + g('tiltFine')) / 65535;
  t.ptSpeed = g('ptSpeed') / 255;                         // 0 = fastest

  // Strobe
  const s = g('strobe');
  if (s <= 3) t.strobe = { mode: 'closed' };
  else if (s <= 103) t.strobe = { mode: 'strobe', hz: lerp(1, 25, frac(s, 4, 103)) };
  else if (s <= 107) t.strobe = { mode: 'open' };
  else if (s <= 207) t.strobe = { mode: 'pulse', hz: lerp(1, 25, frac(s, 108, 207)) };
  else if (s <= 212) t.strobe = { mode: 'open' };
  else if (s <= 225) t.strobe = { mode: 'random', hz: 4 };
  else if (s <= 238) t.strobe = { mode: 'random', hz: 10 };
  else if (s <= 251) t.strobe = { mode: 'random', hz: 20 };
  else t.strobe = { mode: 'open' };

  t.dimmer = (g('dimmer') * 256 + g('dimmerFine')) / 65535;
  if (!('dimmerFine' in v)) t.dimmer = g('dimmer') / 255;

  // Colour wheel: steps of 10 = full colour / split colour … 160+ = water (continuous) effect
  const c = g('color');
  if (c <= 159) t.color = { pos: Math.floor(c / 10) / 2 + (g('colorFine') / 255) * 0.5, spin: 0 };
  else if (c <= 205) t.color = { pos: null, spin: lerp(3.0, 0.15, frac(c, 160, 205)) };
  else if (c <= 209) t.color = { pos: null, spin: 0 };
  else t.color = { pos: null, spin: -lerp(0.15, 3.0, frac(c, 210, 255)) };

  // Static gobo wheel
  const f = g('gobo');
  if (f <= 79) t.gobo = { pos: Math.floor(f / 10), shake: 0, spin: 0 };
  else if (f <= 184) t.gobo = { pos: Math.floor((f - 80) / 15) + 1, shake: lerp(2, 12, ((f - 80) % 15) / 14), spin: 0 };
  else if (f <= 218) t.gobo = { pos: null, spin: lerp(2.5, 0.12, frac(f, 185, 218)) };
  else if (f <= 221) t.gobo = { pos: null, spin: 0 };
  else t.gobo = { pos: null, spin: -lerp(0.12, 2.5, frac(f, 222, 255)) };

  // Rotating gobo wheel
  const r = g('rotGobo');
  if (r <= 69) t.rotGobo = { pos: Math.floor(r / 10), shake: 0, spin: 0 };
  else if (r <= 129) t.rotGobo = { pos: Math.floor((r - 70) / 10) + 1, shake: lerp(2, 12, ((r - 70) % 10) / 9), spin: 0 };
  else if (r <= 189) t.rotGobo = { pos: null, spin: lerp(2.5, 0.12, frac(r, 130, 189)) };
  else if (r <= 195) t.rotGobo = { pos: null, spin: 0 };
  else t.rotGobo = { pos: null, spin: -lerp(0.12, 2.5, frac(r, 196, 255)) };

  // Gobo rotation (pattern of the rotating gobo)
  const gr = g('goboRot');
  if (gr <= 63) t.goboRot = { index: (gr / 63) * 360, spin: 0, bounce: 0 };
  else if (gr <= 126) t.goboRot = { index: null, spin: lerp(1.5, 0.03, frac(gr, 64, 126)), bounce: 0 };
  else if (gr <= 128) t.goboRot = { index: null, spin: 0, bounce: 0 };
  else if (gr <= 191) t.goboRot = { index: null, spin: -lerp(0.03, 1.5, frac(gr, 129, 191)), bounce: 0 };
  else t.goboRot = { index: null, spin: 0, bounce: lerp(0.3, 4, frac(gr, 192, 255)) };

  t.zoom = g('zoom') / 255;
  t.focus = 'focusFine' in v ? (g('focus') * 256 + g('focusFine')) / 65535 : g('focus') / 255;
  t.frost = g('frost') / 255;
  t.prism = g('prism') >= 128;
  const pr = g('prismRot');
  t.prismRot = pr <= 128 ? 0 : pr <= 191 ? -lerp(0.05, 1.5, frac(pr, 129, 191)) : lerp(0.05, 1.5, frac(pr, 192, 255));
  const rs = g('reset');
  t.reset = rs >= 200 && rs <= 250;
  return t;
}

/** Meaning of a channel value (for the monitor and the transmitter) */
function describe(key, val) {
  const v = val | 0;
  const pct = (lo, hi) => Math.round(frac(v, lo, hi) * 100) + '%';
  switch (key) {
    case 'pan': return `${(((v / 255) - 0.5) * SPEC.panRange).toFixed(0)}°`;
    case 'tilt': return `${(((v / 255) - 0.5) * SPEC.tiltRange).toFixed(0)}°`;
    case 'ptSpeed': return v === 0 ? 'Fastest' : `Slower ${pct(0, 255)}`;
    case 'strobe':
      if (v <= 3) return 'OFF (closed)';
      if (v <= 103) return `Strobe ${lerp(1, 25, frac(v, 4, 103)).toFixed(1)}Hz`;
      if (v <= 107) return 'ON (open)';
      if (v <= 207) return `Pulse ${lerp(1, 25, frac(v, 108, 207)).toFixed(1)}Hz`;
      if (v <= 212) return 'Open';
      if (v <= 225) return 'Random slow';
      if (v <= 238) return 'Random mid';
      if (v <= 251) return 'Random fast';
      return 'Open';
    case 'dimmer': return Math.round(v / 2.55) + '%';
    case 'color': {
      if (v <= 159) { const i = Math.floor(v / 10), a = COLORS[(i >> 1) % 8], b = COLORS[((i >> 1) + 1) % 8]; return i & 1 ? `${a.name}+${b.name}` : a.name; }
      if (v <= 205) return `Flow fwd ${pct(205, 160)}`;
      if (v <= 209) return 'Flow stop';
      return `Flow rev ${pct(210, 255)}`;
    }
    case 'gobo':
      if (v <= 79) return FIX_GOBOS[Math.floor(v / 10)];
      if (v <= 184) return `${FIX_GOBOS[Math.floor((v - 80) / 15) + 1]} shake`;
      if (v <= 218) return `Flow fwd ${pct(218, 185)}`;
      if (v <= 221) return 'Flow stop';
      return `Flow rev ${pct(222, 255)}`;
    case 'rotGobo':
      if (v <= 69) return ROT_GOBOS[Math.floor(v / 10)];
      if (v <= 129) return `${ROT_GOBOS[Math.floor((v - 70) / 10) + 1]} shake`;
      if (v <= 189) return `Flow fwd ${pct(189, 130)}`;
      if (v <= 195) return 'Flow stop';
      return `Flow rev ${pct(196, 255)}`;
    case 'goboRot':
      if (v <= 63) return `Index ${Math.round((v / 63) * 360)}°`;
      if (v <= 126) return `Rotate fwd ${pct(126, 64)}`;
      if (v <= 128) return 'Stop';
      if (v <= 191) return `Rotate rev ${pct(129, 191)}`;
      return `Fwd/rev swing ${pct(192, 255)}`;
    case 'zoom': return `${lerp(SPEC.zoomMin, SPEC.zoomMax, v / 255).toFixed(1)}°`;
    case 'focus': case 'frost': return Math.round(v / 2.55) + '%';
    case 'prism': return v >= 128 ? '3-facet ON' : 'OFF';
    case 'prismRot': return v <= 128 ? 'Stop' : v <= 191 ? `Rotate rev ${pct(129, 191)}` : `Rotate fwd ${pct(192, 255)}`;
    case 'reset': return v >= 200 && v <= 250 ? 'Reset (hold 3s)' : '—';
    default: return String(v);
  }
}

/** One gobo: white where light passes, on a transparent background. Origin = centre, R = aperture radius */
function drawGobo(g, wheel, idx, R) {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  if (idx === 0) return dot(0, 0, R);
  if (wheel === 'fix') {
    switch (idx) {
      case 1: {                                   // triangle outline
        g.lineWidth = R * 0.085; g.beginPath();
        for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * TAU / 3; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66 + R * 0.08); }
        g.closePath(); g.stroke(); break;
      }
      case 2: {                                   // three-segment ring
        g.lineWidth = R * 0.14;
        for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * TAU / 3; g.beginPath(); g.arc(0, 0, R * 0.62, a + 0.2, a + TAU / 3 - 0.2); g.stroke(); }
        break;
      }
      case 3: for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; dot(Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42, R * 0.25); } break;   // four dots
      case 4: {                                   // flower (6 petals + small petals between)
        for (let i = 0; i < 6; i++) { g.save(); g.rotate(i * TAU / 6); g.beginPath(); g.ellipse(0, -R * 0.47, R * 0.11, R * 0.26, 0, 0, TAU); g.fill(); g.restore(); }
        for (let i = 0; i < 6; i++) { g.save(); g.rotate(i * TAU / 6 + TAU / 12); g.beginPath(); g.ellipse(0, -R * 0.2, R * 0.045, R * 0.1, 0, 0, TAU); g.fill(); g.restore(); }
        break;
      }
      case 5: {                                   // large and small bubbles
        const r = rng(11); dot(0, 0, R * 0.2);
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6; dot(Math.cos(a) * R * 0.44, Math.sin(a) * R * 0.44, R * 0.15); }
        for (let i = 0; i < 16; i++) { const a = r() * TAU, d = R * (0.2 + r() * 0.62); dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.03 + r() * 0.045)); }
        break;
      }
      case 6: dot(0, 0, R * 0.55); break;         // beam reducer (medium)
      case 7: dot(0, 0, R * 0.3); break;          // beam reducer (small)
    }
    return;
  }
  switch (idx) {                                  // rotating gobos (glass)
    case 1: for (let i = -2; i <= 2; i++) dot(i * R * 0.34, 0, R * 0.13); break;                          // five dots in a row
    case 2: {                                     // rose (line art)
      g.lineWidth = R * 0.035; g.beginPath();
      for (let i = 0; i <= 720; i++) { const t = i / 720 * TAU * 3, rr = R * 0.8 * (t / (TAU * 3)) * (0.82 + 0.18 * Math.sin(t * 2.5)); g[i ? 'lineTo' : 'moveTo'](Math.cos(t) * rr, Math.sin(t) * rr); }
      g.stroke();
      for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + 0.3; g.beginPath(); g.arc(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, R * 0.36, a + 2.2, a + 4.0); g.stroke(); }
      break;
    }
    case 3: {                                     // wave grain
      g.lineWidth = R * 0.04; const r = rng(5);
      for (let j = -6; j <= 6; j++) { const y0 = j * R * 0.125, half = Math.sqrt(Math.max(0, 0.72 - (j / 7.5) ** 2)) * R, ph = r() * 6; g.beginPath();
        for (let x = -half; x <= half; x += R * 0.04) g[x === -half ? 'moveTo' : 'lineTo'](x, y0 + Math.sin(x / R * 9 + ph) * R * 0.035); g.stroke(); }
      break;
    }
    case 4: {                                     // brush strokes (radial scratches)
      const r = rng(23);
      for (let i = 0; i < 70; i++) { const a = -0.5 + (r() - 0.5) * 1.1, y = (r() - 0.5) * R * 1.3, l = R * (0.3 + r() * 0.9), x = -R * 0.7 + r() * R * 0.4;
        g.lineWidth = R * (0.008 + r() * 0.022); g.globalAlpha = 0.45 + r() * 0.55; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
      g.globalAlpha = 1; break;
    }
    case 5: {                                     // star field
      const r = rng(77);
      for (let i = 0; i < 90; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.88; dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.012 + r() * r() * 0.07)); }
      break;
    }
    case 6: {                                     // 4×4 grid
      const s = R * 0.3, gap = R * 0.045;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect((i - 2) * s + gap / 2, (j - 2) * s + gap / 2, s - gap, s - gap);
      break;
    }
  }
}

export default {
  id: 'lm1012b', code: 'WOP-LM1012B', name: '250W BSW', title: '250W LED 3-in-1 Beam / Spot / Wash', lcdTitle: '250W BSW',
  spec: SPEC, colors: COLORS, gobos: { fix: FIX_GOBOS, rot: ROT_GOBOS, draw: drawGobo },
  ch: CH, modes: MODES, defaultMode: 'EXT', decode, describe,
  features: { prism: true, gobos: true, cmy: false, blades: false, scenes: false, ms: false, lamp: false },
  noSignal: 'manual',                               // without DMX the Manual-menu values apply
  manualDefaults: { pan: 128, tilt: 70, strobe: 255, dimmer: 255, focus: 96 },
  homeValues: { pan: 128, tilt: 128 },
  resetHold: 3,
  settings: { flip: false, dispMode: 'Show',
    cal: { pan: 128, tilt: 128, color: 128, dimmer: 128, gobo: 128, rotGobo: 128, goboRot: 128, zoom: 128, focus: 128, frost: 128, prism: 128, prismRot: 128, reset: 128 } },
  offsets: S => [(S.cal.pan - 128) * 0.1, (S.cal.tilt - 128) * 0.1],
  // Built-in program for Host (master) and Sound modes — one step = a set of channel values
  program: {
    base: { dimmer: 255, strobe: 255, focus: 96 },
    steps: [
      { pan: 110, tilt: 80, color: 20, rotGobo: 10, goboRot: 100, zoom: 0 },
      { pan: 150, tilt: 95, color: 60, gobo: 10, zoom: 120 },
      { pan: 128, tilt: 70, color: 100, rotGobo: 60, goboRot: 150, zoom: 60, prism: 200, prismRot: 210 },
      { pan: 95, tilt: 100, color: 140, gobo: 40, zoom: 200 },
      { pan: 165, tilt: 85, color: 40, rotGobo: 50, goboRot: 80, zoom: 0, prism: 200, prismRot: 150 },
      { pan: 128, tilt: 110, color: 120, gobo: 50, zoom: 255, frost: 160 },
      { pan: 140, tilt: 60, color: 80, rotGobo: 20, goboRot: 220, zoom: 30 },
      { pan: 115, tilt: 90, color: 180, rotGobo: 30, goboRot: 110, zoom: 90, prism: 200, prismRot: 240 },
    ],
  },
  // Panel: colour LCD + buttons (manual 4.1). The drawing shows five buttons in a cross; the manual names four functions.
  panel: { type: 'buttons', password: 50, manualKeys: ['pan', 'panFine', 'tilt', 'tiltFine', 'ptSpeed', 'strobe', 'dimmer', 'color', 'gobo', 'rotGobo', 'goboRot', 'zoom', 'focus', 'frost', 'prism', 'prismRot', 'reset'],
    calKeys: ['pan', 'tilt', 'color', 'dimmer', 'gobo', 'rotGobo', 'goboRot', 'zoom', 'focus', 'frost', 'prism', 'prismRot', 'reset'],
    versions: ['Panel: V1.012', 'XY Motor: V1.004', 'Motor: V1.006'] },
  rdm: { modelId: 0x1012, description: 'WOP-LM1012B 250W BSW', software: 'Panel V1.012' },
  // Body: dimension drawing on manual page 5 — 296 (W) × 224 (D) × 492 (H) mm
  body: {
    H: 0.492, style: 'box', handles: true,                      // 296 (W) × 224 (D) × 492 (H) mm, manual chapter 2; shapes from the cover drawing
    base: { hw: 0.113, bot: 0.03, top: 0.105, shoulder: 0.083, chamfer: 0.02, depth: 0.2, frameW: 0.166, frameH: 0.062, panelY: 0.067 },
    feet: { r: 0.014, h: 0.03, x: 0.075, z: 0.07 },
    turntable: { r: 0.078, h: 0.02 }, panY: 0.125,
    yoke: { W: 0.292, t: 0.036, wb: 0.17, h1: 0.04, h2: 0.07, yf: 0.02, c: 0.028, d: 0.12, armW: 0.088, top: 0.245 },
    tiltY: 0.185,
    // moulded box → shoulder → wide front lens ring
    head: [{ y: -0.12, w: 0.1, d: 0.09, r: 0.03 }, { y: -0.108, w: 0.16, d: 0.14, r: 0.04 }, { y: -0.04, w: 0.19, d: 0.165, r: 0.045 }, { y: 0.055, w: 0.19, d: 0.165, r: 0.05 }, { y: 0.09, w: 0.16, d: 0.155, r: 0.07 },
      { y: 0.098, w: 0.184 }, { y: 0.15, w: 0.184 }, { y: 0.158, w: 0.168 }],
    slots: { y: -0.03, z: 0.083, n: 6, pitch: 0.0072 }, plate: { y: 0.03, z: 0.0835 },
    logo: { arm: 'Wincode', head: 'LED', headSize: [0.05, 0.022] },
    lensY: 0.16, lensR: 0.062, ringR: 0.078,                    // lens dome adds 21 mm: 0.125 + 0.185 + 0.160 + 0.021 = 0.491
    lcd: [0.058, 0.0435], lcdX: -0.036, controls: 'cross5', ctrlX: 0.042,
  },
  assumptions: [
    'Colour wheel order: Red, Orange, Yellow, Green, Cyan, Blue, Magenta (the manual only says Color 1–7).',
    'Gobo artwork is redrawn from the small wheel pictures in manual 4.2.',
    'Five buttons in a cross; the manual names four functions → left = MENU, centre/right = ENTER.',
    'FixGobo was added to the Manual menu (the manual\'s list omits the static gobo wheel).',
    'Factory menu password 050; only the pan/tilt calibration offsets have an effect.',
    'Zoom 0 = 6° (narrow), 255 = 26°. Prism rotation 129–191 / 192–255 are opposite directions.',
  ],
};
