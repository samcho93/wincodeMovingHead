// demo.js — demo sequence for the top-bar [Demo] button.
//  Model-agnostic: scenes name the channels they need and are skipped for models without them; wheel positions
//  are found by probing the model's own decode(), so no channel value of any particular chart is hard-coded.
//  Multi-head fixtures: a channel key may exist once (shared) or per head with the head number as a suffix
//  (tilt, or tilt1…tilt5). Scene values may be a number or a function of the head index (0-based) and head count.
const SCENE = 5;                                            // seconds per scene
const tri = x => 1 - Math.abs((x % 2) - 1);                 // 0→1→0 triangle wave
const u8 = v => Math.max(0, Math.min(255, Math.round(v)));
const hue = h => { const f = n => { const k = (n + (((h % 1) + 1) % 1) * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };

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
  { name: 'Colour wheel', needs: ['color'], wheel: true, run: (p, k, t, m) => { p.color = Math.floor(k * (m.colors.length - 0.01)); } },
  { name: 'Colour flow', needs: ['color'], wheel: true, run: p => { p.colorFlow = true; } },
  { name: 'RGBL colours', needs: ['r', 'g', 'b'], run: (p, k, t) => { p.hue = (i, n) => t * 0.12 + i / n * 0.6; } },
  { name: 'Head wave', needs: ['r', 'tilt'], multi: true, run: (p, k, t) => { p.tilt = i => 100 + 45 * Math.sin(t * 1.4 + i * 0.9); p.pan = i => 128 + 70 * Math.sin(t * 0.7 + i * 0.9); p.hue = (i, n) => 0.55 + 0.1 * Math.sin(t + i); p.zoomK = 0.05; } },
  { name: 'Head fan', needs: ['r', 'tilt'], multi: true, run: (p, k, t) => { const a = tri(k * 2); p.tilt = (i, n) => 128 - 60 * a + (i - (n - 1) / 2) * 0; p.pan = (i, n) => 128 - (i - (n - 1) / 2) * 60 * a; p.hue = (i, n) => i / n; p.zoomK = 0.1; } },
  { name: 'Pixel rings', needs: ['ringR'], run: (p, k, t) => { p.ring = (i, n) => t * 0.2 + i / n; p.macro = 16 + Math.floor(k * 7.99) * 16 + 4; p.hue = () => 0.62; p.dim = 60; } },
  { name: 'Pixel ring blocks', needs: ['rb1_1r'], run: (p, k, t) => { p.blocks = (i, b) => t * 0.5 + b / 8 + i * 0.1; p.hue = () => 0.62; p.dim = 60; } },
  { name: 'CMY mixing', needs: ['cyan', 'magenta', 'yellow'], run: (p, k, t) => { p.cyan = 127 + 127 * Math.sin(t * 1.3); p.magenta = 127 + 127 * Math.sin(t * 0.9 + 2); p.yellow = 127 + 127 * Math.sin(t * 0.7 + 4); } },
  { name: 'Static gobos', needs: ['gobo'], run: (p, k, t, m) => { p.gobo = 1 + Math.floor(k * (m.gobos.fix.length - 1.01)); p.color = 3; } },
  { name: 'Rotating gobos', needs: ['rotGobo'], run: (p, k, t, m) => { p.rot = 1 + Math.floor(k * (m.gobos.rot.length - 1.01)); p.goboSpin = true; } },
  { name: 'Prism', needs: ['prism'], run: (p, k, t, m) => { p.rot = m.gobos.rot.length - 1; p.goboSpin = true; p.prismOn = true; p.color = 5; } },
  { name: 'Framing blades', needs: ['cut1'], run: (p, k, t) => { for (let i = 1; i <= 8; i++) p['cut' + i] = 70 + 60 * Math.sin(t * 1.1 + i * 0.8); p.cutRot = 128 + 110 * Math.sin(t * 0.6); p.cyan = 200; } },
  { name: 'Frost', needs: ['frost'], run: (p, k, t, m) => { p.rot = m.gobos.rot.length - 1; p.cut1 = p.cut2 = p.cut5 = p.cut6 = 85; p.frost = k > 0.45 ? 255 : 0; } },
  { name: 'Strobe', needs: ['strobe'], run: (p, k) => { p.strobeK = k; p.color = 6; p.hue = (i, n) => i / n; } },
];

/** Channel values for the given channel list at demo time t (seconds) → { values, scene } */
export function demoValues(model, chans, t) {
  const N = model.heads || 1;
  const has = k => chans.includes(k) || chans.includes(k + '1');                 // shared or per-head
  const wheel = model.colors.length > 1;
  const usable = SCENES.filter(s => s.needs.every(k => (k.includes('_') ? chans.includes(k) : has(k))) && (!s.wheel || wheel) && (!s.multi || N > 1));
  const s = usable[Math.floor(t / SCENE) % usable.length], k = (t % SCENE) / SCENE, p = {};
  s.run(p, k, t, model);
  const v = {}; chans.forEach(c => { v[c] = 0; });
  /** set a channel: shared key and/or every per-head key; val = number or (headIndex, headCount) => number */
  const set = (key, val) => {
    if (val == null) return;
    const f = typeof val === 'function' ? val : () => val;
    if (chans.includes(key)) v[key] = u8(f((N - 1) / 2, N));
    for (let h = 1; h <= N; h++) if (chans.includes(key + h)) v[key + h] = u8(f(h - 1, N));
  };
  // pan/tilt sweep in 16 bit (coarse + fine) so the movement has no 8-bit steps
  const set16 = (key, val) => { const f = typeof val === 'function' ? val : () => val; set(key, (i, n) => Math.floor(Math.max(0, Math.min(255.996, f(i, n))))); set(key + 'Fine', (i, n) => { const x = Math.max(0, Math.min(255.996, f(i, n))); return Math.floor((x % 1) * 256); }); };
  const panK = model.spec.panRange < 200 ? 2.2 : 1;                              // small pan ranges need a bigger share of the channel
  set16('pan', p.pan || (() => 128 + 34 * panK * Math.sin(t * 0.45))); set16('tilt', p.tilt || (i => 74 + 16 * Math.sin(t * 0.33 + i * 0.5)));
  set('dimmer', 255); set('dim', 255); set('cutRot', 128);
  const open = probe(model, 'strobe', 'strobe', 'open', st => st.mode === 'open'), strobe = probe(model, 'strobe', 'strobe', 'st', st => st.mode === 'strobe');
  set('strobe', p.strobeK != null ? strobe + 70 * p.strobeK : open); set('ringStrobe', open);
  // focus: the value the model treats as sharp at mid zoom
  if (model.spec.focus) set('focus', 255 * (model.spec.focus[0] + model.spec.focus[1] * 0.4));
  // zoom charts run either way (0 = narrow or 0 = wide) → ask the model
  const narrow = model.decode({ zoom: 0 }).zoom < 0.5 ? 0 : 255, wide = 255 - narrow;
  set('zoom', narrow + (wide - narrow) * (p.zoomK ?? (N > 1 ? 0.15 : 0.4)));
  if (wheel) {
    if (p.colorFlow) set('color', probe(model, 'color', 'color', 'flow', c => c.pos == null && c.spin > 0.3 && c.spin < 1.2));
    else if (p.color != null) set('color', slot(model, 'color', 'color', Math.min(p.color, model.colors.length - 1)));
  }
  // colour-mixing fixtures: hue per head (default: slow rainbow across the heads)
  const hf = p.hue || ((i, n) => t * 0.05 + i / n * 0.3), dim = (p.dim ?? 255) / 255;
  ['r', 'g', 'b'].forEach((c, ci) => set(c, (i, n) => hue(hf(i, n))[ci] * 255 * dim));
  if (p.ring) ['ringR', 'ringG', 'ringB'].forEach((c, ci) => set(c, (i, n) => hue(p.ring(i, n))[ci] * 255));
  else ['ringR', 'ringG', 'ringB'].forEach((c, ci) => set(c, (i, n) => hue(hf(i, n) + 0.5)[ci] * 90));
  set('macro', p.macro);
  for (let h = 1; h <= N; h++) for (let b = 1; b <= 8; b++) ['r', 'g', 'b'].forEach((c, ci) => {     // direct pixel-ring blocks
    const key = `rb${h}_${b}${c}`; if (!chans.includes(key)) return;
    v[key] = p.blocks ? u8(hue(p.blocks(h - 1, b))[ci] * 255 * (Math.floor(t * 6 + h) % 8 === b - 1 || (b + Math.floor(t * 3)) % 2 ? 1 : 0.08)) : u8(hue(hf(h - 1, N) + 0.5 + b / 16)[ci] * 110);
  });
  if (p.gobo != null) set('gobo', slot(model, 'gobo', 'gobo', p.gobo));
  if (p.rot != null && model.gobos.rot.length > 1) set('rotGobo', slot(model, 'rotGobo', 'rotGobo', p.rot));
  if (p.goboSpin) set('goboRot', probe(model, 'goboRot', 'goboRot', 'spin', g => g.index == null && g.spin > 0.2 && g.spin < 0.5));
  if (p.prismOn) { set('prism', probe(model, 'prism', 'prism', 'on', on => on === true)); set('prismRot', probe(model, 'prismRot', 'prismRot', 'rot', r => Math.abs(r) > 0.3)); }
  for (const key of ['cyan', 'magenta', 'yellow', 'frost', 'cutRot', 'cut1', 'cut2', 'cut3', 'cut4', 'cut5', 'cut6', 'cut7', 'cut8']) set(key, p[key]);
  return { values: v, scene: s.name };
}
