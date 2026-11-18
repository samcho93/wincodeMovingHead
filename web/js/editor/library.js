// editor/library.js — fixture definitions the editor can patch.
//  Wincode fixtures come straight from the simulator's model definitions (models/*.js), so a model added to the
//  simulator is available here without further work. A few generic definitions cover other equipment.
//  Channel groups decide how values from several running functions are merged, as in QLC+:
//   HTP (highest takes precedence): intensity and colour-mixing channels · LTP (latest takes precedence): everything else.
import { LIST } from '../models/index.js';

const baseOf = key => { const m = /^rb\d_\d[rgb]$/.test(key) ? ['rb'] : /^([a-zA-Z]+?)\d*$/.exec(key); return m ? (m[1] || m[0]) : key; };
const headOf = key => { const m = /^(?:rb(\d)_\d[rgb]|[a-zA-Z]+?(\d))$/.exec(key); return m ? +(m[1] || m[2]) : 0; };
const GROUP = {
  pan: 'pan', panFine: 'pan', tilt: 'tilt', tiltFine: 'tilt',
  dimmer: 'intensity', dimmerFine: 'intensity', dim: 'intensity', dimFine: 'intensity',
  r: 'colour', g: 'colour', b: 'colour', l: 'colour', w: 'colour', a: 'colour', ringR: 'colour', ringG: 'colour', ringB: 'colour', rb: 'colour',
};
export const groupOf = key => GROUP[baseOf(key)] || 'effect';
export const isHTP = group => group === 'intensity' || group === 'colour';
const chan = (key, name) => ({ key, name, group: groupOf(key), htp: isHTP(groupOf(key)) });

/** Heads of one mode: channel indexes of the pan/tilt pairs (for EFX) — one entry per head */
function headsOf(channels) {
  const heads = new Map();
  channels.forEach((c, i) => {
    const b = baseOf(c.key); if (!['pan', 'panFine', 'tilt', 'tiltFine'].includes(b)) return;
    const h = headOf(c.key); if (!heads.has(h)) heads.set(h, { pan: -1, panFine: -1, tilt: -1, tiltFine: -1 });
    heads.get(h)[b] = i;
  });
  return [...heads.values()].filter(h => h.pan >= 0 || h.tilt >= 0);
}
function def(id, manufacturer, model, modes, describe) {
  const out = { id, manufacturer, model, modes: {}, describe: describe || ((k, v) => String(v)) };
  for (const [mid, m] of Object.entries(modes)) out.modes[mid] = { id: mid, label: m.label, channels: m.channels, heads: headsOf(m.channels) };
  out.defaultMode = Object.keys(out.modes)[0];
  return out;
}

const DEFS = new Map();
for (const M of LIST) {
  const modes = {};
  for (const m of Object.values(M.modes)) modes[m.id] = { label: m.label, channels: m.channels.map(k => chan(k, M.ch[k])) };
  const d = def('wincode/' + M.id, 'Wincode', `${M.name} (${M.code})`, modes, M.describe);
  d.defaultMode = M.defaultMode; d.sim = M.id;                 // sim: opens in the 3D simulator
  DEFS.set(d.id, d);
}
const G = (id, model, modes) => DEFS.set('generic/' + id, def('generic/' + id, 'Generic', model, modes));
const one = (label, list) => ({ label, channels: list.map(([k, n]) => chan(k, n)) });
G('dimmer', 'Dimmer', { '1CH': one('1CH', [['dimmer', 'Dimmer']]) });
G('rgb', 'RGB', { '3CH': one('3CH', [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]), '4CH': one('4CH (Dimmer + RGB)', [['dimmer', 'Dimmer'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]) });
G('rgbw', 'RGBW', { '4CH': one('4CH', [['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['w', 'White']]), '6CH': one('6CH (Dimmer + RGBW + Strobe)', [['dimmer', 'Dimmer'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['w', 'White'], ['strobe', 'Strobe']]) });
G('moving', 'Moving Head', { '11CH': one('11CH', [['pan', 'Pan'], ['panFine', 'Pan Fine'], ['tilt', 'Tilt'], ['tiltFine', 'Tilt Fine'], ['ptSpeed', 'P/T Speed'], ['dimmer', 'Dimmer'], ['strobe', 'Shutter'], ['color', 'Colour'], ['gobo', 'Gobo'], ['prism', 'Prism'], ['focus', 'Focus']]) });
G('scanner', 'Scanner', { '6CH': one('6CH', [['pan', 'Pan'], ['tilt', 'Tilt'], ['dimmer', 'Dimmer'], ['strobe', 'Shutter'], ['color', 'Colour'], ['gobo', 'Gobo']]) });
{ const modes = {}; for (const n of [1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64]) modes[n + 'CH'] = one(n + 'CH', Array.from({ length: n }, (_, i) => ['dimmer' + (i + 1), 'Channel ' + (i + 1)])); G('multi', 'Generic channels', modes); }

export const library = [...DEFS.values()];
export const getDef = id => DEFS.get(id);
export const modeOf = fx => { const d = DEFS.get(fx.def); return d ? d.modes[fx.mode] || d.modes[d.defaultMode] : null; };
