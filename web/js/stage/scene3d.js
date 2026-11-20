// stage/scene3d.js — the 3D stage for the stage editor: renderer, room, lights, post-processing and the depth pre-pass
//  that the volumetric beams read. (The single-fixture simulator page builds the same room in main.js.)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { roomOf } from '../rig/rig.js';

/** The room in use: { w, d, h, back }. One object, updated by setRoom(), so that every module reads the current size. */
export const ROOM = roomOf(null);
export const TRUSS_Y = 4.6;                                  // default height of the lower truss chords (trusses are built by rig/rig.js)

export function createStage(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.1;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 90);
  camera.position.set(5.5, 3.4, 8.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.6, -1); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.3; controls.maxDistance = 22; controls.maxPolarAngle = Math.PI * 0.55;

  // room: floor, back wall, side walls, ceiling
  const floorM = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.78, metalness: 0.05 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.95 });
  const room = new THREE.Group(); scene.add(room);
  const plane = (w, h, m, x, y, z, rx, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.set(rx, ry, 0); p.receiveShadow = true; room.add(p); return p; };
  /** build the room again in another size ({ w, d, h } in metres) */
  function setRoom(r) {
    Object.assign(ROOM, roomOf(r));
    for (const o of [...room.children]) { room.remove(o); o.geometry.dispose(); }
    const cz = ROOM.back + ROOM.d / 2;
    plane(ROOM.w, ROOM.d, floorM, 0, 0, cz, -Math.PI / 2, 0);
    plane(ROOM.w, ROOM.h, wallM, 0, ROOM.h / 2, ROOM.back, 0, 0);
    plane(ROOM.d, ROOM.h, wallM, -ROOM.w / 2, ROOM.h / 2, cz, 0, Math.PI / 2);
    plane(ROOM.d, ROOM.h, wallM, ROOM.w / 2, ROOM.h / 2, cz, 0, -Math.PI / 2);
    plane(ROOM.w, ROOM.d, wallM, 0, ROOM.h, cz, Math.PI / 2, 0);
    // a 1 m grid on the floor, with a line through x = 0 and z = 0
    const pts = [], x0 = -Math.floor(ROOM.w / 2), z0 = Math.ceil(ROOM.back), z1 = ROOM.back + ROOM.d;
    for (let x = x0; x <= -x0; x++) pts.push(x, 0, ROOM.back, x, 0, z1); for (let z = z0; z <= z1; z++) pts.push(-ROOM.w / 2, 0, z, ROOM.w / 2, 0, z);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const grid = new THREE.LineSegments(lg, gridM); grid.position.y = 0.002; room.add(grid);
    controls.maxDistance = Math.max(22, Math.hypot(ROOM.w, ROOM.d) * 1.1); camera.far = Math.max(90, controls.maxDistance * 2.5); camera.updateProjectionMatrix();
  }
  /** camera presets for the current room: { persp, front, top, side } → [position, target] */
  const views = () => { const k = Math.max(ROOM.w / 16, ROOM.d / 14, ROOM.h / 7), cz = ROOM.back + ROOM.d / 2;
    return { persp: [[ROOM.w * 0.42, ROOM.h * 0.95, ROOM.back + ROOM.d * 1.2], [0, ROOM.h * 0.3, ROOM.back + ROOM.d * 0.42]], front: [[0, ROOM.h * 0.34, 13 * k], [0, ROOM.h * 0.31, 0]], top: [[0, 19 * k, cz + 0.01], [0, 0, cz]], side: [[14 * k, ROOM.h * 0.37, cz], [0, ROOM.h * 0.31, cz]] }; };
  const setView = name => { const [p, t] = views()[name]; camera.position.set(...p); controls.target.set(...t); controls.update(); };
  const gridM = new THREE.LineBasicMaterial({ color: 0x2a2a30, transparent: true, opacity: 0.5 });
  setRoom(ROOM);

  const hemi = new THREE.HemisphereLight(0x55607a, 0x0a0a0c, 0.2); scene.add(hemi);
  const work = new THREE.DirectionalLight(0xfff2e0, 0); work.position.set(3, 6, 5); scene.add(work);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35); fill.position.set(2, 4, 6); scene.add(fill);   // weak front light so the fixtures are visible
  const setWorkLight = on => { work.intensity = on ? 1.6 : 0; hemi.intensity = on ? 0.9 : 0.2; scene.environmentIntensity = on ? 0.5 : 0.1; };

  // post-processing: bloom + depth pre-pass (where a beam is cut off by bodies and walls)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.7, 0.92));
  composer.addPass(new OutputPass());
  const depthRT = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
  depthRT.depthTexture.type = THREE.UnsignedIntType;
  const size = { w: 1, h: 1 };
  let onResize = () => {};
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1, pr = renderer.getPixelRatio();
    renderer.setSize(w, h); composer.setSize(w, h); size.w = Math.floor(w * pr); size.h = Math.floor(h * pr); depthRT.setSize(size.w, size.h);
    camera.aspect = w / h; camera.updateProjectionMatrix(); onResize();
  }
  new ResizeObserver(resize).observe(host); resize();

  /** render one frame; beams: every Beam on the stage (hidden during the depth pre-pass) */
  function render(beams) {
    controls.update();
    renderer.shadowMap.needsUpdate = true;
    for (const b of beams) { b.volWas = b.vol.visible; b.flareWas = b.flare.visible; b.vol.visible = false; b.flare.visible = false; }   // (own field names: Beam keeps scratch vectors in _v, _m …)
    renderer.setRenderTarget(depthRT); renderer.render(scene, camera); renderer.setRenderTarget(null);
    for (const b of beams) { b.vol.visible = b.volWas; b.flare.visible = b.flareWas; }
    composer.render();
  }
  return { THREE, renderer, scene, camera, controls, setRoom, setView, depthRT, size, render, setWorkLight, set onResize(f) { onResize = f; } };
}
