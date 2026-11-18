// machine.js — procedural 3D model of a moving head, built from a model definition's `body` dimensions.
//  Coordinates: origin = floor centre, +Z = control panel (LCD) side, units = m. Head local +Y = beam direction.
//  body.style 'box' = moulded rounded-box head, 'round' = cylindrical head with cooling fins,
//             'bar' = a long base carrying body.headCount small heads, each with a pixel ring.
//  body.controls 'cross5' = five buttons in a cross, 'col4' = MENU / UP / DOWN / ENTER in a column, 'encoder' = one rotary
//             encoder with push button.
//  Optional detail (all in the model definition, none of it model-specific here):
//    body.color            body paint (hex)
//    base.handle 'bar'     a carrying bar on each end of the base, 'wing' = a moulded grip (base.handles = ribbed grips)
//    yoke { W, t, wb, h1, h2, yf, c, d, armW, top }   one-piece U yoke seen from the front: foot width wb flaring to the
//                          full width W at h1, arms of thickness t from h2 up to `top` with a round end (armW deep),
//                          inner floor at yf with corner chamfer c, lower part d deep. Replaces bridge + arm.
//                          arch: true rounds the inner corners (radius c); armR = corner radius of the arm top
//                          instead of a half-round end.
//    rings [{ y, r, tube }]            trim rings round the head (stepped lens barrels)
//    ribs { y0, y1, n, r }             vertical cooling ribs round a cylindrical head
//    vents [{ side:'x'|'z', off, y, h, n, pitch }]   slotted vent panels on both sides of the head
//    hood { y0, y1, r0, r1 }           open lens hood (may flare)
//    logo { arm: 'text', armStyle: 'badge', head: 'text', headSize: [w, h], color }   lettering on both yoke arms (reads
//                                      upwards, or a horizontal badge below the tilt axis) and on a
//                                      badge on the front and back of the head (at plate.y / plate.z)
//    sink { y0, y1, w, d, n }          finned heat sink at the rear end of the head
//    shield { pts: [[x, y]…], z }      raised cover panel on the front and back of the head (outline in head x / y)
//    base.corner                       plan-view corner chamfer of the base (the base is bevelled on all four sides;
//                                      base.bevel: false = plain block with shoulders on the two ends only)
//  Bar bodies: base.endRise (end plates rising above the bar), base.loops (carrying loops between the heads),
//    yoke.round (arm plates with a round top and an inlay)
import * as THREE from 'three';

/** Body lofted from sections along Y: { y, w, d, r } rounded rectangle, { y, w, d, c } rectangle with chamfered (flat-cut)
 *  corners, { y, w } circle of diameter w. */
function loft(sections, n = 64) {
  const pos = [], idx = [];
  const ring = (w, d = w, r = w / 2, c = 0) => {
    const pts = [], hw = w / 2, hd = d / 2; r = Math.min(c || r, hw, hd);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, q = Math.floor(i / (n / 4));
      const cx = (q === 0 || q === 3 ? 1 : -1) * (hw - r), cz = (q < 2 ? 1 : -1) * (hd - r);
      const k = c ? r / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))) : r;   // chamfer: the quarter arc flattened to its chord
      pts.push([cx + Math.cos(a) * k, cz + Math.sin(a) * k]);
    }
    return pts;
  };
  sections.forEach(s => ring(s.w, s.d, s.r, s.c).forEach(p => pos.push(p[0], s.y, p[1])));
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
  return smooth(ng, 32);                                        // keeps chamfer edges and steps crisp
}
// smooth shading: average normals at coincident positions (cap edges split by angle)
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

/** Lettering as a lit, transparent plane (w × h metres) */
function label(text, w, h, color = '#c4c8ce') {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.max(32, Math.round(512 * h / w));
  const g = c.getContext('2d'); let px = c.height * 0.8;
  const font = () => { g.font = `italic 700 ${px}px Arial, Helvetica, sans-serif`; };
  font(); const tw = g.measureText(text).width; if (tw > c.width * 0.94) { px *= c.width * 0.94 / tw; font(); }
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 + px * 0.04);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, metalness: 0.1, depthWrite: false }));
  m.castShadow = false; return m;
}

export function buildMachine(lcdCanvas, B) {
  const M = {
    body: new THREE.MeshStandardMaterial({ color: B.color ?? 0x1b1d20, roughness: 0.55, metalness: 0.12 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.3, metalness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.95 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x1650b8, roughness: 0.45, metalness: 0.1 }),
    btn: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, emissive: 0x000000 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.55, depthWrite: false }),
  };
  const root = new THREE.Group(); root.name = 'fixture';
  const clickables = [];
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const cylX = (parent, r, h, mat, x, y, z) => { const m = add(parent, new THREE.CylinderGeometry(r, r, h, 12), mat, x, y, z); m.rotation.z = Math.PI / 2; m.castShadow = false; return m; };
  /** finned heat sink at the rear end of a head */
  const sink = tilt => { const K = B.sink; if (!K) return; const h = K.y1 - K.y0, yc = (K.y0 + K.y1) / 2;
    add(tilt, new THREE.BoxGeometry(K.w * 0.92, h * 0.7, K.d * 0.7), M.body, 0, K.y1 - h * 0.35, 0);
    for (let i = 0; i < K.n; i++) add(tilt, new THREE.BoxGeometry(K.w / K.n * 0.45, h, K.d), M.trim, (i - (K.n - 1) / 2) * (K.w / K.n), yc, 0); };
  const cylZ = (parent, r, h, mat, x, y, z, seg = 28) => { const m = add(parent, new THREE.CylinderGeometry(r, r, h, seg), mat, x, y, z); m.rotation.x = Math.PI / 2; return m; };

  /* ── base ── */
  const base = new THREE.Group(); root.add(base);
  const b = B.base, hw = b.hw || 0, zf = b.depth / 2 + 0.006;      // zf: outer face of the front/rear panel frames
  if (B.style === 'bar') {                                      // long bar carrying several heads
    const hl = b.length / 2, hd = b.depth / 2;
    add(base, extrude([[-hd, b.bot], [hd, b.bot], [hd, b.top - 0.03], [hd - 0.03, b.top], [-hd + 0.03, b.top], [-hd, b.top - 0.03]], b.length - 0.05, 0.005), M.body).rotation.y = Math.PI / 2;
    for (const sx of [-1, 1]) {                                 // end caps with carrying handles
      if (b.endRise) add(base, extrude([[-hd - 0.006, b.bot], [hd + 0.006, b.bot], [hd + 0.006, b.top - 0.01], [hd * 0.5, b.top + b.endRise], [-hd * 0.5, b.top + b.endRise], [-hd - 0.006, b.top - 0.01]], 0.03, 0.005), M.body, sx * (hl - 0.015), 0, 0).rotation.y = Math.PI / 2;   // end plate rising above the bar
      else add(base, new THREE.BoxGeometry(0.025, b.top - b.bot - 0.004, b.depth - 0.004), M.trim, sx * (hl - 0.0125), (b.top + b.bot) / 2, 0);
      add(base, new THREE.BoxGeometry(0.012, 0.03, 0.09), M.rubber, sx * (hl - 0.006), b.top - 0.035, 0);
      for (const sz of [-1, 1]) add(base, new THREE.CylinderGeometry(0.016, 0.013, b.bot, 16), M.rubber, sx * (hl - 0.09), b.bot / 2, sz * (hd - 0.035));   // feet
    }
    for (let i = 0; i < B.headCount; i++) for (let k = -6; k <= 6; k++) add(base, new THREE.BoxGeometry(0.005, 0.009, b.depth * 0.86), M.trim, (i - (B.headCount - 1) / 2) * B.headPitch + k * 0.011, b.top + 0.003, 0);   // heat-sink fins under each head
    if (b.loops) for (let i = 0; i < B.headCount - 1; i++) {     // carrying loops between the heads (front)
      const x = (i + 0.5 - (B.headCount - 1) / 2) * B.headPitch, w = B.headPitch * 0.46;
      add(base, new THREE.BoxGeometry(w, 0.011, 0.011), M.body, x, b.top - 0.014, hd + 0.024);
      for (const s of [-1, 1]) add(base, new THREE.BoxGeometry(0.011, 0.011, 0.03), M.body, x + s * (w / 2 - 0.0055), b.top - 0.014, hd + 0.012);
    }
    for (const sz of [-1, 1]) add(base, new THREE.BoxGeometry(b.frameW, b.frameH, 0.012), M.trim, 0, b.panelY, sz * hd);
  } else {
    const bc = b.corner ?? 0.028;                               // bevelled on all four sides: skirt, wall, shoulder
    if (b.bevel === false) add(base, extrude([[-hw, b.bot], [hw, b.bot], [hw, b.shoulder], [hw - b.chamfer, b.top], [-hw + b.chamfer, b.top], [-hw, b.shoulder]], b.depth, 0.004), M.body);   // plain block, shoulders on the two ends only
    else add(base, loft([{ y: b.bot, w: hw * 2 - 0.024, d: b.depth - 0.024, c: bc }, { y: b.bot + 0.014, w: hw * 2, d: b.depth, c: bc }, { y: b.shoulder, w: hw * 2, d: b.depth, c: bc },
      { y: b.top, w: hw * 2 - b.chamfer * 2, d: b.depth - b.chamfer * 1.3, c: bc }]), M.body);
    if (b.bevel !== false) add(base, loft([{ y: b.top, w: hw * 1.25, d: b.depth * 0.72, c: bc }, { y: b.top + 0.006, w: hw * 1.2, d: b.depth * 0.68, c: bc }]), M.trim);   // top plate under the turntable
    if (B.handles) for (const sx of [-1, 1]) {                    // carrying handles (sides, ribbed)
      const h = add(base, extrude([[0, b.bot + 0.006], [0.035, b.bot + 0.02], [0.035, b.top - 0.021], [0, b.top - 0.007]], b.depth * 0.75, 0.003), M.body, sx * hw);
      if (sx < 0) h.scale.x = -1;
      for (let i = -4; i <= 4; i++) add(base, new THREE.BoxGeometry(0.02, 0.044, 0.004), M.trim, sx * (hw + 0.014), b.panelY, i * 0.014).rotation.z = sx * -0.38;
      add(base, new THREE.BoxGeometry(0.01, 0.02, 0.05), M.trim, sx * (hw + 0.031), b.panelY, 0);
    }
    if (b.handle === 'bar') for (const sx of [-1, 1]) {           // carrying bar on each end
      add(base, new THREE.BoxGeometry(0.004, (b.top - b.bot) * 0.62, b.depth * 0.72), M.trim, sx * (hw + 0.001), b.panelY, 0);
      for (const sz of [-1, 1]) add(base, new THREE.BoxGeometry(0.03, 0.02, 0.014), M.body, sx * (hw + 0.013), b.panelY, sz * b.depth * 0.3);
      const bar = add(base, new THREE.CylinderGeometry(0.008, 0.008, b.depth * 0.68, 16), M.rubber, sx * (hw + 0.026), b.panelY, 0); bar.rotation.x = Math.PI / 2;
    }
    if (b.handle === 'wing') for (const sx of [-1, 1]) {          // moulded grip on each end, part of the base body
      const hh = (b.shoulder - b.bot) * 0.36;
      add(base, loft([{ y: b.panelY - hh, w: 0.05, d: b.depth * 0.7, c: 0.02 }, { y: b.panelY - hh + 0.014, w: 0.074, d: b.depth * 0.84, c: 0.028 }, { y: b.panelY + hh - 0.014, w: 0.074, d: b.depth * 0.84, c: 0.028 }, { y: b.panelY + hh, w: 0.05, d: b.depth * 0.7, c: 0.02 }]), M.body, sx * hw, 0, 0);
      add(base, new THREE.BoxGeometry(0.004, 0.014, b.depth * 0.46), M.trim, sx * (hw + 0.0372), b.panelY, 0);
    }
    const f = B.feet;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(base, new THREE.CylinderGeometry(f.r, f.r * 0.8, f.h, 20), M.rubber, sx * f.x, f.h / 2, sz * f.z);
    for (const sz of [-1, 1]) add(base, new THREE.BoxGeometry(b.frameW, b.frameH, 0.012), M.trim, 0, b.panelY, sz * b.depth / 2);
  }

  if (b.frameW) for (const sz of [-1, 1]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) cylZ(base, 0.0028, 0.002, M.metal, sx * (b.frameW / 2 - 0.007), b.panelY + sy * (b.frameH / 2 - 0.007), sz * (zf + 0.0005), 10).castShadow = false;   // panel screws
  // front panel: LCD + controls
  const front = new THREE.Group(); front.position.set(0, b.panelY, zf + 0.0005); base.add(front);
  const lcdTex = new THREE.CanvasTexture(lcdCanvas); lcdTex.colorSpace = THREE.SRGBColorSpace; lcdTex.anisotropy = 4;
  const lcdMat = new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false });
  const lcd = add(front, new THREE.PlaneGeometry(B.lcd[0], B.lcd[1]), lcdMat, B.lcdX, 0, 0.0002); lcd.castShadow = false;
  lcd.userData.lcd = true; clickables.push(lcd);
  add(front, new THREE.BoxGeometry(B.lcd[0] + 0.008, B.lcd[1] + 0.008, 0.001), M.rubber, B.lcdX, 0, -0.0004);
  add(front, new THREE.BoxGeometry(0.003, 0.008, 0.001), M.rubber, B.lcdX + B.lcd[0] / 2 + 0.012, 0.006, 0).castShadow = false;   // microphone hole (sound mode)
  const buttons = {};
  let knob = null;
  if (B.controls === 'cross5') {                                // five buttons in a cross
    const bs = 0.0145;
    for (const [key, [dx, dy]] of Object.entries({ up: [0, bs], left: [-bs, 0], enter: [0, 0], right: [bs, 0], down: [0, -bs] })) {
      const m = cylZ(front, 0.0052, 0.004, M.btn.clone(), B.ctrlX + dx, dy, 0.002, 24);
      m.userData.key = key; m.castShadow = false; buttons[key] = m; clickables.push(m);
    }
  } else if (B.controls === 'col4') {                           // MENU / UP / DOWN / ENTER in a column
    ['menu', 'up', 'down', 'enter'].forEach((key, i) => {
      const m = cylZ(front, 0.0046, 0.004, M.btn.clone(), B.ctrlX, (1.5 - i) * 0.0118, 0.002, 24);
      m.userData.key = key; m.castShadow = false; buttons[key] = m; clickables.push(m);
    });
  } else {                                                      // rotary encoder with push button
    cylZ(front, 0.014, 0.003, M.rubber, B.ctrlX, 0, 0.0015, 32).castShadow = false;
    knob = cylZ(front, 0.011, 0.012, M.btn.clone(), B.ctrlX, 0, 0.007, 32);
    knob.userData.key = 'enter'; knob.userData.encoder = true; knob.castShadow = false; buttons.enter = knob; clickables.push(knob);
    const mark = add(knob, new THREE.BoxGeometry(0.0016, 0.0005, 0.007), M.metal, 0, 0.0061, 0.004); mark.castShadow = false;   // pointer line on the knob face
    for (const [i, c] of [[0, 0x30ff60], [1, 0xff3020]].entries()) add(front, new THREE.SphereGeometry(0.0014, 10, 8), new THREE.MeshBasicMaterial({ color: c }), B.lcdX - B.lcd[0] / 2 - 0.012, 0.008 - i * 0.012, 0.001).castShadow = false;
  }
  const led = add(front, new THREE.SphereGeometry(0.0016, 12, 8), new THREE.MeshBasicMaterial({ color: 0x220000 }), B.ctrlX + 0.026, B.lcd[1] / 2 - 0.002, 0.001);   // DMX signal LED
  led.castShadow = false;

  // rear panel: DMX IN/OUT (3-pin, 5-pin) · power IN/OUT · fuse · power switch
  const rear = new THREE.Group(); rear.position.set(0, b.panelY, -zf - 0.0005); rear.rotation.y = Math.PI; base.add(rear);
  const xlr = (x, y, pins) => {
    cylZ(rear, 0.0115, 0.006, M.metal, x, y, 0.003); cylZ(rear, 0.0088, 0.0062, M.rubber, x, y, 0.0032, 24);
    for (let i = 0; i < pins; i++) { const a = Math.PI * (0.15 + 0.7 * i / (pins - 1)) + Math.PI; cylZ(rear, 0.0009, 0.004, M.metal, x + Math.cos(a) * 0.005, y + Math.sin(a) * 0.005 + 0.001, 0.0055, 8); }
  };
  xlr(-0.058, 0.014, 5); xlr(-0.031, 0.014, 5); xlr(-0.058, -0.014, 3); xlr(-0.031, -0.014, 3);
  for (const y of [0.014, -0.014]) { cylZ(rear, 0.0125, 0.008, y > 0 ? M.blue : M.metal, 0.002, y, 0.004); cylZ(rear, 0.008, 0.0082, M.rubber, 0.002, y, 0.0042, 20); }   // powerCON IN (blue) / OUT (grey)
  cylZ(rear, 0.0065, 0.006, M.rubber, 0.04, -0.016, 0.003, 20);                                                 // fuse
  add(rear, new THREE.BoxGeometry(0.026, 0.021, 0.004), M.rubber, 0.046, 0.012, 0.002);
  const rocker = add(rear, new THREE.BoxGeometry(0.02, 0.015, 0.006), new THREE.MeshStandardMaterial({ color: 0x8a1410, roughness: 0.4, emissive: 0x000000 }), 0.046, 0.012, 0.004);
  rocker.userData.key = 'power'; clickables.push(rocker);

  const heads = [];
  if (B.style === 'bar') {
    /* ── heads: small yoke (pan) + round head (tilt) with a pixel ring around the lens ── */
    const Y = B.yoke, domeR = B.lensR * 1.67, sag = domeR - Math.sqrt(domeR * domeR - B.lensR * B.lensR), headTop = B.head[B.head.length - 1].y;
    const bridgeGeo = loft([{ y: 0, w: Y.w * 0.8, d: Y.d * 0.85, r: 0.02 }, { y: 0.008, w: Y.w, d: Y.d, r: 0.02 }, { y: Y.h, w: Y.w, d: Y.d * 0.9, r: 0.02 }]);
    const ar = Y.armD / 2, armPts = Y.round ? [[-ar, Y.h - 0.01], [ar, Y.h - 0.01], ...Array.from({ length: 15 }, (_, i) => { const a = (i / 14) * Math.PI; return [Math.cos(a) * ar, Y.armTop - ar + Math.sin(a) * ar]; })]
      : [[-ar, Y.h - 0.01], [ar, Y.h - 0.01], [Y.armD * 0.36, Y.armTop - 0.012], [Y.armD * 0.2, Y.armTop], [-Y.armD * 0.2, Y.armTop], [-Y.armD * 0.36, Y.armTop - 0.012]];
    const armGeo = extrude(armPts, Y.armT, 0.003), inlayGeo = new THREE.CapsuleGeometry(ar * 0.22, ar * 0.9, 4, 12);
    const headGeo = loft(B.head, 48), lensGeo = new THREE.CircleGeometry(B.lensR, 40);
    const domeGeo = new THREE.SphereGeometry(domeR, 32, 10, 0, Math.PI * 2, 0, Math.asin(Math.min(1, B.lensR / domeR)));
    const blockGeo = new THREE.TorusGeometry(B.ringR, 0.0055, 8, 10, Math.PI / 4 - 0.06);   // one of 8 pixel-ring blocks
    for (let i = 0; i < B.headCount; i++) {
      const pan = new THREE.Group(); pan.position.set((i - (B.headCount - 1) / 2) * B.headPitch, B.panY, 0); root.add(pan);
      add(pan, new THREE.CylinderGeometry(Y.d * 0.42, Y.d * 0.46, 0.008, 32), M.trim, 0, -0.002, 0);
      add(pan, bridgeGeo, M.body);
      for (const sx of [-1, 1]) {
        add(pan, armGeo, M.body, sx * Y.armX, 0, 0).rotation.y = Math.PI / 2;
        if (Y.round) { const inl = add(pan, inlayGeo, M.trim, sx * (Y.armX + Y.armT / 2), B.tiltY - ar * 0.1, 0); inl.rotation.x = Math.PI / 2 - 0.5; inl.scale.x = 0.12; }   // oblong inlay on each arm plate
      }
      const tilt = new THREE.Group(); tilt.position.y = B.tiltY; pan.add(tilt);
      add(tilt, headGeo, M.body); sink(tilt);
      for (const sx of [-1, 1]) { const hub = add(tilt, new THREE.CylinderGeometry(0.016, 0.016, 0.006, 20), M.trim, sx * (Y.armX - Y.armT / 2 - 0.004), 0, 0); hub.rotation.z = Math.PI / 2; }
      const lensMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: true });
      const lens = add(tilt, lensGeo, lensMat, 0, B.lensY - 0.003, 0); lens.rotation.x = -Math.PI / 2; lens.castShadow = false;
      add(tilt, domeGeo, M.glass, 0, B.lensY - (domeR - sag) + 0.001, 0).castShadow = false;
      const ring = [];
      for (let k = 0; k < 8; k++) {
        const m = add(tilt, blockGeo, new THREE.MeshBasicMaterial({ color: 0x050505 }), 0, headTop + 0.002, 0);
        m.rotation.set(Math.PI / 2, 0, k * Math.PI / 4 + 0.03); m.castShadow = false; ring.push(m.material);
      }
      heads.push({ pan, tilt, lensMat, ring });
    }
    root.traverse(o => { if (o.isMesh) o.userData.fixture = true; });
    return { root, base, heads, buttons, knob, rocker, led, lcd, lcdTex, lcdMat, clickables, M, dim: { lensY: B.lensY + sag, lensR: B.lensR, H: B.H } };
  }

  const tt = B.turntable;
  add(base, new THREE.CylinderGeometry(tt.r, tt.r + 0.004, tt.h, 48), M.trim, 0, b.top + tt.h / 2, 0);

  /* ── yoke (pan) ── */
  const pan = new THREE.Group(); pan.position.y = B.panY; root.add(pan);
  if (B.yoke) {                                                 // one-piece U yoke
    const Y = B.yoke, W2 = Y.W / 2, xi = W2 - Y.t, r = Y.armW / 2, cy = Y.top - r, prof = [[-r, Y.h2 - 0.014], [r, Y.h2 - 0.014]];
    const inner = [];                                           // inner outline from the right arm down, across the floor, up the left arm
    if (Y.arch) { for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; inner.push([xi - Y.c + Math.cos(a) * Y.c, Y.yf + Y.c - Math.sin(a) * Y.c]); }
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; inner.push([-xi + Y.c - Math.sin(a) * Y.c, Y.yf + Y.c - Math.cos(a) * Y.c]); } }
    else inner.push([xi, Y.yf + Y.c], [xi - Y.c, Y.yf], [-xi + Y.c, Y.yf], [-xi, Y.yf + Y.c]);
    add(pan, extrude([[-Y.wb / 2, 0], [Y.wb / 2, 0], [W2, Y.h1], [W2, Y.h2], [xi, Y.h2], ...inner, [-xi, Y.h2], [-W2, Y.h2], [-W2, Y.h1]], Y.d, 0.01), M.body);
    if (Y.armR) { const q = Math.min(Y.armR, r);              // flat top with rounded corners
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push([r - q + Math.cos(a) * q, Y.top - q + Math.sin(a) * q]); }
      for (let i = 0; i <= 8; i++) { const a = Math.PI / 2 + (i / 8) * Math.PI / 2; prof.push([-r + q + Math.cos(a) * q, Y.top - q + Math.sin(a) * q]); }
    } else for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI; prof.push([Math.cos(a) * r, cy + Math.sin(a) * r]); }
    for (const sx of [-1, 1]) {
      const ax = sx * (W2 - Y.t / 2);
      add(pan, extrude(prof, Y.t, 0.011), M.body, ax, 0, 0).rotation.y = Math.PI / 2;
      if (Y.inlay !== false) add(pan, extrude([[-r * 0.5, Y.h2 + 0.012], [r * 0.5, Y.h2 + 0.012], [r * 0.5, cy], [-r * 0.5, cy]], 0.003, 0.001), M.trim, ax + sx * (Y.t / 2 + 0.0008), 0, 0).rotation.y = Math.PI / 2;   // side inlay (logo strip)
      const hub = add(pan, new THREE.CylinderGeometry(0.024, 0.024, 0.012, 24), M.trim, ax - sx * (Y.t / 2 + 0.003), B.tiltY, 0); hub.rotation.z = Math.PI / 2;
      const xo = ax + sx * (Y.t / 2 + 0.0026);
      for (const y of [Y.h2 + 0.024, cy + r * 0.2]) for (const sz of [-1, 1]) cylX(pan, 0.003, 0.003, M.metal, xo - sx * 0.001, y, sz * r * 0.74);   // screws
      if (B.logo && B.logo.arm && B.logo.armStyle === 'badge') {   // horizontal badge below the tilt axis
        const bw = r * 1.2, bh = r * 0.5, by = B.tiltY - r * 0.75;
        add(pan, new THREE.BoxGeometry(0.003, bh, bw), M.trim, xo - sx * 0.001, by, 0);
        const lb = label(B.logo.arm, bw * 0.92, bh * 0.8, B.logo.color); lb.position.set(xo + sx * 0.0008, by, 0); lb.rotation.y = sx * Math.PI / 2; pan.add(lb);
      } else if (B.logo && B.logo.arm) { const len = (cy - Y.h2) * 0.72, lb = label(B.logo.arm, len, r * 0.62, B.logo.color); lb.position.set(xo, (Y.h2 + cy) / 2 + 0.006, 0); lb.rotation.y = sx * Math.PI / 2; lb.rotateZ(Math.PI / 2); pan.add(lb); }
    }
  }
  if (!B.yoke) add(pan, loft(B.bridge), M.body);
  const A = B.arm || { shape: [[0, 0]] }, topY = Math.max(...A.shape.map(p => p[1]));
  if (!B.yoke) for (const sx of [-1, 1]) {
    add(pan, extrude(A.shape, A.t, 0.006), M.body, sx * A.x, 0, 0).rotation.y = Math.PI / 2;
    const cap = add(pan, new THREE.CylinderGeometry(A.t * 0.85, A.t * 0.85, 0.004, 32), M.trim, sx * (A.x + A.t / 2 + 0.0015), B.tiltY, 0); cap.rotation.z = Math.PI / 2;
    add(pan, extrude([[-0.018, topY * 0.2], [0.018, topY * 0.2], [0.008, topY * 0.62], [-0.008, topY * 0.62]], 0.003, 0.001), M.trim, sx * (A.x + A.t / 2 + 0.0008), 0, 0).rotation.y = Math.PI / 2;   // side trim
    const hub = add(pan, new THREE.CylinderGeometry(0.022, 0.022, 0.012, 24), M.trim, sx * (A.x - A.t / 2 - 0.003), B.tiltY, 0); hub.rotation.z = Math.PI / 2;
  }

  /* ── head (tilt) ── */
  const tilt = new THREE.Group(); tilt.position.y = B.tiltY; pan.add(tilt);
  add(tilt, loft(B.head), M.body); sink(tilt);
  if (B.slots) for (const sz of [-1, 1]) for (let i = -B.slots.n; i <= B.slots.n; i++) add(tilt, new THREE.BoxGeometry(0.003, 0.024, 0.004), M.trim, i * B.slots.pitch, B.slots.y, sz * B.slots.z);   // cooling slots
  if (B.fins) for (let i = 0; i < B.fins.n; i++) {              // cooling fins around a round head
    const y = B.fins.y0 + (B.fins.y1 - B.fins.y0) * i / (B.fins.n - 1);
    add(tilt, new THREE.TorusGeometry(B.fins.r, 0.0035, 8, 64), M.trim, 0, y, 0).rotation.x = Math.PI / 2;
  }
  for (const g of B.rings || []) add(tilt, new THREE.TorusGeometry(g.r, g.tube ?? 0.004, 10, 64), M.trim, 0, g.y, 0).rotation.x = Math.PI / 2;
  if (B.ribs) for (let i = 0; i < B.ribs.n; i++) {              // vertical cooling ribs
    const a = (i / B.ribs.n) * Math.PI * 2;
    add(tilt, new THREE.BoxGeometry(0.0035, B.ribs.y1 - B.ribs.y0, 0.007), M.trim, Math.cos(a) * B.ribs.r, (B.ribs.y0 + B.ribs.y1) / 2, Math.sin(a) * B.ribs.r).rotation.y = -a + Math.PI / 2;
  }
  for (const v of B.vents || []) for (const s of [-1, 1]) for (let i = 0; i < v.n; i++) {   // slotted vent panels
    const u = (i - (v.n - 1) / 2) * v.pitch;
    if (v.side === 'x') add(tilt, new THREE.BoxGeometry(0.004, v.h, v.pitch * 0.5), M.trim, s * v.off, v.y, u);
    else add(tilt, new THREE.BoxGeometry(v.pitch * 0.5, v.h, 0.004), M.trim, u, v.y, s * v.off);
  }
  if (B.hood) { const hd = add(tilt, new THREE.CylinderGeometry(B.hood.r1, B.hood.r0, B.hood.y1 - B.hood.y0, 56, 1, true), M.body.clone(), 0, (B.hood.y0 + B.hood.y1) / 2, 0); hd.material.side = THREE.DoubleSide; }
  if (B.shield) for (const sz of [-1, 1]) add(tilt, extrude(B.shield.pts, 0.008, 0.003), M.trim, 0, 0, sz * B.shield.z);   // raised cover panel
  if (B.plate) for (const sz of [-1, 1]) {                       // name plate, lettered when the model gives a logo
    const [pw, ph] = (B.logo && B.logo.headSize) || [0.04, 0.02];
    add(tilt, new THREE.BoxGeometry(pw, ph, 0.003), M.trim, 0, B.plate.y, sz * B.plate.z);
    for (const sx of [-1, 1]) cylZ(tilt, 0.0025, 0.002, M.metal, sx * (pw / 2 + 0.008), B.plate.y, sz * (B.plate.z + 0.0005), 10).castShadow = false;
    if (B.logo && B.logo.head) { const lb = label(B.logo.head, pw * 0.94, ph * 0.86, B.logo.color); lb.position.set(0, B.plate.y, sz * (B.plate.z + 0.0021)); if (sz < 0) lb.rotation.y = Math.PI; tilt.add(lb); }
  }
  const headTop = B.head[B.head.length - 1].y;
  const ring = add(tilt, new THREE.CylinderGeometry(B.ringR, B.ringR + 0.002, 0.012, 56, 1, true), M.trim.clone(), 0, headTop + 0.004, 0); ring.material.side = THREE.DoubleSide;
  add(tilt, new THREE.TorusGeometry(B.ringR - 0.0035, 0.0045, 12, 56), M.trim, 0, headTop + 0.0095, 0).rotation.x = Math.PI / 2;
  // lens: emissive rear face (shows the beam section) + front glass
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: true });
  const lens = add(tilt, new THREE.CircleGeometry(B.lensR, 48), lensMat, 0, B.lensY - 0.004, 0); lens.rotation.x = -Math.PI / 2; lens.castShadow = false;
  const domeR = B.lensR * 1.67;                                 // spherical cap whose rim sits on the lens ring
  const dome = add(tilt, new THREE.SphereGeometry(domeR, 40, 12, 0, Math.PI * 2, 0, Math.asin(Math.min(1, B.lensR / domeR))), M.glass, 0, B.lensY - Math.sqrt(domeR * domeR - B.lensR * B.lensR) + 0.001, 0); dome.castShadow = false;

  root.traverse(o => { if (o.isMesh) o.userData.fixture = true; });
  heads.push({ pan, tilt, lensMat, ring: [] });
  return { root, base, heads, buttons, knob, rocker, led, lcd, lcdTex, lcdMat, lensMat, lens, clickables, M, dim: { lensY: B.lensY + (domeR - Math.sqrt(domeR * domeR - B.lensR * B.lensR)), lensR: B.lensR, H: B.H } };
}
