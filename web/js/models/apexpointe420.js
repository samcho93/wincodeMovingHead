// models/apexpointe420.js — Wincode ApexPointe 420 (420W LED Beam / Spot / Wash / FX hybrid)
//  Source: the ApexPointe 420 product page (light engine, zoom 3.2–42.6°, wheels, prisms, frost, 39 DMX channels,
//  386 × 234 × 673 mm). Wincode publishes no manual for this model. The product page states that the fixture is
//  "fully compatible with the original fixture library" of the Robe LEDPointe, so the channel layout follows the public
//  "ROBIN ledPOINTE – DMX protocol" chart (one mode, 39 channels). That substitution and everything else the product
//  page does not state are listed in `assumptions`.
import { lerp, frac, pct, p255, rng, TAU } from './util.js';

const SPEC = {
  panRange: 540, tiltRange: 270,
  zoomMin: 3.2, zoomMax: 42.6,      // product page
  ledWhite: [0.86, 0.93, 1.0],      // 8500–9000K
  cd: 2600,                         // on-screen intensity at the narrowest zoom (420 W engine, 3.2° beam)
  focus: [0.4, 0.12],               // in-focus position = a + b·zoom
  tempRise: 42,
};

// Colour wheel: open + 13 dichroic colours (product page: 13 + open; names and order from the compatible chart)
const COLORS = [
  { name: 'White',       rgb: [1.00, 1.00, 1.00] },
  { name: 'Deep Red',    rgb: [0.95, 0.02, 0.02] },
  { name: 'Deep Blue',   rgb: [0.03, 0.05, 0.90] },
  { name: 'Yellow',      rgb: [1.00, 0.92, 0.08] },
  { name: 'Light Green', rgb: [0.45, 1.00, 0.35] },
  { name: 'Magenta',     rgb: [1.00, 0.05, 0.75] },
  { name: 'Lavender',    rgb: [0.62, 0.45, 1.00] },
  { name: 'Pink',        rgb: [1.00, 0.45, 0.65] },
  { name: 'Dark Green',  rgb: [0.02, 0.70, 0.18] },
  { name: 'CTO 2700K',   rgb: [1.00, 0.62, 0.28] },
  { name: 'Blue',        rgb: [0.05, 0.30, 1.00] },
  { name: 'Orange',      rgb: [1.00, 0.42, 0.02] },
  { name: 'CTO 3200K',   rgb: [1.00, 0.72, 0.42] },
  { name: 'UV',          rgb: [0.25, 0.00, 0.75] },
];
const NC = COLORS.length;
// Upper bounds of the fixed colour positions (128–189)
const COLOR_STEPS = [129, 134, 138, 143, 147, 152, 157, 161, 166, 171, 176, 180, 185, 189];

const FIX_GOBOS = ['Open', 'Gobo 1', 'Gobo 2', 'Gobo 3', 'Gobo 4', 'Gobo 5', 'Gobo 6', 'Gobo 7', 'Reducer 1', 'Reducer 2', 'Reducer 3', 'Reducer 4'];
const ROT_GOBOS = ['Open', 'Gobo 1', 'Gobo 2', 'Gobo 3', 'Gobo 4', 'Gobo 5', 'Gobo 6', 'Gobo 7', 'Gobo 8', 'Gobo 9'];
const NF = FIX_GOBOS.length, NR = ROT_GOBOS.length;

// Prisms (product page: 6+12-facet circular, 6-facet linear, multicoloured linear, 8-facet 12° circular)
const PRISMS = {
  c18: { id: 'c18', name: '18-facet circular', rings: [[6, 0.3], [12, 0.64]], scale: 0.26 },
  l6:  { id: 'l6',  name: '6-facet linear', line: 6, scale: 0.16 },
  l6c: { id: 'l6c', name: '6-facet linear multicolour', line: 6, scale: 0.16, colors: true },
  c8:  { id: 'c8',  name: '8-facet circular', rings: [[8, 0.62]], scale: 0.3 },
};

// Virtual colour wheel: 66 presets named after LEE filter numbers. The RGB values are approximations of those filters.
const FILTERS = [
  [4, 'Medium Bastard Amber', [1, 0.82, 0.68]], [10, 'Medium Yellow', [1, 0.95, 0.1]], [19, 'Fire', [1, 0.3, 0.1]], [26, 'Bright Red', [1, 0.08, 0.05]],
  [58, 'Lavender', [0.6, 0.4, 0.95]], [68, 'Sky Blue', [0.25, 0.55, 1]], [71, 'Tokyo Blue', [0.1, 0, 0.8]], [79, 'Just Blue', [0, 0.2, 1]],
  [88, 'Lime Green', [0.75, 1, 0.2]], [90, 'Dark Yellow Green', [0.2, 0.8, 0.1]], [100, 'Spring Yellow', [0.95, 1, 0.2]], [101, 'Yellow', [1, 0.92, 0.05]],
  [102, 'Light Amber', [1, 0.85, 0.4]], [103, 'Straw', [1, 0.93, 0.7]], [104, 'Deep Amber', [1, 0.75, 0.1]], [105, 'Orange', [1, 0.5, 0]],
  [106, 'Primary Red', [1, 0.05, 0.05]], [111, 'Dark Pink', [1, 0.4, 0.65]], [115, 'Peacock Blue', [0, 0.8, 0.75]], [116, 'Medium Blue-Green', [0, 0.8, 0.7]],
  [117, 'Steel Blue', [0.65, 0.9, 0.95]], [118, 'Light Blue', [0, 0.7, 1]], [119, 'Dark Blue', [0.05, 0.1, 0.85]], [120, 'Deep Blue', [0, 0.1, 0.9]],
  [121, 'Filter Green', [0.55, 0.95, 0.25]], [128, 'Bright Pink', [1, 0.15, 0.6]], [131, 'Marine Blue', [0.3, 0.9, 0.8]], [132, 'Medium Blue', [0, 0.4, 1]],
  [134, 'Golden Amber', [1, 0.55, 0.3]], [135, 'Deep Golden Amber', [1, 0.3, 0]], [136, 'Pale Lavender', [0.85, 0.75, 1]], [137, 'Special Lavender', [0.7, 0.6, 1]],
  [138, 'Pale Green', [0.75, 1, 0.6]], [139, 'Primary Green', [0, 0.9, 0.1]], [141, 'Bright Blue', [0, 0.6, 1]], [147, 'Apricot', [1, 0.7, 0.45]],
  [148, 'Bright Rose', [1, 0.25, 0.5]], [152, 'Pale Gold', [1, 0.87, 0.72]], [154, 'Pale Rose', [1, 0.85, 0.8]], [157, 'Pink', [1, 0.45, 0.55]],
  [158, 'Deep Orange', [1, 0.4, 0]], [162, 'Bastard Amber', [1, 0.88, 0.75]], [164, 'Flame Red', [1, 0.15, 0.05]], [165, 'Daylight Blue', [0.3, 0.6, 1]],
  [169, 'Lilac Tint', [0.95, 0.88, 1]], [170, 'Deep Lavender', [0.8, 0.55, 0.95]], [172, 'Lagoon Blue', [0, 0.75, 0.9]], [179, 'Chrome Orange', [1, 0.6, 0.05]],
  [180, 'Dark Lavender', [0.55, 0.3, 0.95]], [181, 'Congo Blue', [0.25, 0, 0.75]], [197, 'Alice Blue', [0.3, 0.45, 0.95]], [201, 'Full C.T. Blue', [0.6, 0.75, 1]],
  [202, 'Half C.T. Blue', [0.8, 0.88, 1]], [203, 'Quarter C.T. Blue', [0.9, 0.94, 1]], [204, 'Full C.T. Orange', [1, 0.72, 0.4]], [205, 'Half C.T. Orange', [1, 0.84, 0.62]],
  [206, 'Quarter C.T. Orange', [1, 0.92, 0.8]], [247, 'Minus Green', [1, 0.8, 0.95]], [248, 'Half Minus Green', [1, 0.9, 0.97]], [281, 'Three Quarter C.T. Blue', [0.7, 0.82, 1]],
  [285, 'Three Quarter C.T. Orange', [1, 0.78, 0.5]], [352, 'Glacier Blue', [0.2, 0.6, 1]], [353, 'Lighter Blue', [0.4, 0.85, 1]], [715, 'Cabana Blue', [0.15, 0.5, 1]],
  [778, 'Millennium Gold', [1, 0.4, 0.1]], [793, 'Vanity Fair', [1, 0.2, 0.65]],
];
const filterOf = v => (v >= 1 && v <= FILTERS.length * 2 ? FILTERS[Math.ceil(v / 2) - 1] : null);

const CH = {
  pan: 'Pan', panFine: 'Pan Fine', tilt: 'Tilt', tiltFine: 'Tilt Fine', panCtrl: 'Pan Control', ptSpeed: 'P/T Speed', special: 'Special Func',
  ledFreq: 'LED Freq', ledFreqFine: 'LED Freq Fine', maxInt: 'Max Intensity',
  color: 'Colour Wheel', colorFine: 'Colour Fine', cyan: 'Cyan', magenta: 'Magenta', yellow: 'Yellow', cto: 'CTO', green: 'Green Corr', vColor: 'Virtual Colour',
  colorTime: 'Colour Time', fxTime: 'Effect Time',
  gobo: 'Static Gobo', rotGobo: 'Rot Gobo', rotGoboFine: 'Rot Gobo Fine', goboRot: 'Gobo Rot', goboRotFine: 'Gobo Rot Fine',
  prism1: 'Prism Wheel 1', prism1Rot: 'Prism 1 Rot', prism2: 'Prism Wheel 2', prism2Rot: 'Prism 2 Rot', fx: 'Effect Wheel', fxRot: 'Effect Rot',
  frost: 'Frost', zoom: 'Zoom', zoomFine: 'Zoom Fine', focus: 'Focus', focusFine: 'Focus Fine', strobe: 'Shutter', dimmer: 'Dimmer', dimmerFine: 'Dimmer Fine',
};
const MODES = {
  '39CH': { id: '39CH', label: '39CH', channels: ['pan', 'panFine', 'tilt', 'tiltFine', 'panCtrl', 'ptSpeed', 'special', 'ledFreq', 'ledFreqFine', 'maxInt',
    'color', 'colorFine', 'cyan', 'magenta', 'yellow', 'cto', 'green', 'vColor', 'colorTime', 'fxTime',
    'gobo', 'rotGobo', 'rotGoboFine', 'goboRot', 'goboRotFine', 'prism1', 'prism1Rot', 'prism2', 'prism2Rot', 'fx', 'fxRot',
    'frost', 'zoom', 'zoomFine', 'focus', 'focusFine', 'strobe', 'dimmer', 'dimmerFine'] },
};

/** "Auto random" wheel functions: a new slot every `period` ms */
const randomSlot = (n, period) => ((Math.floor(Date.now() / period) * 2654435761) >>> 0) % n;
/** Prism wheel channel → which of its two prisms is in the beam, and whether it rotates (otherwise it is indexed) */
const prismSel = v => (v >= 4 && v <= 19 ? { which: (v >= 8 && v <= 11) || v >= 16 ? 1 : 0, rotate: v >= 12 } : null);
/** Rotation channel shared by gobos and prisms: 0 / 128 = stop, 1–127 fast → slow, 129–255 slow → fast the other way (turns per second) */
const rotSpeed = v => (v === 0 || v === 128 ? 0 : v < 128 ? lerp(1.5, 0.03, frac(v, 1, 127)) : -lerp(0.03, 1.5, frac(v, 129, 255)));
const rotText = v => (v === 0 || v === 128 ? 'Stop' : v < 128 ? `Rotate fwd ${pct(v, 127, 1)}` : `Rotate rev ${pct(v, 129, 255)}`);
/** Frost channel → [level name, amount 0..1]; the pulse / ramp effects of each level are shown as fully in */
function frostOf(v) {
  if (v === 0 || (v >= 84 && v <= 86) || (v >= 170 && v <= 172)) return ['Open', 0];
  if (v <= 83) return ['Light', 0.3 * Math.min(1, v / 50)];
  if (v <= 169) return ['Medium', 0.65 * Math.min(1, (v - 86) / 50)];
  return ['Light + Medium', Math.min(1, (v - 172) / 50)];
}

/** Channel values (key → 0..255) → motion/optics targets */
function decode(v) {
  const g = k => v[k] | 0, w16 = (a, b) => (g(a) * 256 + g(b)) / 65535;
  const t = {};
  t.pan = w16('pan', 'panFine');
  t.tilt = w16('tilt', 'tiltFine');
  const pc = g('panCtrl');                                 // continuous pan rotation, degrees per second
  t.panSpin = pc >= 128 && pc <= 189 ? lerp(200, 6, frac(pc, 128, 189)) : pc >= 194 ? -lerp(6, 200, frac(pc, 194, 255)) : 0;
  const sp = g('ptSpeed');
  t.ptSpeed = sp < 2 ? 0 : (sp - 2) / 253;                 // 0 standard, 1 maximum, then fast → slow
  t.dimmer = w16('dimmer', 'dimmerFine');

  // CH37 shutter / strobe
  const s = g('strobe');
  if (s <= 31) t.strobe = { mode: 'closed' };
  else if (s <= 63) t.strobe = { mode: 'open' };
  else if (s <= 95) t.strobe = { mode: 'strobe', hz: lerp(1, 25, frac(s, 64, 95)) };
  else if (s <= 127) t.strobe = { mode: 'open' };
  else if (s <= 143) t.strobe = { mode: 'fadein', hz: lerp(0.5, 12, frac(s, 128, 143)) };
  else if (s <= 159) t.strobe = { mode: 'pulse', hz: lerp(12, 0.5, frac(s, 144, 159)) };
  else if (s <= 191) t.strobe = { mode: 'open' };
  else if (s <= 223) t.strobe = { mode: 'random', hz: lerp(3, 20, frac(s, 192, 223)) };
  else t.strobe = { mode: 'open' };

  // CH11 colour wheel (+ CH12 fine)
  const c = g('color'), cf = g('colorFine') / 255;
  if (c <= 127) t.color = { pos: ((c + cf) / 128) * NC, spin: 0 };                 // continual positioning: one turn of the wheel
  else if (c <= 189) t.color = { pos: COLOR_STEPS.findIndex(hi => c <= hi), spin: 0 };
  else if (c <= 215) t.color = { pos: null, spin: lerp(3.0, 0.15, frac(c, 190, 215)) };
  else if (c <= 217) t.color = { pos: null, spin: 0 };
  else if (c <= 243) t.color = { pos: null, spin: -lerp(0.15, 3.0, frac(c, 218, 243)) };
  else if (c <= 249) t.color = { pos: randomSlot(NC, 500), spin: 0 };              // random selection by audio control
  else t.color = { pos: randomSlot(NC, lerp(250, 2500, frac(c, 250, 255))), spin: 0 };

  // CH13–15 CMY, replaced by a virtual colour wheel preset (CH18) when one is selected
  const f = filterOf(g('vColor'));
  t.cmy = f ? f[2].map(x => 1 - x) : [g('cyan') / 255, g('magenta') / 255, g('yellow') / 255];
  t.cto = g('cto') / 255;

  // CH21 static gobo wheel: 7 gobos + 4 beam reducers
  const sg = g('gobo');
  if (sg <= 1) t.gobo = { pos: 0, shake: 0, spin: 0 };
  else if (sg <= 78) t.gobo = { pos: Math.floor((sg - 2) / 7) + 1, shake: 0, spin: 0 };
  else if (sg <= 199) t.gobo = { pos: Math.floor((sg - 79) / 11) + 1, shake: lerp(2, 12, ((sg - 79) % 11) / 10), spin: 0 };
  else if (sg <= 201) t.gobo = { pos: 0, shake: 0, spin: 0 };
  else if (sg <= 222) t.gobo = { pos: null, spin: lerp(2.5, 0.12, frac(sg, 202, 222)) };
  else if (sg <= 243) t.gobo = { pos: null, spin: -lerp(0.12, 2.5, frac(sg, 223, 243)) };
  else if (sg <= 249) t.gobo = { pos: 0, shake: 0, spin: 0 };
  else t.gobo = { pos: randomSlot(NF, lerp(250, 2500, frac(sg, 250, 255))), shake: 0, spin: 0 };

  // CH22 rotating gobo wheel (+ CH23 fine): the range chosen decides whether CH24 indexes or rotates the gobo
  const r = g('rotGobo'), rf = g('rotGoboFine') / 255;
  let rotating = false;
  if (r <= 31) t.rotGobo = { pos: r <= 4 ? 0 : Math.min(9, Math.floor((r - 5) / 3) + 1), shake: 0, spin: 0 };
  else if (r <= 59) { t.rotGobo = { pos: Math.min(9, Math.floor((r - 32) / 3) + 1), shake: 0, spin: 0 }; rotating = true; }
  else if (r <= 130) t.rotGobo = { pos: Math.min(NR, (r - 60 + rf) / 7), shake: 0, spin: 0 };
  else if (r <= 201) { t.rotGobo = { pos: Math.min(NR, (r - 131 + rf) / 7), shake: 0, spin: 0 }; rotating = true; }
  else if (r <= 222) t.rotGobo = { pos: null, spin: lerp(2.5, 0.12, frac(r, 202, 222)) };
  else if (r <= 243) t.rotGobo = { pos: null, spin: -lerp(0.12, 2.5, frac(r, 223, 243)) };
  else if (r <= 249) t.rotGobo = { pos: 0, shake: 0, spin: 0 };
  else t.rotGobo = { pos: randomSlot(NR, lerp(250, 2500, frac(r, 250, 255))), shake: 0, spin: 0 };
  // CH24/25 gobo indexing (16-bit) or rotation
  t.goboRot = rotating ? { index: null, spin: rotSpeed(g('goboRot')), bounce: 0 } : { index: w16('goboRot', 'goboRotFine') * 360, spin: 0, bounce: 0 };

  // CH32 frost: light, medium, or both
  t.frost = frostOf(g('frost'))[1];

  // CH26–29 two prism wheels, two prisms each. One prism is shown at a time: wheel 2 has priority; wheel 1 gives way to frost.
  const p2 = prismSel(g('prism2')), p1 = t.frost > 0 ? null : prismSel(g('prism1'));
  const sel = p2 || p1, rot = g(p2 ? 'prism2Rot' : 'prism1Rot');
  if (sel) {
    t.prism = p2 ? (sel.which ? PRISMS.c8 : PRISMS.l6c) : (sel.which ? PRISMS.l6 : PRISMS.c18);
    if (sel.rotate) t.prismRot = rotSpeed(rot); else { t.prismRot = 0; t.prismIndex = (rot / 255) * 360; }
  } else { t.prism = false; t.prismRot = 0; }

  t.zoom = 1 - w16('zoom', 'zoomFine');                    // 0 = widest beam … 255 = narrowest
  t.focus = w16('focus', 'focusFine');

  // CH7 special functions (value held for 3 s)
  const sf = g('special');
  t.reset = sf >= 130 && sf <= 131 ? 'all' : sf >= 132 && sf <= 133 ? 'xy' : sf >= 134 && sf <= 139 ? 'effect' : false;
  t.apply = sf >= 28 && sf <= 29 ? { dimCurve: 'Square Law' } : sf >= 30 && sf <= 31 ? { dimCurve: 'Linear' } : null;
  return t;
}

/** Meaning of a channel value (for the monitor and the transmitter) */
function describe(key, val) {
  const v = val | 0;
  switch (key) {
    case 'pan': return `${(((v / 255) - 0.5) * SPEC.panRange).toFixed(0)}°`;
    case 'tilt': return `${(((v / 255) - 0.5) * SPEC.tiltRange).toFixed(0)}°`;
    case 'panCtrl':
      if (v === 0) return 'Range 540°';
      if (v === 1) return 'Range 360°';
      if (v <= 127) return '—';
      if (v <= 189) return `Rotate fwd ${pct(v, 189, 128)}`;
      if (v <= 193) return 'Stop';
      return `Rotate rev ${pct(v, 194, 255)}`;
    case 'ptSpeed': return v === 0 ? 'Standard' : v === 1 ? 'Max speed' : `Slower ${pct(v, 2, 255)}`;
    case 'special':
      if (v >= 28 && v <= 29) return 'Dimmer square law (3s)';
      if (v >= 30 && v <= 31) return 'Dimmer linear (3s)';
      if (v >= 130 && v <= 131) return 'Total reset (3s)';
      if (v >= 132 && v <= 133) return 'Pan/tilt reset (3s)';
      if (v >= 134 && v <= 135) return 'Colour reset (3s)';
      if (v >= 136 && v <= 137) return 'Gobo reset (3s)';
      if (v >= 138 && v <= 139) return 'Zoom/focus/prism/frost reset (3s)';
      return v === 0 ? '—' : 'Not simulated';
    case 'ledFreq': return v <= 4 ? 'Menu setting' : v <= 9 ? '300Hz' : v <= 14 ? '600Hz' : v <= 19 ? '1200Hz' : v <= 24 ? '2400Hz' : v <= 29 ? 'High' : '—';
    case 'color': {
      if (v <= 127) { const p = (v / 128) * NC, i = Math.floor(p); return p - i < 0.07 ? COLORS[i].name : `${COLORS[i].name}→${COLORS[(i + 1) % NC].name}`; }
      if (v <= 189) return COLORS[COLOR_STEPS.findIndex(hi => v <= hi)].name;
      if (v <= 215) return `Rainbow fwd ${pct(v, 215, 190)}`;
      if (v <= 217) return 'Stop';
      if (v <= 243) return `Rainbow rev ${pct(v, 218, 243)}`;
      if (v <= 249) return 'Random (audio)';
      return 'Auto random';
    }
    case 'cyan': case 'magenta': case 'yellow': case 'dimmer': case 'maxInt': return p255(v);
    case 'cto': return `${Math.round(lerp(8500, 2700, v / 255) / 100) * 100}K`;
    case 'green': return v === 0 || v === 128 ? 'Uncorrected' : v < 128 ? `Minus green ${pct(v, 127, 1)}` : `Plus green ${pct(v, 129, 255)}`;
    case 'vColor': { const f = filterOf(v); return f ? `${f[0]} ${f[1]}` : v === 0 ? 'None' : 'Reserved'; }
    case 'colorTime': case 'fxTime': return v === 0 ? 'Off' : `${(v / 10).toFixed(1)}s`;
    case 'gobo':
      if (v <= 1) return 'Open';
      if (v <= 78) return FIX_GOBOS[Math.floor((v - 2) / 7) + 1];
      if (v <= 199) return `${FIX_GOBOS[Math.floor((v - 79) / 11) + 1]} shake`;
      if (v <= 201) return 'Open';
      if (v <= 222) return `Wheel fwd ${pct(v, 222, 202)}`;
      if (v <= 243) return `Wheel rev ${pct(v, 223, 243)}`;
      return v <= 249 ? 'Reserved' : 'Auto random';
    case 'rotGobo':
      if (v <= 31) return `${ROT_GOBOS[v <= 4 ? 0 : Math.min(9, Math.floor((v - 5) / 3) + 1)]} (index)`;
      if (v <= 59) return `${ROT_GOBOS[Math.min(9, Math.floor((v - 32) / 3) + 1)]} (rotate)`;
      if (v <= 130) return `Position ${((v - 60) / 7).toFixed(1)} (index)`;
      if (v <= 201) return `Position ${((v - 131) / 7).toFixed(1)} (rotate)`;
      if (v <= 222) return `Wheel fwd ${pct(v, 222, 202)}`;
      if (v <= 243) return `Wheel rev ${pct(v, 223, 243)}`;
      return v <= 249 ? 'Reserved' : 'Auto random';
    case 'goboRot': return `Index ${Math.round((v / 255) * 360)}° / ${rotText(v)}`;
    case 'prism1': case 'prism2': {
      const s = prismSel(v); if (!s) return v <= 3 ? 'Open' : 'Reserved';
      const P = key === 'prism2' ? (s.which ? PRISMS.c8 : PRISMS.l6c) : (s.which ? PRISMS.l6 : PRISMS.c18);
      return `${P.name} (${s.rotate ? 'rotate' : 'index'})`;
    }
    case 'prism1Rot': case 'prism2Rot': return `Index ${Math.round((v / 255) * 360)}° / ${rotText(v)}`;
    case 'fx': case 'fxRot': return v <= 3 ? 'Open' : 'Not fitted';
    case 'frost': { const [name, a] = frostOf(v); return a ? `${name} ${Math.round(a * 100)}%` : 'Open'; }
    case 'zoom': return `${lerp(SPEC.zoomMax, SPEC.zoomMin, v / 255).toFixed(1)}°`;
    case 'focus': return p255(v);
    case 'strobe':
      if (v <= 31) return 'Closed';
      if (v <= 63) return 'Open';
      if (v <= 95) return `Strobe ${lerp(1, 25, frac(v, 64, 95)).toFixed(1)}Hz`;
      if (v <= 127) return 'Open';
      if (v <= 143) return `Opening pulse ${pct(v, 128, 143)}`;
      if (v <= 159) return `Closing pulse ${pct(v, 159, 144)}`;
      if (v <= 191) return 'Open';
      if (v <= 223) return `Random ${pct(v, 192, 223)}`;
      return 'Open';
    default: return String(v);
  }
}

/** One gobo: white where light passes, on a transparent background. Origin = centre, R = aperture radius */
function drawGobo(g, wheel, idx, R) {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  const around = (n, fn, a0 = 0) => { for (let i = 0; i < n; i++) { g.save(); g.rotate(a0 + i * TAU / n); fn(i); g.restore(); } };
  if (idx === 0) return dot(0, 0, R);
  if (wheel === 'fix') {
    if (idx >= 8) return dot(0, 0, R * [0.6, 0.42, 0.28, 0.16][idx - 8]);                       // beam reducers
    switch (idx) {                                                                              // metal gobos
      case 1: around(8, () => { g.beginPath(); g.moveTo(0, -R * 0.12); g.lineTo(R * 0.09, -R * 0.85); g.lineTo(-R * 0.09, -R * 0.85); g.closePath(); g.fill(); }); break;   // eight rays
      case 2: g.lineWidth = R * 0.1; for (const k of [0.3, 0.55, 0.8]) around(3, () => { g.beginPath(); g.arc(0, 0, R * k, 0.25, TAU / 3 - 0.25); g.stroke(); }, k * 2); break;   // broken rings
      case 3: for (let i = -2; i <= 2; i++) g.fillRect(i * R * 0.33 - R * 0.07, -R * 0.8, R * 0.14, R * 1.6); break;                                              // five bars
      case 4: around(6, () => dot(0, -R * 0.58, R * 0.17)); dot(0, 0, R * 0.17); break;                                                                             // seven dots
      case 5: g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * TAU / 10, rr = R * (i & 1 ? 0.34 : 0.82); g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); break;   // star
      case 6: g.lineWidth = R * 0.09; around(3, () => { g.beginPath(); g.moveTo(-R * 0.62, -R * 0.36); g.lineTo(R * 0.62, -R * 0.36); g.stroke(); }); break;        // triangle of lines
      case 7: around(12, i => dot(0, -R * 0.7, R * (i & 1 ? 0.06 : 0.11))); around(6, () => dot(0, -R * 0.36, R * 0.08), TAU / 12); break;                           // dot circle
    }
    return;
  }
  switch (idx) {                                                                                // rotating glass gobos
    case 1: { g.lineWidth = R * 0.05; around(2, () => { g.beginPath(); for (let i = 0; i <= 200; i++) { const a = i / 200 * TAU * 1.6, rr = R * 0.85 * i / 200; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke(); }); break; }   // double spiral
    case 2: around(5, () => { g.beginPath(); g.ellipse(0, -R * 0.48, R * 0.16, R * 0.36, 0, 0, TAU); g.fill(); }); break;                                          // five petals
    case 3: { const r = rng(31); for (let i = 0; i < 26; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.8; dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.04 + r() * 0.1)); } break; }   // breakup
    case 4: g.lineWidth = R * 0.035; around(24, () => { g.beginPath(); g.moveTo(0, -R * 0.15); g.lineTo(0, -R * 0.88); g.stroke(); }); break;                      // fine rays
    case 5: { const s = R * 0.26, gap = R * 0.07; for (let i = -3; i < 3; i++) for (let j = -3; j < 3; j++) if (Math.hypot(i + 0.5, j + 0.5) < 3) g.fillRect(i * s + gap / 2, j * s + gap / 2, s - gap, s - gap); break; }   // window grid
    case 6: g.lineWidth = R * 0.07; for (let j = -3; j <= 3; j++) { g.beginPath(); for (let x = -R * 0.85; x <= R * 0.85; x += R * 0.04) g[x === -R * 0.85 ? 'moveTo' : 'lineTo'](x, j * R * 0.24 + Math.sin(x / R * 7) * R * 0.07); g.stroke(); } break;   // waves
    case 7: around(3, () => { g.beginPath(); g.moveTo(0, -R * 0.1); g.lineTo(R * 0.38, -R * 0.8); g.lineTo(-R * 0.38, -R * 0.8); g.closePath(); g.fill(); }); break;   // three wedges
    case 8: { const r = rng(52); for (let i = 0; i < 110; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.88; dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.012 + r() * r() * 0.06)); } break; }   // star field
    case 9: g.lineWidth = R * 0.06; for (const k of [0.25, 0.47, 0.69]) { g.beginPath(); g.arc(0, 0, R * k, 0, TAU); g.stroke(); } around(4, () => dot(0, -R * 0.86, R * 0.07)); break;   // rings
  }
}

const MANUAL_KEYS = ['pan', 'panFine', 'tilt', 'tiltFine', 'panCtrl', 'ptSpeed', 'color', 'cyan', 'magenta', 'yellow', 'cto', 'vColor', 'gobo', 'rotGobo', 'goboRot',
  'prism1', 'prism1Rot', 'prism2', 'prism2Rot', 'frost', 'zoom', 'focus', 'strobe', 'dimmer'];

export default {
  id: 'apexpointe420', code: 'ApexPointe 420', name: 'ApexPointe 420', title: '420W LED Beam / Spot / Wash Hybrid', lcdTitle: 'APEXPOINTE 420',
  spec: SPEC, colors: COLORS, gobos: { fix: FIX_GOBOS, rot: ROT_GOBOS, draw: drawGobo },
  ch: CH, modes: MODES, defaultMode: '39CH', decode, describe,
  features: { prism: true, gobos: true, cmy: true, cto: true, blades: false, scenes: false, ms: false, lamp: false },
  noSignal: 'manual',
  manualDefaults: { pan: 128, tilt: 70, strobe: 40, dimmer: 255, zoom: 128, focus: 128, goboRot: 128, green: 128, ledFreq: 12, ledFreqFine: 128 },
  homeValues: { pan: 128, tilt: 128, zoom: 128, focus: 128, strobe: 32, goboRot: 128, green: 128, ledFreq: 12, ledFreqFine: 128 },
  resetHold: 3,
  settings: { flip: false, dispMode: 'Show', dimCurve: 'Square Law', cal: { pan: 128, tilt: 128 } },
  offsets: S => [(S.cal.pan - 128) * 0.1, (S.cal.tilt - 128) * 0.1],
  // Built-in program (stand-alone / sound) — one step = a set of channel values
  program: {
    base: { dimmer: 255, strobe: 40, focus: 128, goboRot: 128 },
    steps: [
      { pan: 110, tilt: 80, zoom: 250, color: 132, gobo: 60 },                                   // tight red beam through a reducer
      { pan: 150, tilt: 95, zoom: 150, cyan: 255, rotGobo: 35, goboRot: 100 },
      { pan: 128, tilt: 70, zoom: 200, color: 150, prism1: 13, prism1Rot: 90 },                  // 18-facet prism turning
      { pan: 95, tilt: 100, zoom: 60, magenta: 200, yellow: 120, rotGobo: 44, goboRot: 170 },
      { pan: 165, tilt: 85, zoom: 180, rotGobo: 38, goboRot: 60, prism2: 13, prism2Rot: 100 },   // multicoloured linear prism
      { pan: 128, tilt: 110, zoom: 20, vColor: 100, frost: 210 },                                // wash
      { pan: 140, tilt: 60, zoom: 230, color: 174, gobo: 30, prism2: 17, prism2Rot: 170 },
      { pan: 115, tilt: 90, zoom: 120, yellow: 255, cyan: 120, rotGobo: 53, goboRot: 200, prism1: 17, prism1Rot: 60 },
    ],
  },
  // Panel: the product page only says "colour LCD display" — the button panel and menu of the 250W BSW are assumed.
  panel: { type: 'buttons', password: 50, manualKeys: MANUAL_KEYS, calKeys: ['pan', 'tilt'], versions: ['Panel: V1.000', 'XY Motor: V1.000', 'Motor: V1.000'] },
  rdm: { modelId: 0x0420, description: 'Wincode ApexPointe 420', software: 'Panel V1.000' },
  // Body: overall size 386 × 234 × 673 mm from the product page; proportions of base, yoke and head from the product photos.
  body: {
    H: 0.673, style: 'round', handles: false,
    base: { hw: 0.193, bot: 0.045, top: 0.13, shoulder: 0.106, chamfer: 0.035, depth: 0.234, frameW: 0.2, frameH: 0.066, panelY: 0.088 },
    feet: { r: 0.02, h: 0.045, x: 0.125, z: 0.08 },
    turntable: { r: 0.1, h: 0.02 }, panY: 0.15,
    bridge: [{ y: 0, w: 0.28, d: 0.14, r: 0.04 }, { y: 0.014, w: 0.366, d: 0.16, r: 0.04 }, { y: 0.045, w: 0.371, d: 0.155, r: 0.04 }, { y: 0.062, w: 0.356, d: 0.13, r: 0.04 }],
    arm: { x: 0.159, t: 0.05, shape: [[-0.08, 0.027], [0.08, 0.027], [0.066, 0.222], [0.048, 0.275], [0.018, 0.297], [-0.018, 0.297], [-0.048, 0.275], [-0.066, 0.222]] },
    tiltY: 0.262,
    head: [{ y: -0.152, w: 0.12 }, { y: -0.14, w: 0.19 }, { y: -0.087, w: 0.216 }, { y: 0.083, w: 0.216 }, { y: 0.112, w: 0.196 }, { y: 0.145, w: 0.226 }, { y: 0.218, w: 0.232 }, { y: 0.228, w: 0.222 }],
    fins: { y0: -0.079, y1: 0.07, n: 9, r: 0.11 }, plate: { y: 0.0, z: 0.109 },
    lensY: 0.232, lensR: 0.08, ringR: 0.1,                      // lens dome adds 29 mm: 0.150 + 0.262 + 0.232 + 0.029 = 0.673
    lcd: [0.058, 0.0435], lcdX: -0.036, controls: 'cross5', ctrlX: 0.042,
  },
  assumptions: [
    'Wincode publishes no manual for the ApexPointe 420. Its product page says the fixture is compatible with the Robe LEDPointe fixture library, so the 39-channel layout and value ranges follow the public Robe "ROBIN ledPOINTE DMX protocol" chart. Check them against the real fixture before relying on them.',
    'Effect wheel channels 30–31 (SpektraBeam on the Robe fixture) are kept in the channel list but do nothing: the ApexPointe product page lists no such effect.',
    'Only one prism is shown at a time: prism wheel 2 has priority over wheel 1, and frost pushes wheel 1 out of the beam. Stacking two prisms is not simulated.',
    'Frost: light = 30 %, medium = 65 %, both = 100 % of the simulator\'s single frost; the frost pulse / ramp effects are shown as fully in.',
    'Virtual colour wheel presets replace the CMY channels; their colours are approximations of the LEE filters they are named after.',
    'Not simulated: green correction, LED frequency, maximum intensity, colour / effect time channels, pan range 360° shortcut, and the special functions other than reset and dimmer curve.',
    '"Random by audio" on the colour wheel changes colour twice a second (no microphone).',
    'Gobo artwork is original: the product page shows no gobo drawings. Beam reducers are 60 / 42 / 28 / 16 % of the aperture.',
    'Colour wheel order and names follow the compatible chart; the colours themselves are approximations.',
    'Front panel: the product page only says "colour LCD display"; the button panel, menu tree and password (050) of the 250W BSW are assumed.',
    'Overall size 386 × 234 × 673 mm is from the product page; the proportions of base, yoke and head are estimated from the product photos.',
    'Continuous pan rotation speed range (6–200°/s) and the strobe / pulse rates are estimates.',
  ],
};
