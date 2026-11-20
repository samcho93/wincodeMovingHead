// library/desc.js — a fixture from a library (Open Fixture Library, GDTF) as a simulator model.
//  The importers (ofl.js, gdtf.js) turn their format into one neutral description; modelFromDesc() turns that
//  description into a model definition with the same contract as the hand-written files in models/ (see models/index.js).
//
//  Description:
//   { id, source: 'ofl' | 'gdtf', manufacturer, name, categories: [..], lens: [minDeg, maxDeg] | null,
//     size: [width, height, depth] in mm | null, pixels: [columns, rows] | null,      what the body is shaped from (body.js)
//     wheels:   [{ name, slots: [{ type: 'Open' | 'Color' | 'Gobo' | 'Other', name, rgb? }] }],
//     channels: { key: { name, def (0..255), fine?: key of the fine channel, caps: [cap] } },   a fine channel has no caps
//     modes:    [{ id, label, channels: [key | null] }] }
//   cap: { a, b (DMX range on the coarse byte), type, label, s, e (value at a and at b), + type-specific fields }
//     Intensity s,e 0..1 · ColorIntensity color, s,e 0..1 · Pan / Tilt s,e degrees · PanContinuous s,e deg/s
//     PanTiltSpeed s,e 0 (fast)..1 (slow) · Shutter fx: open|closed|strobe|pulse|fadein|random, s,e Hz
//     WheelSlot wheel (index), s,e slot index from 0 · WheelRotation wheel, s,e slots/s · WheelShake wheel, s,e Hz
//     SlotRotation wheel, s,e rev/s  or  angle: true, s,e degrees · Zoom s,e degrees · Focus / Frost s,e 0..1
//     Prism (on) s,e rev/s · PrismRotation s,e rev/s or angle: true · Preset rgb [r,g,b] · Other
import { registerModel } from '../models/index.js';
import { addModel, getDef } from '../editor/library.js';
import { rng, TAU } from '../models/util.js';
import { bodyFromDesc, KIND_LABEL } from './body.js';

/** light of one emitter colour, as RGB */
export const EMITTERS = { Red: [1, 0, 0], Green: [0, 1, 0], Blue: [0, 0, 1], White: [1, 1, 1], 'Warm White': [1, 0.78, 0.5], 'Cold White': [0.8, 0.9, 1], Amber: [1, 0.6, 0],
  UV: [0.35, 0, 1], Lime: [0.65, 1, 0], Indigo: [0.3, 0, 1], Cyan: [0, 1, 1], Magenta: [1, 0, 1], Yellow: [1, 1, 0] };
const clamp01 = v => Math.min(1, Math.max(0, v));

/** Stand-in gobo artwork: libraries name the gobos but carry no drawing the simulator can use */
function drawGobo(g, wheel, idx, R) {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }, r = rng(idx * 37 + (wheel === 'rot' ? 501 : 7)), n = 3 + ((idx * 2) % 7);
  switch ((idx - 1 + (wheel === 'rot' ? 3 : 0)) % 6) {
    case 0: for (let i = 0; i < n; i++) dot(Math.cos(i * TAU / n) * R * 0.5, Math.sin(i * TAU / n) * R * 0.5, R * Math.min(0.2, 1.1 / n)); break;                    // ring of dots
    case 1: g.lineWidth = R * 0.07; for (let i = 0; i < n * 2; i++) { const a = i * TAU / (n * 2); g.beginPath(); g.moveTo(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15); g.lineTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); g.stroke(); } break;   // spokes
    case 2: g.lineWidth = R * 0.13; for (let i = 0; i < n; i++) { const a = i * TAU / n; g.beginPath(); g.arc(0, 0, R * 0.6, a + 0.15, a + TAU / n - 0.15); g.stroke(); } dot(0, 0, R * 0.14); break;   // segmented ring
    case 3: for (let i = 0; i < 40 + n * 6; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.85; dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.015 + r() * r() * 0.08)); } break;     // star field
    case 4: for (let i = -n; i <= n; i++) { const w = Math.sqrt(Math.max(0, 1 - (i / (n + 0.6)) ** 2)) * R * 0.85; g.fillRect(-w, i * R * 0.8 / n - R * 0.16 / n, w * 2, R * 0.32 / n); } break;   // bars
    default: g.lineWidth = R * 0.09; g.beginPath(); for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * TAU / n; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * R * 0.68, Math.sin(a) * R * 0.68); } g.closePath(); g.stroke(); dot(0, 0, R * 0.12);   // polygon
  }
}

export function modelFromDesc(D) {
  const CH = D.channels, keys = Object.keys(CH), capsOf = k => CH[k].caps || [];
  const has = type => keys.some(k => capsOf(k).some(c => c.type === type));
  const all = type => keys.flatMap(k => capsOf(k).filter(c => c.type === type));
  const span = type => all(type).reduce((m, c) => Math.max(m, Math.abs(c.e - c.s)), 0);

  // wheels: one colour wheel, one static and one rotating gobo wheel are simulated
  const W = D.wheels || [], rotating = new Set(all('SlotRotation').map(c => c.wheel));
  const colorW = W.findIndex(w => w.slots.some(s => s.type === 'Color'));
  const goboWs = W.map((w, i) => i).filter(i => i !== colorW && W[i].slots.some(s => s.type === 'Gobo'));
  const rotW = goboWs.find(i => rotating.has(i)) ?? -1, fixW = goboWs.find(i => i !== rotW) ?? -1;
  const role = i => (i < 0 ? null : i === colorW ? 'color' : i === fixW ? 'gobo' : i === rotW ? 'rotGobo' : null);
  const names = i => (i < 0 ? ['Open'] : W[i].slots.map((s, k) => s.name || (s.type === 'Open' ? 'Open' : `Gobo ${k}`)));
  const colors = colorW < 0 ? [{ name: 'White', rgb: [1, 1, 1] }] : W[colorW].slots.map((s, k) => ({ name: s.name || (s.type === 'Open' ? 'White' : `Colour ${k}`), rgb: s.rgb || [1, 1, 1] }));

  const emit = new Set(all('ColorIntensity').map(c => c.color));
  const additive = ['Red', 'Green', 'Blue', 'White', 'Warm White', 'Cold White', 'Amber', 'UV', 'Lime', 'Indigo'].some(c => emit.has(c));
  const cmy = !additive && emit.has('Cyan') && emit.has('Magenta') && emit.has('Yellow');
  const panRange = span('Pan'), tiltRange = span('Tilt'), moving = panRange > 0 || tiltRange > 0;
  const zooms = all('Zoom').flatMap(c => [c.s, c.e]), lens = D.lens || (moving ? [14, 14] : [28, 28]);
  const zoomMin = zooms.length ? Math.min(...zooms) : lens[0], zoomMax = zooms.length ? Math.max(...zooms) : lens[1];
  const features = { prism: has('Prism'), gobos: fixW >= 0 || rotW >= 0, cmy, blades: false, scenes: false, ms: false, lamp: false, rgbl: additive };

  const ch = {}, chGroup = {}, homeValues = {}, highlight = {};
  for (const k of keys) {
    const c = CH[k], t = capsOf(k)[0]?.type, of = keys.find(x => CH[x].fine === k), type = of ? capsOf(of)[0]?.type : t;
    ch[k] = c.name; chGroup[k] = type === 'Intensity' ? 'intensity' : type === 'ColorIntensity' ? 'colour' : type === 'Pan' ? 'pan' : type === 'Tilt' ? 'tilt' : 'effect';
    homeValues[k] = type === 'Pan' || type === 'Tilt' ? (of ? 0 : 128) : c.def | 0;
    // "highlight": what makes the fixture simply shine (open, full, white) — used by the stage editor's lamp test
    const open = capsOf(k).find(x => x.type === 'Shutter' && x.fx === 'open');
    highlight[k] = type === 'Intensity' && !of ? 255 : type === 'ColorIntensity' && !of && !cmy ? 255 : open ? Math.round((open.a + open.b) / 2) : homeValues[k];
  }
  const modes = {}; for (const m of D.modes) modes[m.id] = { id: m.id, label: m.label, channels: m.channels.map((k, i) => k ?? `_${i}`) };
  for (const m of Object.values(modes)) for (const k of m.channels) if (!(k in ch)) { ch[k] = 'Not used'; chGroup[k] = 'effect'; homeValues[k] = 0; highlight[k] = 0; }
  const capAt = (k, val) => { const cs = CH[k] && CH[k].caps; if (!cs) return null; for (let i = 0; i < cs.length; i++) if (val >= cs[i].a && val <= cs[i].b) return cs[i]; return null; };
  /** value of a capability at this DMX value (with the fine channel, when the mode has one) */
  const at = (c, k, v) => { const f = CH[k].fine, val = v[k] | 0;
    const x = f && f in v ? ((val - c.a) * 256 + (v[f] | 0)) / ((c.b - c.a + 1) * 256 - 1) : c.b > c.a ? (val - c.a) / (c.b - c.a) : 0;
    return c.s + (c.e - c.s) * x; };

  function decode(v) {
    const t = { pan: 0.5, tilt: 0.5, ptSpeed: 0, dimmer: 1, strobe: { mode: 'open' }, zoom: 0, frost: 0 };
    let dimSeen = false, sum = null, n = null, preset = null, cm = null, slotRot = {}, shake = {};
    for (const k in v) {
      const c = capAt(k, v[k] | 0); if (!c) continue;
      switch (c.type) {
        case 'Intensity': if (!dimSeen) { dimSeen = true; t.dimmer = clamp01(at(c, k, v)); } break;
        case 'ColorIntensity': {
          const x = clamp01(at(c, k, v));
          if (cmy) { (cm = cm || [0, 0, 0])[c.color === 'Cyan' ? 0 : c.color === 'Magenta' ? 1 : 2] = x; break; }
          sum = sum || {}; n = n || {}; sum[c.color] = (sum[c.color] || 0) + x; n[c.color] = (n[c.color] || 0) + 1; break;   // several pixels: their average
        }
        case 'Preset': if (c.rgb) preset = c.rgb; break;
        case 'Pan': if (panRange) t.pan = clamp01((at(c, k, v) - c.s) / (c.e - c.s || 1)); break;
        case 'Tilt': if (tiltRange) t.tilt = clamp01((at(c, k, v) - c.s) / (c.e - c.s || 1)); break;
        case 'PanContinuous': t.panSpin = at(c, k, v); break;
        case 'PanTiltSpeed': t.ptSpeed = clamp01(at(c, k, v)); break;
        case 'Shutter': if (c.fx !== 'open' || t.strobe.mode === 'open') t.strobe = c.fx === 'open' || c.fx === 'closed' ? { mode: c.fx } : { mode: c.fx, hz: Math.max(0.2, at(c, k, v)) }; break;
        case 'WheelSlot': { const r = role(c.wheel); if (r) t[r] = Object.assign(t[r] || { shake: 0, spin: 0 }, { pos: at(c, k, v) }); break; }
        case 'WheelRotation': { const r = role(c.wheel); if (r) t[r] = { pos: null, spin: at(c, k, v), shake: 0 }; break; }
        case 'WheelShake': shake[c.wheel] = at(c, k, v); break;
        case 'SlotRotation': if (c.wheel === rotW || rotW < 0) slotRot = c.angle ? { index: at(c, k, v), spin: 0, bounce: 0 } : { index: null, spin: at(c, k, v), bounce: 0 }; break;
        case 'Zoom': t.zoom = zoomMax > zoomMin ? clamp01((at(c, k, v) - zoomMin) / (zoomMax - zoomMin)) : 0; break;
        case 'Focus': t.focus = clamp01(at(c, k, v)); break;
        case 'Frost': t.frost = clamp01(at(c, k, v)); break;
        case 'Prism': t.prism = true; if (c.angle) t.prismIndex = at(c, k, v); else if (c.s || c.e) t.prismRot = at(c, k, v); break;
        case 'PrismRotation': if (c.angle) t.prismIndex = at(c, k, v); else t.prismRot = at(c, k, v); break;
      }
    }
    for (const w in shake) { const r = role(+w); if (r && t[r]) t[r].shake = shake[w]; }
    if (rotW >= 0 && slotRot.spin !== undefined) t.goboRot = slotRot;
    if (cm) t.cmy = cm;
    if (additive) {
      let rgb = [0, 0, 0];
      if (sum) for (const c in sum) { const e = EMITTERS[c] || [1, 1, 1], x = sum[c] / n[c]; rgb[0] += e[0] * x; rgb[1] += e[1] * x; rgb[2] += e[2] * x; }
      if (preset && rgb[0] + rgb[1] + rgb[2] < 0.01) rgb = preset.slice();
      const m = Math.max(rgb[0], rgb[1], rgb[2]);
      t.rgb = m > 0.001 ? rgb.map(x => x / m) : [1, 1, 1]; t.level = Math.min(1, m);
    }
    return t;
  }
  function describe(k, val) {
    const c = capAt(k, val | 0); if (!c) return String(val);
    return c.b > c.a && c.s !== c.e ? `${c.label} ${Math.round((val - c.a) / (c.b - c.a) * 100)}%` : c.label;
  }

  const body = bodyFromDesc(D, { moving, gobos: features.gobos, additive });   // shaped from kind, size and cell layout
  const model = {
    id: D.id, imported: D.source, code: '', name: D.name, title: `${D.manufacturer} ${D.name}`, lcdTitle: D.name, manufacturer: D.manufacturer, categories: D.categories || [],
    heads: 1, moving, kind: body.kind,
    spec: { panRange, tiltRange, zoomMin, zoomMax, ledWhite: [1, 1, 1], cd: moving ? 900 : 500, focus: has('Focus') ? [0.33, 0.22] : null, tempRise: 30, soft: moving ? 0 : 10 },
    colors, gobos: { fix: names(fixW), rot: names(rotW), draw: drawGobo },
    ch, chGroup, modes, defaultMode: (D.modes.reduce((a, m) => (m.channels.length > a.channels.length ? m : a), D.modes[0])).id,
    decode, describe, features, noSignal: 'hold', homeValues, highlight, resetHold: 3,
    settings: { dimCurve: 'Linear', dataHold: true },
    program: { base: highlight, steps: [{}] },
    panel: { type: 'none' }, rdm: { modelId: 0, description: D.name, software: '' },
    body,
    assumptions: [
      `Imported from ${D.source === 'gdtf' ? 'a GDTF file' : 'the Open Fixture Library'}: channels and ranges are the library's; nothing was checked against a manual.`,
      `The body is generated, not the real one: a ${KIND_LABEL[body.kind]} shaped from the library's category${D.size ? ', its outer dimensions' : ' (it gives no dimensions: a typical size is used)'}${D.pixels ? ' and its cell layout' : ''}. Fixtures without pan and tilt stay where their "Aim" is set.`,
      'Gobo artwork is a stand-in; colour wheel colours come from the library.',
      'One light source is simulated: pixels of a bar or matrix are averaged into one beam. Effect, macro and maintenance channels do nothing.',
    ],
  };
  return model;
}

/** Make a described fixture usable: 3D model + patchable definition. Returns the definition (editor/library.js). */
export function register(D) {
  const have = getDef(D.id); if (have) return have;
  return addModel(registerModel(modelFromDesc(D)), D.id, D.manufacturer);
}
/** A workspace carries the descriptions of the imported fixtures it uses (ws.library), so that a stage file or a
 *  workspace handed to the DMX editor opens anywhere. */
export function registerAll(ws) { for (const D of Object.values((ws && ws.library) || {})) try { register(D); } catch (e) { console.warn('Fixture description skipped:', D && D.id, e); } }
export function keepInWorkspace(ws, D) { (ws.library = ws.library || {})[D.id] = D; }
/** drop descriptions no patched fixture uses any more */
export function pruneWorkspace(ws) { if (!ws.library) return; const used = new Set(ws.fixtures.map(f => f.def)); for (const id of Object.keys(ws.library)) if (!used.has(id)) delete ws.library[id]; }
