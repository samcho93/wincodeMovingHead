// library/gdtf.js — GDTF fixture file (.gdtf: a zip with description.xml) → neutral description (desc.js). Browser only.
//  GDTF (General Device Type Format, DIN SPEC 15800) is the open fixture format read by grandMA3, Vectorworks, Capture,
//  Depence and others. What is read here: name and manufacturer, wheels, and every DMX mode with its channels,
//  channel functions and channel sets. Not read: 3D models, geometry trees (a channel repeated through geometry
//  references — pixel cells — appears once), emitters' spectra, macros.

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
  return fromGDTFxml(new TextDecoder().decode(await get()), file.name);
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
  return { id: `gdtf/${slug}`, source: 'gdtf', manufacturer, name, categories: [], lens: ba > 0 ? [ba, ba] : null, wheels, channels, modes };
}
