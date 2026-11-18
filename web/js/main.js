// main.js — Wincode moving head 3D simulator (web client). The fixture model is chosen at start (models/index.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildMachine } from './machine.js';
import { LIST, MODELS, currentModelId, rememberModel } from './models/index.js';
import { Fixture } from './fixture.js';
import { Menu } from './menu.js';
import { TouchMenu } from './menu-touch.js';
import { BeamImage } from './gobos.js';
import { Beam } from './beam.js';
import { DmxInput } from './dmx.js';
import { RdmResponder } from './rdm.js';
import { Panel } from './panel.js';
import { demoValues } from './demo.js';
import { installAgentEntry } from './agent-entry.js';

const $ = s => document.querySelector(s);

/* ───────── fixture (firmware model) · communication ───────── */
const MODEL = MODELS[currentModelId()];
rememberModel(MODEL.id);
document.title = `Wincode ${MODEL.name} — 3D Moving Head Simulator`;
const fx = new Fixture(MODEL);
const menu = MODEL.panel.type === 'touch' ? new TouchMenu(fx) : new Menu(fx);
const rdm = new RdmResponder(fx);
let panel = null;
const log = line => panel && panel.log(line);
const dmx = new DmxInput(fx, rdm, line => log(line));
fx.log = line => log(line);
panel = new Panel(fx, dmx, rdm);
window.WMH = { fx, menu, dmx, rdm, model: MODEL };                     // for debugging from the console

/* ───────── renderer / scene ───────── */
const host = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.1;
const camera = new THREE.PerspectiveCamera(38, 1, 0.03, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.12; controls.maxDistance = 16;

/* Stage: floor + back/side walls (where the spot lands) + truss */
const ROOM = { w: 14, d: 13, h: 6.5, back: -6 };
{
  const floorM = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.78, metalness: 0.05 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.95 });
  const mk = (w, h, m, x, y, z, rx, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.set(rx, ry, 0); p.receiveShadow = true; scene.add(p); return p; };
  mk(ROOM.w, ROOM.d, floorM, 0, 0, ROOM.back + ROOM.d / 2, -Math.PI / 2, 0);
  mk(ROOM.w, ROOM.h, wallM, 0, ROOM.h / 2, ROOM.back, 0, 0);
  mk(ROOM.d, ROOM.h, wallM, -ROOM.w / 2, ROOM.h / 2, ROOM.back + ROOM.d / 2, 0, Math.PI / 2);
  mk(ROOM.d, ROOM.h, wallM, ROOM.w / 2, ROOM.h / 2, ROOM.back + ROOM.d / 2, 0, -Math.PI / 2);
  mk(ROOM.w, ROOM.d, wallM, 0, ROOM.h, ROOM.back + ROOM.d / 2, Math.PI / 2, 0);
  // floor grid (1 m)
  const grid = new THREE.GridHelper(14, 14, 0x2a2a30, 0x202024); grid.position.set(0, 0.002, ROOM.back + 7); grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);
  // a prop to show shadows (person-height pillar)
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.7, 24), new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.7 }));
  prop.position.set(1.6, 0.85, -3.4); prop.castShadow = true; prop.receiveShadow = true; scene.add(prop);
}
const truss = new THREE.Group(); truss.visible = false; scene.add(truss);
{
  const m = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.9 });
  const TY = 4.6;
  for (const [y, z] of [[0, -0.14], [0, 0.14], [0.28, -0.14], [0.28, 0.14]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 6, 16), m); t.rotation.z = Math.PI / 2; t.position.set(0, TY + y, z); t.castShadow = true; truss.add(t); }
  for (let x = -3; x <= 3; x += 0.5) for (const z of [-0.14, 0.14]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8), m); t.position.set(x, TY + 0.14, z); truss.add(t); }
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 })); clamp.position.set(0, TY - 0.07, 0); truss.add(clamp);
  truss.userData.hangY = TY - 0.13;
}
const hemi = new THREE.HemisphereLight(0x55607a, 0x0a0a0c, 0.18); scene.add(hemi);
const work = new THREE.DirectionalLight(0xfff2e0, 0); work.position.set(2.5, 5, 4); scene.add(work);
const key = new THREE.SpotLight(0xdfe8ff, 6, 9, 0.5, 0.8, 1.5); key.position.set(1.2, 2.4, 2.6); scene.add(key, key.target);   // weak key light so the fixture's shape is visible

/* ───────── model · light ───────── */
const R = buildMachine(menu.canvas, MODEL.body);
scene.add(R.root);
// one beam (spot light + volumetric cone + beam-section canvas) per head; multi-head fixtures use lighter settings
const MULTI = R.heads.length > 1;
const BEAMS = R.heads.map((r, i) => {
  const img = new BeamImage(MODEL, MULTI ? 192 : 384);
  return { r, head: fx.heads[i], img, beam: new Beam(r.tilt, img.out, R.dim, MULTI ? { steps: 24, shadow: 512 } : {}) };
});
const lcdView = $('#lcdView').getContext('2d'), beamView = $('#beamView').getContext('2d');

/* Post-processing: bloom (lens/beam glow) + depth pre-pass (where the beam is cut by the body and walls) */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.7, 0.92); composer.addPass(bloom);
composer.addPass(new OutputPass());
const depthRT = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
depthRT.depthTexture.type = THREE.UnsignedIntType;
function resize() {
  const w = host.clientWidth || 1, h = host.clientHeight || 1, pr = renderer.getPixelRatio();
  renderer.setSize(w, h); composer.setSize(w, h); depthRT.setSize(Math.floor(w * pr), Math.floor(h * pr));
  camera.aspect = w / h; camera.updateProjectionMatrix();
  for (const B of BEAMS) B.beam.setDepth(depthRT.depthTexture, Math.floor(w * pr), Math.floor(h * pr), camera);
}
new ResizeObserver(resize).observe(host); resize();

/* ───────── mounting (floor / truss) · views ───────── */
let mount = 'floor';
function setMount(m) {
  mount = m; truss.visible = m === 'truss'; fx.inverted = m === 'truss'; menu.dirty = true;
  if (m === 'truss') { R.root.rotation.set(0, 0, Math.PI); R.root.position.set(0, truss.userData.hangY, 0); }
  else { R.root.rotation.set(0, 0, 0); R.root.position.set(0, 0, 0); }
  key.target.position.copy(R.root.position).y += (m === 'truss' ? -0.5 : 0.5) * MODEL.body.H; key.position.set(1.2, key.target.position.y + 1.4, 2.6);
  try { localStorage.setItem('wmh.mount', m); } catch (e) {}
  setView(curView, true);
}
const VS = MODEL.body.viewScale || MODEL.body.H / 0.492, PB = MODEL.body.base, BH = MODEL.body.H, LZ = PB.depth / 2 + 0.006;   // views scale with the fixture height
const VIEWS = {   // fixture-local coordinates (floor mount) → transformed for the mount. world:true = world coordinates
  stage: { world: true, pos: [4.6, 2.3, 6.2], tgt: [0, 1.9, -2.2] },
  front: { pos: [0.35 * VS, BH * 0.5 + 0.17 * VS, 1.25 * VS], tgt: [0, BH * 0.5, 0] },
  rear:  { pos: [-0.3 * VS, BH * 0.4 + 0.1 * VS, -0.95 * VS], tgt: [0, BH * 0.4, 0] },
  beam:  { world: true, pos: [0.6, 1.5, -5.2], tgt: [0, 1.2, 0] },
  lcd:   { pos: [0.02, PB.panelY + 0.02, LZ + 0.32], tgt: [0.005, PB.panelY, LZ] },
};
let curView = 'stage', fly = null;
function setView(name, instant) {
  const v = VIEWS[name]; if (!v) return; curView = name;
  const pos = new THREE.Vector3(...v.pos), tgt = new THREE.Vector3(...v.tgt);
  if (!v.world) { R.root.updateMatrixWorld(true); R.root.localToWorld(pos); R.root.localToWorld(tgt); }
  else if (mount === 'truss') tgt.y = name === 'beam' ? 3.2 : 2.4;
  if (instant) { camera.position.copy(pos); controls.target.copy(tgt); fly = null; } else fly = { pos, tgt, t: 0, p0: camera.position.clone(), t0: controls.target.clone() };
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
controls.addEventListener('start', () => { fly = null; });
WMH.look = (pos, tgt) => { camera.position.set(...pos); controls.target.set(...tgt); fly = null; };   // debug: place the camera

/* ───────── button input (3D body · LCD panel · keyboard) ───────── */
const KEYMAP = { up: 'up', down: 'down', left: 'menu', menu: 'menu', enter: 'enter', right: 'enter' };
/* model selector (top-left chip) — switching reloads the page with the other model */
{
  const sel = $('#selModel');
  sel.innerHTML = LIST.map(m => `<option value="${m.id}">${m.name} · ${m.code}</option>`).join('');
  sel.value = MODEL.id; sel.title = MODEL.title;
  sel.addEventListener('change', () => { rememberModel(sel.value); const u = new URL(location.href); u.searchParams.delete('model'); location.href = u.toString(); });
}
let held = null;
function press(k, mesh) {
  release();
  const key = KEYMAP[k]; if (!key) return;
  held = { key, t0: performance.now(), rep: 0, next: performance.now() + 420, mesh, long: false };
  if (mesh) { if (mesh.userData.z0 == null) mesh.userData.z0 = mesh.position.z; mesh.position.z = mesh.userData.z0 - 0.0012; }
  document.querySelectorAll(`.key[data-key="${key}"]`).forEach(b => b.classList.add('down'));
  if (key !== 'menu') menu.key(key);                    // MENU acts on release (short) or after 1 s held (long)
}
function release() {
  if (!held) return;
  if (held.key === 'menu' && !held.long) menu.key('menu');
  if (held.mesh) held.mesh.position.z = held.mesh.userData.z0;
  document.querySelectorAll('.key.down').forEach(b => b.classList.remove('down'));
  held = null;
}
function pollHeld(now) {
  if (!held) return;
  if (held.key === 'menu') { if (!held.long && now - held.t0 > 1000) { held.long = true; menu.key('menu', { long: true }); } return; }
  if (held.key !== 'enter' && now > held.next) { held.rep++; held.next = now + (held.rep > 12 ? 35 : 90); menu.key(held.key, { rep: held.rep }); }
}
document.querySelectorAll('.key').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); press(b.dataset.key); });
  b.addEventListener('pointerup', release); b.addEventListener('pointercancel', release);
});
addEventListener('keydown', e => {
  if (e.repeat || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const k = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Escape: 'menu', m: 'menu', M: 'menu' }[e.key];
  if (k) { e.preventDefault(); press(k); }
});
addEventListener('keyup', e => { if (held && ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'm', 'M'].includes(e.key)) release(); });

const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let downAt = null;
const pick = e => {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(R.clickables, false)[0];
  lastHit = hit || null;
  return hit && hit.object;
};
let lastHit = null;
/** Rotary encoder: one detent left (-1) or right (+1) */
function turn(dir) { menu.key(dir > 0 ? 'down' : 'up'); if (R.knob) R.knob.rotation.y -= dir * Math.PI / 10; }
renderer.domElement.addEventListener('pointerdown', e => {
  downAt = [e.clientX, e.clientY];
  const o = pick(e);
  if (o && o.userData.key && o.userData.key !== 'power') { controls.enabled = false; press(o.userData.key, o); }
});
addEventListener('pointerup', e => {
  if (held && held.mesh) { release(); controls.enabled = true; }
  if (e.target !== renderer.domElement || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const o = pick(e);
  if (o && o.userData.key === 'power') setPower(!fx.power);
  else if (o && o.userData.lcd) {
    if (MODEL.panel.type === 'touch' && lastHit.uv) menu.touch(lastHit.uv.x * 320, (1 - lastHit.uv.y) * 240);   // touch screen
    else setView('lcd');
  }
});
// encoder: mouse wheel over the knob turns it (instead of zooming the camera)
renderer.domElement.addEventListener('wheel', e => { const o = pick(e); if (o && o.userData.encoder) { e.preventDefault(); e.stopImmediatePropagation(); turn(Math.sign(e.deltaY)); } }, { capture: true, passive: false });
// LCD panel at the bottom: key captions follow the panel type; a touch panel also takes taps on the enlarged LCD
document.querySelectorAll('.key').forEach(b => { const l = menu.keyLabels[b.dataset.key]; b.innerHTML = `${l[0]}<small>${l[1]}</small>`; });
$('#lcdView').addEventListener('pointerdown', e => { const r = e.target.getBoundingClientRect(); menu.touch((e.clientX - r.left) / r.width * 320, (e.clientY - r.top) / r.height * 240); });
if (MODEL.panel.type === 'touch') $('#lcdView').style.cursor = 'pointer';
renderer.domElement.addEventListener('pointermove', e => { renderer.domElement.style.cursor = pick(e) ? 'pointer' : ''; });

/* ───────── top bar ───────── */
function setPower(on) {
  fx.setPower(on);
  try { localStorage.setItem('wmh.power', on ? '1' : '0'); } catch (e) {}
  const b = $('#btnPower'); b.textContent = on ? '⏻ Power ON' : '⏻ Power OFF'; b.classList.toggle('on', on);
  R.rocker.rotation.x = on ? 0.18 : -0.18; R.rocker.material.emissive.setHex(on ? 0x7a0d08 : 0);
  menu.home(); menu.asleep = false; menu.lastKey = performance.now(); log(on ? 'Power ON' : 'Power OFF');
}
$('#btnPower').addEventListener('click', () => setPower(!fx.power));
installAgentEntry();                                         // development only: Ctrl + double-click the logo / Ctrl + Alt + M
let haze = 0.55;
$('#rngHaze').addEventListener('input', e => { haze = e.target.value / 100; });
$('#chkWork').addEventListener('change', e => { work.intensity = e.target.checked ? 1.6 : 0; hemi.intensity = e.target.checked ? 0.9 : 0.18; scene.environmentIntensity = e.target.checked ? 0.5 : 0.1; });
$('#chkDock').addEventListener('change', e => $('#lcdDock').classList.toggle('hidden', !e.target.checked));
$('#selMount').addEventListener('change', e => setMount(e.target.value));
// DMX test transmitter: "added" as a device separate from the fixture (the same page also opens in a new window)
function toggleTx(show) {
  const d = $('#txDock'), on = show ?? d.classList.contains('hidden');
  d.classList.toggle('hidden', !on);
  const f = $('#txFrame'); if (on && !f.src) f.src = 'console.html?embed=1'; if (!on) f.removeAttribute('src');
  $('#btnTx').textContent = on ? '🎚 Remove DMX Transmitter' : '🎚 Add DMX Transmitter'; $('#btnTx').classList.toggle('active', on);
  try { localStorage.setItem('wmh.tx', on ? '1' : '0'); } catch (e) {}
}
$('#btnTx').addEventListener('click', () => toggleTx());
// Demo: drives the fixture directly (overrides DMX / run mode) until stopped or released
function setDemo(on) {
  if (on) { if (!fx.power) setPower(true); fx.lampOn = true; fx.demo = true; fx.demoT = 0; fx.override('demo'); menu.home(); log('Demo started'); }
  else if (fx.demo || fx.localSrc === 'demo') { fx.release(); log('Demo stopped'); }
}
$('#btnDemo').addEventListener('click', () => setDemo(!fx.demo));
$('#txClose').addEventListener('click', () => toggleTx(false));

/* ───────── sound mode (microphone) ───────── */
const mic = { ctx: null, an: null, buf: null, avg: 0, last: 0, state: '' };
async function micStart() {
  if (mic.ctx || mic.state === 'denied') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mic.ctx = new AudioContext(); mic.an = mic.ctx.createAnalyser(); mic.an.fftSize = 512; mic.buf = new Uint8Array(mic.an.fftSize);
    mic.ctx.createMediaStreamSource(stream).connect(mic.an); mic.state = 'Microphone active';
  } catch (e) { mic.state = 'denied'; log('Microphone unavailable — use the [♪ Beat] button instead'); }
}
function micPoll(now) {
  if (!mic.an) return;
  mic.an.getByteTimeDomainData(mic.buf);
  let e = 0; for (const v of mic.buf) e += (v - 128) * (v - 128); e = Math.sqrt(e / mic.buf.length);
  if (e > 6 && e > mic.avg * 1.6 && now - mic.last > 180) { fx.beat = true; mic.last = now; }
  mic.avg += (e - mic.avg) * 0.05;
}
document.addEventListener('click', e => { if (e.target.id === 'btnBeat') fx.beat = true; });

/* ───────── settings change → server / display ───────── */
fx.on(ev => {
  if (ev === 'settings') { dmx.sendFixture(); menu.dirty = true; if (fx.settings.runMode === 'SOUND') micStart(); }
  if (ev === 'signal') { const s = $('#sig'); s.className = 'pill ' + (fx.dmxSignal ? 'on' : 'off'); s.textContent = fx.dmxSignal ? 'DMX receiving' : 'No DMX signal'; }
});

/* ───────── loop ───────── */
const clock = new THREE.Clock();
let uiT = 0, outT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now(), time = clock.elapsedTime;
  pollHeld(now); micPoll(now);
  if (fx.demo && fx.local) {                                    // demo sequence → channel values
    if (!fx.resetting) fx.demoT += dt;
    const d = demoValues(MODEL, fx.mode.channels, fx.demoT); fx.local = d.values; fx.localSrc = 'demo'; fx.demoScene = d.scene;
  }
  fx.update(dt);
  if (fx.dmxOut && now - outT > 25) { outT = now; dmx.sendOut(fx.dmxOut); }      // Host/Sound: DMX OUT (40Hz)

  if (menu.draw(now)) { R.lcdTex.needsUpdate = true; lcdView.drawImage(menu.canvas, 0, 0); }
  {                                                            // DMX signal LED (models with a "DMX Indicate" setting choose how it shows)
    const sig = fx.dmxSignal, mode = fx.settings.dmxInd, br = (fx.settings.sigBright ?? 10) / 10, blink = Math.floor(now / 120) % 2;
    const on = !fx.power ? 0 : mode === 'Mode1' ? +sig : mode === 'Mode2' ? +!sig : mode === 'Mode3' ? (sig ? blink : 0) : (sig ? 0.35 + 0.65 * blink : -1);
    R.led.material.color.setRGB(on < 0 ? 1 : 0.05, on < 0 ? 0.15 : 0.05 + 0.95 * on * br, on < 0 ? 0.1 : 0.05 + 0.3 * on * br);
  }
  for (const B of BEAMS) {
    const h = B.head, r = B.r;
    r.pan.rotation.y = THREE.MathUtils.degToRad(h.pan.pos);
    r.tilt.rotation.x = THREE.MathUtils.degToRad(h.tilt.pos);
    if (B.img.render(h)) { B.beam.tex.needsUpdate = true; if (h.index === 0) beamView.drawImage(B.img.out, 0, 0, 160, 160); }
    B.beam.update(h, camera, haze, time, r.lensMat);
    for (let k = 0; k < r.ring.length; k++) { const c = h.o.ring[k]; r.ring[k].color.setRGB(0.02 + c[0] * 2.6, 0.02 + c[1] * 2.6, 0.02 + c[2] * 2.6); }   // pixel ring (HDR → blooms)
  }
  $('#beamView').style.opacity = 0.25 + 0.75 * Math.min(1, fx.intensity * 3);

  if (fly) { fly.t = Math.min(1, fly.t + dt * 1.8); const k = fly.t * fly.t * (3 - 2 * fly.t); camera.position.lerpVectors(fly.p0, fly.pos, k); controls.target.lerpVectors(fly.t0, fly.tgt, k); if (fly.t >= 1) fly = null; }
  controls.update();

  // depth pre-pass (without the beam) → main render
  renderer.shadowMap.needsUpdate = true;
  for (const B of BEAMS) { B.fv = B.beam.flare.visible; B.vv = B.beam.vol.visible; B.beam.vol.visible = false; B.beam.flare.visible = false; }
  renderer.setRenderTarget(depthRT); renderer.render(scene, camera); renderer.setRenderTarget(null);
  for (const B of BEAMS) { B.beam.vol.visible = B.vv; B.beam.flare.visible = B.fv; }
  composer.render();

  if (now - uiT > 200) { uiT = now; const bd = $('#btnDemo'); bd.classList.toggle('active', fx.demo); bd.textContent = fx.demo ? `■ Demo · ${fx.demoScene}` : '▶ Demo'; panel.updateStatus(); panel.refreshDmx(); $('#lcdState').textContent = !fx.power ? 'Off' : menu.asleep ? 'Sleep' : ''; const ms = document.getElementById('micState'); if (ms) ms.textContent = mic.state === 'denied' ? 'No microphone' : mic.state; }
}

/* ───────── start ───────── */
let saved = {}; try { saved = { mount: localStorage.getItem('wmh.mount'), power: localStorage.getItem('wmh.power'), tx: localStorage.getItem('wmh.tx') }; } catch (e) {}
if (saved.mount === 'truss') { $('#selMount').value = 'truss'; setMount('truss'); } else setView('stage', true);
log('Simulator started');
dmx.connect().then(ok => { log(ok ? 'Local server connected — Art-Net, sACN and USB-DMX input available' : 'Web version — virtual cable and Web Serial only'); panel.refreshDmx(); });
setPower(saved.power !== '0');
if (saved.tx === '1') toggleTx(true);
if (fx.settings.runMode === 'SOUND') micStart();
frame();
