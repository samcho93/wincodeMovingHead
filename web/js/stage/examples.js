// stage/examples.js — ready-made stages with a programmed DMX show.
//  An example is built in code (not stored as JSON) so that it always follows the channel layout of the model
//  definitions. build() returns a stage file: { app: 'wmh-stage', name, fixtures: [layout], workspace } where
//  `workspace` is an ordinary DMX editor workspace (scenes, EFX, chasers, one show) and can be opened in the editor.
import { blankWorkspace } from '../editor/store.js';
import { getDef } from '../editor/library.js';
import { LIST } from '../models/index.js';

export const BEAT_FILE = 'Example beat (generated).wav';
export const BPM = 120, LENGTH = 48000;                      // every example show: 48 s at 120 BPM (24 bars)
const hue = h => { const f = n => { const k = (n + (((h % 1) + 1) % 1) * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)].map(v => Math.round(v * 255)); };

function build(name, use) {
  const ws = blankWorkspace(); ws.name = name;
  let id = 1; const nid = () => id++;
  const layout = [];
  /** patch a fixture and place it on the stage */
  const fix = (label, def, mode, address, x, z, rot = 0, mount = 'floor') => { const f = { id: nid(), name: label, def: 'wincode/' + def, mode, universe: 0, address }; ws.fixtures.push(f); layout.push({ id: f.id, x, z, rot, mount }); return f; };
  /** { channelKey: value } → { channelIndex: value } for one fixture */
  const V = (f, o) => { const ch = getDef(f.def).modes[f.mode].channels, out = {}; for (const [k, v] of Object.entries(o)) { const i = ch.findIndex(c => c.key === k); if (i >= 0) out[i] = v; } return out; };
  const scene = (label, parts, fadeIn = 800, fadeOut = 800) => { const fn = { id: nid(), type: 'scene', name: label, values: {}, fadeIn, fadeOut, rev: 0 }; for (const [f, o] of parts) fn.values[f.id] = V(f, o); ws.functions.push(fn); return fn; };
  const efx = (label, heads, o) => { const fn = Object.assign({ id: nid(), type: 'efx', name: label, fixtures: heads, algo: 'Circle', width: 40, height: 30, xOffset: 127, yOffset: 127, rotation: 0, duration: 4000, spread: 0, direction: 'forward' }, o); ws.functions.push(fn); return fn; };
  const chaser = (label, steps) => { const fn = { id: nid(), type: 'chaser', name: label, steps, order: 'loop', direction: 'forward' }; ws.functions.push(fn); return fn; };
  const tracks = [], track = (label, items) => { tracks.push({ name: label, mute: false, solo: false, items: items.map(([fn, start, end, color]) => ({ fn: fn.id, start, duration: end - start, color, locked: false })) }); };
  const B = n => n * 2000;                                   // bar number → ms (4 beats of 500 ms)

  const audio = { id: nid(), type: 'audio', name: 'Example beat', file: BEAT_FILE, volume: 80 }; ws.functions.push(audio);
  track('Music', [[audio, 0, LENGTH, '#3b6ea8']]);

  /* ── 250W BSW × 2: beams, gobos, prism ── */
  if (use.bsw) {
    const L = fix('BSW left', 'lm1012b', 'EXT', 1, -2.6, 0.4), R = fix('BSW right', 'lm1012b', 'EXT', 21, 2.6, 0.4);
    const both = o => [[L, o], [R, o]], open = { strobe: 255, dimmer: 255, focus: 96 };
    const sOpen = scene('BSW · open beams', [[L, { ...open, pan: 118, tilt: 84, zoom: 0 }], [R, { ...open, pan: 138, tilt: 84, zoom: 0 }]], 2000, 1000);
    const sGobo = scene('BSW · red rose gobo', both({ ...open, color: 20, rotGobo: 20, goboRot: 100, zoom: 130, tilt: 72 }));
    const sPrism = scene('BSW · blue stars + prism', both({ ...open, color: 120, rotGobo: 50, goboRot: 90, prism: 200, prismRot: 215, zoom: 90, tilt: 76 }));
    const sTri = scene('BSW · triangle', both({ ...open, gobo: 10, zoom: 70, tilt: 78 }));
    const sStrobe = scene('BSW · strobe', both({ dimmer: 255, strobe: 70, focus: 96, zoom: 0, tilt: 96 }), 0, 0);
    const cols = [['red', 20], ['yellow', 60], ['blue', 120], ['magenta', 140]].map(([n, v]) => scene('BSW colour · ' + n, both({ color: v }), 0, 0));
    const cCol = chaser('BSW · colour chase (1 beat)', cols.map(s => ({ fn: s.id, fadeIn: 0, hold: 500, fadeOut: 0 })));
    const eCircle = efx('BSW · circle', [{ fx: L.id, head: 0 }, { fx: R.id, head: 0 }], { width: 34, height: 22, yOffset: 78, duration: 4000, spread: 180 });
    track('BSW looks', [[sOpen, 0, B(4), '#8f8a2f'], [sGobo, B(4), B(8), '#a83b5c'], [sPrism, B(8), B(12), '#3b9aa8'], [sTri, B(12), B(16), '#a8673b'], [sStrobe, B(16), B(18), '#a83b3b'], [sPrism, B(18), B(21), '#3b9aa8'], [sOpen, B(21), B(24), '#8f8a2f']]);
    track('BSW colour', [[cCol, B(12), B(16), '#8a4fb0']]);
    track('BSW movement', [[eCircle, B(2), B(16), '#2f8f5b'], [eCircle, B(18), B(23), '#2f8f5b']]);
  }

  /* ── 500W Frame: CMY, framing blades, frost ── */
  if (use.frame) {
    const F = fix('Frame', 'lm500wf', '26CH', 41, 0, -1.8);
    const base = { dimmer: 255, strobe: 255, focus: 100, cutRot: 128, pan: 128, tilt: 74 }, cut = v => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(i => ['cut' + i, v]));
    const sWide = scene('Frame · white wash', [[F, { ...base, zoom: 40 }]], 2000);
    const sBox = scene('Frame · cyan square', [[F, { ...base, cyan: 255, zoom: 110, ...cut(85) }]]);
    const sSlash = scene('Frame · magenta slash', [[F, { ...base, magenta: 255, yellow: 70, zoom: 150, cut1: 150, cut2: 20, cut5: 150, cut6: 20, cutRot: 190 }]]);
    const sWarm = scene('Frame · warm frost', [[F, { ...base, cto: 255, frost: 255, zoom: 20 }]]);
    const sGreen = scene('Frame · green trapezoid', [[F, { ...base, cyan: 255, yellow: 255, zoom: 120, cut1: 120, cut2: 60, cut3: 70, cut4: 70, cut7: 70, cut8: 70, cutRot: 100 }]]);
    const eEight = efx('Frame · slow eight', [{ fx: F.id, head: 0 }], { algo: 'Eight', width: 30, height: 14, yOffset: 74, duration: 8000 });
    track('Frame looks', [[sWide, B(2), B(6), '#8f8a2f'], [sBox, B(6), B(10), '#3b9aa8'], [sSlash, B(10), B(14), '#a83b5c'], [sGreen, B(14), B(16), '#2f8f5b'], [sWarm, B(16), B(20), '#a8673b'], [sBox, B(20), B(24), '#3b9aa8']]);
    track('Frame movement', [[eEight, B(6), B(16), '#2f8f5b'], [eEight, B(20), B(23), '#2f8f5b']]);
  }

  /* ── ApexPointe 420: multi-facet prisms, beam reducers, continuous pan ── */
  if (use.apex) {
    const A = fix('ApexPointe', 'apexpointe420', '39CH', 201, use.frame ? -1.9 : 0, -1.8);
    // wheel and effect channels are LTP: every look states all of them, so nothing is left over from the look before
    const base = { dimmer: 255, strobe: 40, focus: 128, goboRot: 128, pan: 128, tilt: 78, panCtrl: 0, vColor: 0, color: 0, cyan: 0, magenta: 0, yellow: 0, gobo: 0, rotGobo: 0, prism1: 0, prism2: 0, frost: 0 };
    const sBeam = scene('Apex · red reducer beam', [[A, { ...base, color: 132, gobo: 60, zoom: 250 }]], 1500);
    const sFlower = scene('Apex · 18-facet magenta flower', [[A, { ...base, color: 150, prism1: 13, prism1Rot: 90, zoom: 190 }]]);
    const sGlass = scene('Apex · cyan glass gobo', [[A, { ...base, cyan: 255, rotGobo: 35, goboRot: 100, zoom: 140 }]]);
    const sRainbow = scene('Apex · multicolour linear prism', [[A, { ...base, rotGobo: 44, goboRot: 60, prism2: 13, prism2Rot: 100, zoom: 170 }]]);
    const sSpin = scene('Apex · continuous pan', [[A, { ...base, panCtrl: 150, color: 174, gobo: 30, tilt: 96, zoom: 230 }]]);
    const sWash = scene('Apex · congo blue wash', [[A, { ...base, vColor: 100, frost: 210, zoom: 20 }]]);
    const eCircle = efx('Apex · circle', [{ fx: A.id, head: 0 }], { width: 30, height: 20, yOffset: 82, duration: 6000 });
    track('Apex looks', [[sBeam, B(1), B(5), '#a83b3b'], [sFlower, B(5), B(9), '#a83b5c'], [sGlass, B(9), B(13), '#3b9aa8'], [sRainbow, B(13), B(16), '#8a4fb0'], [sSpin, B(16), B(19), '#3b6ea8'], [sWash, B(19), B(21), '#3b6ea8'], [sFlower, B(21), B(24), '#a83b5c']]);
    track('Apex movement', [[eCircle, B(3), B(16), '#2f8f5b'], [eCircle, B(21), B(23), '#2f8f5b']]);
  }

  /* ── Mega480 BSW: CMY, preset colours, two prism wheels ── */
  if (use.mega) {
    const M = fix('Mega480', 'mega480', '39CH', 241, use.frame ? 1.9 : 0, -1.8);
    // wheel and effect channels are LTP: every look states all of them, so nothing is left over from the look before
    const base = { dimmer: 255, strobe: 40, focus: 128, goboRot: 128, pan: 128, tilt: 78, cmyMacro: 0, color: 0, cyan: 0, magenta: 0, yellow: 0, gobo: 0, rotGobo: 0, prism1: 0, prism2: 0, frost: 0 };
    const sBeam = scene('Mega · white pencil beam', [[M, { ...base, zoom: 255 }]], 1500);
    const sAmber = scene('Mega · amber gobo', [[M, { ...base, yellow: 255, magenta: 110, gobo: 12, zoom: 150 }]]);
    const sGlass = scene('Mega · green rotating gobo', [[M, { ...base, cyan: 255, yellow: 255, rotGobo: 38, goboRot: 90, zoom: 130 }]]);
    const sPrism = scene('Mega · blue prism', [[M, { ...base, cyan: 255, magenta: 160, prism2: 17, prism2Rot: 100, zoom: 190 }]]);
    const sPreset = scene('Mega · preset colour + frost', [[M, { ...base, cmyMacro: 51, frost: 210, zoom: 30 }]]);
    const sStrobe = scene('Mega · strobe', [[M, { ...base, strobe: 85, zoom: 240, tilt: 96 }]], 0, 0);
    const eEight = efx('Mega · eight', [{ fx: M.id, head: 0 }], { algo: 'Eight', width: 34, height: 16, yOffset: 82, duration: 6000 });
    track('Mega looks', [[sBeam, B(1), B(4), '#8f8a2f'], [sAmber, B(4), B(8), '#a8673b'], [sGlass, B(8), B(12), '#2f8f5b'], [sPrism, B(12), B(16), '#3b6ea8'], [sStrobe, B(16), B(18), '#a83b3b'], [sPreset, B(18), B(21), '#8a4fb0'], [sPrism, B(21), B(24), '#3b6ea8']]);
    track('Mega movement', [[eEight, B(2), B(16), '#2f8f5b'], [eEight, B(21), B(23), '#2f8f5b']]);
  }

  /* ── every other registered model: looks generated from its built-in program ──
     A model added later (for instance by the Add-model agent) appears here without any change to this file. */
  const auto = LIST.filter(M => (use.auto || []).includes(M.id));
  auto.forEach((M, k) => {
    const mode = M.modes[M.defaultMode], chans = mode.channels, P = M.program, colors = ['#3b9aa8', '#a83b5c', '#8f8a2f', '#2f8f5b', '#8a4fb0', '#a8673b'];
    const next = ws.fixtures.reduce((a, f) => Math.max(a, f.address + getDef(f.def).modes[f.mode].channels.length), 1);
    const solo = ws.fixtures.length === 0 && auto.length === 1;
    const F = fix(M.name, M.id, mode.id, next, solo ? 0 : (k - (auto.length - 1) / 2) * 1.9, solo ? 0 : -3.4);
    // one look per program step, with every channel of the mode stated (same rule as Fixture.runProgram)
    const looks = P.steps.map((st, i) => {
      const s = { ...P.base, ...st }, o = {};
      for (const key of chans) { const v = s[key] ?? (P.fill ? P.fill(key, s, i) : undefined) ?? 0; o[key] = typeof v === 'number' ? v : 0; }
      if ('ptSpeed' in o) o.ptSpeed = 40;
      return scene(`${M.name} · program step ${i + 1}`, [[F, o]]);
    });
    const bars = Array.from({ length: 12 }, (_, i) => i);      // a new look every two bars
    track(`${M.name} looks`, bars.map(i => [looks[i % looks.length], B(i * 2), B(i * 2 + 2), colors[i % colors.length]]));
  });

  /* ── AquaVortex TB5: five heads, RGBL, pixel rings (patched last: with every model on stage its fifth head is the one over the projection budget) ── */
  if (use.tb5) {
    const T = fix('TB5', 'tb5', '85CH', 101, 0, 1.6), H = [1, 2, 3, 4, 5];
    /** per-head values: f(headIndex 0..4) → { r, g, b, l, zoom, tilt, pan, ring: [r, g, b], macro } */
    const tb = f => { const o = { dimmer: 255, ringStrobe: 255 }; for (const h of H) { const p = f(h - 1); Object.assign(o, { ['dim' + h]: 255, ['strobe' + h]: 255, ['zoom' + h]: p.zoom ?? 255, ['r' + h]: p.r ?? 0, ['g' + h]: p.g ?? 0, ['b' + h]: p.b ?? 0, ['l' + h]: p.l ?? 0, ['tilt' + h]: p.tilt ?? 100, ['pan' + h]: p.pan ?? 128, ['ringR' + h]: (p.ring || [0, 0, 0])[0], ['ringG' + h]: (p.ring || [0, 0, 0])[1], ['ringB' + h]: (p.ring || [0, 0, 0])[2], ['macro' + h]: p.macro ?? 0 }); } return o; };
    const rgb = (c, extra) => ({ r: c[0], g: c[1], b: c[2], ...extra });
    const sIce = scene('TB5 · blue / white', [[T, tb(i => (i % 2 ? { r: 255, g: 255, b: 255, l: 255, ring: [0, 60, 255], macro: 20 } : rgb([0, 60, 255], { ring: [255, 255, 255], macro: 20 })))]], 1500);
    const sRain = scene('TB5 · rainbow fan', [[T, tb(i => rgb(hue(i / 5), { pan: 128 - (i - 2) * 45, tilt: 96, ring: hue(i / 5 + 0.5), macro: 136 }))]]);
    const sRed = scene('TB5 · red + chase rings', [[T, tb(i => rgb([255, 0, 0], { tilt: 112 - Math.abs(i - 2) * 14, ring: [255, 120, 0], macro: 40 }))]]);
    const sGold = scene('TB5 · gold wide', [[T, tb(() => ({ r: 255, g: 130, l: 255, zoom: 60, ring: [255, 90, 0], macro: 100 }))]]);
    const sHit = scene('TB5 · white strobe', [[T, { ...tb(() => ({ r: 255, g: 255, b: 255, l: 255, tilt: 128, ring: [255, 255, 255] })), ...Object.fromEntries(H.map(h => ['strobe' + h, 90])) }]], 0, 0);
    const eWave = efx('TB5 · wave', H.map(h => ({ fx: T.id, head: h - 1 })), { algo: 'Eight', width: 70, height: 34, yOffset: 100, duration: 3000, spread: 360 });
    track('TB5 looks', [[sIce, 0, B(5), '#3b6ea8'], [sRain, B(5), B(10), '#8a4fb0'], [sRed, B(10), B(16), '#a83b3b'], [sHit, B(16), B(18), '#a83b5c'], [sGold, B(18), B(21), '#a8673b'], [sRain, B(21), B(24), '#8a4fb0']]);
    track('TB5 movement', [[eWave, B(1), B(5), '#2f8f5b'], [eWave, B(10), B(16), '#2f8f5b'], [eWave, B(18), B(21), '#2f8f5b']]);
  }

  ws.functions.push({ id: nid(), type: 'show', name: name, tracks });
  ws.nextId = id;
  return { app: 'wmh-stage', version: 1, name, fixtures: layout, workspace: ws };
}

/* ── several units of one model ──
   arrange() turns a single-model stage into `count` units. Each unit gets its own copy of every look, movement and
   track (so the result stays editable per unit); `style` decides how the copies differ. */
export const STYLES = [
  { id: 'unison', name: 'Unison', about: 'every unit does exactly the same' },
  { id: 'mirror', name: 'Mirror', about: 'the right half mirrors the left half (pan and movement direction)' },
  { id: 'fan', name: 'Fan', about: 'pan spreads out from the centre' },
  { id: 'wave', name: 'Wave', about: 'same looks, movements run with a phase offset from unit to unit' },
  { id: 'canon', name: 'Canon', about: 'each unit follows the one before it, one beat later' },
];
const MAX_HEADS = 24;
/** how many units of this stage's model can be asked for */
export function maxUnits(file) { const f = file.workspace.fixtures[0], m = getDef(f.def).modes[f.mode]; return Math.max(1, Math.min(8, Math.floor(MAX_HEADS / Math.max(1, m.heads.length)))); }

export function arrange(file, count, style = 'unison') {
  const ws = file.workspace, tpl = ws.fixtures[0], mode = getDef(tpl.def).modes[tpl.mode], nch = mode.channels.length, heads = mode.heads;
  count = Math.max(1, Math.min(maxUnits(file), Math.round(count) || 1));
  // keep one unit as the template: drop the others the example was written with
  const extra = new Set(ws.fixtures.slice(1).map(f => f.id));
  ws.fixtures = [tpl]; const lay0 = file.fixtures.find(l => l.id === tpl.id); file.fixtures = [lay0];
  for (const fn of ws.functions) {
    if (fn.type === 'scene') for (const id of extra) delete fn.values[id];
    if (fn.type === 'efx') { fn.fixtures = fn.fixtures.filter(r => !extra.has(r.fx)); if (heads.length === 1) fn.spread = 0; }
  }
  if (count === 1) { lay0.x = 0; return file; }
  let id = ws.nextId; const nid = () => id++;
  const show = ws.functions.find(f => f.type === 'show'), audio = new Set(ws.functions.filter(f => f.type === 'audio').map(f => f.id));
  const own = ws.functions.filter(f => ['scene', 'efx', 'chaser'].includes(f.type)), pristine = JSON.parse(JSON.stringify(own));
  const tracks = show.tracks.filter(t => !t.items.some(i => audio.has(i.fn))).map(t => JSON.parse(JSON.stringify(t)));
  const perU = Math.max(1, Math.floor(512 / nch)), base = tpl.name.replace(/ (left|right)$/, ''), clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const perRow = count <= 5 ? count : Math.ceil(count / 2), gap = heads.length > 1 ? 1.9 : 1.3, z0 = lay0.z;
  const panIdx = heads.map(h => h.pan).filter(i => i >= 0);
  for (let k = 0; k < count; k++) {
    const u = (k / (count - 1)) * 2 - 1, right = u > 0.001;                  // −1 (left) … +1 (right)
    const row = Math.floor(k / perRow), n = Math.min(perRow, count - row * perRow), x = ((k % perRow) - (n - 1) / 2) * gap, z = z0 - row * 1.7;
    const place = { universe: Math.floor(k / perU), address: 1 + (k % perU) * nch };
    const pan = v => (style === 'mirror' && right ? 255 - v : style === 'fan' ? clamp(v + u * 30) : v);
    const tune = fn => {                                                     // how this unit's copy differs from the template
      if (fn.type === 'scene') for (const vals of Object.values(fn.values)) for (const i of panIdx) if (i in vals) vals[i] = pan(vals[i]);
      if (fn.type === 'efx') {
        fn.xOffset = pan(fn.xOffset ?? 127);
        if (style === 'mirror' && right) fn.direction = fn.direction === 'backward' ? 'forward' : 'backward';
        if (style === 'wave') fn.phase = (k / count) * 360;
      }
    };
    if (k === 0) { Object.assign(tpl, place, { name: `${base} 1` }); Object.assign(lay0, { x, z }); own.forEach(tune); continue; }
    const f = { ...tpl, ...place, id: nid(), name: `${base} ${k + 1}` };
    ws.fixtures.push(f); file.fixtures.push({ ...lay0, id: f.id, x, z });
    const map = new Map();
    for (const src of pristine) map.set(src.id, nid());
    for (const src of pristine) {
      const fn = JSON.parse(JSON.stringify(src)); fn.id = map.get(src.id); fn.name = `${src.name} · unit ${k + 1}`;
      if (fn.type === 'scene') fn.values = { [f.id]: fn.values[tpl.id] || {} };
      if (fn.type === 'efx') fn.fixtures = fn.fixtures.map(r => ({ ...r, fx: f.id }));
      if (fn.type === 'chaser') fn.steps = fn.steps.map(s => ({ ...s, fn: map.get(s.fn) ?? s.fn }));
      tune(fn); ws.functions.push(fn);
    }
    const delay = style === 'canon' ? k * 60000 / BPM : 0;
    for (const t of tracks) show.tracks.push({ ...t, name: `${t.name} · unit ${k + 1}`, items: t.items.map(i => ({ ...i, fn: map.get(i.fn) ?? i.fn, start: i.start + delay, duration: Math.min(i.duration, LENGTH - i.start - delay) })).filter(i => i.duration > 0) });
  }
  ws.nextId = id; ws.name = file.name = `${file.name} × ${count} (${STYLES.find(s => s.id === style)?.name || style})`;
  return file;
}

// Models with a hand-written section above. Every other model in the registry gets a generated section and its own example.
const WRITTEN = ['lm1012b', 'lm500wf', 'tb5', 'apexpointe420', 'mega480'];
const OTHERS = LIST.filter(M => !WRITTEN.includes(M.id));
/** stage with one model's generated section (also usable for a hand-written model, to try the generator) */
export const buildAuto = id => { const M = LIST.find(m => m.id === id); return build(M.name, { auto: [id] }); };

export const EXAMPLES = [
  { id: 'all', name: 'All models — showcase', about: 'every registered model on one stage, 48 s show with music', build: () => build('All models — showcase', { bsw: true, frame: true, tb5: true, apex: true, mega: true, auto: OTHERS.map(M => M.id) }) },
  { id: 'bsw', name: '250W BSW — beams, gobos, prism', about: 'WOP-LM1012B', units: 2, style: 'mirror', build: () => build('250W BSW', { bsw: true }) },
  { id: 'frame', name: '500W Frame — CMY and framing blades', about: 'one WOP-LM500WF', build: () => build('500W Frame', { frame: true }) },
  { id: 'tb5', name: 'AquaVortex TB5 — five heads and pixel rings', about: 'one WOP-AVortex TB5 in 85CH mode', build: () => build('AquaVortex TB5', { tb5: true }) },
  { id: 'apex', name: 'ApexPointe 420 — prisms, reducers, continuous pan', about: 'one ApexPointe 420 in 39CH mode', build: () => build('ApexPointe 420', { apex: true }) },
  { id: 'mega', name: 'Mega480 BSW — CMY, gobos, prisms', about: 'one WOP-M480BSW in 39CH mode', build: () => build('Mega480 BSW', { mega: true }) },
  ...OTHERS.map(M => ({ id: M.id, name: `${M.name} — built-in program`, about: `one ${M.code} in ${M.modes[M.defaultMode].label} mode, looks generated from its built-in program`, build: () => buildAuto(M.id) })),
];
