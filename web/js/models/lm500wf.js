// models/lm500wf.js — Wincode WOP-LM500WF 500W LED Framing Moving Head Wash
//  Source: "WOP-LM500WF 500W LED Frame User Manual" — chapter 2 (touch panel + encoder, the six setting pages),
//  chapter 3 (26CH channel table); product page: 500W LED engine, 4 framing blades, zoom 6–48°, linear CMY, RDM.
//  Anything the manual does not state is listed in `assumptions`.
import { lerp, frac, pct, p255 } from './util.js';

const SPEC = {
  panRange: 540, tiltRange: 270,
  zoomMin: 6, zoomMax: 48,          // product page: zoom angle 6–48°
  ledWhite: [0.93, 0.96, 1.0],
  cd: 2000,                         // on-screen intensity at the narrowest zoom (500 W engine)
  focus: [0.38, 0.1],               // in-focus position = a + b·zoom
  tempRise: 44,
};

// Colour wheel: open + 7 colours (the channel table goes up to "Colour6+Colour7"; no names are given).
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

const CH = {
  pan: 'Pan', panFine: 'Pan Fine', tilt: 'Tilt', tiltFine: 'Tilt Fine', ptSpeed: 'PT Spd', dimmer: 'Dimmer', strobe: 'Strobe',
  color: 'Colour', colorFine: 'Colour F', cyan: 'Cyan', magenta: 'Magenta', yellow: 'Yellow', cto: 'Color2', frost: 'Frost', zoom: 'Zoom', focus: 'Focus',
  cut1: 'CUT1', cut2: 'CUT2', cut3: 'CUT3', cut4: 'CUT4', cut5: 'CUT5', cut6: 'CUT6', cut7: 'CUT7', cut8: 'CUT8', cutRot: 'Cut Rot', reset: 'Reset',
};
const CUTS = ['cut1', 'cut2', 'cut3', 'cut4', 'cut5', 'cut6', 'cut7', 'cut8'];
const MODES = {
  '26CH': { id: '26CH', label: '26CH', channels: ['pan', 'panFine', 'tilt', 'tiltFine', 'ptSpeed', 'dimmer', 'strobe', 'color', 'colorFine', 'cyan', 'magenta', 'yellow', 'cto', 'frost', 'zoom', 'focus', ...CUTS, 'cutRot', 'reset'] },
};
const BLADES = ['Top', 'Right', 'Bottom', 'Left'];

// CH8 fixed positions: [upper bound, wheel position]. x.5 = split between two colours.
const COLOR_STEPS = [[131, 1], [135, 2], [140, 3], [145, 4], [149, 5], [154, 6], [158, 0.5], [163, 1.5], [167, 2.5], [172, 3.5], [176, 4.5], [181, 5.5], [187, 6.5]];
const colorName = pos => { const i = Math.floor(pos), a = COLORS[i % 8].name, b = COLORS[(i + 1) % 8].name; return pos === i ? a : `${a}+${b}`; };

/** Channel values (key → 0..255) → motion/optics targets */
function decode(v) {
  const g = k => v[k] | 0;
  const t = {};
  t.pan = (g('pan') * 256 + g('panFine')) / 65535;
  t.tilt = (g('tilt') * 256 + g('tiltFine')) / 65535;
  t.ptSpeed = g('ptSpeed') / 255;                         // fast to slow
  t.dimmer = g('dimmer') / 255;

  // CH7 strobe
  const s = g('strobe');
  if (s <= 3) t.strobe = { mode: 'closed' };
  else if (s <= 103) t.strobe = { mode: 'strobe', hz: lerp(1, 25, frac(s, 4, 103)) };
  else if (s <= 107) t.strobe = { mode: 'open' };
  else if (s <= 155) t.strobe = { mode: 'fadein', hz: lerp(0.5, 12, frac(s, 108, 155)) };
  else if (s <= 207) t.strobe = { mode: 'random', hz: lerp(3, 20, frac(s, 156, 207)) };
  else if (s <= 212) t.strobe = { mode: 'open' };
  else if (s <= 251) t.strobe = { mode: 'random', hz: lerp(3, 20, frac(s, 213, 251)) };
  else t.strobe = { mode: 'open' };

  // CH8 colour wheel (+ CH9 fine)
  const c = g('color'), fine = (g('colorFine') / 255) * 0.5;
  if (c <= 127) t.color = { pos: (c / 127) * 7 + fine, spin: 0 };
  else if (c <= 187) t.color = { pos: COLOR_STEPS.find(e => c <= e[0])[1] + fine, spin: 0 };
  else if (c <= 220) t.color = { pos: null, spin: lerp(3.0, 0.15, frac(c, 188, 220)) };
  else if (c <= 225) t.color = { pos: null, spin: 0 };
  else t.color = { pos: null, spin: -lerp(0.15, 3.0, frac(c, 226, 255)) };

  t.cmy = [g('cyan') / 255, g('magenta') / 255, g('yellow') / 255];
  t.cto = g('cto') / 255;
  t.frost = g('frost') >= 128 ? 1 : 0;
  t.zoom = 1 - g('zoom') / 255;                           // "large to small": 0 = widest
  t.focus = g('focus') / 255;
  t.blades = CUTS.map(k => g(k) / 255);
  t.bladeRot = (g('cutRot') - 128) / 127;                 // −1..+1 → ±45°
  const rs = g('reset');
  t.reset = rs >= 240 ? 'all' : rs >= 220 && rs <= 235 ? 'effect' : rs >= 210 && rs <= 215 ? 'xy' : false;
  return t;
}

/** Meaning of a channel value (for the monitor and the transmitter) */
function describe(key, val) {
  const v = val | 0;
  if (CUTS.includes(key)) { const i = CUTS.indexOf(key); return `${BLADES[i >> 1]} ${i & 1 ? 'B' : 'A'} ${p255(v)}`; }
  switch (key) {
    case 'pan': return `${(((v / 255) - 0.5) * SPEC.panRange).toFixed(0)}°`;
    case 'tilt': return `${(((v / 255) - 0.5) * SPEC.tiltRange).toFixed(0)}°`;
    case 'ptSpeed': return v === 0 ? 'Fastest' : `Slower ${p255(v)}`;
    case 'dimmer': case 'cyan': case 'magenta': case 'yellow': case 'focus': return p255(v);
    case 'strobe':
      if (v <= 3) return 'Dark';
      if (v <= 103) return `Strobe ${lerp(1, 25, frac(v, 4, 103)).toFixed(1)}Hz`;
      if (v <= 107) return 'Open';
      if (v <= 155) return `Fade-in ${pct(v, 108, 155)}`;
      if (v <= 207) return `Random ${pct(v, 156, 207)}`;
      if (v <= 212) return 'Open';
      if (v <= 251) return `Random ${pct(v, 213, 251)}`;
      return 'Open';
    case 'color':
      if (v <= 127) return `Linear ${((v / 127) * 7).toFixed(1)}`;
      if (v <= 187) return colorName(COLOR_STEPS.find(e => v <= e[0])[1]);
      if (v <= 220) return `Rotate fwd ${pct(v, 220, 188)}`;
      if (v <= 225) return 'Stop';
      return `Rotate rev ${pct(v, 226, 255)}`;
    case 'cto': return `CTO ${p255(v)}`;
    case 'frost': return v >= 128 ? 'Frost in' : 'None';
    case 'zoom': return `${lerp(SPEC.zoomMax, SPEC.zoomMin, v / 255).toFixed(1)}°`;
    case 'cutRot': return `${(((v - 128) / 127) * 45).toFixed(0)}°`;
    case 'reset': return v >= 240 ? 'Reset all (4s)' : v >= 220 && v <= 235 ? 'Reset effects (4s)' : v >= 210 && v <= 215 ? 'Reset XY (4s)' : '—';
    default: return String(v);
  }
}

export default {
  id: 'lm500wf', code: 'WOP-LM500WF', name: '500W Frame', title: '500W LED Framing Moving Head Wash', lcdTitle: '500W LED FRAME',
  spec: SPEC, colors: COLORS, gobos: { fix: ['Open'], rot: ['Open'], draw: null },
  ch: CH, modes: MODES, defaultMode: '26CH', decode, describe,
  features: { prism: false, gobos: false, cmy: true, cto: true, blades: true, scenes: true, ms: true, lamp: true },
  noSignal: 'hold',                                 // Advanced → Data hold: ON keeps the last frame, OFF returns to the post-reset state
  homeValues: { pan: 128, tilt: 128, cutRot: 128 },
  sceneDefault: { pan: 128, tilt: 70, dimmer: 255, strobe: 255, zoom: 150, focus: 100, cutRot: 128 },
  resetHold: 4,
  settings: { msMode: 'Auto', sceneSel: 'Auto', saver: 'OFF', rot: 'OFF', dmxInd: 'Mode1', sigBright: 10, scrLight: 10, touch: true,
    rectify: true, panOffset: 10, tiltOffset: 10, dataHold: false, lampMode: 'After reset' },
  offsets: S => [(S.panOffset - 10) * 0.2, (S.tiltOffset - 10) * 0.2],
  // Built-in program (Auto Run / Sound Ctrl)
  program: {
    base: { dimmer: 255, strobe: 255, focus: 100, cutRot: 128 },
    steps: [
      { pan: 110, tilt: 80, zoom: 200, cyan: 255 },
      { pan: 150, tilt: 95, zoom: 120, magenta: 255, cut1: 90, cut2: 90, cut5: 90, cut6: 90 },
      { pan: 128, tilt: 70, zoom: 60, yellow: 255, magenta: 120, cut3: 110, cut4: 60, cut7: 110, cut8: 60, cutRot: 170 },
      { pan: 95, tilt: 100, zoom: 230, color: 132 },
      { pan: 165, tilt: 85, zoom: 150, cyan: 200, yellow: 200, cut1: 120, cut2: 40, cut3: 80, cut4: 80, cut5: 40, cut6: 120, cut7: 80, cut8: 80 },
      { pan: 128, tilt: 110, zoom: 20, cto: 255, frost: 200 },
      { pan: 140, tilt: 60, zoom: 180, cyan: 255, magenta: 255, cut1: 100, cut2: 100, cut3: 100, cut4: 100, cut5: 100, cut6: 100, cut7: 100, cut8: 100, cutRot: 90 },
      { pan: 115, tilt: 90, zoom: 100, color: 146 },
    ],
  },
  // Panel: touch TFT + rotary encoder with push button (manual chapter 2, figures 3–6)
  panel: { type: 'touch', versions: { device: '500W LED FRAME', model: 'WOP-LM500WF', panel: 'A5.0.17', main: 'M2.1.08' } },
  rdm: { modelId: 0x0500, description: 'WOP-LM500WF 500W LED Frame', software: 'Panel A5.0.17' },
  // Body: proportions taken from the product photos (the manual has no dimension drawing)
  body: {
    H: 0.722, style: 'round', handles: false,
    base: { hw: 0.19, bot: 0.05, top: 0.145, shoulder: 0.118, chamfer: 0.035, depth: 0.25, frameW: 0.2, frameH: 0.072, panelY: 0.098 },
    feet: { r: 0.02, h: 0.05, x: 0.125, z: 0.085 },
    turntable: { r: 0.1, h: 0.02 }, panY: 0.165,
    bridge: [{ y: 0, w: 0.28, d: 0.15, r: 0.04 }, { y: 0.015, w: 0.36, d: 0.172, r: 0.04 }, { y: 0.05, w: 0.365, d: 0.166, r: 0.04 }, { y: 0.07, w: 0.35, d: 0.14, r: 0.04 }],
    arm: { x: 0.156, t: 0.05, shape: [[-0.085, 0.03], [0.085, 0.03], [0.07, 0.25], [0.05, 0.31], [0.018, 0.335], [-0.018, 0.335], [-0.05, 0.31], [-0.07, 0.25]] },
    tiltY: 0.295,
    head: [{ y: -0.17, w: 0.12 }, { y: -0.158, w: 0.19 }, { y: -0.1, w: 0.222 }, { y: 0.095, w: 0.222 }, { y: 0.125, w: 0.2 }, { y: 0.16, w: 0.236 }, { y: 0.245, w: 0.246 }, { y: 0.256, w: 0.236 }],
    fins: { y0: -0.09, y1: 0.08, n: 9, r: 0.113 }, plate: { y: 0.0, z: 0.112 },
    lensY: 0.262, lensR: 0.088, ringR: 0.105,
    lcd: [0.064, 0.048], lcdX: -0.03, controls: 'encoder', ctrlX: 0.052,
  },
  assumptions: [
    'Dimensions (about 400 × 270 × 720 mm) are estimated from the product photos; the manual has no drawing.',
    'Colour wheel order: Red, Orange, Yellow, Green, Cyan, Blue, Magenta (the manual only says Colour1–7).',
    'CH13 "Color2" is treated as a linear CTO filter.',
    'CUT1/2 = top blade (two ends), CUT3/4 = right, CUT5/6 = bottom, CUT7/8 = left; each end travels the full aperture.',
    'Cut Rot: 128 = centre, ±45° at the ends.',
    'Encoder navigation: turn = move / change value, press = select / save; BACK (Esc) leaves a page or dialog.',
    'Only the 26CH mode is documented, so it is the only channel mode.',
    'Factory default run mode is taken as DMX Ctrl with Data hold OFF: without DMX the fixture stays dark in its post-reset position.',
  ],
};
