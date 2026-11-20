// rig/main.js — Stage Builder: assemble the truss rig of a stage and choose the size of the room.
//  Pieces: straight trusses in any direction, uprights (towers), circles and arcs, in several truss sizes. The result is a
//  rig file (rig.js) that the Stage Editor and the simulator load; the current rig is also kept in localStorage, which is
//  how "Use in the Stage Editor" hands it over.
import * as THREE from 'three';
import { createStage, ROOM } from '../stage/scene3d.js';
import { h, fill, select, textInput } from '../editor/ui.js';
import { TYPES, SIZES, PRESETS, norm, addPiece, nextId, buildPiece, disposePiece, endsOf, legsFor, mountable, lengthOf, blankRig, readRig, savedRig, keepRig, roomOf, ROOM_LIMITS } from './rig.js';
import { pieceEditor, pieceLine, totalLength } from './rig-ui.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), r2 = v => Math.round(v * 100) / 100;
const S = createStage($('#viewport'));
let rig = null;                                              // { app, name, room: { w, d, h }, trusses }
const groups = new Map();                                    // piece id → THREE.Group
const sel = new Set(); let cur = null;                       // selected piece ids; cur = the one in the form
const add = { type: 'straight', len: 6, r: 2.5, angle: 180, h: 4.9, y: 4.6, size: 0.29 };   // what "Add" makes next
const grid = () => +$('#selGrid').value, snapG = v => Math.round(v / grid()) * grid();
window.WRB = { get rig() { return rig; }, get sel() { return [...sel]; }, scene: S };   // for debugging from the console

/* ── drawing ── */
const selMat = new THREE.MeshBasicMaterial({ color: 0xf0923a, transparent: true, opacity: 0.85, depthWrite: false });
const marks = new THREE.Group(); S.scene.add(marks);
function draw() {
  for (const g of groups.values()) { S.scene.remove(g); disposePiece(g); } groups.clear();
  for (const p of rig.trusses) { const g = buildPiece(p); S.scene.add(g); groups.set(p.id, g); }
  showMarks();
}
/** floor marks under the selected pieces: a dot under every end */
function showMarks() {
  for (const m of [...marks.children]) { marks.remove(m); m.geometry.dispose(); }
  for (const p of rig.trusses) if (sel.has(p.id)) for (const [x, z] of endsOf(p)) { const m = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32), selMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.008, z); marks.add(m); }
}
const keep = () => { clearTimeout(keep.t); keep.t = setTimeout(() => keepRig(rig), 300); };
function changed(redraw = true) { if (redraw) draw(); keep(); status(); }
function status() { const n = rig.trusses.length, hang = rig.trusses.filter(mountable); $('#src').className = 'pill ' + (n ? 'on' : 'off'); $('#src').textContent = n ? `${n} pieces · ${r2(totalLength(rig.trusses))} m of truss · ${r2(totalLength(hang))} m to hang from` : 'Empty rig'; }
function load(f) { rig = readRig(f); S.setRoom(rig.room); sel.clear(); cur = null; draw(); panel(); status(); S.setView('persp'); }

/* ── editing ── */
const piece = id => rig.trusses.find(p => p.id === id), selected = () => rig.trusses.filter(p => sel.has(p.id));
function pick(id, more) {
  if (id == null) { sel.clear(); cur = null; }
  else if (more) { if (sel.has(id) && sel.size > 1) { sel.delete(id); cur = [...sel].pop(); } else { sel.add(id); cur = id; } }
  else { sel.clear(); sel.add(id); cur = id; }
  showMarks(); panel();
}
function addNew() {
  const t = add.type, y = clamp(add.y, 0, rig.room.h), base = { type: t, size: add.size, x: 0, z: r2(snapG(S.controls.target.z)) };
  const p = addPiece(rig.trusses, t === 'straight' ? { ...base, len: add.len, y } : t === 'upright' ? { ...base, h: add.h, y: 0 } : t === 'circle' ? { ...base, r: add.r, y } : { ...base, r: add.r, angle: add.angle, y });
  p.name = `${{ straight: 'Truss', upright: 'Tower', circle: 'Circle', arc: 'Arc' }[t]} ${p.id}`;
  changed(); pick(p.id);
}
function remove(ids) { rig.trusses = rig.trusses.filter(p => !ids.includes(p.id)); sel.clear(); cur = null; changed(); panel(); }
function duplicate(ids) {
  const made = []; for (const id of ids) { const p = piece(id); if (!p) continue; const q = addPiece(rig.trusses, { ...p, id: nextId(rig.trusses), name: p.name.replace(/\s*\d*$/, '') + ' ' + nextId(rig.trusses), x: r2(p.x + 1), z: r2(p.z + 1) }); made.push(q.id); }
  sel.clear(); made.forEach(i => sel.add(i)); cur = made[made.length - 1] ?? null; changed(); panel();
}
/** ends of the moved pieces jump to the nearest end of another piece (within 35 cm): returns the shift [dx, dz] */
function endSnap(moving) {
  if (!$('#chkSnap').checked) return [0, 0];
  const others = rig.trusses.filter(p => !moving.includes(p)).flatMap(endsOf); let best = null;
  for (const p of moving) for (const [x, z] of endsOf(p)) for (const [ox, oz] of others) { const d = Math.hypot(ox - x, oz - z); if (d < 0.35 && (!best || d < best.d)) best = { d, dx: ox - x, dz: oz - z }; }
  return best ? [best.dx, best.dz] : [0, 0];
}

/* ── side panel ── */
function panel() {
  const p = piece(cur), many = selected(), row = (label, el) => [h('span', null, label), el];
  const num = (value, min, max, step, fn, w = 62) => h('input', { type: 'number', step, min, max, value, style: `width:${w}px`, onchange: e => { const v = clamp(+e.target.value || 0, min, max); e.target.value = v; fn(v); } });
  fill($('#rigPanel'),
    h('h3', null, 'Stage'),
    h('div', { class: 'kv' }, row('Name', textInput(rig.name, v => { rig.name = v; keep(); })),
      row('Room W × D × H (m)', h('div', { class: 'row' }, ['w', 'd', 'h'].map(k => num(rig.room[k], ...ROOM_LIMITS[k], 1, v => { rig.room[k] = v; S.setRoom(rig.room); keep(); panel(); }, 58))))),
    h('p', { class: 'note' }, `Floor ${rig.room.w} × ${rig.room.d} m, ${rig.room.h} m high. The audience looks from +Z; the back wall is at z = ${roomOf(rig.room).back} m.`),
    h('h3', null, 'Add a piece'),
    h('div', { class: 'kv' },
      row('Shape', select(TYPES, add.type, v => { add.type = v; panel(); })),
      row('Truss size', select(SIZES, add.size, v => { add.size = +v; })),
      add.type === 'straight' ? row('Length (m)', num(add.len, 0.5, 60, 0.5, v => { add.len = v; })) : null,
      add.type === 'circle' || add.type === 'arc' ? row('Radius (m)', num(add.r, 0.5, 30, 0.25, v => { add.r = v; })) : null,
      add.type === 'arc' ? row('Angle (°)', num(add.angle, 10, 350, 5, v => { add.angle = v; })) : null,
      add.type === 'upright' ? row('Height (m)', num(add.h, 0.5, rig.room.h, 0.1, v => { add.h = v; })) : row('Hangs at (m)', num(add.y, 0.5, rig.room.h, 0.1, v => { add.y = v; }))),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn acc', onclick: addNew, title: 'Add this piece in the middle of the view; then drag it into place' }, '＋ Add'),
      h('span', { class: 'note' }, { straight: 'A truss to hang fixtures from.', upright: 'A tower: a leg of a ground support.', circle: 'A ring to hang fixtures from.', arc: 'Part of a ring.' }[add.type])),
    h('h3', null, `Pieces (${rig.trusses.length})`),
    h('div', null, rig.trusses.map(t => h('div', { class: 'fnrow' + (sel.has(t.id) ? ' sel' : ''), onclick: e => pick(t.id, e.shiftKey || e.ctrlKey || e.metaKey) }, h('span', { class: 'nm' }, t.name), h('span', { class: 'note' }, pieceLine(t))))),
    rig.trusses.length ? h('p', { class: 'note' }, 'Shift-click to select several. Del removes · Ctrl+D duplicates · arrow keys move · Q / E turn 15° · PgUp / PgDn raise and lower.') : h('p', { class: 'note' }, 'The rig is empty. Add a piece above, or load a ready-made rig from the top bar.'),
    many.length > 1 ? [h('h3', null, `${many.length} pieces selected`),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', title: 'Give all of them the height of the first one', onclick: () => { const y = many.find(mountable)?.y; if (y != null) for (const q of many) if (mountable(q)) q.y = y; changed(); panel(); } }, '⇥ Same height'),
        h('button', { class: 'btn sm', title: 'Towers from the floor up to every selected truss', onclick: () => { for (const q of many) legsFor(rig.trusses, q); changed(); panel(); } }, '⫿ Add legs'),
        h('button', { class: 'btn sm', onclick: () => duplicate([...sel]) }, '⧉ Duplicate'), h('button', { class: 'btn sm danger', onclick: () => remove([...sel]) }, '✕ Remove'))]
    : p ? [h('h3', null, 'Selected piece'),
      pieceEditor(p, ROOM, k => { changed(); if (['type', 'name', 'y', 'len', 'r', 'angle', 'h'].includes(k)) panel(); }),
      h('div', { class: 'row', style: 'margin-top:8px' },
        mountable(p) ? h('button', { class: 'btn sm', title: 'Towers from the floor up to this truss: under its ends (four under a circle)', onclick: () => { legsFor(rig.trusses, p); changed(); panel(); } }, '⫿ Add legs') : null,
        h('button', { class: 'btn sm', title: 'Turn by 90°', onclick: () => { p.rot = ((p.rot + 90 + 180) % 360) - 180; changed(); panel(); } }, '⟳ 90°'),
        h('button', { class: 'btn sm', onclick: () => duplicate([p.id]) }, '⧉ Duplicate'), h('button', { class: 'btn sm danger', onclick: () => remove([p.id]) }, '✕ Remove')),
      h('p', { class: 'note' }, mountable(p) ? `Fixtures can hang along ${r2(lengthOf(p))} m of this piece.` : 'A tower carries the rig; fixtures do not hang on it.')]
    : h('p', { class: 'note' }, 'Click a piece on the stage or in the list to edit it.'),
    h('h3', null, 'Using the rig'),
    h('p', { class: 'note' }, 'Save writes a rig file. “Use in the Stage Editor” opens the Stage Editor with this rig: the fixtures that hang there are spread over these trusses, and “Auto-place” hangs the rest. The Stage Editor and the simulator can also fetch this rig later with “Load rig…”.'));
}

/* ── picking and dragging ── */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), dom = S.renderer.domElement;
const aim = e => { const r = dom.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, S.camera); };
const under = e => { aim(e); const x = ray.intersectObjects([...groups.values()], true)[0]; return x ? { p: piece(x.object.userData.piece), y: x.point.y } : null; };
let drag = null, downAt = null;
dom.addEventListener('pointerdown', e => {
  if (e.button !== 0) return; const u = under(e); downAt = u ? null : [e.clientX, e.clientY]; if (!u) return;
  const more = e.shiftKey || e.ctrlKey || e.metaKey; if (more || !sel.has(u.p.id)) pick(u.p.id, more); else { cur = u.p.id; panel(); }
  plane.constant = -u.y; aim(e);                              // drag in the horizontal plane through the point that was grabbed
  if (ray.ray.intersectPlane(plane, hit)) { drag = { x: hit.x, z: hit.z, start: selected().map(p => ({ p, x: p.x, z: p.z })), moved: false }; S.controls.enabled = false; dom.setPointerCapture(e.pointerId); }
});
dom.addEventListener('pointermove', e => {
  if (!drag) { dom.style.cursor = under(e) ? 'grab' : ''; return; }
  aim(e); if (!ray.ray.intersectPlane(plane, hit)) return;
  const X = rig.room.w / 2, r = roomOf(rig.room);
  for (const s of drag.start) { s.p.x = clamp(r2(snapG(s.x + hit.x - drag.x)), -X, X); s.p.z = clamp(r2(snapG(s.z + hit.z - drag.z)), r.back, r.back + r.d); }
  const [dx, dz] = endSnap(drag.start.map(s => s.p)); for (const s of drag.start) { s.p.x = r2(s.p.x + dx); s.p.z = r2(s.p.z + dz); }
  for (const s of drag.start) { const g = groups.get(s.p.id); g.position.x = s.p.x; g.position.z = s.p.z; }
  drag.moved = true; showMarks();
});
addEventListener('pointerup', e => {
  if (drag) { S.controls.enabled = true; if (drag.moved) { keep(); panel(); } drag = null; return; }
  if (downAt && e.target === dom && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4 && sel.size) pick(null);
  downAt = null;
});
addEventListener('keydown', e => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || !sel.size) return;
  const list = selected(), step = e.shiftKey ? 1 : grid(), k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  const move = (dx, dz, dy = 0) => { for (const p of list) { p.x = r2(p.x + dx); p.z = r2(p.z + dz); if (dy && mountable(p)) p.y = clamp(r2(p.y + dy), 0, rig.room.h); } changed(); panel(); };
  if (e.key === 'Delete') remove([...sel]);
  else if (ctrl && k === 'd') duplicate([...sel]);
  else if (ctrl && k === 'a') { rig.trusses.forEach(p => sel.add(p.id)); showMarks(); panel(); }
  else if (e.key === 'ArrowLeft') move(-step, 0); else if (e.key === 'ArrowRight') move(step, 0); else if (e.key === 'ArrowUp') move(0, -step); else if (e.key === 'ArrowDown') move(0, step);
  else if (e.key === 'PageUp') move(0, 0, 0.1); else if (e.key === 'PageDown') move(0, 0, -0.1);
  else if (k === 'q' || k === 'e') { for (const p of list) p.rot = ((p.rot + (k === 'q' ? -15 : 15) + 180 + 360) % 360) - 180; changed(); panel(); }
  else if (e.key === 'Escape') pick(null); else return;
  e.preventDefault();
});

/* ── top bar ── */
fill($('#selPreset'), PRESETS.map(x => h('option', { value: x.id, title: x.about }, x.name)));
const replace = () => !rig.trusses.length || confirm('Replace the current rig?');
$('#btnPreset').addEventListener('click', () => { if (replace()) { load(PRESETS.find(x => x.id === $('#selPreset').value).build()); keep(); } });
$('#btnNew').addEventListener('click', () => { if (replace()) { load(blankRig()); keep(); } });
$('#btnSave').addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(rig, null, 1)], { type: 'application/json' })); a.download = (rig.name || 'rig').replace(/[^\w.-]+/g, '_') + '.rig.json'; a.click(); URL.revokeObjectURL(a.href); });
$('#btnOpen').addEventListener('click', () => $('#fileOpen').click());
$('#fileOpen').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { load(JSON.parse(await f.text())); keep(); } catch (err) { alert('Could not open the file: ' + err.message); } });
for (const id of ['#lnkStage', '#lnkSim']) $(id).addEventListener('click', () => keepRig(rig));   // the other page reads the rig from localStorage
$('#chkWork').addEventListener('change', e => S.setWorkLight(e.target.checked)); S.setWorkLight(true);
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => S.setView(b.dataset.view)));

/* ── start: the rig that was open last, or a ready-made one ── */
{ const r = savedRig(); load(r || PRESETS[2].build()); $('#selPreset').value = r ? PRESETS[0].id : PRESETS[2].id; }
(function frame() { requestAnimationFrame(frame); S.render([]); })();
