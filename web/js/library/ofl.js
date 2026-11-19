// library/ofl.js — Open Fixture Library (https://open-fixture-library.org, MIT) fixture JSON → neutral description (desc.js).
//  Pure functions: used in the browser (a dropped .json file) and by tools/import-ofl.mjs (the bundled library).
const num = s => (typeof s === 'number' ? s : parseFloat(s));
const hex = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map(i => parseInt(m[i], 16) / 255) : null; };
const NAMED = { red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1], orange: [1, 0.5, 0], amber: [1, 0.6, 0], pink: [1, 0.4, 0.7], purple: [0.6, 0, 1], violet: [0.6, 0, 1],
  lavender: [0.8, 0.75, 1], white: [1, 1, 1], uv: [0.35, 0, 1], lime: [0.65, 1, 0], turquoise: [0, 0.9, 0.8], 'light blue': [0.5, 0.8, 1], 'dark blue': [0, 0, 0.7], 'light green': [0.5, 1, 0.5], cto: [1, 0.75, 0.45], ctb: [0.7, 0.85, 1] };
const mix = list => { const c = (list || []).map(hex).filter(Boolean); return c.length ? [0, 1, 2].map(i => c.reduce((s, x) => s + x[i], 0) / c.length) : null; };
const byName = n => { const s = (n || '').toLowerCase(); for (const k of Object.keys(NAMED).sort((a, b) => b.length - a.length)) if (s.includes(k)) return NAMED[k]; return null; };

/** a speed entity ("fast CW", "20Hz", "50%", "stop", "3rpm") on a scale: slow → lo, fast → hi; CCW / reverse is negative */
function speed(v, lo, hi, unitScale = 1) {
  if (v == null) return null; if (typeof v === 'number') return v;
  const s = String(v).toLowerCase(), sign = /ccw|reverse/.test(s) ? -1 : 1;
  if (/stop/.test(s)) return 0;
  if (/^slow/.test(s)) return sign * lo; if (/^fast/.test(s)) return sign * hi;
  const n = parseFloat(s); if (isNaN(n)) return sign * (lo + hi) / 2;
  if (s.endsWith('%')) return n / 100 * hi; if (s.endsWith('rpm')) return n / 60 * unitScale; return n * unitScale;   // Hz
}
const level = v => { if (v == null) return null; const s = String(v).toLowerCase(); return s === 'off' || s === 'dark' || s === 'closed' || s === 'near' ? 0 : s === 'bright' || s === 'high' || s === 'open' || s === 'far' ? 1 : s === 'low' ? 0.1 : parseFloat(s) / 100; };
/** [value at range start, value at range end] of a capability property, or null */
const se = (c, prop, parse) => (c[prop] != null ? [parse(c[prop]), parse(c[prop])] : c[prop + 'Start'] != null ? [parse(c[prop + 'Start']), parse(c[prop + 'End'])] : null);
const FX = { Open: 'open', Closed: 'closed', Strobe: 'strobe', Pulse: 'pulse', RampUp: 'fadein', RampDown: 'pulse', RampUpDown: 'pulse', Lightning: 'random', Spikes: 'strobe', Burst: 'strobe' };
const COLOR = { 'Warm White': 'Warm White', 'Cold White': 'Cold White' };
/** label of a rotation range from its speeds: Stop / CW / CCW, slow → fast */
const turn = (what, r) => { if (!r || (!r[0] && !r[1])) return `${what} stop`; const d = r[0] + r[1] < 0 ? 'CCW' : 'CW', a = Math.abs(r[0]), b = Math.abs(r[1]); return `${what} ${d}${a === b ? '' : a < b ? ' slow … fast' : ' fast … slow'}`; };

export function fromOFL(J, manKey, fixKey, manName) {
  if (!J || !J.modes || !(J.availableChannels || J.templateChannels)) throw new Error('Not an Open Fixture Library fixture');
  const wheels = Object.entries(J.wheels || {}).map(([name, w]) => ({ name, slots: w.slots.map(s => ({ type: s.type === 'Open' || s.type === 'Color' || s.type === 'Gobo' ? s.type : 'Other', name: s.name || '',
    rgb: s.type === 'Color' ? mix(s.colors) || byName(s.name) || [1, 1, 1] : undefined })) }));
  const wheelIx = (c, chName) => { const n = c.wheel ? (Array.isArray(c.wheel) ? c.wheel[0] : c.wheel) : chName; let i = wheels.findIndex(w => w.name === n); if (i < 0) i = wheels.findIndex(w => chName.startsWith(w.name)); return i; };

  function cap(c, chName, a, b) {
    const o = { a, b, type: 'Other', label: c.comment || c.effectName || c.type, s: 0, e: 0 }, set = (type, r, extra) => Object.assign(o, { type, s: r ? r[0] : 0, e: r ? r[1] : 0 }, extra);
    switch (c.type) {
      case 'Intensity': set('Intensity', se(c, 'brightness', level) || [0, 1]); o.label = 'Intensity'; break;
      case 'ColorIntensity': set('ColorIntensity', se(c, 'brightness', level) || [0, 1], { color: COLOR[c.color] || c.color }); o.label = c.color; break;
      case 'ColorPreset': { const rgb = mix(c.colors) || mix(c.colorsStart); if (rgb) set('Preset', null, { rgb }); o.label = c.comment || 'Colour preset'; break; }
      case 'Pan': case 'Tilt': set(c.type, se(c, 'angle', num) || [0, c.type === 'Pan' ? 540 : 270]); o.label = c.type; break;
      case 'PanContinuous': set('PanContinuous', se(c, 'speed', v => speed(v, 20, 360, 360))); o.label = 'Pan rotation'; break;
      case 'PanTiltSpeed': { const r = se(c, 'speed', v => 1 - Math.abs(speed(v, 0, 1) ?? 0.5)) || se(c, 'duration', v => (/short|instant/.test(v) ? 0 : /long/.test(v) ? 1 : 0.5)); set('PanTiltSpeed', r || [0, 1]); o.label = 'Pan/tilt speed'; break; }
      case 'ShutterStrobe': { const fx = FX[c.shutterEffect] || 'strobe', r = se(c, 'speed', v => Math.abs(speed(v, 1, 20))) || [8, 8];
        set('Shutter', fx === 'open' || fx === 'closed' ? null : r, { fx: c.randomTiming && fx !== 'open' && fx !== 'closed' ? 'random' : fx }); o.label = c.comment || c.shutterEffect; break; }
      case 'WheelSlot': { const w = wheelIx(c, chName), r = se(c, 'slotNumber', num); if (w < 0 || !r) break; set('WheelSlot', [r[0] - 1, r[1] - 1], { wheel: w });
        const sl = wheels[w].slots[Math.round(r[0]) - 1], nth = sl ? wheels[w].slots.slice(0, Math.round(r[0])).filter(x => x.type === sl.type).length : 0;
        o.label = c.comment || (sl && (sl.name || (sl.type === 'Open' ? 'Open' : `${sl.type} ${nth}`))) || `Slot ${r[0]}`; if (r[0] % 1) o.label = `Split ${r[0]}`; else if (r[0] !== r[1]) o.label += ' …'; break; }
      case 'WheelRotation': { const w = wheelIx(c, chName); if (w < 0) break; set('WheelRotation', se(c, 'speed', v => speed(v, 0.15, 3)) || [0, 0], { wheel: w }); o.label = turn('Wheel rotation', [o.s, o.e]); break; }
      case 'WheelShake': { const w = wheelIx(c, chName); if (w < 0) break; set('WheelShake', se(c, 'shakeSpeed', v => Math.abs(speed(v, 2, 12))) || [6, 6], { wheel: w }); o.label = 'Shake'; break; }
      case 'WheelSlotRotation': { const w = wheelIx(c, chName), ang = se(c, 'angle', num); if (ang) set('SlotRotation', ang, { wheel: w, angle: true }); else set('SlotRotation', se(c, 'speed', v => speed(v, 0.03, 1.5)) || [0, 0], { wheel: w }); o.label = ang ? 'Gobo index' : turn('Gobo rotation', [o.s, o.e]); break; }
      case 'Zoom': { const r = se(c, 'angle', v => { const s = String(v).toLowerCase(); return s === 'narrow' ? 6 : s === 'wide' ? 45 : s === 'closed' ? 3 : num(v) * (s.endsWith('%') ? 0.45 : 1); }); if (r) set('Zoom', r); o.label = 'Zoom'; break; }
      case 'Focus': set('Focus', se(c, 'distance', level) || [0, 1]); o.label = 'Focus'; break;
      case 'Frost': set('Frost', se(c, 'frostIntensity', level) || [1, 1]); o.label = 'Frost'; break;
      case 'Prism': { const ang = se(c, 'angle', num); if (ang) set('Prism', ang, { angle: true }); else set('Prism', se(c, 'speed', v => speed(v, 0.05, 1.5)) || [0, 0]); o.label = c.comment || (ang ? 'Prism index' : c.speed != null || c.speedStart != null ? turn('Prism', [o.s, o.e]) : 'Prism'); break; }
      case 'PrismRotation': { const ang = se(c, 'angle', num); if (ang) set('PrismRotation', ang, { angle: true }); else set('PrismRotation', se(c, 'speed', v => speed(v, 0.05, 1.5)) || [0, 0]); o.label = ang ? 'Prism index' : turn('Prism rotation', [o.s, o.e]); break; }
      case 'NoFunction': o.label = c.comment || 'No function'; break;
    }
    return o;
  }

  // channel table: channels are created when a mode uses them (template channels once per pixel)
  const channels = {}, keyOf = new Map(), pixels = [], groups = Object.keys((J.matrix && J.matrix.pixelGroups) || {});
  if (J.matrix) { if (J.matrix.pixelKeys) for (const z of J.matrix.pixelKeys) for (const y of z) for (const x of y) if (x != null) pixels.push(String(x)); else { /* empty cell */ }
    if (!pixels.length && J.matrix.pixelCount) { const n = J.matrix.pixelCount.reduce((a, b) => a * b, 1); for (let i = 1; i <= n; i++) pixels.push(String(i)); } }
  const slug = s => s.replace(/[^A-Za-z0-9]+(.)?/g, (m, c) => (c ? c.toUpperCase() : '')).replace(/^(\d)/, 'n$1') || 'ch';
  const fresh = k => { let x = k, i = 2; while (x in channels) x = k + '_' + i++; return x; };
  const dmx = (v, res) => { if (typeof v === 'string' && v.endsWith('%')) return Math.round(parseFloat(v) * 2.55); const n = num(v) || 0; return res > 1 ? n >> (8 * (res - 1)) : n; };
  /** find the definition behind a channel name used in a mode: { def, name, coarse?: name of its coarse channel } */
  function lookup(name) {
    const sources = [[J.availableChannels || {}, x => x]];
    for (const pk of [...pixels, ...groups]) sources.push([J.templateChannels || {}, x => x.replace(/\$pixelKey/g, pk)]);
    for (const [table, fill] of sources) for (const [n, def] of Object.entries(table)) {
      if (fill(n) === name) return { def, name };
      const fi = (def.fineChannelAliases || []).findIndex(a => fill(a) === name); if (fi >= 0) return { fine: fi, coarse: fill(n) };
      for (const c of def.capabilities || []) if (c.switchChannels) for (const [alias, to] of Object.entries(c.switchChannels)) if (fill(alias) === name) {   // a switching channel: use what it is by default
        const dv = dmx(def.defaultValue ?? 0, 1), act = (def.capabilities.find(x => x.dmxRange && dv >= x.dmxRange[0] && dv <= x.dmxRange[1]) || c).switchChannels[alias]; return lookup(fill(act)); }
    }
    return null;
  }
  function key(name) {
    if (name == null) return null; if (keyOf.has(name)) return keyOf.get(name);
    const L = lookup(name); let k;
    if (!L) { k = fresh(slug(name)); channels[k] = { name, def: 0, caps: [] }; }
    else if (L.coarse) { const ck = key(L.coarse); k = fresh(L.fine === 0 ? ck + 'Fine' : ck + 'Fine' + (L.fine + 1)); channels[k] = { name, def: 0 }; if (L.fine === 0) channels[ck].fine = k; }
    else {
      const d = L.def, list = d.capabilities || [d.capability], first = list[0] && list[0].type, res = d.dmxValueResolution === '16bit' ? 2 : d.dmxValueResolution === '24bit' ? 3 : 1;
      const want = first === 'Pan' ? 'pan' : first === 'Tilt' ? 'tilt' : first === 'Intensity' ? 'dimmer' : slug(name);
      k = fresh(want); channels[k] = { name, def: dmx(d.defaultValue ?? (first === 'Pan' || first === 'Tilt' ? 128 : 0), 1) };
      channels[k].caps = list.filter(Boolean).map(c => { const r = c.dmxRange || [0, 255]; return cap(c, name, dmx(r[0], res), dmx(r[1], res)); });
    }
    keyOf.set(name, k); return k;
  }
  const modes = J.modes.map((m, i) => {
    const out = [];
    for (const c of m.channels) {
      if (c && typeof c === 'object') {                         // matrix insert
        const who = Array.isArray(c.repeatFor) ? c.repeatFor : c.repeatFor === 'eachPixelGroup' ? groups : pixels;
        const one = (t, pk) => out.push(t == null ? null : key(t.replace(/\$pixelKey/g, pk)));
        if (c.channelOrder === 'perChannel') for (const t of c.templateChannels) for (const pk of who) one(t, pk); else for (const pk of who) for (const t of c.templateChannels) one(t, pk);
      } else out.push(key(c));
    }
    return { id: m.shortName || m.name || `mode${i + 1}`, label: `${m.name} (${out.length})`, channels: out };
  });
  const ids = new Set(); for (const m of modes) { let id = m.id, i = 2; while (ids.has(id)) id = m.id + ' ' + i++; ids.add(id); m.id = id; }
  const lens = J.physical && J.physical.lens && J.physical.lens.degreesMinMax;
  return { id: `ofl/${manKey}/${fixKey}`, source: 'ofl', manufacturer: manName || manKey, name: J.name, categories: J.categories || [], lens: lens || null, wheels, channels, modes };
}
