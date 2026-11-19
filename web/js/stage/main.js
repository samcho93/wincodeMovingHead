// stage/main.js — Stage Editor: several fixtures of any model on one 3D stage, driven by one DMX patch.
//  A stage file holds the layout (trusses, where each fixture stands or hangs) and a DMX editor workspace (patch,
//  functions, show, and the descriptions of the library fixtures it uses). The show plays here through the editor's
//  own engine; when nothing plays, the fixtures follow the virtual DMX cable, so a console in another window can
//  program the same stage live.
import * as THREE from 'three';
import { createStage, buildTruss, TRUSS_Y, ROOM } from './scene3d.js';
import { EXAMPLES, STYLES, arrange, maxUnits, BEAT_FILE, BPM, LENGTH } from './examples.js';
import { makeBeat } from './beat.js';
import { openLibrary } from './library-ui.js';
import { store, blankWorkspace, audioFiles } from '../editor/store.js';
import { Engine, durationOf } from '../editor/engine.js';
import { getDef } from '../editor/library.js';
import { freeAddress } from '../editor/fixtures.js';
import { h, fill, select, numInput, textInput, fmtTime } from '../editor/ui.js';
import { MODELS } from '../models/index.js';
import { registerAll, keepInWorkspace, pruneWorkspace } from '../library/desc.js';
import { Fixture } from '../fixture.js';
import { Menu } from '../menu.js';
import { TouchMenu } from '../menu-touch.js';
import { NullMenu } from '../menu-none.js';
import { buildMachine } from '../machine.js';
import { BeamImage } from '../gobos.js';
import { Beam } from '../beam.js';
import { CABLE } from '../dmx.js';
import { installAgentEntry } from '../agent-entry.js';

const $ = s => document.querySelector(s);
const LS = 'wmh.stage.v1';
const MAX_PROJECTED = 9, MAX_SHADOWS = 3;                    // projected spots cost texture units in every lit material
const MENUS = { touch: TouchMenu, buttons: Menu, none: NullMenu };
const snap = v => Math.round(v * 10) / 10, clamp = (v, a, b) => Math.min(b, Math.max(a, v)), rad = THREE.MathUtils.degToRad;
const X_MAX = ROOM.w / 2 - 0.5, Z_MIN = ROOM.back + 0.5, Z_MAX = ROOM.back + ROOM.d - 0.5;

store.persist = false;                                       // never overwrite the DMX editor's own autosave from here
const engine = new Engine();
const S = createStage($('#viewport'));
let file = null;                                             // the stage file being shown
let items = [];                                              // runtime: { lay, patch, model, fx, menu, R, beams: [{ img, beam, head, r }], hl }
const sel = new Set();                                       // selected fixture ids (the last one clicked is `cur`)
let cur = null, haze = 0.55;
window.WST = { engine, store, get items() { return items; }, get file() { return file; }, get sel() { return [...sel]; } };   // for debugging from the console

/* ── DMX from other windows (the DMX editor, DMX Studio, the slider transmitter) ── */
const cable = new Map();                                     // universe → { data, at }
new BroadcastChannel(CABLE).onmessage = e => { const m = e.data; if (m && m.t === 'dmx') cable.set(m.u ?? 0, { data: m.data, at: performance.now() }); };

/* ── trusses ── */
const trussGroups = new Map();                               // truss id → THREE.Group
const trussOf = lay => (lay.mount === 'truss' ? file.trusses.find(t => t.id === lay.truss) || file.trusses[0] : null);
function addTruss(props = {}) {
  const id = 1 + file.trusses.reduce((m, t) => Math.max(m, t.id), 0), t = Object.assign({ id, name: `Truss ${id}`, x: 0, z: 0, y: TRUSS_Y, len: ROOM.w - 2 }, props);
  file.trusses.push(t); return t;
}
function drawTrusses() {
  for (const g of trussGroups.values()) { S.scene.remove(g); g.traverse(o => o.geometry && o.geometry.dispose()); }
  trussGroups.clear();
  for (const t of file.trusses) { const g = buildTruss(t.len); g.position.set(t.x, t.y, t.z); S.scene.add(g); trussGroups.set(t.id, g); }
}

/* ── building / disposing fixtures ── */
const markers = [];
const markerMat = new THREE.MeshBasicMaterial({ color: 0xf0923a, transparent: true, opacity: 0.9, depthWrite: false });
function showMarkers() {
  const list = items.filter(i => sel.has(i.lay.id));
  while (markers.length < list.length) { const m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.47, 48), markerMat); m.rotation.x = -Math.PI / 2; S.scene.add(m); markers.push(m); }
  markers.forEach((m, i) => { m.visible = i < list.length; if (m.visible) m.position.set(list[i].lay.x, 0.006, list[i].lay.z); });
}
function place(it) {
  const l = it.lay; if (l.mount === 'truss' && !file.trusses.length) { addTruss({ z: l.z }); drawTrusses(); }
  const tr = trussOf(l);
  if (tr) { l.truss = tr.id; l.z = tr.z; l.x = clamp(l.x, tr.x - tr.len / 2 + 0.2, tr.x + tr.len / 2 - 0.2); }
  it.R.root.position.set(l.x, tr ? tr.y - 0.13 : 0, l.z);
  it.R.root.rotation.set(0, rad(l.rot || 0), tr ? Math.PI : 0);
  it.fx.inverted = !!tr;
}
function addItem(lay) {
  const patch = store.fixture(lay.id), def = patch && getDef(patch.def), model = def && MODELS[def.sim];
  if (!model) return null;                                   // generic fixtures have no 3D model: they stay in the patch only
  const fx = new Fixture(model, { persist: false, settings: { address: patch.address, mode: patch.mode, runMode: 'DMX' } });
  fx.setPower(true); fx.skipReset();
  const menu = new (MENUS[model.panel.type] || Menu)(fx);
  const R = buildMachine(menu.canvas, model.body);
  R.root.traverse(o => { o.userData.item = lay.id; });
  S.scene.add(R.root);
  const used = items.reduce((n, i) => n + i.beams.filter(b => b.beam.project).length, 0), shadows = items.reduce((n, i) => n + i.beams.filter(b => b.beam.project && b.beam.light.castShadow).length, 0);
  const beams = R.heads.map((r, i) => {
    const img = new BeamImage(model, 192), project = used + i < MAX_PROJECTED, shadow = project && R.heads.length === 1 && shadows < MAX_SHADOWS ? 512 : 0;
    const beam = new Beam(r.tilt, img.out, R.dim, { steps: 20, shadow, project });
    beam.setDepth(S.depthRT.depthTexture, S.size.w, S.size.h, S.camera);
    return { img, beam, head: fx.heads[i], r };
  });
  const it = { lay, patch, model, fx, menu, R, beams, hl: false }; items.push(it); place(it); return it;
}
function removeItem(it) {
  S.scene.remove(it.R.root);
  it.R.root.traverse(o => { if (o.geometry) o.geometry.dispose(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { if (x.map && x.map.isCanvasTexture) x.map.dispose(); x.dispose(); }); });
  it.beams.forEach(b => b.beam.tex.dispose());
  items = items.filter(x => x !== it);
}
S.onResize = () => { for (const it of items) for (const b of it.beams) b.beam.setDepth(S.depthRT.depthTexture, S.size.w, S.size.h, S.camera); };
/** lamp test: the fixture simply shines (open, full, white), whatever the show or the cable sends */
function highlight(it, on) {
  it.hl = on; if (!on) return it.fx.release();
  const M = it.model, v = it.fx.override('local'), hv = Object.assign({}, M.homeValues, M.highlight || M.program.base);
  for (const k of Object.keys(v)) v[k] = hv[k] ?? 0;
}

/* ── stage files ── */
const emptyStage = () => ({ app: 'wmh-stage', version: 2, name: 'New stage', trusses: [], fixtures: [], workspace: Object.assign(blankWorkspace(), { name: 'New stage' }) });
function load(f) {
  if (!f || f.app !== 'wmh-stage' || !f.workspace) throw new Error('Not a stage file');
  wantPlay = false; playSeq++;                                // the old show is gone: its "ended" must not restart anything
  engine.reset(); [...items].forEach(removeItem); sel.clear(); cur = null;
  file = f; store.load(f.workspace); file.workspace = store.ws;   // the engine re-reads universes and the patch; keep one workspace object
  if (!file.trusses) {                                        // version 1 files: one fixed truss line per depth at which something hangs
    file.trusses = []; for (const l of f.fixtures) if (l.mount === 'truss') { const t = file.trusses.find(t => Math.abs(t.z - l.z) < 0.05) || addTruss({ z: l.z }); l.truss = t.id; }
  }
  drawTrusses();
  for (const lay of f.fixtures) addItem(lay);
  drawPanel(); syncTransport(); showMarkers();
}
const autosave = () => { try { pruneWorkspace(store.ws); localStorage.setItem(LS, JSON.stringify(file)); } catch (e) {} };
const changed = () => { clearTimeout(changed.t); changed.t = setTimeout(autosave, 500); };
function download() {
  pruneWorkspace(store.ws);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
  a.download = (file.name || 'stage').replace(/[^\w.-]+/g, '_') + '.stage.json'; a.click(); URL.revokeObjectURL(a.href);
}

/* ── transport: plays the first show of the workspace ── */
const showFn = () => store.ws.functions.find(f => f.type === 'show');
const playing = () => { const s = showFn(); return !!s && engine.isRunning(s.id); };
async function play(offset = 0) {
  const my = ++playSeq, s = showFn(); if (!s) return alert('This stage has no show yet. Use "Edit show" to program one in the DMX editor.');
  if (store.ws.functions.some(f => f.type === 'audio' && f.file === BEAT_FILE) && !(await audioFiles.get(BEAT_FILE))) await audioFiles.put(BEAT_FILE, makeBeat(LENGTH / 1000, BPM));   // the examples' backing track is synthesised on first use
  if (my !== playSeq || s !== showFn()) return;               // a newer play / load came in while the track was being prepared
  // Restarting a running show stops the old runner first. That must not look like "the show ended" to the loop handler
  // below, or every restart would trigger another one.
  wantPlay = false; engine.start(s.id, { offset }); wantPlay = true; syncTransport();
}
let playSeq = 0;
let wantPlay = false;                                        // true while the show is meant to run (tells "ended" from "stopped")
function stop() { wantPlay = false; engine.stopAll(); syncTransport(); }
function syncTransport() { const p = playing(); $('#btnPlay').textContent = p ? '❚❚ Pause' : '▶ Play'; $('#btnPlay').classList.toggle('on', p); $('#btnPlay').disabled = !showFn(); }
let pausedAt = 0;
$('#btnPlay').addEventListener('click', () => { if (playing()) { pausedAt = engine.runner(showFn().id).t; stop(); } else play(pausedAt); });
$('#btnStop').addEventListener('click', () => { pausedAt = 0; stop(); });
$('#seek').addEventListener('input', e => { const s = showFn(); if (!s) return; pausedAt = e.target.value / 1000 * durationOf(s); if (playing()) play(pausedAt); });
engine.on(ev => { if (ev !== 'run') return; const s = showFn(), ended = wantPlay && s && !engine.isRunning(s.id); syncTransport(); if (ended) { pausedAt = 0; if ($('#chkLoop').checked) play(0); else wantPlay = false; } });

/* ── editing the patch and the layout ── */
const footprint = f => getDef(f.def).modes[f.mode].channels.length;
/** first free block of n channels: this universe first, then the following ones → { universe, address } | null */
function freeSlot(n, from = 0) { for (let u = from; u < store.ws.universes.length; u++) { const a = freeAddress(u, n); if (a) return { universe: u, address: a }; } return null; }
function touchPatch() { store.emit('fixtures'); changed(); drawPanel(); showMarkers(); }
/** add `count` fixtures of a definition in a row; returns their ids */
function addFixtures({ def, desc, mode, count, mount }) {
  const ws = store.ws, n = def.modes[mode].channels.length, made = [], short = def.model.replace(/ \(.*/, '');
  if (desc) keepInWorkspace(ws, desc);
  const tr = mount === 'truss' ? file.trusses[0] || addTruss() : null, gap = count > 1 ? Math.min(1.2, (ROOM.w - 3) / (count - 1)) : 0;
  if (tr) drawTrusses();
  // where the new row goes: on the floor the first free row from the front; on a truss next to what already hangs there
  const lim = tr ? tr.len / 2 - 0.4 : X_MAX, mid = tr ? tr.x : 0, w = gap * (count - 1);
  const rowOf = z => file.fixtures.filter(l => (tr ? l.mount === 'truss' && l.truss === tr.id : l.mount !== 'truss' && Math.abs(l.z - z) < 0.5));
  const z0 = tr ? tr.z : [1.5, 0.5, 2.5, -0.5, 3.5, -1.5, -2.5].find(z => !rowOf(z).length) ?? 1.5, there = rowOf(z0);
  const right = there.length ? Math.max(...there.map(l => l.x)) + Math.max(gap, 0.8) : -Infinity, x0 = there.length && right + w <= mid + lim ? right : mid - w / 2;
  for (let i = 0; i < count; i++) {
    const slot = freeSlot(n); if (!slot) { alert(`No universe has ${n} free channels left. ${made.length} of ${count} fixtures were added.`); break; }
    const id = store.id(), num = ws.fixtures.filter(f => f.def === def.id).length + 1;
    ws.fixtures.push({ id, name: `${short} ${num}`, def: def.id, mode, universe: slot.universe, address: slot.address });
    const lay = { id, x: snap(x0 + i * gap), z: z0, rot: 0, mount, truss: tr ? tr.id : undefined };
    file.fixtures.push(lay); if (addItem(lay)) made.push(id);
  }
  sel.clear(); made.forEach(id => sel.add(id)); cur = made[made.length - 1] ?? null; touchPatch(); return made;
}
function removeFixtures(ids) {
  const ws = store.ws;
  for (const id of ids) {
    ws.fixtures = ws.fixtures.filter(f => f.id !== id); file.fixtures = file.fixtures.filter(l => l.id !== id);
    for (const fn of ws.functions) { if (fn.values) delete fn.values[id]; if (fn.fixtures) fn.fixtures = fn.fixtures.filter(r => r.fx !== id); }
    const it = items.find(i => i.lay.id === id); if (it) removeItem(it); sel.delete(id);
  }
  cur = [...sel].pop() ?? null; touchPatch();
}
function duplicate(ids) {
  const ws = store.ws, made = [];
  for (const id of ids) {
    const p = store.fixture(id), l = file.fixtures.find(x => x.id === id); if (!p || !l) continue;
    const slot = freeSlot(footprint(p), p.universe) || freeSlot(footprint(p)); if (!slot) { alert('No free channels left for another copy.'); break; }
    const nid = store.id(); ws.fixtures.push(Object.assign({}, p, { id: nid, name: p.name.replace(/\s*\d*$/, '') + ' ' + (ws.fixtures.filter(f => f.def === p.def).length + 1), universe: slot.universe, address: slot.address }));
    const lay = Object.assign({}, l, { id: nid, x: clamp(snap(l.x + 0.6), -X_MAX, X_MAX) }); file.fixtures.push(lay); if (addItem(lay)) made.push(nid);
  }
  if (made.length) { sel.clear(); made.forEach(id => sel.add(id)); cur = made[made.length - 1]; } touchPatch();
}
/** give the fixtures consecutive addresses, in the order given, starting at universe / address */
function readdress(ids, universe, address) {
  const ws = store.ws, own = new Set(ids), taken = u => { const used = new Uint8Array(514); for (const f of ws.fixtures) if (f.universe === u && !own.has(f.id)) for (let a = f.address; a < f.address + footprint(f) && a <= 512; a++) used[a] = 1; return used; };
  let u = universe, a = address, used = taken(u);
  for (const id of ids) {
    const p = store.fixture(id), n = footprint(p);
    for (;;) { while (a + n - 1 <= 512 && used.subarray(a, a + n).some(Boolean)) a++; if (a + n - 1 <= 512) break; if (++u >= ws.universes.length) return alert('Not enough free channels: the rest keeps its address.'); a = 1; used = taken(u); }
    p.universe = u; p.address = a; used.fill(1, a, a + n); a += n; own.delete(id);
    const it = items.find(i => i.lay.id === id); if (it) it.fx.set('address', p.address);
  }
}
const selItems = () => items.filter(i => sel.has(i.lay.id));
const bySide = list => [...list].sort((a, b) => a.lay.x - b.lay.x || a.lay.z - b.lay.z);

/* ── side panel ── */
function drawPanel() {
  const ws = store.ws, it = items.find(i => i.lay.id === cur), many = selItems(), row = (label, el) => [h('span', null, label), el];
  const setPatch = (key, v) => { it.patch[key] = v; if (key === 'mode') { it.fx.set('mode', v); for (const fn of ws.functions) if (fn.values) delete fn.values[it.patch.id]; } if (key === 'address') it.fx.set('address', v); touchPatch(); };
  const setLay = (list, key, v) => { for (const i of list) { i.lay[key] = v; place(i); } changed(); showMarkers(); };
  const num = (value, min, max, step, fn) => h('input', { type: 'number', step, min, max, value, onchange: e => fn(clamp(+e.target.value || 0, min, max)) });
  const trussSel = (list, value) => select([['', 'Floor'], ...file.trusses.map(t => [t.id, `${t.name} (${t.y} m)`])], value, v => { for (const i of list) { i.lay.mount = v ? 'truss' : 'floor'; i.lay.truss = v ? +v : undefined; place(i); } changed(); drawPanel(); showMarkers(); });
  const hlBtn = list => { const on = list.every(i => i.hl); return h('button', { class: 'btn sm' + (on ? ' on' : ''), title: 'Lamp test: the selected fixtures shine open, full and white whatever the show sends', onclick: () => { list.forEach(i => highlight(i, !on)); drawPanel(); } }, '💡 Highlight'); };
  let reU = 0, reA = 1;
  fill($('#stagePanel'),
    h('h3', null, 'Stage'),
    h('div', { class: 'kv' }, row('Name', textInput(file.name, v => { file.name = v; ws.name = v; changed(); })), row('Show', h('b', null, showFn() ? `${showFn().name} · ${fmtTime(durationOf(showFn()))}` : 'none — use "Edit show"'))),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn acc', onclick: () => openLibrary(addFixtures), title: 'Open the fixture library: Wincode models, the Open Fixture Library, GDTF import' }, '＋ Add fixtures…'),
      h('button', { class: 'btn sm', title: 'Add a truss to hang fixtures from', onclick: () => { addTruss({ z: snap(clamp((file.trusses.length ? Math.min(...file.trusses.map(t => t.z)) : 1) - 1.5, Z_MIN, Z_MAX)) }); drawTrusses(); changed(); drawPanel(); } }, '＋ Truss')),
    file.trusses.length ? [h('h3', null, `Trusses (${file.trusses.length})`), h('table', { class: 'mini' }, h('tr', null, ['Name', 'Depth Z', 'Height', 'Length', ''].map(x => h('th', null, x))),
      file.trusses.map(t => { const upd = (k, v) => { t[k] = v; drawTrusses(); items.forEach(place); changed(); showMarkers(); if (k === 'y' || k === 'name') drawPanel(); };
        return h('tr', null, h('td', null, textInput(t.name, v => upd('name', v))), h('td', null, num(t.z, Z_MIN, Z_MAX, 0.1, v => upd('z', v))), h('td', null, num(t.y, 1.5, ROOM.h - 0.5, 0.1, v => upd('y', v))), h('td', null, num(t.len, 1, ROOM.w - 1, 0.5, v => upd('len', v))),
          h('td', null, h('button', { class: 'btn sm', title: 'Remove the truss; what hangs from it goes to the floor', onclick: () => { for (const i of items) if (i.lay.mount === 'truss' && i.lay.truss === t.id) { i.lay.mount = 'floor'; i.lay.truss = undefined; } file.trusses = file.trusses.filter(x => x !== t); drawTrusses(); items.forEach(place); changed(); drawPanel(); showMarkers(); } }, '✕'))); }))] : null,
    h('h3', null, `Fixtures (${items.length})`),
    h('div', null, items.map(i => h('div', { class: 'fnrow' + (sel.has(i.lay.id) ? ' sel' : ''), onclick: e => selectItem(i.lay.id, e.shiftKey || e.ctrlKey || e.metaKey) },
      h('span', { class: 'nm' }, i.hl ? '💡 ' : '', i.patch.name), h('span', { class: 'note' }, `${i.model.name} · U${i.patch.universe + 1}.${String(i.patch.address).padStart(3, '0')}–${i.patch.address + i.fx.footprint - 1}`)))),
    items.length ? h('p', { class: 'note' }, 'Shift-click to select several. Del removes · Ctrl+D duplicates · arrow keys move · Q / E turn.') : h('p', { class: 'note' }, 'The stage is empty. Press “Add fixtures…”, or load an example from the top bar.'),
    many.length > 1 ? [
      h('h3', null, `${many.length} fixtures selected`),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', title: 'Equal spacing between the leftmost and the rightmost one', onclick: () => { const L = bySide(many), a = L[0].lay.x, b = L[L.length - 1].lay.x, w = b - a < 0.2 ? Math.min(1.2 * (L.length - 1), 2 * X_MAX) : b - a, x0 = b - a < 0.2 ? clamp(a - w / 2, -X_MAX, X_MAX - w) : a; L.forEach((i, k) => { i.lay.x = snap(x0 + w * k / (L.length - 1)); place(i); }); changed(); showMarkers(); } }, '↔ Spread evenly'),
        h('button', { class: 'btn sm', title: 'Put all of them at the depth of the first one', onclick: () => setLay(many.filter(i => i.lay.mount !== 'truss'), 'z', many[0].lay.z) }, '⇥ Same depth'),
        h('button', { class: 'btn sm', title: 'Turn every fixture so that its front faces the audience', onclick: () => { setLay(many, 'rot', 0); drawPanel(); } }, '⟲ Face front'),
        h('button', { class: 'btn sm', title: 'Mirror the rotation left and right of the middle', onclick: () => { const L = bySide(many); L.forEach((i, k) => { const m = L[L.length - 1 - k]; if (k < L.length / 2) { const r = Math.abs(i.lay.rot || m.lay.rot || 30); i.lay.rot = r; m.lay.rot = -r; place(i); place(m); } }); changed(); drawPanel(); } }, '⇋ Fan')),
      h('div', { class: 'kv', style: 'margin-top:6px' }, row('Hang from', trussSel(many, many.every(i => i.lay.truss === many[0].lay.truss && i.lay.mount === many[0].lay.mount) ? many[0].lay.truss ?? '' : '')),
        row('Re-address', h('div', { class: 'row' }, select(ws.universes.map((u, i) => [i, `U${i + 1}`]), 0, v => { reU = +v; }), numInput(1, 1, 512, v => { reA = v; }, { style: 'width:62px' }),
          h('button', { class: 'btn sm', title: 'Give the selected fixtures consecutive addresses from here, left to right', onclick: () => { readdress(bySide(many).map(i => i.lay.id), reU, reA); touchPatch(); } }, 'Apply')))),
      h('div', { class: 'row', style: 'margin-top:8px' }, hlBtn(many), h('button', { class: 'btn sm', onclick: () => duplicate([...sel]) }, '⧉ Duplicate'), h('button', { class: 'btn sm danger', onclick: () => removeFixtures([...sel]) }, '✕ Remove')),
    ] : it ? [
      h('h3', null, 'Selected fixture'),
      h('div', { class: 'kv' },
        row('Name', textInput(it.patch.name, v => { it.patch.name = v; touchPatch(); })),
        row('Model', h('b', null, it.model.code || `${it.model.manufacturer || ''} ${it.model.name}`)),
        row('Channel mode', select(Object.values(it.model.modes).map(m => [m.id, m.label.includes('(') ? m.label : `${m.label} (${m.channels.length})`]), it.patch.mode, v => setPatch('mode', v))),
        row('Universe', select(ws.universes.map((u, i) => [i, u.name]), it.patch.universe, v => setPatch('universe', +v))),
        row('DMX address', numInput(it.patch.address, 1, 512, v => setPatch('address', v))),
        row('Hang from', trussSel([it], it.lay.mount === 'truss' ? it.lay.truss : '')),
        row('Position X (m)', num(it.lay.x, -X_MAX, X_MAX, 0.1, v => setLay([it], 'x', v))),
        it.lay.mount === 'truss' ? null : row('Position Z (m)', num(it.lay.z, Z_MIN, Z_MAX, 0.1, v => setLay([it], 'z', v))),
        row('Rotation (°)', numInput(it.lay.rot || 0, -180, 180, v => setLay([it], 'rot', v))),
        it.model.spec.tiltRange ? null : row('Aim (°)', numInput(it.lay.aim || 0, -135, 135, v => { it.lay.aim = v; changed(); }, { title: 'A fixture without tilt: the angle at which it is clamped. 0 = straight down from a truss / straight up from the floor' })),
        row('Output', h('b', { id: 'selOut' }, '—')), row('Value source', h('b', { id: 'selSrc' }, '—'))),
      h('div', { class: 'row', style: 'margin-top:8px' }, hlBtn([it]),
        it.model.imported ? null : h('a', { class: 'btn sm', href: `index.html?model=${it.model.id}`, target: 'wmh-sim', title: 'Open this model alone, with its panel and menu' }, '🔦 Open in simulator'),
        h('button', { class: 'btn sm', onclick: () => duplicate([it.lay.id]) }, '⧉ Duplicate'), h('button', { class: 'btn sm danger', onclick: () => removeFixtures([it.lay.id]) }, '✕ Remove')),
      it.model.imported ? h('p', { class: 'note' }, it.model.assumptions[0]) : null,
    ] : h('p', { class: 'note' }, 'Click a fixture on the stage or in the list to edit its address, position and mounting.'),
    h('h3', null, 'DMX'),
    h('p', { class: 'note' }, 'While the show plays here, the fixtures follow it. When it is stopped they follow the virtual DMX cable, so DMX Studio or the DMX editor (output: Virtual DMX cable) drives this stage live from another window.'),
    items.reduce((n, i) => n + i.beams.length, 0) > MAX_PROJECTED ? h('p', { class: 'note', style: 'color:var(--yellow)' }, `More than ${MAX_PROJECTED} heads: the extra ones show their beam in the air but do not light the floor and walls.`) : null);
}
function selectItem(id, add) {
  if (id == null) { sel.clear(); cur = null; }
  else if (add) { if (sel.has(id) && sel.size > 1) { sel.delete(id); cur = [...sel].pop(); } else { sel.add(id); cur = id; } }
  else { sel.clear(); sel.add(id); cur = id; }
  drawPanel(); showMarkers();
}

/* ── picking and dragging fixtures on the floor / along their truss ── */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
const dom = S.renderer.domElement;
const aim = e => { const r = dom.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, S.camera); };
const pick = e => { aim(e); const hit = ray.intersectObjects(items.map(i => i.R.root), true)[0]; return hit ? items.find(i => i.lay.id === hit.object.userData.item) : null; };
let drag = null, downAt = null;
dom.addEventListener('pointerdown', e => {
  if (e.button !== 0) return; const it = pick(e); downAt = it ? null : [e.clientX, e.clientY]; if (!it) return;
  const add = e.shiftKey || e.ctrlKey || e.metaKey; if (add || !sel.has(it.lay.id)) selectItem(it.lay.id, add); else { cur = it.lay.id; drawPanel(); }
  // drag in the horizontal plane at the height of what was grabbed (the floor, or the truss)
  ground.constant = -it.R.root.position.y; aim(e);
  if (ray.ray.intersectPlane(ground, hitP)) { drag = { x: hitP.x, z: hitP.z, start: selItems().map(i => ({ i, x: i.lay.x, z: i.lay.z })), moved: false }; S.controls.enabled = false; dom.setPointerCapture(e.pointerId); }
});
dom.addEventListener('pointermove', e => {
  if (!drag) { dom.style.cursor = pick(e) ? 'grab' : ''; return; }
  aim(e); if (!ray.ray.intersectPlane(ground, hitP)) return;
  for (const s of drag.start) { s.i.lay.x = clamp(snap(s.x + hitP.x - drag.x), -X_MAX, X_MAX); if (s.i.lay.mount !== 'truss') s.i.lay.z = clamp(snap(s.z + hitP.z - drag.z), Z_MIN, Z_MAX); place(s.i); }
  drag.moved = true; showMarkers();
});
addEventListener('pointerup', e => {
  if (drag) { S.controls.enabled = true; if (drag.moved) { changed(); drawPanel(); } drag = null; return; }
  if (downAt && e.target === dom && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4 && sel.size) selectItem(null);   // a click on empty stage clears the selection
  downAt = null;
});
addEventListener('keydown', e => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || document.querySelector('.dlg-back') || !sel.size) return;
  const list = selItems(), step = e.shiftKey ? 0.5 : 0.1, move = (dx, dz) => { for (const i of list) { i.lay.x = clamp(snap(i.lay.x + dx), -X_MAX, X_MAX); if (i.lay.mount !== 'truss') i.lay.z = clamp(snap(i.lay.z + dz), Z_MIN, Z_MAX); place(i); } changed(); showMarkers(); drawPanel(); };
  const turn = d => { for (const i of list) { i.lay.rot = ((((i.lay.rot || 0) + d + 180) % 360) + 360) % 360 - 180; place(i); } changed(); drawPanel(); };
  if (e.key === 'Delete') removeFixtures([...sel]);
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') duplicate([...sel]);
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { items.forEach(i => sel.add(i.lay.id)); drawPanel(); showMarkers(); }
  else if (e.key === 'ArrowLeft') move(-step, 0); else if (e.key === 'ArrowRight') move(step, 0); else if (e.key === 'ArrowUp') move(0, -step); else if (e.key === 'ArrowDown') move(0, step);
  else if (e.key.toLowerCase() === 'q') turn(-15); else if (e.key.toLowerCase() === 'e') turn(15);
  else if (e.key === 'Escape') selectItem(null); else return;
  e.preventDefault();
});

/* ── top bar ── */
fill($('#selExample'), EXAMPLES.map(x => h('option', { value: x.id, title: x.about }, x.name)));
fill($('#exStyle'), STYLES.map(s => h('option', { value: s.id, title: s.about }, s.name)));
// Units / style apply to the single-model examples; the showcase has its own cast
const exSync = () => { const x = EXAMPLES.find(e => e.id === $('#selExample').value), single = x.id !== 'all', c = $('#exCount'), s = $('#exStyle');
  c.disabled = s.disabled = !single; c.max = single ? maxUnits(x.build()) : 1; c.value = single ? x.units || 1 : 1; s.value = (single && x.style) || 'unison'; };
$('#selExample').addEventListener('change', exSync); exSync();
$('#exCount').addEventListener('change', e => { e.target.value = Math.max(1, Math.min(+e.target.max, Math.round(+e.target.value) || 1)); });
$('#btnLoadEx').addEventListener('click', () => { const x = EXAMPLES.find(e => e.id === $('#selExample').value); pausedAt = 0; load(x.id === 'all' ? x.build() : arrange(x.build(), +$('#exCount').value, $('#exStyle').value)); changed(); play(0); });
$('#btnNew').addEventListener('click', () => { if (confirm('Start an empty stage? The current one is replaced.')) { pausedAt = 0; load(emptyStage()); changed(); } });
$('#btnSave').addEventListener('click', download);
$('#btnOpen').addEventListener('click', () => $('#fileOpen').click());
$('#fileOpen').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { pausedAt = 0; load(JSON.parse(await f.text())); changed(); } catch (err) { alert('Could not open the file: ' + err.message); } });
$('#btnEdit').addEventListener('click', () => {
  if (!confirm('Open this stage\'s patch and show in the DMX editor?\nIt replaces the workspace currently open in the editor.')) return;
  stop(); store.handOver(store.ws); window.open('editor.html', 'wmh-editor');
});
// bring back what was programmed in the DMX editor: its patch and functions replace this stage's; fixtures keep their place
$('#btnPull').addEventListener('click', () => {
  const w = store.peekSaved(); if (!w) return alert('The DMX editor has no saved workspace in this browser yet.');
  if (!confirm(`Replace this stage's patch and show with the DMX editor's workspace "${w.name}"?`)) return;
  registerAll(w);
  const lays = w.fixtures.filter(x => (getDef(x.def) || {}).sim).map((x, i) => file.fixtures.find(l => l.id === x.id) || { id: x.id, x: -3 + (i % 7), z: Math.floor(i / 7) * 1.2, rot: 0, mount: 'floor' });
  pausedAt = 0; load({ app: 'wmh-stage', version: 2, name: w.name || file.name, trusses: file.trusses, fixtures: lays, workspace: w }); changed();
});
$('#rngHaze').addEventListener('input', e => { haze = e.target.value / 100; });
$('#chkWork').addEventListener('change', e => S.setWorkLight(e.target.checked));
// camera presets
const VIEWS = { persp: [[5.5, 3.4, 8.5], [0, 1.6, -1]], front: [[0, 2.4, 13], [0, 2.2, 0]], top: [[0, 19, 1.01], [0, 0, 1]], side: [[14, 2.6, 1], [0, 2.2, 1]] };
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { const [p, t] = VIEWS[b.dataset.view]; S.camera.position.set(...p); S.controls.target.set(...t); S.controls.update(); }));

/* ── loop ── */
// The show clock is a worker timer (40 Hz) so playback and audio stay in step even when this window is in the
// background; rendering and the fixtures' motors run on animation frames.
let lastTick = performance.now();
const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 25)'], { type: 'text/javascript' })));
ticker.onmessage = () => { const now = performance.now(); engine.tick(Math.min(250, now - lastTick)); lastTick = now; };
const clock = new THREE.Clock();
let uiT = 0, cableOn = false;
/** advance every fixture by dt seconds (DMX in → motors, optics) and update its 3D parts */
function simulate(dt, now, time) {
  const live = engine.top.size > 0; cableOn = false;
  for (const it of items) {
    const u = it.patch.universe, c = cable.get(u), data = live ? engine.out[u] : c && now - c.at < 1500 ? c.data : null;
    if (data) { it.fx.feedDmx(data); if (!live) cableOn = true; }
    it.fx.update(dt);
    if (it.menu.draw(now)) it.R.lcdTex.needsUpdate = true;
    for (const b of it.beams) {
      const hd = b.head, r = b.r;
      r.pan.rotation.y = rad(hd.pan.pos); r.tilt.rotation.x = rad(hd.tilt.pos + (it.lay.aim || 0));
      if (b.img.render(hd)) b.beam.tex.needsUpdate = true;
      b.beam.update(hd, S.camera, haze, time, r.lensMat);
      for (let k = 0; k < r.ring.length; k++) { const cc = hd.o.ring[k]; r.ring[k].color.setRGB(0.02 + cc[0] * 2.6, 0.02 + cc[1] * 2.6, 0.02 + cc[2] * 2.6); }
    }
  }
}
Object.assign(window.WST, { simulate, load: f => { load(f); play(0); }, addFixtures, removeFixtures, duplicate, readdress, addTruss, highlight });
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now(), time = clock.elapsedTime, live = engine.top.size > 0;
  simulate(dt, now, time);
  S.render(items.flatMap(i => i.beams.map(b => b.beam)));

  if (now - uiT > 150) {
    uiT = now;
    const s = showFn(), r = s && engine.runner(s.id), t = r && !r.done ? r.t : pausedAt, len = s ? durationOf(s) : 0;
    $('#time').textContent = `${fmtTime(t)}${len ? ' / ' + fmtTime(len) : ''}`; if (len && document.activeElement !== $('#seek')) $('#seek').value = Math.round(t / len * 1000);
    const p = $('#src'); p.className = 'pill ' + (live || cableOn ? 'on' : 'off'); p.textContent = live ? 'Playing the show' : cableOn ? 'Following the virtual DMX cable' : 'No DMX';
    const si = sel.size === 1 && items.find(i => i.lay.id === cur);
    if (si) { const o = $('#selOut'), q = $('#selSrc'); if (o) o.textContent = `${(si.fx.intensity * 100).toFixed(0)}% · pan ${si.fx.pan.pos.toFixed(0)}° · tilt ${si.fx.tilt.pos.toFixed(0)}°`; if (q) q.textContent = si.hl ? 'highlight (lamp test)' : si.fx.dmxSignal ? `DMX ${si.fx.dmxFps.toFixed(0)} Hz` : 'no DMX signal'; }
  }
}

/* ── start: the last stage, or the showcase example ── */
let saved = null; try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
try { load(saved && saved.app === 'wmh-stage' ? saved : EXAMPLES[0].build()); } catch (e) { console.warn('The saved stage could not be opened:', e); load(EXAMPLES[0].build()); }
frame();
installAgentEntry();                                         // development only: Ctrl + double-click the logo / Ctrl + Alt + M

// Wincode DMX Studio is a separate site: next to this one on GitHub Pages, under /studio/ on the local server
{ const a = document.querySelector('#lnkStudio'); if (a && window.WMH_STATIC) a.href = '../wincodeDmxStudio/'; }
