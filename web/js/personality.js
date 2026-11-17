// personality.js — DMX channel chart of the WOP-LM1012B 250W BSW (manual chapter 6, "DMX Mode")
//  STD = 17CH, EXT = 20CH. Value ranges follow the manual tables; anything the manual does not state
//  (colour names, etc.) is listed under "Assumptions" in the README.

export const CH = {
  pan:        { name: 'Pan' },
  panFine:    { name: 'Pan Fine' },
  tilt:       { name: 'Tilt' },
  tiltFine:   { name: 'Tilt Fine' },
  ptSpeed:    { name: 'PTSpeed' },
  strobe:     { name: 'Strobe' },
  dimmer:     { name: 'Dimmer' },
  dimmerFine: { name: 'Dimmer Fine' },
  color:      { name: 'Color' },
  colorFine:  { name: 'Color Fine' },
  gobo:       { name: 'FixGobo' },
  rotGobo:    { name: 'RotGobo' },
  goboRot:    { name: 'GoboRot' },
  zoom:       { name: 'Zoom' },
  focus:      { name: 'Focus' },
  focusFine:  { name: 'Focus Fine' },
  frost:      { name: 'Frost' },
  prism:      { name: 'Prism' },
  prismRot:   { name: 'PrismRot' },
  reset:      { name: 'Reset' },
};

export const MODES = {
  STD: { id: 'STD', label: '17CH', channels: ['pan', 'panFine', 'tilt', 'tiltFine', 'ptSpeed', 'strobe', 'dimmer', 'color', 'gobo', 'rotGobo', 'goboRot', 'zoom', 'focus', 'frost', 'prism', 'prismRot', 'reset'] },
  EXT: { id: 'EXT', label: '20CH', channels: ['pan', 'panFine', 'tilt', 'tiltFine', 'ptSpeed', 'strobe', 'dimmer', 'dimmerFine', 'color', 'colorFine', 'gobo', 'rotGobo', 'goboRot', 'zoom', 'focus', 'focusFine', 'frost', 'prism', 'prismRot', 'reset'] },
};
export const KEYS = MODES.EXT.channels;

// Optical data (manual chapter 2)
export const SPEC = {
  panRange: 540, tiltRange: 270,
  zoomMin: 6, zoomMax: 26,          // full beam angle, degrees
  lux5m: { 6: 22140, 26: 1715 },    // chapter 3, Optical Lumen Diagram
  ledWhite: [0.90, 0.95, 1.0],      // 7500–8500K
};

// Colour wheel: open (white) + 7 colours. The manual only says "Color 1–7" → a common layout is assumed.
export const COLORS = [
  { name: 'White',   rgb: [1.00, 1.00, 1.00] },
  { name: 'Red',     rgb: [1.00, 0.05, 0.03] },
  { name: 'Orange',  rgb: [1.00, 0.42, 0.02] },
  { name: 'Yellow',  rgb: [1.00, 0.92, 0.08] },
  { name: 'Green',   rgb: [0.05, 0.95, 0.15] },
  { name: 'Cyan',    rgb: [0.05, 0.75, 1.00] },
  { name: 'Blue',    rgb: [0.04, 0.10, 1.00] },
  { name: 'Magenta', rgb: [1.00, 0.05, 0.75] },
];
export const N_COLOR = COLORS.length;      // 8 slots
export const FIX_GOBOS = ['Open', 'Triangle', 'Tri-Ring', 'Four Dots', 'Flower', 'Bubbles', 'Reducer M', 'Reducer S'];   // 4.2 GOBO1
export const ROT_GOBOS = ['Open', 'Five Dots', 'Rose', 'Waves', 'Brush', 'Stars', 'Grid'];                              // 4.2 GOBO2
export const N_FIX = FIX_GOBOS.length, N_ROT = ROT_GOBOS.length;

const lerp = (a, b, t) => a + (b - a) * t;
const frac = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

/** Channel values (key → 0..255) → motion/optics targets. Channels missing in 17CH mode count as 0. */
export function decode(v) {
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
export function describe(key, val) {
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
