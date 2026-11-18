// models/tb5.js — Wincode AquaVortex TB5 (WOP-AVortex TB5): IP65 multi-head LED moving light, 5 × 120W RGBL + pixel rings
//  Source: "IP65 LED AquaVortex TB5 Moving Head Light — User Manual" (scan): chapter 7 (DMX channels, six modes),
//  8 (display menu), 9 (key features: zoom 4–32°, pan 60°, tilt 220°, 1019 × 206.5 × 352.5 mm), 10 (photometric data).
//  Anything the manual does not state is listed in `assumptions`.
import { lerp, frac, pct, p255 } from './util.js';

const N = 5;                                                 // heads
const SPEC = {
  panRange: 59, tiltRange: 221,     // channel table: PAN 0°→59°, TILT 0°→221°
  zoomMin: 4, zoomMax: 32,
  ledWhite: [1, 1, 1],
  cd: 1500,                         // on-screen intensity of one head at 4° (manual: RGBL 32000 lx @ 5 m)
  soft: 5,                          // wash-beam edge softness (no focus channel)
  tempRise: 34,
};

/* ── channel layout ── */
const HEADS = [1, 2, 3, 4, 5];
const PT = h => [`pan${h}`, `panFine${h}`, `tilt${h}`, `tiltFine${h}`];
const RGBL = h => [`r${h}`, `g${h}`, `b${h}`, `l${h}`];
const RING = h => [`ringR${h}`, `ringG${h}`, `ringB${h}`, `macro${h}`];
const BLOCKS = h => [1, 2, 3, 4, 5, 6, 7, 8].flatMap(b => [`rb${h}_${b}r`, `rb${h}_${b}g`, `rb${h}_${b}b`]);
const COLOR_ALL = ['r', 'g', 'b', 'l', 'cto', 'color', 'ringR', 'ringG', 'ringB', 'macro', 'dimmer', 'dimmerFine', 'strobe', 'ringStrobe', 'ptSpeed', 'func'];
const mode = (id, channels) => ({ id, label: id, channels });
const MODES = {
  '21CH': mode('21CH', ['pan', 'panFine', 'tilt', 'tiltFine', 'zoom', ...COLOR_ALL]),
  '41CH': mode('41CH', [...HEADS.flatMap(h => [...PT(h), `zoom${h}`]), ...COLOR_ALL]),
  '71CH': mode('71CH', [...HEADS.flatMap(h => [...PT(h), ...RGBL(h), `zoom${h}`, ...RING(h)]), 'dimmer', 'dimmerFine', 'strobe', 'ringStrobe', 'ptSpeed', 'func']),
  '75CH': mode('75CH', [...HEADS.flatMap(h => [...PT(h), ...RGBL(h), `strobe${h}`, `zoom${h}`, ...RING(h)]), 'dimmer', 'dimmerFine', 'ringStrobe', 'ptSpeed', 'func']),
  '85CH': mode('85CH', [...HEADS.flatMap(h => [...PT(h), ...RGBL(h), `dim${h}`, `dimFine${h}`, `strobe${h}`, `zoom${h}`, ...RING(h)]), 'dimmer', 'dimmerFine', 'ringStrobe', 'ptSpeed', 'func']),
  '170CH': mode('170CH', [...HEADS.flatMap(h => [...PT(h), ...RGBL(h), `zoom${h}`, ...BLOCKS(h)]), 'dimmer', 'dimmerFine', 'strobe', 'ptSpeed', 'func']),
};
const BASE_NAME = { pan: 'PAN', panFine: 'PAN FINE', tilt: 'TILT', tiltFine: 'TILT FINE', zoom: 'ZOOM', r: 'LED RED', g: 'LED GREEN', b: 'LED BLUE', l: 'LED LIME',
  cto: 'LED CTO', color: 'LED COLOR', ringR: 'RING RED', ringG: 'RING GREEN', ringB: 'RING BLUE', macro: 'RING MACRO', dimmer: 'DIMMER', dimmerFine: 'DIMMER FINE',
  dim: 'LED DIMMER', dimFine: 'LED DIMMER FINE', strobe: 'LED STROBE', ringStrobe: 'RING STROBE', ptSpeed: 'PAN/TILT SPEED', func: 'FUNCTION' };
/** 'tilt3' → { base: 'tilt', head: 3 } · 'rb2_5g' → { base: 'rb', head: 2, block: 5, c: 'g' } · 'dimmer' → { base: 'dimmer', head: 0 } */
function parse(key) {
  let m = /^rb(\d)_(\d)([rgb])$/.exec(key); if (m) return { base: 'rb', head: +m[1], block: +m[2], c: m[3] };
  m = /^([a-zA-Z]+?)(\d)$/.exec(key); return m ? { base: m[1], head: +m[2] } : { base: key, head: 0 };
}
const CH = {};
for (const md of Object.values(MODES)) for (const k of md.channels) {
  const p = parse(k);
  CH[k] = p.base === 'rb' ? `RING ${p.head} BLOCK ${p.block} ${{ r: 'RED', g: 'GREEN', b: 'BLUE' }[p.c]}`
    : p.head ? BASE_NAME[p.base].replace(/^(LED|RING|PAN|TILT|ZOOM)/, `$1 ${p.head}`) : BASE_NAME[p.base];
}

/* ── colour ── */
// "LED COLOR" presets (channel table: 7 DMX values each from 010, the last one 234–255)
const LEE = [
  ['LEE 790 Moroccan Pink', [1, 0.55, 0.45]], ['LEE 157 Pink', [1, 0.45, 0.55]], ['LEE 332 Special Rose Pink', [1, 0.2, 0.6]], ['LEE 328 Follies Pink', [1, 0.25, 0.75]],
  ['LEE 345 Fuchsia Pink', [0.85, 0.3, 0.8]], ['LEE 194 Surprise Pink', [0.75, 0.5, 0.9]], ['LEE 181 Congo Blue', [0.25, 0, 0.75]], ['LEE 071 Tokyo Blue', [0.1, 0, 0.8]],
  ['LEE 120 Deep Blue', [0, 0.1, 0.9]], ['LEE 079 Just Blue', [0, 0.2, 1]], ['LEE 132 Medium Blue', [0, 0.4, 1]], ['LEE 200 Double CT Blue', [0.4, 0.6, 1]],
  ['LEE 161 Slate Blue', [0.45, 0.65, 0.95]], ['LEE 201 Full CT Blue', [0.6, 0.75, 1]], ['LEE 202 Half CT Blue', [0.8, 0.88, 1]], ['LEE 117 Steel Blue', [0.65, 0.9, 0.95]],
  ['LEE 353 Lighter Blue', [0.4, 0.85, 1]], ['LEE 118 Light Blue', [0, 0.7, 1]], ['LEE 116 Medium Blue Green', [0, 0.8, 0.7]], ['LEE 124 Dark Green', [0, 0.7, 0.3]],
  ['LEE 139 Primary Green', [0, 0.9, 0.1]], ['LEE 089 Moss Green', [0.2, 0.85, 0.25]], ['LEE 122 Fern Green', [0.4, 0.9, 0.3]], ['LEE 738 JAS Green', [0.6, 0.95, 0.1]],
  ['LEE 088 Lime Green', [0.75, 1, 0.2]], ['LEE 100 Spring Yellow', [0.95, 1, 0.2]], ['LEE 104 Deep Amber', [1, 0.75, 0.1]], ['LEE 179 Chrome Orange', [1, 0.6, 0.05]],
  ['LEE 105 Orange', [1, 0.5, 0]], ['LEE 021 Gold Amber', [1, 0.45, 0.05]], ['LEE 778 Millennium Gold', [1, 0.4, 0.1]], ['LEE 135 Deep Golden Amber', [1, 0.3, 0]],
  ['LEE 164 Flame Red', [1, 0.15, 0.05]],
];
const leeIndex = v => Math.min(LEE.length - 1, Math.floor((v - 10) / 7));
const kelvinOf = v => 8000 - Math.round(((v - 1) / 254) * 55) * 100;          // 001 → 8000K … 255 → 2500K in 100K steps
const KELVIN = [[2500, [1, 0.62, 0.3]], [3200, [1, 0.72, 0.45]], [4500, [1, 0.85, 0.7]], [5600, [1, 0.93, 0.87]], [6500, [1, 1, 1]], [8000, [0.86, 0.91, 1]]];
function kelvinRgb(k) {
  for (let i = 1; i < KELVIN.length; i++) if (k <= KELVIN[i][0]) { const [k0, a] = KELVIN[i - 1], [k1, b] = KELVIN[i], f = (k - k0) / (k1 - k0); return a.map((x, j) => lerp(x, b[j], f)); }
  return KELVIN[KELVIN.length - 1][1];
}
// RGBL additive mix → hue (max component 1) + level. Lime adds mostly green/red; all four at full = white.
const LIME = [0.35, 0.6, 0.05], WHITE = [1.35, 1.6, 1.05];
function mix(r, g, b, l) {
  const c = [r + l * LIME[0], g + l * LIME[1], b + l * LIME[2]].map((x, i) => x / WHITE[i]), m = Math.max(c[0], c[1], c[2]);
  return m > 1e-4 ? { rgb: c.map(x => x / m), level: Math.pow(Math.min(1, m), 0.6) } : { rgb: [1, 1, 1], level: 0 };
}
const hue = h => { const f = n => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };

/* ── strobe (same table for LED and ring) ── */
function strobeOf(s) {
  if (s <= 7) return { mode: 'closed' };
  if (s <= 15) return { mode: 'open' };
  if (s <= 131) return { mode: 'strobe', hz: lerp(1, 25, frac(s, 16, 131)) };
  if (s <= 139) return { mode: 'open' };
  if (s <= 181) return { mode: 'pulse', hz: lerp(1, 15, frac(s, 140, 181)) };      // fast open, slow close
  if (s <= 189) return { mode: 'open' };
  if (s <= 231) return { mode: 'fadein', hz: lerp(1, 15, frac(s, 190, 231)) };     // slow open, fast close
  if (s <= 239) return { mode: 'open' };
  if (s <= 247) return { mode: 'random', hz: lerp(3, 20, frac(s, 240, 247)) };
  return { mode: 'open' };
}
const strobeText = v => (v <= 7 ? 'Close' : v <= 15 ? 'Open' : v <= 131 ? `Strobe ${lerp(1, 25, frac(v, 16, 131)).toFixed(1)}Hz` : v <= 139 ? 'Open'
  : v <= 181 ? `Fast open/slow close ${pct(v, 140, 181)}` : v <= 189 ? 'Open' : v <= 231 ? `Slow open/fast close ${pct(v, 190, 231)}` : v <= 239 ? 'Open' : v <= 247 ? `Random ${pct(v, 240, 247)}` : 'Open');

/* ── function channel (value held for 3 s) ── */
const REFRESH = ['900Hz', '1000Hz', '1100Hz', '1200Hz', '1300Hz', '1400Hz', '1500Hz', '2500Hz', '4000Hz', '5000Hz', '6000Hz', '10KHz', '15KHz', '20KHz', '25KHz'];
const FUNC = [
  [30, 39, 'Dimmer Curve: Linear', { dimCurve: 'Linear' }], [40, 49, 'Dimmer Curve: Square Law', { dimCurve: 'Square Law' }],
  [50, 59, 'Dimmer Curve: Inv SQ Law', { dimCurve: 'Inv SQ Law' }], [60, 69, 'Dimmer Curve: S Curve', { dimCurve: 'S Curve' }],
  [70, 79, 'Cooling Mode: Standard', { fanSpeed: 'Normal' }], [80, 89, 'Cooling Mode: Quiet', { fanSpeed: 'Quiet' }],
  [100, 109, 'Led Frequency Setting Enable', { ledFreq: true }], [110, 119, 'Led Frequency Setting Disable', { ledFreq: false }],
  ...REFRESH.map((hz, i) => [123 + i, 123 + i, hz, { ledRefresh: hz }]),
  [140, 149, 'Pan/Tilt Reset', null, 'xy'], [150, 159, 'Effect Reset', null, 'effect'],
  [160, 169, 'Head Invert: Yes', { panInvert: true, tiltInvert: true }], [170, 179, 'Head Invert: No', { panInvert: false, tiltInvert: false }],
  [180, 189, 'CCI Calibration: On', { cci: true }], [190, 199, 'CCI Calibration: Off', { cci: false }], [200, 209, 'All Reset', null, 'all'],
  [210, 219, 'Dimmer Speed: Fast', { dimSpeed: 'Fast' }], [220, 229, 'Dimmer Speed: Smooth', { dimSpeed: 'Smooth' }],
  [230, 230, 'Dimming Start Mode: High', { dimStart: 'High' }], [231, 231, 'Dimming Start Mode: Low', { dimStart: 'Low' }],
];
const funcOf = v => FUNC.find(f => v >= f[0] && v <= f[1]);

/** Channel values (key → 0..255) → targets. A per-head channel wins over the shared one of the same name. */
function decode(v) {
  const g = k => v[k] | 0, has = k => k in v;
  const pick = (k, h) => ((k + h) in v ? v[k + h] : (v[k] ?? 0));
  const master = has('dimmer') ? (g('dimmer') * 256 + g('dimmerFine')) / 65535 : 1;
  const ledStrobe = has('strobe') ? strobeOf(g('strobe')) : { mode: 'open' };
  const ringStrobe = has('ringStrobe') ? strobeOf(g('ringStrobe')) : { mode: 'open' };
  const preset = g('color') >= 10 ? LEE[leeIndex(g('color'))][1] : g('cto') >= 1 ? kelvinRgb(kelvinOf(g('cto'))) : null;   // LED COLOR > LED CTO > RGBL
  const heads = HEADS.map(h => {
    const t = {};
    t.pan = (pick('pan', h) * 256 + pick('panFine', h)) / 65535;
    t.tilt = (pick('tilt', h) * 256 + pick('tiltFine', h)) / 65535;
    t.zoom = 1 - pick('zoom', h) / 255;                       // Wide → Narrow
    const c = preset ? { rgb: preset, level: 1 } : mix(pick('r', h) / 255, pick('g', h) / 255, pick('b', h) / 255, pick('l', h) / 255);
    t.rgb = c.rgb; t.level = c.level;
    t.dimmer = master * (has('dim' + h) ? (g('dim' + h) * 256 + g('dimFine' + h)) / 65535 : 1);
    t.strobe = has('strobe' + h) ? strobeOf(g('strobe' + h)) : ledStrobe;
    t.ring = has(`rb${h}_1r`)
      ? { blocks: [1, 2, 3, 4, 5, 6, 7, 8].map(b => ['r', 'g', 'b'].map(x => g(`rb${h}_${b}${x}`) / 255)), strobe: ringStrobe }
      : { color: [pick('ringR', h) / 255, pick('ringG', h) / 255, pick('ringB', h) / 255], macro: pick('macro', h), strobe: ringStrobe };
    return t;
  });
  const t = Object.assign({}, heads[0]);                      // head 1 doubles as the top level (probing, single-value readers)
  t.heads = heads; t.strobe = has('strobe') ? ledStrobe : heads[0].strobe; t.ptSpeed = g('ptSpeed') / 255;
  const f = funcOf(g('func'));
  t.reset = f && f[4] ? f[4] : false;
  t.apply = f && f[3] ? f[3] : null;
  return t;
}

/** Ring macro (channel value 016–255: effect 1–15 in steps of 16, fast → slow within each) → 8 blocks of RGB */
function ringMacro(ring, T, head) {
  const col = ring.color, m = ring.macro | 0, flat = () => Array.from({ length: 8 }, () => col);
  if (m < 16) return flat();
  const effect = Math.floor(m / 16), rate = lerp(10, 0.6, (m % 16) / 15), p = T * rate, i = Math.floor(p), k = p - i;
  const mk = f => Array.from({ length: 8 }, (_, b) => { const a = f(b); return Array.isArray(a) ? a : col.map(c => c * a); });
  switch ((effect - 1) % 8) {
    case 0: return mk(b => (b === i % 8 ? 1 : 0));                                    // one block chasing
    case 1: return mk(b => (b % 4 === i % 4 ? 1 : 0));                                // two opposite blocks chasing
    case 2: return mk(b => ((b + i) % 8 < 4 ? 1 : 0));                                // half ring rotating
    case 3: return mk(b => ((b + i) % 2 ? 1 : 0));                                    // alternate blocks
    case 4: return mk(b => (b <= i % 9 - 1 ? 1 : 0));                                 // fill up
    case 5: return mk(() => 0.5 + 0.5 * Math.sin(p * 1.6));                           // breathe
    case 6: return mk(b => { const d = (b - p % 8 + 8) % 8; return Math.max(0, 1 - d / 4); });   // comet tail
    default: return mk(b => hue(((b + head) / 8 + p * 0.12) % 1));                    // rainbow (ignores the ring colour)
  }
}

/** Meaning of a channel value (for the monitor and the transmitter) */
function describe(key, val) {
  const v = val | 0, base = parse(key).base;
  switch (base) {
    case 'pan': return `${(((v / 255) - 0.5) * SPEC.panRange).toFixed(0)}°`;
    case 'tilt': return `${(((v / 255) - 0.5) * SPEC.tiltRange).toFixed(0)}°`;
    case 'zoom': return `${lerp(SPEC.zoomMax, SPEC.zoomMin, v / 255).toFixed(1)}°`;
    case 'cto': return v === 0 ? 'Null' : `${kelvinOf(v)}K`;
    case 'color': return v < 10 ? 'Null' : LEE[leeIndex(v)][0];
    case 'macro': return v < 16 ? 'Null' : `Macro ${Math.floor(v / 16)} · ${pct(v % 16, 15, 0)} speed`;
    case 'strobe': case 'ringStrobe': return strobeText(v);
    case 'ptSpeed': return v === 0 ? 'Fastest' : `Slower ${p255(v)}`;
    case 'func': { const f = funcOf(v); return f ? `${f[2]} (hold 3s)` : 'Null'; }
    case 'panFine': case 'tiltFine': case 'dimmerFine': case 'dimFine': return String(v);
    default: return p255(v);
  }
}

/* ── defaults / built-in program ── */
const centre = k => { const b = parse(k).base; return b === 'pan' || b === 'tilt' ? 128 : 0; };   // pan/tilt centred, everything else 0 (dark)
// Auto-run steps: per-head functions (h = 0..4) for position and hue
const STEPS = [
  { T: h => 90 + h * 0, P: () => 128, H: h => h / 5, zoom: 255, macro: 20 },
  { T: h => 70 + h * 12, P: h => 100 + h * 14, H: () => 0.6, zoom: 200, macro: 40 },
  { T: h => 118 - Math.abs(h - 2) * 20, P: () => 128, H: h => 0.02 + h * 0.03, zoom: 255, macro: 100 },
  { T: h => (h % 2 ? 80 : 110), P: h => (h % 2 ? 90 : 166), H: h => (h % 2 ? 0.33 : 0.83), zoom: 120, macro: 56 },
  { T: h => 128 - (h - 2) * 14, P: h => 128 + (h - 2) * 20, H: () => 0.5, zoom: 255, macro: 130 },
  { T: () => 95, P: h => 128 + (h - 2) * 30, H: h => 0.9 - h * 0.04, zoom: 40, macro: 250 },
];
function autoFill(k, s) {
  const p = parse(k), h = p.head ? p.head - 1 : 2, c = hue(s.H(h) % 1), ring = hue((s.H(h) + 0.5) % 1);
  switch (p.base) {
    case 'pan': return Math.round(s.P(h)); case 'tilt': return Math.round(s.T(h)); case 'zoom': return s.zoom;
    case 'r': return Math.round(c[0] * 255); case 'g': return Math.round(c[1] * 255); case 'b': return Math.round(c[2] * 255);
    case 'ringR': return Math.round(ring[0] * 255); case 'ringG': return Math.round(ring[1] * 255); case 'ringB': return Math.round(ring[2] * 255);
    case 'rb': return Math.round(hue((s.H(h) + p.block / 8) % 1)['rgb'.indexOf(p.c)] * 255);
    case 'macro': return s.macro; case 'dimmer': case 'dim': case 'strobe': case 'ringStrobe': return 255;
    default: return 0;
  }
}

export default {
  id: 'tb5', code: 'WOP-AVortex TB5', name: 'AquaVortex TB5', title: 'IP65 Multi-Head LED Moving Light · 5 × 120W RGBL', lcdTitle: 'AquaVortex TB5',
  heads: N,
  spec: SPEC, colors: [{ name: 'Open', rgb: [1, 1, 1] }], gobos: { fix: ['Open'], rot: ['Open'], draw: null },
  ch: CH, modes: MODES, defaultMode: '21CH', decode, describe, ringMacro,
  features: { prism: false, gobos: false, cmy: false, blades: false, scenes: false, ms: false, lamp: false, rgbl: true, ring: true },
  noSignal: 'manual',                               // Fixture → No DMX State: Keep = hold the last frame, Clear = the Manual-menu values
  manualDefaults: centre, homeValues: centre,
  resetHold: 3,
  settings: { flip: false, dispMode: 'Show', dataHold: false, fanSpeed: 'Normal', dimCurve: 'Linear', dimSpeed: 'Fast', ledRefresh: '1200Hz', ledFreq: false, cci: false, dimStart: 'High', cal: {} },
  program: { base: {}, steps: STEPS, fill: autoFill, stepTime: 4 },
  // Panel: display + buttons, menu tree from manual chapter 8 ("Display instruction")
  panel: {
    type: 'buttons', password: 50,
    versions: ['Show: V1.03', 'Y Motor: V1.02', 'Dimmer 1–5: V1.05'],
    menu: ({ fx, S, onoff, list, info, num, menu }) => [
      { label: 'Dmx Address', type: 'num', min: 1, max: 512, pad: 3, get: () => S().address, set: v => fx.set('address', v) },
      { label: 'Fixture', items: [
        list('CH Mode', 'mode', Object.keys(MODES)),
        { label: 'Run Mode', type: 'enum', opts: [['DMX', 'DMX'], ['AUTO', 'Auto']], get: () => S().runMode, set: v => fx.set('runMode', v) },
        onoff('Pan Invert', 'panInvert'), onoff('Tilt Invert', 'tiltInvert'),
        list('Fan Speed', 'fanSpeed', ['Normal', 'Low', 'Quiet', 'High']), list('Dim Curve', 'dimCurve', ['Linear', 'Square Law', 'Inv SQ Law', 'S Curve']),
        list('Dim Speed', 'dimSpeed', ['Smooth', 'Fast']), onoff('No DMX State', 'dataHold', 'Clear', 'Keep'), list('LED Refresh', 'ledRefresh', REFRESH),
      ] },
      { label: 'Manual', get items() { return fx.mode.channels.map(k => num(CH[k], () => fx.manual[k], v => { fx.manual[k] = v; fx.emit('manual'); }, { live: true, hint: v => describe(k, v) })); } },
      { label: 'Information', items: [
        info('Time', () => [`Current Time: ${(fx.sessionSec / 3600).toFixed(1)} H`, `Total Time: ${S().totalHours.toFixed(1)} H`, `Power Count: ${S().powerCount}`]),
        info('Sensor', () => fx.heads.slice(0, 4).map((h, i) => `Head${i + 1}  T ${h.tilt.pos.toFixed(0)}°  P ${h.pan.pos.toFixed(0)}°  Z ${h.beamAngleDeg.toFixed(0)}°`)),
        info('Temperature', () => fx.heads.map((h, i) => `Head${i + 1} Temp: ${(fx.tempC + (h.intensity - fx.intensity) * 6).toFixed(0)} ℃`)),
        info('Software Version', () => ['Show: V1.03', 'Y Motor: V1.02', 'Dimmer 1–5: V1.05']),
      ] },
      { label: 'Factory', items: [
        { label: 'Password', type: 'num', min: 0, max: 255, pad: 3, get: () => 0, set: v => { menu.unlocked = v === 50; } },
        ...HEADS.flatMap(h => ['Pan', 'Tilt', 'Zoom'].map(a => ({ label: `${a}${h}`, type: 'num', min: 0, max: 255, pad: 3, locked: () => !menu.unlocked,
          get: () => S().cal[a + h] ?? 128, set: v => { S().cal[a + h] = v; fx.save(); } }))),
      ] },
      { label: 'FixReset', items: [
        { label: 'All Reset', type: 'enum', opts: [[false, 'OFF'], [true, 'Run']], get: () => false, set: v => { if (v) { fx.startReset('menu'); menu.home(); } } },
        { label: 'Factory', type: 'enum', opts: [[false, 'OFF'], [true, 'Run']], get: () => false, set: v => { if (v) { fx.factoryDefaults(); menu.unlocked = false; menu.home(); } } },
      ] },
      { label: 'Display', items: [
        { label: 'Language', type: 'enum', opts: [['CH', '中文'], ['EN', 'English']], get: () => S().lang, set: v => fx.set('lang', v) },
        onoff('Display Flip', 'flip', 'NO', 'YES'), list('Display Mode', 'dispMode', ['60s', 'Show']),
      ] },
    ],
  },
  rdm: { modelId: 0x0b05, description: 'WOP-AVortex TB5 5x120W RGBL', software: 'Show V1.03' },
  // Body: 1019 × 206.5 × 352.5 mm (manual chapter 9). Measured off the product page's front and rear photos, scaled by
  // the 1019 mm length: heads 203 mm apart, yokes 200 mm wide with 20 mm arm plates, heads ≈ 160 mm square in section
  // with a Ø 133 mm lens, bar ≈ 100 mm high with two raised blocks 287 mm either side of the display.
  body: {
    H: 0.3525, style: 'bar', viewScale: 1.9, headCount: 5,
    base: { length: 1.019, depth: 0.1945, bot: 0.025, top: 0.125, panelY: 0.078, frameW: 0.11, frameH: 0.056, endRise: 0.035,
      bosses: [{ x: 0.287, w: 0.155, h: 0.07, y: 0.075 }] },
    headPitch: 0.2, panY: 0.125, tiltY: 0.133,
    // cradle with tall round-topped arm plates; square-section head with a round bezel
    yoke: { w: 0.19, d: 0.12, h: 0.026, armX: 0.0905, armT: 0.018, armD: 0.1, armTop: 0.172, round: true },
    head: [{ y: -0.075, w: 0.125, d: 0.125, r: 0.03 }, { y: -0.066, w: 0.158, d: 0.16, r: 0.034 }, { y: 0.058, w: 0.158, d: 0.16, r: 0.034 }, { y: 0.067, w: 0.154, d: 0.154, r: 0.06 }, { y: 0.074, w: 0.148 }],
    lensY: 0.075, lensR: 0.066, ringR: 0.073,                   // lens dome adds 22 mm: 0.125 + 0.133 + 0.075 + 0.022 = 0.355
    sink: { y0: -0.088, y1: -0.07, w: 0.075, d: 0.12, n: 9 },     // finned grille on the rear end of each head (rear product photo)
    lcd: [0.05, 0.036], lcdX: 0, controls: 'split4', ctrlX: 0.04,
  },
  assumptions: [
    'Overall size 1019 × 206.5 × 352.5 mm is from the manual; the dimensions of bar, yokes and heads are measured off the product page photos, so they are good to a centimetre or two at best. The depth of the heads along the beam is not visible in those photos and is estimated.',
    'The manual has no picture of the control panel: a display with five buttons in a cross is assumed (top = UP, bottom = DOWN, left = MENU, centre/right = ENTER).',
    'Pan and tilt are centred at DMX 128 (pan ±29.5°, tilt ±110.5°; tilt 128 = heads pointing straight out of the bar).',
    'LED COLOR presets override LED CTO, which overrides the RGBL channels. The LEE colours and the CTO whites are approximations.',
    'The 15 ring macros are not described in the manual: eight patterns (chase, opposite chase, half ring, alternate, fill, breathe, comet, rainbow) repeat over macro 1–15.',
    'Ring blocks: 8 blocks of 3 LEDs each, counted around the lens.',
    'Function channel: dimmer curve, dimmer speed, head invert and the resets act on the simulation; cooling, LED frequency, CCI and dimming start mode are only stored.',
    'No DMX State = Clear shows the Manual-menu values (default: dark, heads centred); Keep holds the last DMX frame.',
    'The menu lists Run Mode DMX / Auto only, so sound mode is not offered. Factory password 050; the calibration values are stored but have no effect.',
    'Default channel mode 21CH (the first one listed).',
  ],
};
