// stage/examples.js — ready-made stages with a programmed DMX show.
//  An example is built in code (not stored as JSON) so that it always follows the channel layout of the model
//  definitions. build() returns a stage file: { app: 'wmh-stage', name, fixtures: [layout], workspace } where
//  `workspace` is an ordinary DMX editor workspace (scenes, EFX, chasers, one show) and can be opened in the editor.
import { blankWorkspace } from '../editor/store.js';
import { getDef } from '../editor/library.js';

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

  /* ── AquaVortex TB5: five heads, RGBL, pixel rings ── */
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

export const EXAMPLES = [
  { id: 'all', name: 'All three models — showcase', about: '2 × 250W BSW, 500W Frame and AquaVortex TB5 on one stage, 48 s show with music', build: () => build('All three models — showcase', { bsw: true, frame: true, tb5: true }) },
  { id: 'bsw', name: '250W BSW pair — beams, gobos, prism', about: 'two WOP-LM1012B', build: () => build('250W BSW pair', { bsw: true }) },
  { id: 'frame', name: '500W Frame — CMY and framing blades', about: 'one WOP-LM500WF', build: () => build('500W Frame', { frame: true }) },
  { id: 'tb5', name: 'AquaVortex TB5 — five heads and pixel rings', about: 'one WOP-AVortex TB5 in 85CH mode', build: () => build('AquaVortex TB5', { tb5: true }) },
];
