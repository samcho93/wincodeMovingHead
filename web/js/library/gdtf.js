// library/gdtf.js — GDTF fixture file (.gdtf: a zip with description.xml) → neutral description (desc.js). Browser only.
//  GDTF (General Device Type Format, DIN SPEC 15800) is the open fixture format read by grandMA3, Vectorworks, Capture,
//  Depence and others. What is read here: name and manufacturer, wheels, and every DMX mode with its channels,
//  channel functions and channel sets; the 3D models (3DS or binary glTF) and the geometry tree that assembles them,
//  simplified into `shape` (end of this file). Not read: materials, a channel repeated through geometry references
//  (pixel cells: it appears once), emitters' spectra, macros.

/* ── zip (stored or deflated entries) ── */
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), out = new Map();
  let e = buf.byteLength - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a zip archive');
  let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true);
  for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), data = u8.subarray(ds, ds + csize);
    out.set(name, async () => (method === 0 ? data : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())));
    p += 46 + nl + xl + cl;
  }
  return out;
}

/* ── helpers ── */
const f = (el, a, d = 0) => { const v = parseFloat(el.getAttribute(a)); return Number.isFinite(v) ? v : d; };
/** "128/1" or "32768/2" → value on the coarse byte */
const dmx = s => { const m = /^(\d+)\/(\d+)$/.exec(s || ''); if (!m) return parseInt(s, 10) || 0; return +m[2] > 1 ? Math.floor(+m[1] / 256 ** (+m[2] - 1)) : +m[1]; };
/** CIE xyY "0.3127,0.3290,100" → RGB with the largest component 1 */
function xyY(s) {
  const [x, y] = (s || '').split(',').map(Number); if (!(y > 0)) return [1, 1, 1];
  const X = x / y, Z = (1 - x - y) / y, lin = [3.2406 * X - 1.5372 - 0.4986 * Z, -0.9689 * X + 1.8758 + 0.0415 * Z, 0.0557 * X - 0.204 + 1.057 * Z].map(v => Math.max(0, v));
  const m = Math.max(...lin) || 1; return lin.map(v => Math.pow(v / m, 1 / 2.2));
}
const ADD = { R: 'Red', G: 'Green', B: 'Blue', W: 'White', WW: 'Warm White', CW: 'Cold White', A: 'Amber', UV: 'UV', L: 'Lime', C: 'Cyan', M: 'Magenta', Y: 'Yellow', RY: 'Amber', GY: 'Lime', GC: 'Cyan', BC: 'Cyan', BM: 'Magenta', RM: 'Magenta',
  Red: 'Red', Green: 'Green', Blue: 'Blue', Cyan: 'Cyan', Magenta: 'Magenta', Yellow: 'Yellow', Quality: null };
const isOpen = n => /^(open|off|none|no[ _-]?\w*|white|empty)$/i.test((n || '').trim());

export async function fromGDTF(file) {
  const zip = await unzip(await file.arrayBuffer()), get = zip.get('description.xml');
  if (!get) throw new Error('description.xml is missing — not a GDTF file');
  const xml = new TextDecoder().decode(await get()), D = fromGDTFxml(xml, file.name);
  try { const shape = await shapeOf(new DOMParser().parseFromString(xml, 'application/xml'), zip); if (shape) D.shape = shape; }
  catch (e) { console.warn('GDTF 3D model not used:', e.message); }   // the fixture still works, with a generated body
  return D;
}
export function fromGDTFxml(xml, fileName = '') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'), FT = doc.querySelector('FixtureType');
  if (!FT || doc.querySelector('parsererror')) throw new Error('description.xml could not be read');
  const kids = (el, tag) => (el ? [...el.children].filter(c => c.tagName === tag) : []), kid = (el, tag) => kids(el, tag)[0];
  const name = FT.getAttribute('LongName') || FT.getAttribute('Name') || fileName.replace(/\.gdtf$/i, ''), manufacturer = FT.getAttribute('Manufacturer') || 'GDTF';
  const wheels = kids(kid(FT, 'Wheels'), 'Wheel').map(w => ({ name: w.getAttribute('Name'), slots: kids(w, 'Slot').map(s => ({ type: 'Other', name: s.getAttribute('Name') || '', color: s.getAttribute('Color') })) }));
  const wheelIx = n => wheels.findIndex(w => w.name === n), wheelOf = {};   // wheelOf: 'Gobo1' → wheel index

  const channels = {}, modes = [];
  const fresh = k => { let x = k, i = 2; while (x in channels) x = k + '_' + i++; return x; };
  const sig = c => JSON.stringify([c.name, c.caps]);
  for (const mode of kids(kid(FT, 'DMXModes'), 'DMXMode')) {
    const list = [];
    for (const ch of kids(kid(mode, 'DMXChannels'), 'DMXChannel')) {
      const offs = (ch.getAttribute('Offset') || '').split(',').map(Number).filter(n => n > 0); if (!offs.length) continue;   // virtual channel
      const fns = kids(ch, 'LogicalChannel').flatMap(lc => kids(lc, 'ChannelFunction').map(fn => ({ fn, attr: fn.getAttribute('Attribute') && fn.getAttribute('Attribute') !== 'NoFeature' ? fn.getAttribute('Attribute') : lc.getAttribute('Attribute') })))
        .sort((a, b) => dmx(a.fn.getAttribute('DMXFrom')) - dmx(b.fn.getAttribute('DMXFrom')));
      if (!fns.length) continue;
      const caps = [];
      fns.forEach(({ fn, attr }, i) => {
        const a = dmx(fn.getAttribute('DMXFrom')), b = i + 1 < fns.length ? dmx(fns[i + 1].fn.getAttribute('DMXFrom')) - 1 : 255; if (b < a) return;
        const sets = kids(fn, 'ChannelSet').map(s => ({ name: s.getAttribute('Name') || '', a: Math.max(a, dmx(s.getAttribute('DMXFrom'))), slot: parseInt(s.getAttribute('WheelSlotIndex'), 10) || 0 })).sort((x, y) => x.a - y.a);
        sets.forEach((s, k) => { s.b = k + 1 < sets.length ? sets[k + 1].a - 1 : b; });
        const p0 = f(fn, 'PhysicalFrom', 0), p1 = f(fn, 'PhysicalTo', 1), fname = fn.getAttribute('Name') || attr, w = wheelIx(fn.getAttribute('Wheel'));
        const one = (type, s, e, extra, aa = a, bb = b, label = fname) => caps.push(Object.assign({ a: aa, b: bb, type, label, s, e }, extra));
        const perSet = make => { if (!sets.length) return false; if (sets[0].a > a) one('Other', 0, 0, null, a, sets[0].a - 1); for (const s of sets) make(s); return true; };
        let m;
        if (attr === 'Dimmer') one('Intensity', 0, 1);
        else if (attr === 'Pan' || attr === 'Tilt') one(attr, p0, p1);
        else if (attr === 'PanRotate') one('PanContinuous', p0, p1);
        else if ((m = /^Color(?:Add|Sub|RGB)_(\w+)$/.exec(attr)) && ADD[m[1]]) one('ColorIntensity', 0, 1, { color: ADD[m[1]] });
        else if ((m = /^(Color|Gobo)(\d)(WheelIndex|SelectShake|SelectSpin|WheelShake|WheelRandom|WheelAudio)?$/.exec(attr)) && w >= 0) {
          wheelOf[m[1] + m[2]] = w; const kind = m[1] === 'Color' ? 'Color' : 'Gobo', n = wheels[w].slots.length;
          wheels[w].slots.forEach(s => { s.type = isOpen(s.name) ? 'Open' : kind; });
          if (!perSet(s => (s.slot ? one('WheelSlot', s.slot - 1, s.slot - 1, { wheel: w }, s.a, s.b, s.name || `Slot ${s.slot}`) : one('Other', 0, 0, null, s.a, s.b, s.name)))) one('WheelSlot', 0, n - 1, { wheel: w });
        }
        else if ((m = /^(Color|Gobo)(\d)WheelSpin$/.exec(attr))) { const wi = w >= 0 ? w : wheelOf[m[1] + m[2]] ?? -1; if (wi >= 0) one('WheelRotation', p0 / 360 * wheels[wi].slots.length, p1 / 360 * wheels[wi].slots.length, { wheel: wi }); else one('Other', 0, 0); }
        else if ((m = /^Gobo(\d)Pos$/.exec(attr))) one('SlotRotation', p0, p1, { wheel: wheelOf['Gobo' + m[1]] ?? -1, angle: true, gobo: +m[1] });
        else if ((m = /^Gobo(\d)PosRotate$/.exec(attr))) one('SlotRotation', p0 / 360, p1 / 360, { wheel: wheelOf['Gobo' + m[1]] ?? -1, gobo: +m[1] });
        else if (/^Shutter\d$/.test(attr)) { const fx = n => (/clos|black/i.test(n) ? 'closed' : /open/i.test(n) ? 'open' : null);
          if (!perSet(s => one('Shutter', 0, 0, { fx: fx(s.name) || fx(fname) || 'open' }, s.a, s.b, s.name || fname))) one('Shutter', 0, 0, { fx: fx(fname) || (p0 === p1 && p0 <= 0 ? 'closed' : 'open') }); }
        else if ((m = /^Shutter\dStrobe(\w*)$/.exec(attr))) one('Shutter', Math.abs(p0) || 1, Math.abs(p1) || 20, { fx: /Random/.test(m[1]) ? 'random' : /PulseOpen/.test(m[1]) ? 'fadein' : /Pulse/.test(m[1]) ? 'pulse' : 'strobe' });
        else if (attr === 'Zoom') one('Zoom', p0, p1);
        else if (/^Focus\d$/.test(attr)) one('Focus', 0, 1);
        else if (/^Frost\d$/.test(attr)) one('Frost', p0 >= 0 && p1 <= 1 ? p0 : 0, p0 >= 0 && p1 <= 1 ? p1 : 1);
        else if (/^Prism\d$/.test(attr)) { if (!perSet(s => one(isOpen(s.name) ? 'Other' : 'Prism', 0, 0, null, s.a, s.b, s.name || fname))) { if (isOpen(fname)) one('Other', 0, 0); else if (b - a > 200) { const mid = (a + b) >> 1; one('Other', 0, 0, null, a, mid, 'Prism off'); one('Prism', 0, 0, null, mid + 1, b, 'Prism on'); } else one('Prism', 0, 0); } }
        else if (/^Prism\dPosRotate$/.test(attr)) one('PrismRotation', p0 / 360, p1 / 360);
        else if (/^Prism\dPos$/.test(attr)) one('PrismRotation', p0, p1, { angle: true });
        else one('Other', 0, 0);
      });
      const first = caps[0] && caps[0].type, geo = ch.getAttribute('Geometry') || '', label = (fns[0].attr || 'Channel') + (list.some(k => k && channels[k].attr === fns[0].attr) ? ` (${geo})` : '');
      const c = { name: label, attr: fns[0].attr, def: dmx(fns[0].fn.getAttribute('Default') || ch.getAttribute('Default') || (first === 'Pan' || first === 'Tilt' ? '128/1' : '0/1')), caps };
      // the same channel in another mode keeps its key; a different one with the same attribute gets its own
      const base = first === 'Pan' ? 'pan' : first === 'Tilt' ? 'tilt' : first === 'Intensity' ? 'dimmer' : (fns[0].attr || 'ch').replace(/[^A-Za-z0-9]+/g, '') || 'ch';
      let k = Object.keys(channels).find(x => (x === base || x.startsWith(base + '_')) && sig(channels[x]) === sig(c) && !list.includes(x));
      if (!k) { k = fresh(base); channels[k] = c; }
      list[offs[0] - 1] = k;
      offs.slice(1).forEach((o, i) => { let fk = i === 0 ? channels[k].fine : null; if (!fk || list.includes(fk)) { fk = fresh(k + 'Fine' + (i ? i + 1 : '')); channels[fk] = { name: `${label} fine${i ? ' ' + (i + 1) : ''}`, def: 0 }; if (i === 0) channels[k].fine = fk; } list[o - 1] = fk; });
    }
    for (let i = 0; i < list.length; i++) if (list[i] === undefined) list[i] = null;
    if (list.length) modes.push({ id: mode.getAttribute('Name') || `Mode ${modes.length + 1}`, label: `${mode.getAttribute('Name') || 'Mode'} (${list.length})`, channels: list });
  }
  if (!modes.length) throw new Error('The GDTF file has no DMX mode with channels');
  // gobo rotation channels name their wheel only through the attribute number: resolve now that every wheel is known
  for (const c of Object.values(channels)) { for (const x of c.caps || []) if (x.gobo) { if (x.wheel < 0) x.wheel = wheelOf['Gobo' + x.gobo] ?? -1; delete x.gobo; } delete c.attr; }
  for (const w of wheels) for (const s of w.slots) { if (s.type === 'Color') s.rgb = xyY(s.color); delete s.color; }
  const slug = `${manufacturer}/${name}`.toLowerCase().replace(/[^a-z0-9/]+/g, '-').replace(/^-|-$/g, '');
  const beam = doc.querySelector('Beam[BeamAngle]'), ba = beam ? parseFloat(beam.getAttribute('BeamAngle')) : NaN;   // the lamp geometry gives the beam angle of a fixture without zoom
  // outer size: the largest extent of the fixture's 3D models (metres; Length = X, Width = Y, Height = Z)
  const ext = a => Math.max(0, ...[...doc.querySelectorAll('Models > Model')].map(m => f(m, a))), mm = [ext('Length'), ext('Height'), ext('Width')].map(x => Math.round(x * 1000));
  return { id: `gdtf/${slug}`, source: 'gdtf', manufacturer, name, categories: [], lens: ba > 0 ? [ba, ba] : null, size: mm.every(x => x > 0) ? mm : null, pixels: null, wheels, channels, modes };
}

/* ── 3D model: the file's own meshes, assembled by its geometry tree ─────────────────────────────────────────────
 *  GDTF: Z up, metres, the fixture hangs from its origin and shines along −Z; pan turns round Z, tilt round X.
 *  Simulator (machine.js): Y up, the fixture stands on its origin and shines along +Y  →  (x, y, z) becomes (x, −z, y).
 *  Result (desc.shape, already in simulator coordinates, small enough to live in a stage file):
 *    { tris, panPos: [x, y, z], tiltPos: [x, y, z] (from the pan axis), lensY, lensR, size: [w, h, d],
 *      parts: { base, pan, tilt, lens } }   each part { n, p: base64 Int16 xyz over min..min+size, i: base64 Uint16, min, size }
 *  base = what stands still, pan = what turns with the pan axis, tilt = the head, lens = the meshes of the Beam geometries
 *  (they show the light). The meshes are simplified by vertex clustering to about MAX_TRIS triangles. */
const MAX_TRIS = 7000;
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c]; return o; };   // row-major
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const xf = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
/** "{a,b,c,x}{d,e,f,y}{g,h,i,z}{0,0,0,1}" → row-major 4 × 4 */
const matrix = s => { const n = (s || '').match(/-?\d+(\.\d+)?(e-?\d+)?/gi); return n && n.length >= 12 ? [...n.slice(0, 12).map(Number), 0, 0, 0, 1] : IDENT; };

/** binary glTF → triangles (flat xyz, GDTF axes: glTF is Y up, so (x, y, z) → (x, −z, y)) */
function readGLB(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a binary glTF');
  let p = 12, J = null, bin = null;
  while (p + 8 <= u8.length) { const len = dv.getUint32(p, true), type = dv.getUint32(p + 4, true), data = u8.subarray(p + 8, p + 8 + len); if (type === 0x4e4f534a) J = JSON.parse(new TextDecoder().decode(data)); else if (type === 0x004e4942 && !bin) bin = data; p += 8 + len; }
  if (!J || !bin) throw new Error('glTF without embedded data');
  if ((J.extensionsRequired || []).length) throw new Error('glTF needs ' + J.extensionsRequired.join(', '));
  const bd = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = i => {
    const a = J.accessors[i], bv = J.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType], stride = bv.byteStride || n * size, off = (bv.byteOffset || 0) + (a.byteOffset || 0), out = new Float64Array(a.count * n);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = bd[get](off + k * stride + c * size, true);
    return out;
  };
  const local = nd => {
    if (nd.matrix) { const m = nd.matrix; return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], 0, 0, 0, 1]; }   // column-major → row-major
    const [x, y, z, w] = nd.rotation || [0, 0, 0, 1], [sx, sy, sz] = nd.scale || [1, 1, 1], [tx, ty, tz] = nd.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y - z * w) * sy, 2 * (x * z + y * w) * sz, tx, 2 * (x * y + z * w) * sx, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z - x * w) * sz, ty,
      2 * (x * z - y * w) * sx, 2 * (y * z + x * w) * sy, (1 - 2 * (x * x + y * y)) * sz, tz, 0, 0, 0, 1];
  };
  const out = [];
  const visit = (ni, M, depth) => {
    const nd = J.nodes[ni], W = mul(M, local(nd)); if (depth > 32) return;
    if (nd.mesh != null) for (const pr of J.meshes[nd.mesh].primitives) {
      if ((pr.mode ?? 4) !== 4 || pr.attributes.POSITION == null) continue;
      const pos = read(pr.attributes.POSITION), idx = pr.indices != null ? read(pr.indices) : null, n = idx ? idx.length : pos.length / 3;
      for (let k = 0; k + 2 < n; k += 3) for (let c = 0; c < 3; c++) { const v = idx ? idx[k + c] : k + c, q = xf(W, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); out.push(q[0], -q[2], q[1]); }
    }
    for (const c of nd.children || []) visit(c, W, depth + 1);
  };
  for (const r of (J.scenes && J.scenes[J.scene || 0] ? J.scenes[J.scene || 0].nodes : J.nodes.map((_, i) => i))) visit(r, IDENT, 0);
  return out;
}
/** 3D Studio file → triangles (flat xyz; 3DS is Z up like GDTF, one unit = 1 mm) */
function read3DS(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = []; let verts = null;
  const walk = (p, end) => {
    while (p + 6 <= end) {
      const id = dv.getUint16(p, true), len = dv.getUint32(p + 2, true); if (len < 6) return; const e = Math.min(end, p + len);
      if (id === 0x4d4d || id === 0x3d3d) walk(p + 6, e);
      else if (id === 0x4000) { let q = p + 6; while (q < e && u8[q]) q++; walk(q + 1, e); }                    // object: a name, then its chunks
      else if (id === 0x4100) { verts = null; walk(p + 6, e); }
      else if (id === 0x4110) { const n = dv.getUint16(p + 6, true); verts = new Float32Array(n * 3); for (let k = 0; k < n * 3; k++) verts[k] = dv.getFloat32(p + 8 + k * 4, true) * 0.001; }
      else if (id === 0x4120 && verts) { const n = dv.getUint16(p + 6, true); for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) { const v = dv.getUint16(p + 8 + k * 8 + c * 2, true); out.push(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]); } }
      p = e;
    }
  };
  walk(0, u8.length); return out;
}
/** a box, a cylinder or a sphere of 1 × 1 × 1 round the origin (GDTF primitive models) */
function primitive(type) {
  const out = [], quad = (a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  if (type === 'Cube') { const h = 0.5, P = (x, y, z) => [x * h, y * h, z * h];
    for (const s of [-1, 1]) { quad(P(s, -1, -1), P(s, 1, -1), P(s, 1, 1), P(s, -1, 1)); quad(P(-1, s, -1), P(1, s, -1), P(1, s, 1), P(-1, s, 1)); quad(P(-1, -1, s), P(1, -1, s), P(1, 1, s), P(-1, 1, s)); } }
  else if (type === 'Cylinder') for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12, A = [Math.cos(a) / 2, Math.sin(a) / 2], B = [Math.cos(b) / 2, Math.sin(b) / 2];
    quad([...A, -0.5], [...B, -0.5], [...B, 0.5], [...A, 0.5]); out.push(0, 0, 0.5, ...A, 0.5, ...B, 0.5, 0, 0, -0.5, ...B, -0.5, ...A, -0.5); }
  else if (type === 'Sphere') { const P = (u, v) => [Math.cos(u) * Math.sin(v) / 2, Math.sin(u) * Math.sin(v) / 2, Math.cos(v) / 2];
    for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) quad(P(i * Math.PI / 8, j * Math.PI / 8), P((i + 1) * Math.PI / 8, j * Math.PI / 8), P((i + 1) * Math.PI / 8, (j + 1) * Math.PI / 8), P(i * Math.PI / 8, (j + 1) * Math.PI / 8)); }
  return out.length ? out : null;
}
const bounds = t => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let k = 0; k < t.length; k++) { const c = k % 3; if (t[k] < lo[c]) lo[c] = t[k]; if (t[k] > hi[c]) hi[c] = t[k]; } return [lo, hi]; };
const b64 = arr => { const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); let s = ''; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(s); };
/** vertex clustering on a grid of `cell`: { pos: [x, y, z …], idx: [a, b, c …] } without the triangles that collapse */
function cluster(tris, cell) {
  const ids = new Map(), sum = [], cnt = [], idx = [], seen = new Set();
  const vert = k => { const x = tris[k], y = tris[k + 1], z = tris[k + 2], key = Math.round(x / cell) + ',' + Math.round(y / cell) + ',' + Math.round(z / cell); let i = ids.get(key);
    if (i === undefined) { i = cnt.length; ids.set(key, i); sum.push(0, 0, 0); cnt.push(0); } sum[i * 3] += x; sum[i * 3 + 1] += y; sum[i * 3 + 2] += z; cnt[i]++; return i; };
  for (let k = 0; k + 8 < tris.length; k += 9) { const a = vert(k), b = vert(k + 3), c = vert(k + 6); if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((p, q) => p - q).join(); if (seen.has(key)) continue; seen.add(key); idx.push(a, b, c); }
  return { pos: sum.map((v, k) => v / cnt[(k / 3) | 0]), idx };
}

async function shapeOf(doc, zip) {
  const FT = doc.querySelector('FixtureType'), kids = el => (el ? [...el.children] : []), top = kids(FT.querySelector(':scope > Geometries'));
  if (!top.length) return null;
  /* models: mesh file (the lightest version there is) or a primitive, scaled to the Length × Width × Height the file states */
  const files = new Map([...zip.keys()].map(k => [k.toLowerCase(), k])), meshes = {}; let real = 0;
  for (const m of FT.querySelectorAll(':scope > Models > Model')) {
    const file = (m.getAttribute('File') || '').toLowerCase(), dim = [f(m, 'Length'), f(m, 'Width'), f(m, 'Height')]; let t = null;
    if (file) for (const [dir, ext, read] of [['gltf_low', 'glb', readGLB], ['3ds_low', '3ds', read3DS], ['gltf', 'glb', readGLB], ['3ds', '3ds', read3DS], ['gltf_high', 'glb', readGLB], ['3ds_high', '3ds', read3DS]]) {
      const key = files.get(`models/${dir}/${file}.${ext}`); if (!key) continue;
      try { t = read(await zip.get(key)()); if (t.length) { real++; break; } t = null; } catch (e) { console.warn(`GDTF model ${file}.${ext}:`, e.message); t = null; }
    }
    let unit = !t;
    if (!t) t = primitive(m.getAttribute('PrimitiveType'));
    if (!t) continue;
    const [lo, hi] = bounds(t), s = [0, 1, 2].map(c => (unit ? dim[c] || 0.05 : dim[c] > 0 && hi[c] - lo[c] > 1e-6 ? dim[c] / (hi[c] - lo[c]) : 1));
    if (!unit && Math.max(...s) / Math.min(...s) > 50) s.fill(1);                                              // a flat model with a nonsense thickness: leave it alone
    for (let k = 0; k < t.length; k++) t[k] *= s[k % 3];
    meshes[m.getAttribute('Name')] = t;
  }
  if (!real) return null;                                       // only primitives: the generated body looks better

  /* which geometry pans and which tilts: the ones the Pan and Tilt channels address */
  const geoOf = attr => { for (const ch of FT.querySelectorAll('DMXChannel')) if (ch.querySelector(`ChannelFunction[Attribute="${attr}"], LogicalChannel[Attribute="${attr}"]`)) return ch.getAttribute('Geometry'); return null; };
  const panG = geoOf('Pan'), tiltG = geoOf('Tilt'), moving = !!(panG || tiltG);
  const mode = FT.querySelector('DMXMode[Geometry]'), root = top.find(g => mode && g.getAttribute('Name') === mode.getAttribute('Geometry')) || top[0];
  const part = { base: [], pan: [], tilt: [], lens: [] }, origin = { base: [0, 0, 0], pan: null, tilt: null }, beams = [];
  const walk = (g, M, grp, depth, modelOverride, placed) => {   // placed: a referenced geometry stands where the reference puts it
    if (depth > 12) return;
    const W = placed ? M : mul(M, matrix(g.getAttribute('Position'))), name = g.getAttribute('Name');
    if (g.tagName === 'GeometryReference') { const ref = top.find(x => x.getAttribute('Name') === g.getAttribute('Geometry')); if (ref) walk(ref, W, grp, depth + 1, g.getAttribute('Model'), true); return; }
    if (moving) { if (name === panG && !origin.pan) { grp = 'pan'; origin.pan = xf(W, 0, 0, 0); } if (name === tiltG && !origin.tilt) { grp = 'tilt'; origin.tilt = xf(W, 0, 0, 0); } }
    else if (g.tagName === 'Axis') grp = 'base';                // a fixture without motors: what hangs on a manual axis (the yoke) stays, the rest follows "Aim"
    const t = meshes[modelOverride || g.getAttribute('Model')], isBeam = g.tagName === 'Beam';
    if (isBeam) beams.push({ at: xf(W, 0, 0, 0), r: f(g, 'BeamRadius', 0.05) });
    if (t) { const to = isBeam ? part.lens : part[grp]; for (let k = 0; k < t.length; k += 3) to.push(...xf(W, t[k], t[k + 1], t[k + 2])); }
    for (const c of kids(g)) if (/^(Geometry|Axis|Beam|GeometryReference|FilterBeamStop|FilterColor|FilterGobo|FilterShaper|MediaServer\w+|Display|Structure|Support|Magnet|Laser|Inventory|WiringObject)$/.test(c.tagName)) walk(c, W, grp, depth + 1);
  };
  walk(root, IDENT, moving ? 'base' : 'tilt', 0);
  if (!beams.length) return null;
  const pan0 = origin.pan || origin.tilt || [0, 0, 0], tilt0 = origin.tilt || origin.pan || [0, 0, 0];
  const frame = { base: [0, 0, 0], pan: pan0, tilt: tilt0, lens: tilt0 }, sim = (p, o) => [p[0] - o[0], -(p[2] - o[2]), p[1] - o[1]];
  for (const k in part) { const t = part[k], o = frame[k]; for (let i = 0; i < t.length; i += 3) { const q = sim([t[i], t[i + 1], t[i + 2]], o); t[i] = q[0]; t[i + 1] = q[1]; t[i + 2] = q[2]; } }
  // stand it on the floor: the lowest point of the whole fixture (as assembled, head straight) at y = 0
  const panPos = sim(pan0, [0, 0, 0]), tiltPos = sim(tilt0, pan0);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const k in part) if (part[k].length) { const [a, b] = bounds(part[k]), off = k === 'base' ? [0, 0, 0] : k === 'pan' ? panPos : [panPos[0] + tiltPos[0], panPos[1] + tiltPos[1], panPos[2] + tiltPos[2]];
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], a[c] + off[c]); hi[c] = Math.max(hi[c], b[c] + off[c]); } }
  for (let i = 1; i < part.base.length; i += 3) part.base[i] -= lo[1]; panPos[1] -= lo[1];
  // the light source: the Beam geometries; without a mesh of their own they get a disc
  const B = beams.map(b => ({ at: sim(b.at, tilt0), r: b.r })), lensY = B.reduce((s, b) => s + b.at[1], 0) / B.length;
  if (!part.lens.length) for (const b of B) for (let i = 0; i < 24; i++) { const a0 = i * Math.PI / 12, a1 = (i + 1) * Math.PI / 12; part.lens.push(b.at[0], b.at[1], b.at[2], b.at[0] + Math.cos(a1) * b.r, b.at[1], b.at[2] + Math.sin(a1) * b.r, b.at[0] + Math.cos(a0) * b.r, b.at[1], b.at[2] + Math.sin(a0) * b.r); }
  const spread = Math.max(...B.map(b => Math.hypot(b.at[0], b.at[2]) + b.r));
  /* simplify: one grid size for the whole fixture, coarser until it fits */
  let cell = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 500, done, tris;
  for (let n = 0; n < 40; n++, cell *= 1.25) { done = {}; tris = 0; for (const k in part) if (part[k].length) { done[k] = cluster(part[k], k === 'lens' ? cell / 2 : cell); tris += done[k].idx.length / 3; } if (tris <= MAX_TRIS) break; }
  const parts = {};
  for (const k in done) { const { pos, idx } = done[k]; if (!idx.length || pos.length / 3 > 65535) continue;
    const [a, b] = bounds(pos), size = a.map((v, c) => Math.max(1e-5, b[c] - v)), q = new Int16Array(pos.length);
    for (let i = 0; i < pos.length; i++) q[i] = Math.round((pos[i] - a[i % 3]) / size[i % 3] * 65535) - 32768;
    parts[k] = { n: pos.length / 3, p: b64(q), i: b64(new Uint16Array(idx)), min: a.map(v => +v.toFixed(5)), size: size.map(v => +v.toFixed(5)) }; }
  if (!parts.base && !parts.pan && !parts.tilt) return null;
  const r5 = v => v.map(x => +x.toFixed(5));
  return { tris, moving, panPos: r5(panPos), tiltPos: r5(tiltPos), lensY: +lensY.toFixed(5), lensR: +Math.min(spread, Math.max(...B.map(b => b.r)) * (B.length > 1 ? 3 : 1)).toFixed(5), size: r5(hi.map((v, c) => v - lo[c])), parts };
}
