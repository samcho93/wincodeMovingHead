// stage/scene3d.js — the 3D stage for the stage editor: renderer, room, lights, post-processing and the depth pre-pass
//  that the volumetric beams read. (The single-fixture simulator page builds the same room in main.js.)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const ROOM = { w: 16, d: 14, h: 7, back: -6 };
export const TRUSS_Y = 4.6;                                  // height of the lower truss chords

const trussMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.9 });
/** A box truss of the given length along X; origin = middle of the lower chords (where fixtures hang) */
export function buildTruss(len) {
  const g = new THREE.Group(), tube = (r, l, seg) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), trussMat);
  for (const [y, z] of [[0, -0.14], [0, 0.14], [0.28, -0.14], [0.28, 0.14]]) { const t = tube(0.025, len, 12); t.rotation.z = Math.PI / 2; t.position.set(0, y, z); g.add(t); }
  for (let x = -len / 2; x <= len / 2 + 1e-6; x += 0.5) {
    for (const z of [-0.14, 0.14]) { const t = tube(0.012, 0.28, 6); t.position.set(x, 0.14, z); g.add(t); }
    for (const y of [0, 0.28]) { const t = tube(0.012, 0.28, 6); t.rotation.x = Math.PI / 2; t.position.set(x, y, 0); g.add(t); }
  }
  return g;
}

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
  const plane = (w, h, m, x, y, z, rx, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.set(rx, ry, 0); p.receiveShadow = true; scene.add(p); return p; };
  const cz = ROOM.back + ROOM.d / 2;
  const floor = plane(ROOM.w, ROOM.d, floorM, 0, 0, cz, -Math.PI / 2, 0);
  plane(ROOM.w, ROOM.h, wallM, 0, ROOM.h / 2, ROOM.back, 0, 0);
  plane(ROOM.d, ROOM.h, wallM, -ROOM.w / 2, ROOM.h / 2, cz, 0, Math.PI / 2);
  plane(ROOM.d, ROOM.h, wallM, ROOM.w / 2, ROOM.h / 2, cz, 0, -Math.PI / 2);
  plane(ROOM.w, ROOM.d, wallM, 0, ROOM.h, cz, Math.PI / 2, 0);
  const grid = new THREE.GridHelper(ROOM.w, ROOM.w, 0x2a2a30, 0x202024); grid.position.set(0, 0.002, cz); grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);

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
  return { THREE, renderer, scene, camera, controls, floor, depthRT, size, render, setWorkLight, set onResize(f) { onResize = f; } };
}
