// models/apexpointe420.js — Wincode ApexPointe 420 (420W LED Beam / Spot / Wash / FX hybrid)
//  Source: the fixture's user manual ("LED480 POINTE BSW Moving Head User Manual", the document Wincode supplies for the
//  ApexPointe 420) — chapter 2 (technical parameters), 4.1 (panel), 4.2 (gobo wheels), 4.3 (menu table), 6 (39CH channel
//  table); product page: overall size 386 × 234 × 673 mm and the product photos.
//  Anything the manual does not state is listed in `assumptions`.
import { lerp, frac, pct, p255, rng, TAU } from './util.js';

const SPEC = {
  panRange: 540, tiltRange: 270,
  zoomMin: 3.2, zoomMax: 42.6,      // product page
  ledWhite: [0.86, 0.93, 1.0],      // 8500–9000K
  cd: 2600,                         // on-screen intensity at the narrowest zoom (420 W engine, 3.2° beam)
  focus: [0.4, 0.12],               // in-focus position = a + b·zoom
  tempRise: 42,
};

// Colour wheel: open + 13 colours, names and order from the CH11 table
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

// Prisms (chapter 2 and CH26 / CH28): wheel 1 = 18-facet circular, 6-facet linear; wheel 2 = 6-facet linear multicoloured, 8-facet 12° circular
const PRISMS = {
  c18: { id: 'c18', name: '18-facet circular', rings: [[6, 0.3], [12, 0.64]], scale: 0.26 },
  l6:  { id: 'l6',  name: '6-facet linear', line: 6, scale: 0.16 },
  l6c: { id: 'l6c', name: '6-facet linear multicolour', line: 6, scale: 0.16, colors: true },
  c8:  { id: 'c8',  name: '8-facet circular', rings: [[8, 0.62]], scale: 0.3 },
};

// CH18 virtual colour wheel: the 66 presets of the channel table (LEE filter numbers). The RGB values are approximations of those filters.
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
  pan: 'Pan', panFine: 'Pan Fine', tilt: 'Tilt', tiltFine: 'Tilt Fine', panCtrl: 'Pan ctrl', ptSpeed: 'PT spd', special: 'Reset',
  ledFreq: 'LED freq', ledFreqFine: 'Empty (9)', maxInt: 'Empty (10)',
  color: 'Colour', colorFine: 'Colour F', cyan: 'Cyan', magenta: 'Magenta', yellow: 'Yellow', cto: 'CTO', green: 'Green C', vColor: 'CMY Macro',
  colorTime: 'CMY spd', fxTime: 'Focus spd',
  gobo: 'GOBO', rotGobo: 'Rot gobo', rotGoboFine: 'Rot Gobo.f', goboRot: 'Gobo Rot', goboRotFine: 'Gobo.R.f',
  prism1: 'Prism1', prism1Rot: 'Prism 1R', prism2: 'Prism2', prism2Rot: 'Prism 2R', fx: 'Beam Shape', fxRot: 'Beam Shape R',
  frost: 'Frost', zoom: 'Zoom', zoomFine: 'Zoom F', focus: 'Focus', focusFine: 'Focus F', strobe: 'Strobe', dimmer: 'Dimmer', dimmerFine: 'Dimmer F',
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

  // CH26–29 two prism wheels, two prisms each. One prism is shown at a time: wheel 2 has priority. The channel table says
  // that neither prism wheel can be in the beam together with the frost: frost wins.
  const p2 = t.frost > 0 ? null : prismSel(g('prism2')), p1 = t.frost > 0 ? null : prismSel(g('prism1'));
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
      if (v >= 20 && v <= 21) return 'Display on';
      if (v >= 22 && v <= 23) return 'Display off';
      if (v >= 32 && v <= 33) return 'Fans auto';
      if (v >= 34 && v <= 35) return 'Fans high';
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
    case 'cyan': case 'magenta': case 'yellow': case 'dimmer': return p255(v);
    case 'ledFreqFine': case 'maxInt': return '—';
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
    case 'fx': return v <= 3 ? 'Open' : v <= 63 ? `Effect ${Math.floor(((v - 4) % 30) / 2) + 1} (not simulated)` : 'Reserved';
    case 'fxRot': return `Index ${Math.round((v / 255) * 360)}° / ${rotText(v)}`;
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

/** One gobo: white where light passes, on a transparent background. Origin = centre, R = aperture radius.
 *  Redrawn from the wheel pictures in manual 4.2. */
function drawGobo(g, wheel, idx, R) {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  const around = (n, fn, a0 = 0) => { for (let i = 0; i < n; i++) { g.save(); g.rotate(a0 + i * TAU / n); fn(i); g.restore(); } };
  if (idx === 0) return dot(0, 0, R);
  if (wheel === 'fix') {
    if (idx >= 8) return dot(0, 0, R * [0.62, 0.46, 0.34, 0.2][idx - 8]);                       // four beam reducers, large to small
    switch (idx) {                                                                              // seven metal gobos
      case 1: g.fillRect(-R * 0.07, -R * 0.72, R * 0.14, R * 1.44); break;                                                     // slot
      case 2: g.rotate(1.2); g.fillRect(-R * 0.07, -R * 0.72, R * 0.14, R * 1.44); break;                                      // slot, turned
      case 3: g.lineWidth = R * 0.07; around(4, () => { g.beginPath(); g.ellipse(0, -R * 0.4, R * 0.24, R * 0.3, 0, 0, TAU); g.stroke(); }); break;   // four-leaf rings
      case 4: g.lineWidth = R * 0.13; around(4, () => { g.beginPath(); g.arc(0, 0, R * 0.62, 0.14, TAU / 4 - 0.14); g.stroke(); }); break;            // segmented ring
      case 5: around(5, () => dot(0, -R * 0.42, R * 0.15)); dot(0, 0, R * 0.15); break;                                         // six dots
      case 6: g.lineWidth = R * 0.07; around(3, () => { g.beginPath(); g.moveTo(0, -R * 0.75); g.lineTo(0, R * 0.75); g.stroke(); }); break;          // asterisk
      case 7: around(4, () => { for (let i = -2; i <= 2; i++) dot(i * R * 0.17, -R * 0.52 + Math.abs(i) * R * 0.09, R * 0.065); }, TAU / 8); break;   // beaded square
    }
    return;
  }
  switch (idx) {                                                                                // nine rotating glass gobos
    case 1: g.lineWidth = R * 0.09; around(12, () => { g.beginPath(); g.moveTo(R * 0.06, -R * 0.26); g.quadraticCurveTo(R * 0.3, -R * 0.5, R * 0.12, -R * 0.84); g.stroke(); }); break;   // curved petals
    case 2: around(26, i => { const l = i & 1 ? 0.62 : 0.86; g.beginPath(); g.moveTo(0, -R * 0.3); g.lineTo(R * 0.035, -R * l); g.lineTo(-R * 0.035, -R * l); g.closePath(); g.fill(); }); break;   // ray burst
    case 3: g.lineWidth = R * 0.07; around(7, () => { g.translate(0, -R * 0.56); g.rotate(0.5); g.strokeRect(-R * 0.13, -R * 0.13, R * 0.26, R * 0.26); }); break;   // ring of squares
    case 4: { g.save(); g.beginPath(); g.arc(0, 0, R * 0.84, 0, TAU); g.clip(); g.rotate(-0.9); for (let i = -4; i <= 4; i++) g.fillRect(i * R * 0.24 - R * 0.07, -R, R * 0.14, R * 2); g.restore(); break; }   // slanted bars
    case 5: g.lineWidth = R * 0.022; around(4, q => { const n = q & 1 ? 6 : 9, w = q & 1 ? 0.5 : 0.9; for (let i = 0; i < n; i++) { const a = (i / (n - 1) - 0.5) * w; g.beginPath(); g.moveTo(Math.sin(a) * R * 0.22, -Math.cos(a) * R * 0.22); g.lineTo(Math.sin(a) * R * 0.86, -Math.cos(a) * R * 0.86); g.stroke(); } }); break;   // four fans
    case 6: g.lineWidth = R * 0.026; around(34, () => { g.beginPath(); g.moveTo(0, -R * 0.26); g.quadraticCurveTo(R * 0.42, -R * 0.42, R * 0.38, -R * 0.8); g.stroke(); }); break;   // vortex
    case 7: { g.rotate(0.6); for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) { const x = i * R * 0.16, y = j * R * 0.16, d = Math.hypot(x, y) / R; if (d < 0.82) { g.beginPath(); g.ellipse(x, y, R * (0.035 + 0.035 * (1 - d)), R * 0.05, 0.6, 0, TAU); g.fill(); } } break; }   // warped dot grid
    case 8: g.lineWidth = R * 0.022; for (const [n, r0, r1] of [[6, 0.0, 0.3], [10, 0.26, 0.56], [14, 0.52, 0.84]]) around(n, () => { const w = R * (r0 + r1) * 0.5 * Math.sin(Math.PI / n) * 1.25; g.beginPath(); g.moveTo(0, -R * r0); g.lineTo(w, -R * (r0 + r1) / 2); g.lineTo(0, -R * r1); g.lineTo(-w, -R * (r0 + r1) / 2); g.closePath(); g.stroke(); }, n * 0.1); break;   // petal mesh
    case 9: { const r = rng(52); for (let i = 0; i < 120; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.86; dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.014 + r() * r() * 0.055)); } break; }   // scattered dots
  }
}

// Values the channel table marks as defaults (shutter open, rotation stopped, zoom / focus centred)
const DEFAULTS = { zoom: 128, focus: 128, strobe: 32, goboRot: 128, prism1Rot: 128, prism2Rot: 128, fxRot: 128, green: 128, ledFreq: 10 };

export default {
  id: 'apexpointe420', code: 'ApexPointe 420', name: 'ApexPointe 420', title: '420W LED Beam / Spot / Wash Hybrid', lcdTitle: 'APEXPOINTE 420',
  spec: SPEC, colors: COLORS, gobos: { fix: FIX_GOBOS, rot: ROT_GOBOS, draw: drawGobo },
  ch: CH, modes: MODES, defaultMode: '39CH', decode, describe,
  features: { prism: true, gobos: true, cmy: true, cto: true, blades: false, scenes: true, ms: true, lamp: true },
  noSignal: 'hold',                                 // Advanced → Data hold: ON keeps the last frame, OFF returns to the post-reset state
  homeValues: { pan: 128, tilt: 128, ...DEFAULTS },
  sceneDefault: { pan: 128, tilt: 70, dimmer: 255, ...DEFAULTS, strobe: 40 },
  resetHold: 3,
  settings: { msMode: 'Auto', sceneSel: 'Auto', saver: 'OFF', rot: 'OFF', dmxInd: 'Mode1', sigBright: 10, scrLight: 10, touch: true,
    rectify: true, panOffset: 10, tiltOffset: 10, dataHold: false, lampMode: 'After reset', dimCurve: 'Square Law' },
  offsets: S => [(S.panOffset - 10) * 0.2, (S.tiltOffset - 10) * 0.2],
  // Built-in program (stand-alone / sound) — one step = a set of channel values
  program: {
    base: { dimmer: 255, ...DEFAULTS, strobe: 40 },
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
  // Panel: touch screen (menu table 4.3: Touch Enable / Touch Rectify) plus the four buttons of drawing 4.1
  panel: { type: 'touch', versions: { device: 'APEXPOINTE 420', model: 'ApexPointe 420', panel: 'H3.12', main: 'H3.12' } },
  rdm: { modelId: 0x0420, description: 'Wincode ApexPointe 420', software: 'H3.12' },
  // Body: overall size 386 × 234 × 673 mm from the product page; proportions of base, yoke and head from the product photos.
  body: {
    H: 0.673, style: 'round',                                   // 386 × 234 × 673 mm (product page); shapes from the manual cover drawing and the product photos
    base: { hw: 0.172, bot: 0.04, top: 0.112, shoulder: 0.092, chamfer: 0.022, depth: 0.23, frameW: 0.19, frameH: 0.058, panelY: 0.074, handle: 'bar' },
    feet: { r: 0.02, h: 0.04, x: 0.125, z: 0.08 },
    turntable: { r: 0.095, h: 0.012 }, panY: 0.124,
    yoke: { W: 0.391, t: 0.05, wb: 0.22, h1: 0.07, h2: 0.105, yf: 0.03, c: 0.035, d: 0.15, armW: 0.113, top: 0.34 },
    tiltY: 0.262,
    // rear box with flat faces → neck → one wide lens barrel
    head: [{ y: -0.2, w: 0.12, d: 0.1, r: 0.03 }, { y: -0.188, w: 0.2, d: 0.17, r: 0.04 }, { y: -0.11, w: 0.24, d: 0.205, r: 0.04 }, { y: 0.1, w: 0.24, d: 0.205, r: 0.04 }, { y: 0.135, w: 0.2, d: 0.19, r: 0.085 },
      { y: 0.15, w: 0.2 }, { y: 0.165, w: 0.24 }, { y: 0.243, w: 0.24 }, { y: 0.255, w: 0.222 }],
    vents: [{ side: 'x', off: 0.121, y: -0.03, h: 0.06, n: 5, pitch: 0.012 }], plate: { y: 0.0, z: 0.104 },
    lensY: 0.256, lensR: 0.094, ringR: 0.108,                   // lens dome adds 31 mm: 0.124 + 0.262 + 0.256 + 0.031 = 0.673
    lcd: [0.05, 0.04], lcdX: -0.012, controls: 'col4', ctrlX: 0.034,
  },
  assumptions: [
    'The manual is titled "LED480 POINTE BSW Moving Head"; it is the document supplied for the ApexPointe 420 and its technical parameters (420 W LED, zoom 3.2–42.6°, 39CH) are those of this fixture.',
    'Overall size 386 × 234 × 673 mm is from the product page (the manual only gives the package size); the proportions of base, yoke and head are estimated from the manual\'s cover drawing and the product photos.',
    'Front panel: the menu table has Touch Enable / Touch Rectify, so the simulator\'s shared touch-panel menu is used. Its pages differ from the manual\'s table in details (Fan mode, Dim mode, Dim freq, stepper information are not reproduced; a Lamp switch is shown although this is an LED fixture).',
    'Drawing 4.1 shows four buttons (MENU, UP, DOWN, ENTER) in a column next to the display; the on-screen key captions are those of the encoder panel.',
    'Beam Shape channels 30–31 (the "SpektraBeam" effects of the channel table) are in the channel list but are not simulated; they do not block the prisms or gobos here.',
    'Only one prism is shown at a time: prism wheel 2 has priority over wheel 1. Stacking two prisms is not simulated. As the channel table states, frost pushes both prism wheels out of the beam.',
    'Frost: light = 30 %, medium = 65 %, combined = 100 % of the simulator\'s single frost; the frost pulse / ramp effects are shown as fully in.',
    'Virtual colour wheel (CH18) presets replace the CMY channels; their colours are approximations of the LEE filters they are named after.',
    'Not simulated: green correction, LED frequency, CMY / focus speed channels, pan range 360° shortcut, display on / off and fan modes of CH7, and the microphone ("random by audio" changes colour twice a second).',
    'CH39 is "Dimmer Spd" in the menu\'s Scene list but "Dimmer intensity – fine" in the channel table: the channel table is used. CH9 and CH10 are "Empty".',
    'CH16 CTO is described as 6700K → 2700K in the channel table and 2700K–9000K in chapter 2: the monitor shows 8500K → 2700K.',
    'Gobo artwork is redrawn from the pictures in 4.2. The fixed wheel picture is small: its gobo order (clockwise from the open hole) and the reducer sizes (62 / 46 / 34 / 20 % of the aperture) are estimates.',
    'Colour wheel names follow the channel table; the colours themselves are approximations.',
    'Continuous pan rotation speed range (6–200°/s), the strobe / pulse rates and the 3 s hold time of CH7 are estimates.',
  ],
};
