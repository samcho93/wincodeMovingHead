// demo.js — demo sequence for the top-bar [Demo] button.
//  Model-agnostic: scenes name the channels they need and are skipped for models without them; wheel positions
//  are found by probing the model's own decode(), so no channel value of any particular chart is hard-coded.
const SCENE = 5;                                            // seconds per scene
const tri = x => 1 - Math.abs((x % 2) - 1);                 // 0→1→0 triangle wave
const u8 = v => Math.max(0, Math.min(255, Math.round(v)));

const cache = new Map();
/** First channel value (0..255) whose decoded target satisfies pred — memoised per model */
function probe(model, ch, target, tag, pred) {
  const id = `${model.id}|${ch}|${tag}`;
  if (!cache.has(id)) { let hit = null; for (let x = 0; x < 256 && hit == null; x++) { const t = model.decode({ [ch]: x })[target]; if (t && pred(t, x)) hit = x; } cache.set(id, hit); }
  return cache.get(id);
}
const slot = (model, ch, target, n) => probe(model, ch, target, 's' + n, (t, x) => t.pos === n && !t.shake && !/Linear/.test(model.describe(ch, x)));

// p = scene parameters: wheel slots (color/gobo/rot), flags, and raw channel values under their channel keys
const SCENES = [
  { name: 'Zoom', needs: ['zoom'], run: (p, k) => { p.zoomK = tri(k * 2); } },
  { name: 'Colour wheel', needs: ['color'], run: (p, k, t, m) => { p.color = Math.floor(k * (m.colors.length - 0.01)); } },
  { name: 'Colour flow', needs: ['color'], run: p => { p.colorFlow = true; } },
  { name: 'CMY mixing', needs: ['cyan', 'magenta', 'yellow'], run: (p, k, t) => { p.cyan = 127 + 127 * Math.sin(t * 1.3); p.magenta = 127 + 127 * Math.sin(t * 0.9 + 2); p.yellow = 127 + 127 * Math.sin(t * 0.7 + 4); } },
  { name: 'Static gobos', needs: ['gobo'], run: (p, k, t, m) => { p.gobo = 1 + Math.floor(k * (m.gobos.fix.length - 1.01)); p.color = 3; } },
  { name: 'Rotating gobos', needs: ['rotGobo'], run: (p, k, t, m) => { p.rot = 1 + Math.floor(k * (m.gobos.rot.length - 1.01)); p.goboSpin = true; } },
  { name: 'Prism', needs: ['prism'], run: (p, k, t, m) => { p.rot = m.gobos.rot.length - 1; p.goboSpin = true; p.prismOn = true; p.color = 5; } },
  { name: 'Framing blades', needs: ['cut1'], run: (p, k, t) => { for (let i = 1; i <= 8; i++) p['cut' + i] = 70 + 60 * Math.sin(t * 1.1 + i * 0.8); p.cutRot = 128 + 110 * Math.sin(t * 0.6); p.cyan = 200; } },
  { name: 'Frost', needs: ['frost'], run: (p, k, t, m) => { p.rot = m.gobos.rot.length - 1; p.cut1 = p.cut2 = p.cut5 = p.cut6 = 85; p.frost = k > 0.45 ? 255 : 0; } },
  { name: 'Strobe', needs: ['strobe'], run: (p, k) => { p.strobeK = k; p.color = 6; } },
];

/** Channel values for the given channel list at demo time t (seconds) → { values, scene } */
export function demoValues(model, chans, t) {
  const has = k => chans.includes(k);
  const usable = SCENES.filter(s => s.needs.every(has));
  const s = usable[Math.floor(t / SCENE) % usable.length], k = (t % SCENE) / SCENE, p = {};
  s.run(p, k, t, model);
  const v = {}; chans.forEach(c => { v[c] = 0; });
  const set = (key, val) => { if (has(key) && val != null) v[key] = u8(val); };
  // pan/tilt sweep in 16 bit (coarse + fine) so the movement has no 8-bit steps
  const set16 = (key, val) => { const w = Math.max(0, Math.min(65535, Math.round(val * 256))); set(key, w >> 8); set(key + 'Fine', w & 255); };
  set16('pan', 128 + 34 * Math.sin(t * 0.45)); set16('tilt', 74 + 16 * Math.sin(t * 0.33)); set('dimmer', 255); set('cutRot', 128);
  set('strobe', p.strobeK != null ? probe(model, 'strobe', 'strobe', 'st', st => st.mode === 'strobe') + 70 * p.strobeK : probe(model, 'strobe', 'strobe', 'open', st => st.mode === 'open'));
  // focus: the value the model treats as sharp at mid zoom
  set('focus', 255 * (model.spec.focus[0] + model.spec.focus[1] * 0.4));
  // zoom charts run either way (0 = narrow or 0 = wide) → ask the model
  const narrow = model.decode({ zoom: 0 }).zoom < 0.5 ? 0 : 255, wide = 255 - narrow;
  set('zoom', narrow + (wide - narrow) * (p.zoomK ?? 0.4));
  if (p.colorFlow) set('color', probe(model, 'color', 'color', 'flow', c => c.pos == null && c.spin > 0.3 && c.spin < 1.2));
  else if (p.color != null) set('color', slot(model, 'color', 'color', Math.min(p.color, model.colors.length - 1)));
  if (p.gobo != null) set('gobo', slot(model, 'gobo', 'gobo', p.gobo));
  if (p.rot != null && model.gobos.rot.length > 1) set('rotGobo', slot(model, 'rotGobo', 'rotGobo', p.rot));
  if (p.goboSpin) set('goboRot', probe(model, 'goboRot', 'goboRot', 'spin', g => g.index == null && g.spin > 0.2 && g.spin < 0.5));
  if (p.prismOn) { set('prism', probe(model, 'prism', 'prism', 'on', on => on === true)); set('prismRot', probe(model, 'prismRot', 'prismRot', 'rot', r => Math.abs(r) > 0.3)); }
  for (const key of ['cyan', 'magenta', 'yellow', 'frost', 'cutRot', 'cut1', 'cut2', 'cut3', 'cut4', 'cut5', 'cut6', 'cut7', 'cut8']) set(key, p[key]);
  return { values: v, scene: s.name };
}
