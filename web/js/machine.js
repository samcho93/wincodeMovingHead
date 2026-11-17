// machine.js — 3D model of the moving head (procedural). Drawing dimensions from manual page 5: 296 (W) × 224 (D) × 492 (H) mm
//  Coordinates: origin = floor centre, +Z = control panel (LCD) side, units = m. Head local +Y = beam direction.
import * as THREE from 'three';

export const DIM = {
  W: 0.296, D: 0.224, H: 0.492,
  baseTop: 0.105, panY: 0.125, tiltY: 0.185,      // tiltY: tilt axis height above the yoke origin (0.310 above the floor)
  lensY: 0.1825, lensR: 0.054,
  lcd: [0.058, 0.0435],
};

/** Body lofted from rounded-rectangle sections along Y (moulded-housing look) */
function loft(sections, n = 56) {
  const pos = [], idx = [];
  const ring = (w, d, r) => {
    const pts = [], hw = w / 2, hd = d / 2; r = Math.min(r, hw, hd);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, q = Math.floor(i / (n / 4));
      const cx = (q === 0 || q === 3 ? 1 : -1) * (hw - r), cz = (q < 2 ? 1 : -1) * (hd - r);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return pts;
  };
  sections.forEach(s => ring(s.w, s.d, s.r).forEach(p => pos.push(p[0], s.y, p[1])));
  for (let j = 0; j < sections.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (j, flip) => {
    const c = pos.length / 3; pos.push(0, sections[j].y, 0);
    for (let i = 0; i < n; i++) { const a = j * n + i, b = j * n + (i + 1) % n; flip ? idx.push(c, a, b) : idx.push(c, b, a); }
  };
  cap(0, true); cap(sections.length - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  // smooth shading: average normals at coincident positions (cap edges split by angle)
  return smooth(ng, 50);
}
function smooth(g, angleDeg) {
  const p = g.attributes.position, nrm = g.attributes.normal, map = new Map(), cos = Math.cos(angleDeg * Math.PI / 180);
  const key = i => `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i); (map.get(k) || map.set(k, []).get(k)).push(i); }
  const out = new Float32Array(p.count * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), s = new THREE.Vector3();
  for (const ids of map.values()) for (const i of ids) {
    a.fromBufferAttribute(nrm, i); s.set(0, 0, 0);
    for (const j of ids) { b.fromBufferAttribute(nrm, j); if (a.dot(b) > cos) s.add(b); }
    s.normalize(); out[i * 3] = s.x; out[i * 3 + 1] = s.y; out[i * 3 + 2] = s.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}
const extrude = (pts, depth, bevel = 0.003) => {
  const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
};

export function buildMachine(lcdCanvas) {
  const M = {
    body: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.48, metalness: 0.12 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.3, metalness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.95 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x1650b8, roughness: 0.45, metalness: 0.1 }),
    btn: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, emissive: 0x000000 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.55 }),
  };
  const root = new THREE.Group(); root.name = 'fixture';
  const clickables = [];
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  /* ── base ── */
  const base = new THREE.Group(); root.add(base);
  const hw = 0.113;
  add(base, extrude([[-hw, 0.03], [hw, 0.03], [hw, 0.083], [hw - 0.02, DIM.baseTop], [-hw + 0.02, DIM.baseTop], [-hw, 0.083]], 0.2, 0.004), M.body);
  for (const sx of [-1, 1]) {                                   // handles (sides, ribbed)
    const h = add(base, extrude([[0, 0.036], [0.035, 0.05], [0.035, 0.084], [0, 0.098]], 0.15, 0.003), M.body, sx * hw);
    if (sx < 0) h.scale.x = -1;
    for (let i = -4; i <= 4; i++) add(base, new THREE.BoxGeometry(0.02, 0.044, 0.004), M.trim, sx * (hw + 0.014), 0.067, i * 0.014).rotation.z = sx * -0.38;
    add(base, new THREE.BoxGeometry(0.01, 0.02, 0.05), M.trim, sx * (DIM.W / 2 - 0.004), 0.067, 0);   // loop
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(base, new THREE.CylinderGeometry(0.014, 0.011, 0.03, 20), M.rubber, sx * 0.075, 0.015, sz * 0.07);   // feet
  for (const sz of [-1, 1]) add(base, new THREE.BoxGeometry(0.166, 0.062, 0.012), M.trim, 0, 0.067, sz * 0.106);   // front/rear panel frames → depth 224

  // front panel: LCD + 5 buttons (cross) — manual 4.1, left picture
  const front = new THREE.Group(); front.position.set(0, 0.067, 0.1125); base.add(front);
  const lcdTex = new THREE.CanvasTexture(lcdCanvas); lcdTex.colorSpace = THREE.SRGBColorSpace; lcdTex.anisotropy = 4;
  const lcdMat = new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false });
  const lcd = add(front, new THREE.PlaneGeometry(DIM.lcd[0], DIM.lcd[1]), lcdMat, -0.036, 0, 0.0002); lcd.castShadow = false;
  lcd.userData.lcd = true; clickables.push(lcd);
  add(front, new THREE.BoxGeometry(DIM.lcd[0] + 0.008, DIM.lcd[1] + 0.008, 0.001), M.rubber, -0.036, 0, -0.0004);
  const mic = add(front, new THREE.BoxGeometry(0.003, 0.008, 0.001), M.rubber, 0.006, 0.006, 0);                      // microphone hole (sound mode)
  mic.castShadow = false;
  const bx = 0.042, bs = 0.0145;
  const BTN = { up: [0, bs], left: [-bs, 0], enter: [0, 0], right: [bs, 0], down: [0, -bs] };
  const buttons = {};
  for (const [key, [dx, dy]] of Object.entries(BTN)) {
    const b = add(front, new THREE.CylinderGeometry(0.0052, 0.0052, 0.004, 24), M.btn.clone(), bx + dx, dy, 0.002);
    b.rotation.x = Math.PI / 2; b.userData.key = key; b.castShadow = false; buttons[key] = b; clickables.push(b);
  }
  const led = add(front, new THREE.SphereGeometry(0.0016, 12, 8), new THREE.MeshBasicMaterial({ color: 0x220000 }), 0.068, 0.02, 0.001);   // DMX signal LED
  led.castShadow = false;

  // rear panel: DMX IN/OUT (3-pin, 5-pin) · power IN/OUT · fuse · power switch — manual 4.1, right picture
  const rear = new THREE.Group(); rear.position.set(0, 0.067, -0.1125); rear.rotation.y = Math.PI; base.add(rear);
  const xlr = (x, y, pins) => {
    const s = add(rear, new THREE.CylinderGeometry(0.0115, 0.0115, 0.006, 28), M.metal, x, y, 0.003); s.rotation.x = Math.PI / 2;
    const hole = add(rear, new THREE.CylinderGeometry(0.0088, 0.0088, 0.0062, 24), M.rubber, x, y, 0.0032); hole.rotation.x = Math.PI / 2;
    for (let i = 0; i < pins; i++) { const a = Math.PI * (0.15 + 0.7 * i / (pins - 1)) + Math.PI; const p = add(rear, new THREE.CylinderGeometry(0.0009, 0.0009, 0.004, 8), M.metal, x + Math.cos(a) * 0.005, y + Math.sin(a) * 0.005 + 0.001, 0.0055); p.rotation.x = Math.PI / 2; }
  };
  xlr(-0.058, 0.014, 5); xlr(-0.031, 0.014, 5); xlr(-0.058, -0.014, 3); xlr(-0.031, -0.014, 3);
  for (const y of [0.014, -0.014]) {                                                                              // powerCON IN (blue) / OUT (grey)
    const pc = add(rear, new THREE.CylinderGeometry(0.0125, 0.0125, 0.008, 28), y > 0 ? M.blue : M.metal, 0.002, y, 0.004); pc.rotation.x = Math.PI / 2;
    const ph = add(rear, new THREE.CylinderGeometry(0.008, 0.008, 0.0082, 20), M.rubber, 0.002, y, 0.0042); ph.rotation.x = Math.PI / 2;
  }
  const fuse = add(rear, new THREE.CylinderGeometry(0.0065, 0.0065, 0.006, 20), M.rubber, 0.04, -0.016, 0.003); fuse.rotation.x = Math.PI / 2;
  add(rear, new THREE.BoxGeometry(0.026, 0.021, 0.004), M.rubber, 0.046, 0.012, 0.002);
  const rocker = add(rear, new THREE.BoxGeometry(0.02, 0.015, 0.006), new THREE.MeshStandardMaterial({ color: 0x8a1410, roughness: 0.4, emissive: 0x000000 }), 0.046, 0.012, 0.004);
  rocker.userData.key = 'power'; clickables.push(rocker);

  add(base, new THREE.CylinderGeometry(0.078, 0.082, 0.02, 48), M.trim, 0, DIM.baseTop + 0.01, 0);                // turntable

  /* ── yoke (pan) ── */
  const pan = new THREE.Group(); pan.position.y = DIM.panY; root.add(pan);
  add(pan, loft([{ y: 0, w: 0.2, d: 0.115, r: 0.03 }, { y: 0.012, w: 0.268, d: 0.128, r: 0.03 }, { y: 0.04, w: 0.272, d: 0.126, r: 0.03 }, { y: 0.055, w: 0.262, d: 0.11, r: 0.03 }]), M.body);
  const armShape = [[-0.064, 0.02], [0.064, 0.02], [0.05, 0.19], [0.036, 0.228], [0.012, 0.244], [-0.012, 0.244], [-0.036, 0.228], [-0.05, 0.19]];
  for (const sx of [-1, 1]) {
    const arm = add(pan, extrude(armShape, 0.036, 0.006), M.body, sx * 0.118, 0, 0); arm.rotation.y = Math.PI / 2;
    const capM = add(pan, new THREE.CylinderGeometry(0.03, 0.03, 0.004, 32), M.trim, sx * 0.1375, DIM.tiltY, 0); capM.rotation.z = Math.PI / 2;
    add(pan, extrude([[-0.018, 0.05], [0.018, 0.05], [0.008, 0.15], [-0.008, 0.15]], 0.003, 0.001), M.trim, sx * 0.1368, 0, 0).rotation.y = Math.PI / 2;   // side trim (the "A" recess in the drawing)
    const hub = add(pan, new THREE.CylinderGeometry(0.022, 0.022, 0.012, 24), M.trim, sx * 0.097, DIM.tiltY, 0); hub.rotation.z = Math.PI / 2;
  }

  /* ── head (tilt) ── */
  const tilt = new THREE.Group(); tilt.position.y = DIM.tiltY; pan.add(tilt);
  add(tilt, loft([
    { y: -0.118, w: 0.105, d: 0.09, r: 0.03 }, { y: -0.108, w: 0.15, d: 0.128, r: 0.04 }, { y: -0.04, w: 0.182, d: 0.158, r: 0.045 },
    { y: 0.04, w: 0.18, d: 0.156, r: 0.046 }, { y: 0.12, w: 0.152, d: 0.14, r: 0.05 }, { y: 0.16, w: 0.142, d: 0.136, r: 0.06 }, { y: 0.174, w: 0.134, d: 0.13, r: 0.062 },
  ]), M.body);
  for (const sz of [-1, 1]) {                                                                                     // cooling slots · name plate
    for (let i = -6; i <= 6; i++) add(tilt, new THREE.BoxGeometry(0.003, 0.024, 0.004), M.trim, i * 0.0072, -0.07, sz * 0.0735);
    add(tilt, new THREE.BoxGeometry(0.04, 0.02, 0.003), M.trim, 0, 0.03, sz * 0.0775);
  }
  const ring = add(tilt, new THREE.CylinderGeometry(0.062, 0.064, 0.012, 56, 1, true), M.trim, 0, 0.178, 0); ring.material = M.trim.clone(); ring.material.side = THREE.DoubleSide;
  add(tilt, new THREE.TorusGeometry(0.0585, 0.0045, 12, 56), M.trim, 0, 0.1835, 0).rotation.x = Math.PI / 2;
  // lens: emissive rear face (shows the beam section) + front glass
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: true });
  const lens = add(tilt, new THREE.CircleGeometry(DIM.lensR, 48), lensMat, 0, DIM.lensY - 0.004, 0); lens.rotation.x = -Math.PI / 2; lens.castShadow = false;
  const dome = add(tilt, new THREE.SphereGeometry(0.09, 40, 12, 0, Math.PI * 2, 0, 0.64), M.glass, 0, DIM.lensY - 0.0745, 0); dome.castShadow = false;

  root.traverse(o => { if (o.isMesh) o.userData.fixture = true; });
  return { root, base, pan, tilt, buttons, rocker, led, lcdTex, lcdMat, lensMat, lens, clickables, M };
}
