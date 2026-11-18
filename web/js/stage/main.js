// stage/main.js — Stage Editor: several fixtures of any model on one 3D stage, driven by one DMX patch.
//  A stage file holds the layout (where each fixture stands or hangs) and a DMX editor workspace (patch, functions,
//  show). The show plays here through the editor's own engine; when nothing plays, the fixtures follow the virtual DMX
//  cable, so the DMX editor in another window can program the same stage live.
import * as THREE from 'three';
import { createStage, TRUSS_Y, ROOM } from './scene3d.js';
import { EXAMPLES, STYLES, arrange, maxUnits, BEAT_FILE, BPM, LENGTH } from './examples.js';
import { makeBeat } from './beat.js';
import { store, blankWorkspace, audioFiles } from '../editor/store.js';
import { Engine, durationOf } from '../editor/engine.js';
import { getDef, library, modeOf } from '../editor/library.js';
import { freeAddress } from '../editor/fixtures.js';
import { h, fill, select, numInput, textInput, fmtTime } from '../editor/ui.js';
import { MODELS } from '../models/index.js';
import { Fixture } from '../fixture.js';
import { Menu } from '../menu.js';
import { TouchMenu } from '../menu-touch.js';
import { buildMachine } from '../machine.js';
import { BeamImage } from '../gobos.js';
import { Beam } from '../beam.js';
import { CABLE } from '../dmx.js';
import { installAgentEntry } from '../agent-entry.js';

const $ = s => document.querySelector(s);
const LS = 'wmh.stage.v1';
const MAX_PROJECTED = 9, MAX_SHADOWS = 3;                    // projected spots cost texture units in every lit material

store.persist = false;                                       // never overwrite the DMX editor's own autosave from here
const engine = new Engine();
const S = createStage($('#viewport'));
let file = null;                                             // the stage file being shown
let items = [];                                              // runtime: { lay, patch, model, fx, menu, R, beams: [{ img, beam, head, r }] }
let sel = null, haze = 0.55;
window.WST = { engine, store, get items() { return items; }, get file() { return file; } };   // for debugging from the console

/* ── DMX from other windows (the DMX editor, the slider transmitter) ── */
const cable = new Map();                                     // universe → { data, at }
new BroadcastChannel(CABLE).onmessage = e => { const m = e.data; if (m && m.t === 'dmx') cable.set(m.u ?? 0, { data: m.data, at: performance.now() }); };

/* ── building / disposing fixtures ── */
const marker = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.47, 48), new THREE.MeshBasicMaterial({ color: 0xf0923a, transparent: true, opacity: 0.9, depthWrite: false }));
marker.rotation.x = -Math.PI / 2; marker.visible = false; S.scene.add(marker);
function place(it) {
  const l = it.lay, truss = l.mount === 'truss';
  it.R.root.position.set(l.x, truss ? TRUSS_Y - 0.13 : 0, l.z);
  it.R.root.rotation.set(0, THREE.MathUtils.degToRad(l.rot || 0), truss ? Math.PI : 0);
  it.fx.inverted = truss;
  S.truss.visible = items.some(i => i.lay.mount === 'truss');
}
function addItem(lay) {
  const patch = store.fixture(lay.id), def = patch && getDef(patch.def), model = def && MODELS[def.sim];
  if (!model) return null;                                   // generic fixtures have no 3D model: they stay in the patch only
  const fx = new Fixture(model, { persist: false, settings: { address: patch.address, mode: patch.mode, runMode: 'DMX' } });
  fx.setPower(true); fx.skipReset();
  const menu = model.panel.type === 'touch' ? new TouchMenu(fx) : new Menu(fx);
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
  const it = { lay, patch, model, fx, menu, R, beams }; items.push(it); place(it); return it;
}
function removeItem(it) {
  S.scene.remove(it.R.root);
  it.R.root.traverse(o => { if (o.geometry) o.geometry.dispose(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { if (x.map && x.map.isCanvasTexture) x.map.dispose(); x.dispose(); }); });
  it.beams.forEach(b => b.beam.tex.dispose());
  items = items.filter(x => x !== it);
}
S.onResize = () => { for (const it of items) for (const b of it.beams) b.beam.setDepth(S.depthRT.depthTexture, S.size.w, S.size.h, S.camera); };

/* ── stage files ── */
const emptyStage = () => ({ app: 'wmh-stage', version: 1, name: 'New stage', fixtures: [], workspace: Object.assign(blankWorkspace(), { name: 'New stage' }) });
function load(f) {
  if (!f || f.app !== 'wmh-stage' || !f.workspace) throw new Error('Not a stage file');
  wantPlay = false; playSeq++;                                // the old show is gone: its "ended" must not restart anything
  engine.reset(); [...items].forEach(removeItem); sel = null; marker.visible = false;
  file = f; store.load(f.workspace); file.workspace = store.ws;   // the engine re-reads universes and the patch; keep one workspace object
  for (const lay of f.fixtures) addItem(lay);
  S.truss.visible = items.some(i => i.lay.mount === 'truss');
  drawPanel(); syncTransport();
}
const autosave = () => { try { localStorage.setItem(LS, JSON.stringify(file)); } catch (e) {} };
const changed = () => { clearTimeout(changed.t); changed.t = setTimeout(autosave, 500); };
function download() {
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

/* ── side panel ── */
function drawPanel() {
  const ws = store.ws, it = items.find(i => i.lay.id === sel);
  const row = (label, el) => [h('span', null, label), el];
  const setPatch = (key, v) => { it.patch[key] = v; if (key === 'mode') { it.fx.set('mode', v); for (const fn of ws.functions) if (fn.values) delete fn.values[it.patch.id]; } if (key === 'address') it.fx.set('address', v); store.emit('fixtures'); changed(); drawPanel(); };
  const setLay = (key, v) => { it.lay[key] = v; place(it); changed(); };
  const simDefs = library.filter(d => d.sim);
  let addDef = simDefs[0];
  const addSel = select(simDefs.map(d => [d.id, d.model]), addDef.id, v => { addDef = getDef(v); });
  fill($('#stagePanel'),
    h('h3', null, 'Stage'),
    h('div', { class: 'kv' }, row('Name', textInput(file.name, v => { file.name = v; ws.name = v; changed(); })), row('Show', h('b', null, showFn() ? `${showFn().name} · ${fmtTime(durationOf(showFn()))}` : 'none — use "Edit show"'))),
    h('h3', null, `Fixtures (${items.length})`),
    h('div', null, items.map(i => h('div', { class: 'fnrow' + (i.lay.id === sel ? ' sel' : ''), onclick: () => selectItem(i.lay.id) },
      h('span', { class: 'nm' }, i.patch.name), h('span', { class: 'note' }, `${i.model.name} · U${i.patch.universe + 1}.${String(i.patch.address).padStart(3, '0')}–${i.patch.address + i.fx.footprint - 1}`)))),
    items.length ? null : h('p', { class: 'note' }, 'The stage is empty. Add fixtures below, or load an example from the top bar.'),
    h('div', { class: 'row', style: 'margin-top:8px' }, addSel, h('button', { class: 'btn sm acc', onclick: () => {
      const mode = addDef.defaultMode, n = addDef.modes[mode].channels.length, addr = freeAddress(0, n);
      if (!addr) return alert('Universe 1 is full.');
      const id = store.id(), count = ws.fixtures.filter(f => f.def === addDef.id).length + 1;
      ws.fixtures.push({ id, name: `${addDef.model.replace(/ \(.*/, '')} ${count}`, def: addDef.id, mode, universe: 0, address: addr });
      const lay = { id, x: Math.round((Math.random() * 4 - 2) * 10) / 10, z: Math.round((Math.random() * 2) * 10) / 10, rot: 0, mount: 'floor' };
      file.fixtures.push(lay); store.emit('fixtures'); addItem(lay); selectItem(id); changed();
    } }, '＋ Add fixture')),
    it ? [
      h('h3', null, 'Selected fixture'),
      h('div', { class: 'kv' },
        row('Name', textInput(it.patch.name, v => { it.patch.name = v; store.emit('fixtures'); changed(); drawPanel(); })),
        row('Model', h('b', null, `${it.model.code}`)),
        row('Channel mode', select(Object.values(it.model.modes).map(m => [m.id, `${m.label} (${m.channels.length})`]), it.patch.mode, v => setPatch('mode', v))),
        row('DMX address', numInput(it.patch.address, 1, 512, v => setPatch('address', v))),
        row('Position X (m)', h('input', { type: 'number', step: 0.1, min: -ROOM.w / 2 + 0.5, max: ROOM.w / 2 - 0.5, value: it.lay.x, onchange: e => setLay('x', +e.target.value || 0) })),
        row('Position Z (m)', h('input', { type: 'number', step: 0.1, min: ROOM.back + 0.5, max: ROOM.back + ROOM.d - 0.5, value: it.lay.z, onchange: e => setLay('z', +e.target.value || 0) })),
        row('Rotation (°)', numInput(it.lay.rot || 0, -180, 180, v => setLay('rot', v))),
        row('Mounting', select([['floor', 'Floor'], ['truss', 'Truss (inverted)']], it.lay.mount, v => { setLay('mount', v); drawPanel(); })),
        row('Output', h('b', { id: 'selOut' }, '—')), row('Value source', h('b', { id: 'selSrc' }, '—'))),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('a', { class: 'btn sm', href: `index.html?model=${it.model.id}`, target: 'wmh-sim', title: 'Open this model alone, with its panel and menu' }, '🔦 Open in simulator'),
        h('button', { class: 'btn sm danger', onclick: () => {
          const id = it.patch.id; ws.fixtures = ws.fixtures.filter(f => f.id !== id); file.fixtures = file.fixtures.filter(l => l.id !== id);
          for (const fn of ws.functions) { if (fn.values) delete fn.values[id]; if (fn.fixtures) fn.fixtures = fn.fixtures.filter(r => r.fx !== id); }
          removeItem(it); sel = null; marker.visible = false; store.emit('fixtures'); changed(); drawPanel();
        } }, '✕ Remove')),
    ] : h('p', { class: 'note' }, 'Click a fixture on the stage or in the list to edit its address, position and mounting.'),
    h('h3', null, 'DMX'),
    h('p', { class: 'note' }, 'While the show plays here, the fixtures follow it. When it is stopped they follow the virtual DMX cable, so the DMX editor (“Edit show”, output: Virtual DMX cable) drives this stage live from another window.'),
    items.length > MAX_PROJECTED ? h('p', { class: 'note', style: 'color:var(--yellow)' }, `More than ${MAX_PROJECTED} heads: the extra ones show their beam in the air but do not light the floor and walls.`) : null);
}
function selectItem(id) { sel = id; const it = items.find(i => i.lay.id === id); marker.visible = !!it; drawPanel(); }

/* ── picking and dragging fixtures on the floor ── */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
const dom = S.renderer.domElement;
const aim = e => { const r = dom.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, S.camera); };
const pick = e => { aim(e); const hit = ray.intersectObjects(items.map(i => i.R.root), true)[0]; return hit ? items.find(i => i.lay.id === hit.object.userData.item) : null; };
let drag = null;
dom.addEventListener('pointerdown', e => {
  if (e.button !== 0) return; const it = pick(e); if (!it) return;
  selectItem(it.lay.id); aim(e);
  if (ray.ray.intersectPlane(ground, hitP)) { drag = { it, dx: it.lay.x - hitP.x, dz: it.lay.z - hitP.z, moved: false }; S.controls.enabled = false; dom.setPointerCapture(e.pointerId); }
});
dom.addEventListener('pointermove', e => {
  if (!drag) { dom.style.cursor = pick(e) ? 'grab' : ''; return; }
  aim(e); if (!ray.ray.intersectPlane(ground, hitP)) return;
  const l = drag.it.lay, snap = v => Math.round(v * 10) / 10;
  l.x = Math.min(ROOM.w / 2 - 0.5, Math.max(-ROOM.w / 2 + 0.5, snap(hitP.x + drag.dx))); l.z = Math.min(ROOM.back + ROOM.d - 0.5, Math.max(ROOM.back + 0.5, snap(hitP.z + drag.dz)));
  drag.moved = true; place(drag.it);
});
addEventListener('pointerup', () => { if (!drag) return; S.controls.enabled = true; if (drag.moved) { changed(); drawPanel(); } drag = null; });

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
  const lays = w.fixtures.filter(x => (getDef(x.def) || {}).sim).map((x, i) => file.fixtures.find(l => l.id === x.id) || { id: x.id, x: -3 + (i % 7), z: Math.floor(i / 7) * 1.2, rot: 0, mount: 'floor' });
  pausedAt = 0; load({ app: 'wmh-stage', version: 1, name: w.name || file.name, fixtures: lays, workspace: w }); changed();
});
$('#rngHaze').addEventListener('input', e => { haze = e.target.value / 100; });
$('#chkWork').addEventListener('change', e => S.setWorkLight(e.target.checked));

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
      r.pan.rotation.y = THREE.MathUtils.degToRad(hd.pan.pos); r.tilt.rotation.x = THREE.MathUtils.degToRad(hd.tilt.pos);
      if (b.img.render(hd)) b.beam.tex.needsUpdate = true;
      b.beam.update(hd, S.camera, haze, time, r.lensMat);
      for (let k = 0; k < r.ring.length; k++) { const cc = hd.o.ring[k]; r.ring[k].color.setRGB(0.02 + cc[0] * 2.6, 0.02 + cc[1] * 2.6, 0.02 + cc[2] * 2.6); }
    }
  }
}
window.WST.simulate = simulate; window.WST.load = f => { load(f); play(0); };
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now(), time = clock.elapsedTime, live = engine.top.size > 0;
  simulate(dt, now, time);
  const si = items.find(i => i.lay.id === sel); if (si) marker.position.set(si.lay.x, 0.006, si.lay.z);
  S.render(items.flatMap(i => i.beams.map(b => b.beam)));

  if (now - uiT > 150) {
    uiT = now;
    const s = showFn(), r = s && engine.runner(s.id), t = r && !r.done ? r.t : pausedAt, len = s ? durationOf(s) : 0;
    $('#time').textContent = `${fmtTime(t)}${len ? ' / ' + fmtTime(len) : ''}`; if (len && document.activeElement !== $('#seek')) $('#seek').value = Math.round(t / len * 1000);
    const p = $('#src'); p.className = 'pill ' + (live || cableOn ? 'on' : 'off'); p.textContent = live ? 'Playing the show' : cableOn ? 'Following the virtual DMX cable' : 'No DMX';
    if (si) { const o = $('#selOut'), q = $('#selSrc'); if (o) o.textContent = `${(si.fx.intensity * 100).toFixed(0)}% · pan ${si.fx.pan.pos.toFixed(0)}° · tilt ${si.fx.tilt.pos.toFixed(0)}°`; if (q) q.textContent = si.fx.dmxSignal ? `DMX ${si.fx.dmxFps.toFixed(0)} Hz` : 'no DMX signal'; }
  }
}

/* ── start: the last stage, or the showcase example ── */
let saved = null; try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
try { load(saved && saved.app === 'wmh-stage' ? saved : EXAMPLES[0].build()); } catch (e) { load(EXAMPLES[0].build()); }
frame();
installAgentEntry();                                         // development only: Ctrl + double-click the logo / Ctrl + Alt + M
