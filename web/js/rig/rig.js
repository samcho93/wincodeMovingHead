// rig/rig.js — the truss rig of a stage: its pieces, their 3D shape and the points fixtures hang from.
//  Shared by the Stage Builder (rig.html), the Stage Editor (a stage file's `room` and `trusses`) and the simulator.
//
//  Piece: { id, name, type, x, z, y, rot, size, … }       metres and degrees; x / z = its middle (centre of a circle or arc)
//    straight  len            horizontal, along X when rot = 0 (rot 90 = running upstage–downstage)
//    circle    r              horizontal ring
//    arc       r, angle       part of a ring, `angle` degrees wide, bulging upstage when rot = 0
//    upright   h              vertical tower standing at y (0 = on the floor) with a base plate: legs of a ground support
//  y = height of the lower chords of a horizontal piece: fixtures hang there. size = distance between the chords.
//  A piece without `type` is a straight one (stage files written before there were other shapes).
//
//  Rig file: { app: 'wmh-rig', version: 1, name, room: { w, d, h }, trusses: [piece] }
//  The builder keeps its current rig in localStorage[RIG_LS]; that is also how the other pages fetch "the rig from the builder".
import * as THREE from 'three';

export const RIG_LS = 'wmh.rig.v1';
export const SIZES = [[0.22, 'F22 · 220 mm'], [0.29, 'F34 · 290 mm'], [0.4, 'F44 · 400 mm'], [0.52, 'F52 · 520 mm']];
export const TYPES = [['straight', 'Straight'], ['upright', 'Upright (tower)'], ['circle', 'Circle'], ['arc', 'Arc']];
export const DEFAULT_ROOM = { w: 16, d: 14, h: 7 };
export const ROOM_LIMITS = { w: [6, 60], d: [6, 60], h: [3, 20] };
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = v => Math.round(v * 100) / 100;

/** room with every field, inside the limits; `back` = z of the back wall (the stage front stays near z = 0 … +) */
export function roomOf(r) {
  const o = {}; for (const k of ['w', 'd', 'h']) o[k] = clamp(+((r || {})[k]) || DEFAULT_ROOM[k], ...ROOM_LIMITS[k]);
  o.back = -r2(o.d * 3 / 7); return o;
}
/** fill in what a piece leaves out (in place) */
export function norm(p) {
  p.type = TYPES.some(t => t[0] === p.type) ? p.type : 'straight';
  p.x = +p.x || 0; p.z = +p.z || 0; p.rot = +p.rot || 0; p.size = +p.size || 0.29;
  if (p.type === 'upright') { p.y = +p.y || 0; p.h = Math.max(0.5, +p.h || 4.6); }
  else { p.y = p.y == null ? 4.6 : +p.y; if (p.type === 'straight') p.len = Math.max(0.5, +p.len || 6); else { p.r = Math.max(0.5, +p.r || 2.5); if (p.type === 'arc') p.angle = clamp(+p.angle || 180, 10, 350); } }
  if (!p.name) p.name = `${TYPES.find(t => t[0] === p.type)[1].replace(/ .*/, '')} ${p.id}`;
  return p;
}
export const mountable = p => p.type !== 'upright';
export const closed = p => p.type === 'circle';
export const lengthOf = p => (p.type === 'straight' ? p.len : p.type === 'circle' ? 2 * Math.PI * p.r : p.type === 'arc' ? p.r * rad(p.angle) : p.h);
export const describe = p => (p.type === 'straight' ? `${r2(p.len)} m` : p.type === 'circle' ? `⌀ ${r2(p.r * 2)} m` : p.type === 'arc' ? `r ${r2(p.r)} m · ${Math.round(p.angle)}°` : `${r2(p.h)} m high`) + (p.type === 'upright' ? '' : ` @ ${r2(p.y)} m`);

/** local (x, z) of the centre line at t = 0..1, and the local angle of travel */
function local(p, t) {
  if (p.type === 'straight') return [(t - 0.5) * p.len, 0, 0];
  const a = p.type === 'circle' ? t * 2 * Math.PI : -Math.PI / 2 + (t - 0.5) * rad(p.angle);
  return [Math.cos(a) * p.r, Math.sin(a) * p.r, Math.atan2(-Math.cos(a), -Math.sin(a))];
}
const world = (p, lx, lz) => { const c = Math.cos(rad(p.rot)), s = Math.sin(rad(p.rot)); return [p.x + lx * c + lz * s, p.z - lx * s + lz * c]; };
/** where a fixture hangs at t = 0..1 along a piece: { x, y, z, yaw } — yaw (degrees) turns a fixture's X along the truss */
export function pointAt(p, t) {
  if (p.type === 'upright') return { x: p.x, y: p.y + p.h, z: p.z, yaw: p.rot };
  const [lx, lz, a] = local(p, t), [x, z] = world(p, lx, lz);
  return { x, y: p.y, z, yaw: deg(a) + p.rot };
}
/** the t of the point of a piece that is nearest to (x, z) */
export function nearestT(p, x, z) {
  const c = Math.cos(rad(p.rot)), s = Math.sin(rad(p.rot)), dx = x - p.x, dz = z - p.z, lx = dx * c - dz * s, lz = dx * s + dz * c;   // into the piece's own frame
  if (p.type === 'straight') return clamp(lx / p.len + 0.5, 0, 1);
  const a = Math.atan2(lz, lx);
  if (p.type === 'circle') return ((a / (2 * Math.PI)) % 1 + 1) % 1;
  let d = a + Math.PI / 2; d = Math.atan2(Math.sin(d), Math.cos(d));   // angle from the middle of the arc
  return clamp(d / rad(p.angle) + 0.5, 0, 1);
}
/** the two ends of an open piece (or the foot of an upright) in the world: [[x, z] …] — what other pieces snap to */
export function endsOf(p) {
  if (p.type === 'upright') return [[p.x, p.z]];
  if (p.type === 'circle') return [0, 0.25, 0.5, 0.75].map(t => { const q = pointAt(p, t); return [q.x, q.z]; });
  return [0, 1].map(t => { const q = pointAt(p, t); return [q.x, q.z]; });
}
/** keep fixtures a little away from the ends of an open piece */
export const clampT = (p, t) => (closed(p) ? ((t % 1) + 1) % 1 : clamp(t, Math.min(0.5, 0.2 / lengthOf(p)), 1 - Math.min(0.5, 0.2 / lengthOf(p))));

/* ── 3D ── */
const trussMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.9 });
const plateMat = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.5, metalness: 0.7 });
/** one geometry made of round bars: bar(a, b, radius) adds a bar between two points */
function bars() {
  const pos = [], idx = [], N = 7, A = new THREE.Vector3(), B = new THREE.Vector3(), d = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3();
  return {
    bar(a, b, r) {
      A.fromArray(a); B.fromArray(b); d.subVectors(B, A); if (d.lengthSq() < 1e-8) return; d.normalize();
      u.set(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0).cross(d).normalize(); v.crossVectors(d, u);
      const o = pos.length / 3;
      for (const P of [A, B]) for (let i = 0; i < N; i++) { const a2 = i * 2 * Math.PI / N, cx = Math.cos(a2) * r, sy = Math.sin(a2) * r; pos.push(P.x + u.x * cx + v.x * sy, P.y + u.y * cx + v.y * sy, P.z + u.z * cx + v.z * sy); }
      for (let i = 0; i < N; i++) { const j = (i + 1) % N; idx.push(o + i, o + N + i, o + j, o + j, o + N + i, o + N + j); }
    },
    geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; },
  };
}
/** A piece as a THREE.Group at its place. Horizontal pieces: origin of the section = middle of the lower chords. */
export function buildPiece(p) {
  const g = new THREE.Group(), B = bars(), s = p.size, rc = chordR(s), rb = rc * 0.5;
  // stations along the piece: [four corner points], in the piece's own frame
  const st = [];
  if (p.type === 'upright') {
    const n = Math.max(1, Math.round(p.h / 0.5));
    for (let i = 0; i <= n; i++) { const y = p.h * i / n; st.push([[-s / 2, y, -s / 2], [s / 2, y, -s / 2], [s / 2, y, s / 2], [-s / 2, y, s / 2]]); }
  } else {
    const L = lengthOf(p), n = Math.max(p.type === 'straight' ? 1 : 8, Math.round(L / (p.type === 'straight' ? 0.5 : 0.4))), last = closed(p) ? n - 1 : n;
    for (let i = 0; i <= last; i++) {
      const [x, z, a] = local(p, i / n), nx = Math.sin(a), nz = Math.cos(a);   // (nx, nz): across the truss
      st.push([[x - nx * s / 2, 0, z - nz * s / 2], [x + nx * s / 2, 0, z + nz * s / 2], [x + nx * s / 2, s, z + nz * s / 2], [x - nx * s / 2, s, z - nz * s / 2]]);
    }
  }
  const bays = closed(p) ? st.length : st.length - 1;
  for (let i = 0; i < st.length; i++) for (let k = 0; k < 4; k++) B.bar(st[i][k], st[i][(k + 1) % 4], rb);                       // a frame at every station
  for (let i = 0; i < bays; i++) { const a = st[i], b = st[(i + 1) % st.length];
    for (let k = 0; k < 4; k++) { B.bar(a[k], b[k], rc); B.bar(i % 2 ? a[k] : a[(k + 1) % 4], i % 2 ? b[(k + 1) % 4] : b[k], rb); } }   // chords and one diagonal per face
  const mesh = new THREE.Mesh(B.geometry(), trussMat); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
  if (p.type === 'upright') { const plate = new THREE.Mesh(new THREE.BoxGeometry(s + 0.4, 0.03, s + 0.4), plateMat); plate.position.y = 0.015; plate.castShadow = true; plate.receiveShadow = true; g.add(plate); }
  g.position.set(p.x, p.y, p.z); g.rotation.y = rad(p.rot);
  g.traverse(o => { o.userData.piece = p.id; });
  return g;
}
const chordR = s => Math.max(0.016, s * 0.086);
/** how far below the lower chords (their centre line) the mounting face of a hung fixture is */
export const hangDrop = p => chordR(p.size) + 0.075;
const clampMat = new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.45, metalness: 0.6 });
/** What holds a fixture on a horizontal piece: a bar across the two lower chords with a hook round each, and a spigot down
 *  to the fixture. Origin = the point on the centre line (pointAt), X along the truss; reaches down to −hangDrop. */
export function buildClamp(p) {
  const g = new THREE.Group(), s = p.size, rc = chordR(s), drop = hangDrop(p), add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, clampMat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add(new THREE.BoxGeometry(0.05, 0.014, s + rc * 2 + 0.03), 0, -rc - 0.007, 0);                                   // bar under both chords
  for (const sz of [-1, 1]) add(new THREE.TorusGeometry(rc + 0.006, 0.008, 8, 20), 0, 0, sz * s / 2).rotation.y = Math.PI / 2;   // a coupler round each chord
  add(new THREE.CylinderGeometry(0.014, 0.014, drop - rc - 0.014, 12), 0, -(drop + rc + 0.014) / 2, 0);            // spigot
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20), 0, -drop + 0.006, 0);                                    // plate on the fixture
  return g;
}
export function disposePiece(g) { g.traverse(o => o.geometry && o.geometry.dispose()); }

/* ── editing helpers ── */
export const nextId = list => 1 + list.reduce((m, t) => Math.max(m, t.id || 0), 0);
export function addPiece(list, props) { const p = norm(Object.assign({ id: nextId(list) }, props)); list.push(p); return p; }
/** uprights from the floor up to a horizontal piece: under both ends of a straight piece or an arc, four under a circle */
export function legsFor(list, p) {
  if (!mountable(p)) return [];
  const have = list.filter(q => q.type === 'upright');
  return endsOf(p).filter(([x, z]) => !have.some(q => Math.hypot(q.x - x, q.z - z) < 0.15)).map(([x, z]) => addPiece(list, { type: 'upright', x: r2(x), z: r2(z), y: 0, h: r2(p.y + p.size), size: p.size, name: `Leg ${nextId(list)}` }));
}
/** share n fixtures over the pieces by their length: [{ piece, t }] in order, evenly spaced on each piece */
export function distribute(pieces, n) {
  const list = pieces.filter(mountable); if (!list.length || n < 1) return [];
  const total = list.reduce((s, p) => s + lengthOf(p), 0), share = list.map(p => lengthOf(p) / total * n), count = share.map(Math.floor);
  let left = n - count.reduce((a, b) => a + b, 0);
  for (const i of share.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).map(x => x[1])) { if (left-- <= 0) break; count[i]++; }
  const out = [];
  list.forEach((p, i) => { for (let k = 0; k < count[i]; k++) out.push({ piece: p, t: closed(p) ? k / count[i] : (k + 0.5) / count[i] }); });
  return out;
}

/* ── rig files ── */
export const blankRig = () => ({ app: 'wmh-rig', version: 1, name: 'New rig', room: { ...DEFAULT_ROOM }, trusses: [] });
/** a rig file, or the room and trusses of a stage file → a clean rig */
export function readRig(f) {
  if (!f || (f.app !== 'wmh-rig' && f.app !== 'wmh-stage') || !Array.isArray(f.trusses)) throw new Error('Not a rig file');
  const r = roomOf(f.room), trusses = JSON.parse(JSON.stringify(f.trusses)).map(norm);
  return { app: 'wmh-rig', version: 1, name: f.name || 'Rig', room: { w: r.w, d: r.d, h: r.h }, trusses };
}
export const savedRig = () => { try { const f = JSON.parse(localStorage.getItem(RIG_LS) || 'null'); return f ? readRig(f) : null; } catch (e) { return null; } };
export const keepRig = rig => { try { localStorage.setItem(RIG_LS, JSON.stringify(rig)); } catch (e) {} };

/* ── ready-made rigs ── */
const rig = (name, room, list) => { const trusses = []; for (const p of list) addPiece(trusses, p); return { app: 'wmh-rig', version: 1, name, room, trusses }; };
const legs = (pts, h, size = 0.29) => pts.map(([x, z], i) => ({ type: 'upright', x, z, y: 0, h, size, name: `Leg ${i + 1}` }));
export const PRESETS = [
  { id: 'two', name: 'Front and back truss', about: 'Two straight trusses across the stage — the classic club or theatre rig.',
    build: () => rig('Front and back truss', { w: 16, d: 14, h: 7 }, [{ name: 'Front truss', x: 0, z: 3, y: 4.8, len: 12 }, { name: 'Back truss', x: 0, z: -3.5, y: 4.6, len: 12 }]) },
  { id: 'goal', name: 'Goalpost', about: 'One truss on two towers: the smallest ground support.',
    build: () => rig('Goalpost', { w: 12, d: 10, h: 6 }, [{ name: 'Truss', x: 0, z: -1, y: 4, len: 8 }, ...legs([[-4, -1], [4, -1]], 4.29)]) },
  { id: 'box', name: 'Ground support 10 × 8 m', about: 'A rectangle of trusses on four towers with one truss across the middle.',
    build: () => rig('Ground support 10 × 8 m', { w: 18, d: 16, h: 8 }, [{ name: 'Front', x: 0, z: 4, y: 5.5, len: 10, size: 0.4 }, { name: 'Back', x: 0, z: -4, y: 5.5, len: 10, size: 0.4 }, { name: 'Left', x: -5, z: 0, y: 5.5, len: 8, rot: 90, size: 0.4 },
      { name: 'Right', x: 5, z: 0, y: 5.5, len: 8, rot: 90, size: 0.4 }, { name: 'Mid', x: 0, z: 0, y: 5.5, len: 10 }, ...legs([[-5, 4], [5, 4], [-5, -4], [5, -4]], 5.9, 0.4)]) },
  { id: 'circle', name: 'Circle and front truss', about: 'A 6 m ring over the stage and a straight front truss.',
    build: () => rig('Circle and front truss', { w: 16, d: 14, h: 7.5 }, [{ type: 'circle', name: 'Circle', x: 0, z: -0.5, y: 5.2, r: 3 }, { name: 'Front truss', x: 0, z: 4.5, y: 5, len: 12 }]) },
  { id: 'arch', name: 'Arc and back truss', about: 'A half-round arc behind the performers, a straight truss in front.',
    build: () => rig('Arc and back truss', { w: 18, d: 14, h: 7.5 }, [{ type: 'arc', name: 'Arc', x: 0, z: 1.5, y: 5, r: 5, angle: 180 }, { name: 'Front truss', x: 0, z: 4.5, y: 5.2, len: 12 }, ...legs([[-5, 1.5], [5, 1.5]], 5.29)]) },
  { id: 'roof', name: 'Roof grid 12 × 9 m', about: 'Three trusses across and two along, on six towers: a festival-style roof.',
    build: () => rig('Roof grid 12 × 9 m', { w: 22, d: 18, h: 9 }, [{ name: 'Front', x: 0, z: 4.5, y: 6.5, len: 12, size: 0.4 }, { name: 'Mid', x: 0, z: 0, y: 6.5, len: 12, size: 0.4 }, { name: 'Back', x: 0, z: -4.5, y: 6.5, len: 12, size: 0.4 },
      { name: 'Left', x: -6, z: 0, y: 6.5, len: 9, rot: 90, size: 0.4 }, { name: 'Right', x: 6, z: 0, y: 6.5, len: 9, rot: 90, size: 0.4 }, ...legs([[-6, 4.5], [6, 4.5], [-6, 0], [6, 0], [-6, -4.5], [6, -4.5]], 6.9, 0.4)]) },
];
