// models/mega480.js — Wincode Mega480 (WOP-M480BSW) 480W Beam / Spot / Wash with CMY
//  Source: "MEGA480W BSW Moving Head Light User Manual" — chapter 2 (technical parameters), 3 (photometrics),
//  4.1–4.3 (panel, wheel pictures, menu table), 6 (34CH / 39CH channel table); product page: overall size 391 × 230 × 673 mm,
//  touch screen. Anything the manual does not state is listed in `assumptions`.
import { lerp, frac, pct, p255, rng, TAU } from './util.js';

const SPEC = {
  panRange: 540, tiltRange: 270,
  zoomMin: 1.6, zoomMax: 44,        // manual chapter 2: beam angle 1.6°–44°
  ledWhite: [0.90, 0.95, 1.0],      // 7800K discharge lamp
  cd: 3000,                         // on-screen intensity at the narrowest zoom (manual: 1 011 360 lx @ 5 m, 1.6°)
  focus: [0.4, 0.12],               // in-focus position = a + b·zoom
  tempRise: 48,
};

// Colour wheel: open + 13 colours, names and order from the CH10 table and the wheel picture in 4.2
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
// Upper bounds of the fixed colour positions (CH10 130–189)
const COLOR_STEPS = [134, 138, 143, 147, 152, 157, 161, 166, 171, 176, 180, 185, 189];

// Static wheel: 10 metal gobos + 4 beam reducers; rotating wheel: 9 gobos (pictures in 4.2)
const FIX_GOBOS = ['Open', 'Dot Ring', 'Fan', 'Slash', 'Bar', 'Three Dots', 'Star', 'Four Dots', 'Triangle', 'Lines', 'Dot Cluster',
  'Reducer 1', 'Reducer 2', 'Reducer 3', 'Reducer 4'];
const ROT_GOBOS = ['Open', 'Petals', 'Pebbles', 'Windmill', 'Zebra', 'Dot Halo', 'Dashes', 'Foliage', 'Ovals', 'Leaves'];
const NF = FIX_GOBOS.length, NR = ROT_GOBOS.length;

// Prism wheels (chapter 2 and the CH23 / CH25 tables): three prisms each
const PRISMS = {
  l6:   { id: 'l6',   name: '6-facet linear', line: 6, scale: 0.16 },
  cyl:  { id: 'cyl',  name: 'Cylindrical', line: 9, scale: 0.1 },
  c8n:  { id: 'c8n',  name: '8-facet 12° circular', rings: [[8, 0.5]], scale: 0.3 },
  l6b:  { id: 'l6b',  name: '6-facet linear', line: 6, scale: 0.16 },
  c32:  { id: 'c32',  name: '32-facet circular', rings: [[4, 0.2], [10, 0.5], [18, 0.82]], scale: 0.15 },
  c8w:  { id: 'c8w',  name: '8-facet 18° circular', rings: [[8, 0.7]], scale: 0.3 },
};
const WHEEL1 = [PRISMS.l6, PRISMS.cyl, PRISMS.c8n], WHEEL2 = [PRISMS.l6b, PRISMS.c32, PRISMS.c8w];

// CH12 "CMY Macro": the 66 preset colours of the virtual colour wheel. The manual does not list them — see `assumptions`.
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

// Channel names: the manual's channel table (section 6)
const CH = {
  pan: 'X-540°', panFine: 'X Fine', tilt: 'Y-270°', tiltFine: 'Y Fine', ptSpeed: 'XY speed', special: 'Lamp / Reset',
  cyan: 'Cyan', magenta: 'Magenta', yellow: 'Yellow', color: 'Colour wheel', colorFine: 'Colour Fine', cmyMacro: 'CMY Macro',
  fxSpeed: 'Effect Speed', colorTime: 'CMY/Colour time', zfTime: 'Z/F/F/P time', fxPos: 'Effect wheel pos', fxRot: 'Effect wheel rot', fxAnim: 'Effect wheel anim',
  gobo: 'Static gobo', rotGobo: 'Rot gobo', goboRot: 'Gobo rot', goboRotFine: 'Gobo rot Fine',
  prism1: 'Prism wheel 1', prism1Rot: 'Prism 1 rot', prism2: 'Prism wheel 2', prism2Rot: 'Prism 2 rot',
  pattern: 'Pattern', patternRot: 'Pattern rot', shaper: 'Beam shaper', shaperRot: 'Shaper rot',
  frost: 'Frost', zoom: 'Zoom', zoomFine: 'Zoom Fine', focus: 'Focus', focusFine: 'Focus Fine', hotspot: 'Hot-Spot',
  strobe: 'Shutter/strobe', dimmer: 'Dimmer', dimmerFine: 'Dimmer Fine',
};
const CH39 = ['pan', 'panFine', 'tilt', 'tiltFine', 'ptSpeed', 'special', 'cyan', 'magenta', 'yellow', 'color', 'colorFine', 'cmyMacro', 'fxSpeed', 'colorTime', 'zfTime',
  'fxPos', 'fxRot', 'fxAnim', 'gobo', 'rotGobo', 'goboRot', 'goboRotFine', 'prism1', 'prism1Rot', 'prism2', 'prism2Rot', 'pattern', 'patternRot', 'shaper', 'shaperRot',
  'frost', 'zoom', 'zoomFine', 'focus', 'focusFine', 'hotspot', 'strobe', 'dimmer', 'dimmerFine'];
// 34CH = 39CH without the five fine channels marked "*" in the table
const FINE_ONLY = ['colorFine', 'goboRotFine', 'zoomFine', 'focusFine', 'dimmerFine'];
const MODES = {
  '34CH': { id: '34CH', label: '34CH', channels: CH39.filter(k => !FINE_ONLY.includes(k)) },
  '39CH': { id: '39CH', label: '39CH', channels: CH39 },
};

/** "Random selection" wheel functions: a new slot every `period` ms */
const randomSlot = (n, period) => ((Math.floor(Date.now() / period) * 2654435761) >>> 0) % n;
/** Prism wheel channel → which of its three prisms is in the beam, and whether it rotates (otherwise it is indexed) */
const prismSel = v => (v >= 4 && v <= 27 ? { which: ((v - 4) >> 2) % 3, rotate: v >= 16 } : null);
/** Rotation channels: 0 / 128 = stop, 1–127 forwards fast → slow, 129–255 backwards slow → fast (turns per second) */
const rotSpeed = v => (v === 0 || v === 128 ? 0 : v < 128 ? lerp(1.5, 0.03, frac(v, 1, 127)) : -lerp(0.03, 1.5, frac(v, 129, 255)));
const rotText = v => (v === 0 || v === 128 ? 'Stop' : v < 128 ? `Rotate fwd ${pct(v, 127, 1)}` : `Rotate rev ${pct(v, 129, 255)}`);
/** Frost channel → [level name, amount 0..1]; the pulse / ramp effects of each level are shown as fully in */
function frostOf(v) {
  if (v === 0 || (v >= 84 && v <= 86) || (v >= 170 && v <= 172)) return ['Open', 0];
  if (v <= 83) return ['Light', 0.3 * Math.min(1, v / 50)];
  if (v <= 169) return ['Medium', 0.65 * Math.min(1, (v - 86) / 50)];
  return ['Combined', 0.3 + 0.7 * Math.min(1, (v - 172) / 50)];
}
/** Rotating gobo wheel channel → { pos | spin, shake, rotating (CH21 rotates instead of indexing) } */
function rotGoboOf(r) {
  const slot = (lo, w) => Math.min(NR - 1, Math.floor((r - lo) / w) + 1), shake = lo => lerp(2, 12, Math.min(1, ((r - lo) % 8) / 7));
  if (r <= 4) return { pos: 0, shake: 0, spin: 0 };
  if (r <= 31) return { pos: slot(5, 3), shake: 0, spin: 0 };
  if (r <= 59) return { pos: slot(32, 3), shake: 0, spin: 0, rotating: true };
  if (r <= 129) return { pos: slot(60, 8), shake: shake(60), spin: 0 };
  if (r <= 199) return { pos: slot(130, 8), shake: shake(130), spin: 0, rotating: true };
  if (r <= 201) return { pos: 0, shake: 0, spin: 0 };
  if (r <= 222) return { pos: null, spin: lerp(2.5, 0.12, frac(r, 202, 222)) };
  if (r <= 243) return { pos: null, spin: -lerp(0.12, 2.5, frac(r, 223, 243)) };
  if (r <= 249) return { pos: randomSlot(NR, 500), shake: 0, spin: 0 };
  return { pos: randomSlot(NR, lerp(250, 2500, frac(r, 250, 255))), shake: 0, spin: 0 };
}

/** Channel values (key → 0..255) → motion/optics targets. The fine channels missing in 34CH mode count as 0. */
function decode(v) {
  const g = k => v[k] | 0, w16 = (a, b) => (b in v ? (g(a) * 256 + g(b)) / 65535 : g(a) / 255);
  const t = {};
  t.pan = w16('pan', 'panFine');
  t.tilt = w16('tilt', 'tiltFine');
  t.ptSpeed = g('ptSpeed') / 255;                          // 0 = fastest
  t.dimmer = w16('dimmer', 'dimmerFine');

  // CH37/33 shutter / strobe
  const s = g('strobe');
  if (s <= 31) t.strobe = { mode: 'closed' };
  else if (s <= 63) t.strobe = { mode: 'open' };
  else if (s <= 95) t.strobe = { mode: 'strobe', hz: lerp(1, 20, frac(s, 64, 95)) };
  else if (s <= 127) t.strobe = { mode: 'open' };
  else if (s <= 143) t.strobe = { mode: 'fadein', hz: lerp(0.5, 12, frac(s, 128, 143)) };
  else if (s <= 159) t.strobe = { mode: 'pulse', hz: lerp(12, 0.5, frac(s, 144, 159)) };
  else if (s <= 191) t.strobe = { mode: 'open' };
  else if (s <= 223) t.strobe = { mode: 'random', hz: lerp(3, 20, frac(s, 192, 223)) };
  else t.strobe = { mode: 'open' };

  // CH10 colour wheel (+ CH11 fine in 39CH)
  const c = g('color'), cf = (g('colorFine') / 255) * 0.5;
  if (c <= 129) t.color = { pos: cf, spin: 0 };
  else if (c <= 189) t.color = { pos: COLOR_STEPS.findIndex(hi => c <= hi) + 1 + cf, spin: 0 };
  else if (c <= 215) t.color = { pos: null, spin: lerp(3.0, 0.15, frac(c, 190, 215)) };
  else if (c <= 217) t.color = { pos: null, spin: 0 };
  else if (c <= 243) t.color = { pos: null, spin: -lerp(0.15, 3.0, frac(c, 218, 243)) };
  else if (c <= 249) t.color = { pos: randomSlot(NC, 500), spin: 0 };               // random selection by audio control
  else t.color = { pos: randomSlot(NC, lerp(250, 2500, frac(c, 250, 255))), spin: 0 };

  // CH7–9 CMY, replaced by a preset of the virtual colour wheel (CMY Macro) when one is selected
  const f = filterOf(g('cmyMacro'));
  t.cmy = f ? f[2].map(x => 1 - x) : [g('cyan') / 255, g('magenta') / 255, g('yellow') / 255];

  // Static gobo wheel: 10 gobos + 4 beam reducers
  const sg = g('gobo');
  if (sg <= 3) t.gobo = { pos: 0, shake: 0, spin: 0 };
  else if (sg <= 87) t.gobo = { pos: Math.floor((sg - 4) / 6) + 1, shake: 0, spin: 0 };
  else if (sg <= 199) t.gobo = { pos: Math.floor((sg - 88) / 8) + 1, shake: lerp(2, 12, ((sg - 88) % 8) / 7), spin: 0 };
  else if (sg <= 201) t.gobo = { pos: 0, shake: 0, spin: 0 };
  else if (sg <= 222) t.gobo = { pos: null, spin: lerp(2.5, 0.12, frac(sg, 202, 222)) };
  else if (sg <= 243) t.gobo = { pos: null, spin: -lerp(0.12, 2.5, frac(sg, 223, 243)) };
  else if (sg <= 249) t.gobo = { pos: randomSlot(NF, 500), shake: 0, spin: 0 };
  else t.gobo = { pos: randomSlot(NF, lerp(250, 2500, frac(sg, 250, 255))), shake: 0, spin: 0 };

  // Rotating gobo wheel: the range chosen decides whether the next channel indexes or rotates the gobo
  const r = g('rotGobo'), rg = rotGoboOf(r);
  t.rotGobo = rg;
  t.goboRot = rg.rotating ? { index: null, spin: rotSpeed(g('goboRot')), bounce: 0 } : { index: w16('goboRot', 'goboRotFine') * 360, spin: 0, bounce: 0 };

  // Two prism wheels, one prism shown at a time. Prism wheel 1 is blocked while the rotating gobo channel is above 0.
  const p2 = prismSel(g('prism2')), p1 = r > 0 ? null : prismSel(g('prism1'));
  const sel = p2 || p1, rot = g(p2 ? 'prism2Rot' : 'prism1Rot');
  if (sel) {
    t.prism = (p2 ? WHEEL2 : WHEEL1)[sel.which];
    if (sel.rotate) t.prismRot = rotSpeed(rot); else { t.prismRot = 0; t.prismIndex = (rot / 255) * 360; }
  } else { t.prism = false; t.prismRot = 0; }

  // Frost: light, medium or combined. Prism wheel 1 has priority over the combined frost.
  const fr = g('frost');
  t.frost = p1 && fr >= 173 ? 0 : frostOf(fr)[1];

  t.zoom = 1 - w16('zoom', 'zoomFine');                    // from max. to min. beam angle
  t.focus = w16('focus', 'focusFine');

  // CH6 lamp / reset
  const sf = g('special');
  t.reset = sf >= 140 && sf <= 149 ? 'xy' : sf >= 150 && sf <= 199 ? 'effect' : sf >= 200 && sf <= 209 ? 'all' : false;
  return t;
}

/** Meaning of a channel value (for the monitor and the transmitter) */
function describe(key, val) {
  const v = val | 0;
  switch (key) {
    case 'pan': return `${(((v / 255) - 0.5) * SPEC.panRange).toFixed(0)}°`;
    case 'tilt': return `${(((v / 255) - 0.5) * SPEC.tiltRange).toFixed(0)}°`;
    case 'ptSpeed': return v === 0 ? 'Fastest' : `Slower ${p255(v)}`;
    case 'special':
      if (v <= 129) return '—';
      if (v <= 139) return 'Lamp On';
      if (v <= 149) return 'Pan/Tilt reset';
      if (v <= 199) return 'Effect wheel reset';
      if (v <= 209) return 'Total reset';
      if (v >= 230 && v <= 239) return 'Lamp Off';
      return 'Reserved';
    case 'cyan': case 'magenta': case 'yellow': case 'dimmer': case 'focus': return p255(v);
    case 'color':
      if (v <= 129) return 'Open/white';
      if (v <= 189) return COLORS[COLOR_STEPS.findIndex(hi => v <= hi) + 1].name;
      if (v <= 215) return `Rainbow fwd ${pct(v, 215, 190)}`;
      if (v <= 217) return 'No rotation';
      if (v <= 243) return `Rainbow rev ${pct(v, 218, 243)}`;
      if (v <= 249) return 'Random (audio)';
      return 'Auto random';
    case 'cmyMacro': { const f = filterOf(v); return f ? `Preset ${Math.ceil(v / 2)}: ${f[1]}` : 'Off'; }
    case 'fxSpeed': return v === 0 ? 'Max speed' : `Slower ${p255(v)}`;
    case 'colorTime': case 'zfTime': return v === 0 ? 'Off' : `${(v / 10).toFixed(1)}s`;
    case 'fxPos':
      if (v <= 19) return 'No function';
      if (v <= 127) return `Index ${pct(v, 20, 127)}`;
      if (v <= 170) return 'Ramp open→full';
      if (v <= 213) return 'Ramp open→half';
      return 'Ramp half→full';
    case 'fxRot': case 'patternRot': case 'shaperRot': return rotText(v);
    case 'fxAnim': return v >= 4 && v <= 43 ? 'Macro' : 'No rotation';
    case 'pattern': return v >= 4 && v <= 67 ? 'Macro' : 'No rotation';
    case 'shaper': return v >= 4 && v <= 35 ? 'Macro' : 'No rotation';
    case 'gobo':
      if (v <= 3) return 'Open';
      if (v <= 87) return FIX_GOBOS[Math.floor((v - 4) / 6) + 1];
      if (v <= 199) return `${FIX_GOBOS[Math.floor((v - 88) / 8) + 1]} shake`;
      if (v <= 201) return 'Open';
      if (v <= 222) return `Wheel fwd ${pct(v, 222, 202)}`;
      if (v <= 243) return `Wheel rev ${pct(v, 223, 243)}`;
      return v <= 249 ? 'Random (audio)' : 'Auto random';
    case 'rotGobo': {
      if (v >= 202 && v <= 222) return `Wheel fwd ${pct(v, 222, 202)}`;
      if (v >= 223 && v <= 243) return `Wheel rev ${pct(v, 223, 243)}`;
      if (v >= 244) return v <= 249 ? 'Random (audio)' : 'Auto random';
      const rg = rotGoboOf(v);
      return rg.pos === 0 ? 'Open' : `${ROT_GOBOS[rg.pos]}${rg.shake ? ' shake' : ''} (${rg.rotating ? 'rotate' : 'index'})`;
    }
    case 'goboRot': case 'prism1Rot': case 'prism2Rot': return `Index ${Math.round((v / 255) * 360)}° / ${rotText(v)}`;
    case 'prism1': case 'prism2': {
      const s = prismSel(v); if (!s) return v <= 3 ? 'Open' : 'Raw DMX';
      return `${(key === 'prism2' ? WHEEL2 : WHEEL1)[s.which].name} (${s.rotate ? 'rotate' : 'index'})`;
    }
    case 'frost': {
      const [name, a] = frostOf(v); if (!a) return 'Open';
      const w = v <= 83 ? v : v <= 169 ? v - 86 : v - 172;                // position inside the level's block
      return w <= 50 ? `${name} ${Math.round(w * 2)}%` : w <= 53 ? `${name} 100%` : w <= 63 ? `${name} pulse closing` : w <= 73 ? `${name} pulse opening` : `${name} ramping`;
    }
    case 'zoom': return `${lerp(SPEC.zoomMax, SPEC.zoomMin, v / 255).toFixed(1)}°`;
    case 'hotspot': return v === 0 ? 'Automatic' : p255(v);
    case 'strobe':
      if (v <= 31) return 'Closed';
      if (v <= 63) return 'Open';
      if (v <= 95) return `Strobe ${lerp(1, 20, frac(v, 64, 95)).toFixed(1)}Hz`;
      if (v <= 127) return 'Open';
      if (v <= 143) return `Opening pulse ${pct(v, 128, 143)}`;
      if (v <= 159) return `Closing pulse ${pct(v, 159, 144)}`;
      if (v <= 191) return 'Open';
      if (v <= 223) return `Random ${pct(v, 192, 223)}`;
      return 'Open, full power';
    default: return String(v);
  }
}

/** One gobo: white where light passes, on a transparent background. Origin = centre, R = aperture radius */
function drawGobo(g, wheel, idx, R) {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  const around = (n, fn, a0 = 0) => { for (let i = 0; i < n; i++) { g.save(); g.rotate(a0 + i * TAU / n); fn(i); g.restore(); } };
  const poly = pts => { g.beginPath(); pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x * R, y * R)); g.closePath(); };
  if (idx === 0) return dot(0, 0, R);
  if (wheel === 'fix') {
    if (idx >= 11) return dot(0, 0, R * [0.55, 0.4, 0.26, 0.12][idx - 11]);                     // beam reducers
    switch (idx) {                                                                              // metal gobos (small shapes: this is a beam wheel)
      case 1: dot(0, 0, R * 0.16); around(6, () => dot(0, -R * 0.36, R * 0.085)); break;                                   // dot ring
      case 2: around(3, () => { poly([[0, -0.06], [0.2, -0.46], [-0.2, -0.46]]); g.fill(); }); break;                       // three-blade fan
      case 3: g.rotate(-1.1); g.fillRect(-R * 0.42, -R * 0.075, R * 0.84, R * 0.15); break;                                 // slanted bar
      case 4: g.fillRect(-R * 0.42, -R * 0.065, R * 0.84, R * 0.13); break;                                                 // bar
      case 5: for (let i = -1; i <= 1; i++) dot(i * R * 0.3, i * R * 0.06, R * 0.11); break;                                // three dots
      case 6: g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * TAU / 8, rr = R * (i & 1 ? 0.14 : 0.5); g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); break;   // four-point star
      case 7: around(4, () => dot(0, -R * 0.24, R * 0.14), TAU / 8); break;                                                 // four dots
      case 8: g.lineWidth = R * 0.07; poly([[-0.42, 0], [0.36, -0.32], [0.14, 0], [0.36, 0.32]]); g.stroke(); break;        // triangle (arrow head)
      case 9: for (let i = -2; i <= 1; i++) g.fillRect(-R * 0.3, (i + 0.5) * R * 0.15 - R * 0.045, R * 0.6, R * 0.09); break;   // four lines
      case 10: { const r = rng(7); dot(0, 0, R * 0.1); for (let i = 0; i < 16; i++) { const a = r() * TAU, d = R * (0.15 + r() * 0.3); dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.035 + r() * 0.04)); } break; }   // dot cluster
    }
    return;
  }
  switch (idx) {                                                                                // rotating gobos
    case 1: g.lineWidth = R * 0.09; around(6, () => { poly([[0, -0.24], [0.2, -0.5], [0.13, -0.8], [-0.13, -0.8], [-0.2, -0.5]]); g.stroke(); }); break;   // six hollow petals
    case 2: { const r = rng(19); for (let i = 0; i < 80; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.72; g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d, R * (0.03 + r() * 0.05), R * (0.025 + r() * 0.035), r() * 3, 0, TAU); g.fill(); } break; }   // pebbles
    case 3: g.rotate(0.35); around(4, () => { g.fillRect(R * 0.03, -R * 0.85, R * 0.07, R * 0.8); g.fillRect(R * 0.15, -R * 0.78, R * 0.07, R * 0.7); }); break;   // windmill of double bars
    case 4: {                                                                                   // zebra stripes
      g.rotate(-0.5); const r = rng(41);
      for (let j = -5; j <= 5; j++) { const x0 = j * R * 0.17, ph = r() * 6; g.lineWidth = R * (0.06 + r() * 0.05); g.beginPath();
        for (let y = -R * 0.85; y <= R * 0.85; y += R * 0.05) g[y === -R * 0.85 ? 'moveTo' : 'lineTo'](x0 + Math.sin(y / R * 5 + ph) * R * 0.06, y); g.stroke(); }
      break;
    }
    case 5: [[0.36, 14, 0.07], [0.5, 20, 0.06], [0.62, 26, 0.045], [0.72, 32, 0.035], [0.81, 38, 0.025]].forEach(([rad, n, s], k) => around(n, () => dot(0, -R * rad, R * s), k * 0.1)); break;   // halo of shrinking dots
    case 6: g.rotate(0.6); for (const [x, w] of [[-0.82, 0.5], [-0.24, 0.4], [0.24, 0.58]]) g.fillRect(R * x, -R * 0.13, R * w, R * 0.26); break;   // three dashes
    case 7: { const r = rng(63); for (let i = 0; i < 46; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.62, s = R * (0.07 + r() * 0.1); g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(r() * TAU);
      g.beginPath(); for (let k = 0; k < 10; k++) { const b = k * TAU / 10, rr = s * (k & 1 ? 0.45 : 1); g[k ? 'lineTo' : 'moveTo'](Math.cos(b) * rr, Math.sin(b) * rr); } g.closePath(); g.fill(); g.restore(); } break; }   // foliage breakup
    case 8: g.lineWidth = R * 0.05; g.rotate(-0.25); for (let i = -2; i <= 2; i++) { g.beginPath(); g.ellipse(i * R * 0.27, 0, R * 0.09, R * (0.42 - Math.abs(i) * 0.07), 0.45, 0, TAU); g.stroke(); } break;   // row of ovals
    case 9: {                                                                                   // leaves in a square
      g.beginPath(); g.rect(-R * 0.6, -R * 0.6, R * 1.2, R * 1.2); g.clip(); const r = rng(88);
      for (let i = 0; i < 90; i++) { g.beginPath(); g.ellipse((r() - 0.5) * R * 1.25, (r() - 0.5) * R * 1.25, R * (0.05 + r() * 0.06), R * 0.022, r() * Math.PI, 0, TAU); g.fill(); }
      break;
    }
  }
}

// Values the channel table marks as defaults (shutter open, rotation stopped, zoom / focus centred)
const DEFAULTS = { zoom: 128, focus: 128, strobe: 32, fxRot: 128, goboRot: 128, prism1Rot: 128, prism2Rot: 128, patternRot: 128, shaperRot: 128 };

export default {
  id: 'mega480', code: 'WOP-M480BSW', name: 'Mega480 BSW', title: '480W Beam / Spot / Wash CMY Moving Head', lcdTitle: 'MEGA480W BSW',
  spec: SPEC, colors: COLORS, gobos: { fix: FIX_GOBOS, rot: ROT_GOBOS, draw: drawGobo },
  ch: CH, modes: MODES, defaultMode: '39CH', decode, describe,
  features: { prism: true, gobos: true, cmy: true, cto: false, blades: false, scenes: true, ms: true, lamp: true },
  noSignal: 'hold',                                 // Advanced → Data hold: ON keeps the last frame, OFF returns to the post-reset state
  homeValues: { pan: 128, tilt: 128, ...DEFAULTS },
  sceneDefault: { pan: 128, tilt: 70, dimmer: 255, ...DEFAULTS, strobe: 40 },
  resetHold: 3,
  settings: { msMode: 'Auto', sceneSel: 'Auto', saver: 'OFF', rot: 'OFF', dmxInd: 'Mode1', sigBright: 10, scrLight: 10, touch: true,
    rectify: true, panOffset: 10, tiltOffset: 10, dataHold: false, lampMode: 'After reset' },
  offsets: S => [(S.panOffset - 10) * 0.2, (S.tiltOffset - 10) * 0.2],
  // Built-in program (Auto Run / Sound Ctrl) — one step = a set of channel values
  program: {
    base: { dimmer: 255, ...DEFAULTS, strobe: 40 },
    steps: [
      { pan: 110, tilt: 80, zoom: 255, color: 132, gobo: 70 },                                    // tight red beam through a reducer
      { pan: 150, tilt: 95, zoom: 150, cyan: 255, rotGobo: 33, goboRot: 100 },
      { pan: 128, tilt: 70, zoom: 235, color: 150, gobo: 30, prism1: 25, prism1Rot: 90 },         // 8-facet prism turning
      { pan: 95, tilt: 100, zoom: 60, magenta: 200, yellow: 120, rotGobo: 45, goboRot: 170 },
      { pan: 165, tilt: 85, zoom: 180, rotGobo: 39, goboRot: 60, prism2: 21, prism2Rot: 100 },    // 32-facet prism
      { pan: 128, tilt: 110, zoom: 20, cmyMacro: 100, frost: 225 },                               // wash
      { pan: 140, tilt: 60, zoom: 245, color: 174, gobo: 40, prism2: 17, prism2Rot: 170 },
      { pan: 115, tilt: 90, zoom: 120, yellow: 255, cyan: 120, rotGobo: 54, goboRot: 200, prism2: 25, prism2Rot: 60 },
    ],
  },
  // Panel: touch screen (menu table 4.3: Touch Enable / Touch Rectify) plus the buttons of drawing 4.1
  panel: { type: 'touch', versions: { device: 'MEGA480W BSW', model: 'WOP-M480BSW', panel: 'H3.12', main: 'H3.12' } },
  rdm: { modelId: 0x0480, description: 'WOP-M480BSW Mega480 BSW', software: 'H3.12' },
  // Body: the product page drawing gives 391 (yoke) / 386 (base) × 230 × 673 mm, arms 113 mm deep, arm top at 460 mm.
  // Yoke, base and head body are the platform of the ApexPointe 420 (same drawing, same photos apart from the lens end),
  // so they use the dimensions measured there; the three stepped lens rings and the cover panel are read off the Mega480
  // photos.
  body: {
    H: 0.673, style: 'round',
    base: { hw: 0.172, bot: 0.024, top: 0.112, shoulder: 0.1, chamfer: 0.016, depth: 0.23, frameW: 0.165, frameH: 0.06, panelY: 0.064, handle: 'bar', corner: 0.03 },
    feet: { r: 0.018, h: 0.024, x: 0.135, z: 0.085 },
    turntable: { r: 0.095, h: 0.012 }, panY: 0.124,
    yoke: { W: 0.391, t: 0.055, tTop: 0.034, wb: 0.278, h1: 0.057, h2: 0.13, yf: 0.07, c: 0.082, cy: 0.057, d: 0.146, armW: 0.113, armW0: 0.14, top: 0.336, inlay: false },
    tiltY: 0.262,
    // smooth moulded body with a domed rear end → shoulders → three stepped lens rings, the front one a deep hood
    head: [{ y: -0.165, w: 0.16, d: 0.19, r: 0.06 }, { y: -0.152, w: 0.212, d: 0.226, r: 0.07 }, { y: -0.115, w: 0.252, d: 0.23, r: 0.07 }, { y: -0.085, w: 0.265, d: 0.23, r: 0.06 },
      { y: 0.151, w: 0.265, d: 0.23, r: 0.06 }, { y: 0.196, w: 0.214, d: 0.21, r: 0.1 }, { y: 0.2, w: 0.216 }, { y: 0.226, w: 0.216 }, { y: 0.226, w: 0.23 }, { y: 0.254, w: 0.23 }, { y: 0.254, w: 0.2 }, { y: 0.262, w: 0.196 }],
    hood: { y0: 0.25, y1: 0.292, r0: 0.122, r1: 0.1235 },
    rings: [{ y: 0.291, r: 0.1225, tube: 0.0045 }, { y: 0.284, r: 0.113, tube: 0.004 }, { y: 0.276, r: 0.103, tube: 0.004 }, { y: 0.269, r: 0.094, tube: 0.004 }],
    // cover panel: narrow at the lens end, widest low down, cut corners; badge in the middle, square grille below
    shield: { pts: [[-0.07, 0.13], [0.07, 0.13], [0.1, -0.085], [0.075, -0.14], [-0.075, -0.14], [-0.1, -0.085]], z: 0.1145 },
    plate: { y: 0.025, z: 0.1205 },
    vents: [{ side: 'z', off: 0.1195, y: -0.075, h: 0.06, n: 9, pitch: 0.0105 }, { side: 'x', off: 0.133, y: 0.095, h: 0.045, n: 6, pitch: 0.011 }],
    logo: { arm: 'Wincode', armDir: 'down', head: 'MEGA 480', headSize: [0.11, 0.035] },
    lensY: 0.262, lensR: 0.082, ringR: 0.09,                    // hood rim: 0.124 + 0.262 + 0.292 = 0.678
    lcd: [0.058, 0.044], lcdX: -0.018, controls: 'col4', ctrlX: 0.058,
  },
  assumptions: [
    'Overall size 391 (yoke) / 386 (base) × 230 × 673 mm, arm depth 113 mm and arm top at 460 mm are from the product page drawing (the manual only gives the package size). The other dimensions are measured off the product photos — the fixture shares yoke, base and head body with the ApexPointe 420 — so they are good to a centimetre or two at best.',
    'Front panel: the product page says touch screen and the menu table has Touch Enable / Touch Rectify, so the simulator\'s shared touch-panel menu is used. Its pages differ from the manual\'s table in details (screen saver and rotation options, Touch Rectify, "Lamp when", "Manual time", stepper information are not reproduced; the Scene page lists the channels of the current channel mode instead of the manual\'s 36 entries).',
    'Drawing 4.1 shows five buttons in a cross; the manual names four (MENU, DOWN, UP, ENTER). Centre = ENTER, up / down move, MENU is on the on-screen key bar; the on-screen key captions are those of the encoder panel.',
    'CH6 Lamp On / Lamp Off is not simulated (the core has no lamp command on a DMX channel): use the Lamp Switch in the menu. Reset values act after being held for 3 s — the manual gives no hold time.',
    'CH12/11 "CMY Macro" (0–132) is taken as the virtual colour wheel with the "66 preset colours" of chapter 2: value 0 = off, two values per preset. The manual does not list the presets; the LEE-filter list of the Robe MegaPointe, whose channel layout this fixture copies, is assumed, with approximate colours. A preset replaces the CMY channels.',
    'Animation (effect) wheel channels 16–18, Pattern channels 27–28 and Beam shaper channels 29–30 are in the channel list but do nothing: the core has no animation wheel, and the manual only calls their values "Macro".',
    'Not simulated: Effect Speed, CMY & colour wheel time, zoom / focus / frost / prism time, Hot-Spot control, "full lamp power" on shutter 224–255, and the microphone ("random by audio" changes slot twice a second).',
    'Only one prism is shown at a time: prism wheel 2 has priority over wheel 1. Stacking two prisms is not simulated. Prism values 28–255 ("Raw DMX") are treated as open.',
    'As the manual states, prism wheel 1 is ignored while the rotating gobo channel is above 0, and it pushes the combined frost out of the beam.',
    'The cylindrical prism is approximated by a row of nine overlapping images; the 32-facet prism by rings of 4 + 10 + 18 images; the 12° and 18° 8-facet prisms differ only in spread.',
    'Chapter 2 lists the prisms of wheel 1 as linear / 8-facet / cylindrical, the channel table as linear / cylindrical / 8-facet: the channel table is used. The product page describes the prisms differently ("6 rows + 12 circles + 8 prisms", "6 rows + 32 + 8"); the manual wins.',
    'Product page: colour temperature 7500–8500 K, static wheel "10 gobos + open"; manual: 7800 K, 10 gobos + 4 beam reducers. The manual is used.',
    'Frost: light = 30 %, medium = 65 %, combined = up to 100 % of the simulator\'s single frost; the frost pulse / ramp effects are shown as fully in.',
    'Gobo artwork is redrawn from the pictures in 4.2. The static wheel picture is tiny: its gobo order (clockwise from the open hole) and the reducer sizes (55 / 40 / 26 / 12 % of the aperture) are estimates.',
    'Colour fine (39CH) shifts the wheel by up to half a slot; the filter colours are approximations of the names in the table.',
    'XY speed: 0 = fastest (the manual gives no direction). Zoom 0 = 44°, 255 = 1.6° ("from max. to min. beam angle"); the photometric page gives 2.9° as the narrowest spot, 1.6° is used for the whole range.',
    'Strobe 1–20 Hz (product page); pulse and random strobe rates, wheel rotation speeds and gobo shake speeds are estimates.',
    'Factory defaults are taken as DMX Ctrl, 39CH, Data hold OFF: without DMX the fixture stays in its post-reset state (shutter open at 32, dimmer 0).',
    'Tilt offset range and the other menu value ranges follow the shared touch menu, not the manual\'s 1–150.',
  ],
};
