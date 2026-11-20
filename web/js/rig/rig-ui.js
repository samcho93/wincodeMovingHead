// rig/rig-ui.js — the form that edits one truss piece (Stage Builder and Stage Editor) and the "load a rig" dialog.
import { h, select, textInput, dialog } from '../editor/ui.js';
import { TYPES, SIZES, norm, PRESETS, savedRig, readRig, describe, lengthOf, mountable } from './rig.js';

const num = (value, min, max, step, fn) => h('input', { type: 'number', step, min, max, value: Math.round(value * 100) / 100, onchange: e => { const v = Math.min(max, Math.max(min, +e.target.value || 0)); e.target.value = v; fn(v); } });
/** fields of a piece as a two-column form; onChange(key) after every edit ('type' = the fields themselves changed) */
export function pieceEditor(p, room, onChange) {
  const row = (label, el, title) => [h('span', { title }, label), el], set = (k, v) => { p[k] = v; onChange(k); };
  const X = room.w / 2, Z0 = room.back, Z1 = room.back + room.d;
  return h('div', { class: 'kv' },
    row('Name', textInput(p.name, v => set('name', v))),
    row('Shape', select(TYPES, p.type, v => { p.type = v; if (v === 'upright') { p.h = p.y + p.size; p.y = 0; } else if (!p.y) p.y = Math.min(4.6, room.h - 1); norm(p); onChange('type'); })),
    row('Truss size', select(SIZES, p.size, v => set('size', +v)), 'Distance between the chords of the box truss'),
    p.type === 'straight' ? row('Length (m)', num(p.len, 0.5, 60, 0.5, v => set('len', v))) : null,
    p.type === 'circle' || p.type === 'arc' ? row('Radius (m)', num(p.r, 0.5, 30, 0.25, v => set('r', v))) : null,
    p.type === 'arc' ? row('Angle (°)', num(p.angle, 10, 350, 5, v => set('angle', v)), 'How much of the ring the arc covers') : null,
    p.type === 'upright' ? row('Height (m)', num(p.h, 0.5, room.h, 0.1, v => set('h', v))) : null,
    row(p.type === 'straight' ? 'Middle X (m)' : p.type === 'upright' ? 'Position X (m)' : 'Centre X (m)', num(p.x, -X, X, 0.1, v => set('x', v))),
    row(p.type === 'straight' ? 'Middle Z (m)' : p.type === 'upright' ? 'Position Z (m)' : 'Centre Z (m)', num(p.z, Z0, Z1, 0.1, v => set('z', v)), 'Depth: negative = upstage (towards the back wall)'),
    row(p.type === 'upright' ? 'Stands at (m)' : 'Height (m)', num(p.y, 0, room.h, 0.1, v => set('y', v)), p.type === 'upright' ? 'Height of its foot: 0 = on the floor' : 'Height of the lower chords: fixtures hang there'),
    row('Rotation (°)', num(p.rot, -180, 180, 5, v => set('rot', v)), '0 = across the stage, 90 = running upstage–downstage'));
}
/** one line that says what a piece is */
export const pieceLine = p => `${describe(p)}${mountable(p) ? '' : ' · structure'}`;
export const totalLength = list => list.reduce((s, p) => s + lengthOf(p), 0);

/** Dialog: choose a ready-made rig, the one in the Stage Builder, or a file. onPick(rig) */
export function openRigDialog(onPick, note) {
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const close = dialog('Load a rig', (b, shut) => {
    const pick = rig => { shut(); onPick(rig); }, built = savedRig();
    file.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { pick(readRig(JSON.parse(await f.text()))); } catch (err) { alert('Could not open the file: ' + err.message); } });
    b.append(h('p', { class: 'note' }, note || 'The rig is the room and its trusses. Loading one replaces the trusses of this stage.'),
      h('div', null, PRESETS.map(x => h('div', { class: 'fnrow', title: x.about, onclick: () => pick(x.build()) }, h('span', { class: 'nm' }, x.name), h('span', { class: 'note' }, x.about)))),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn', disabled: !built || !built.trusses.length, title: 'The rig that is open in the Stage Builder (its last state in this browser)', onclick: () => pick(savedRig()) }, built && built.trusses.length ? `🏗 From the Stage Builder: “${built.name}”` : '🏗 Stage Builder: nothing built yet'),
        h('button', { class: 'btn', onclick: () => file.click(), title: 'A rig file saved by the Stage Builder, or the rig of a stage file' }, 'Open a rig file…'), file));
  });
  return close;
}
