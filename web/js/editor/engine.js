// editor/engine.js — playback engine: runs functions and produces the DMX universes 40 times a second.
//  Function types (after QLC+): Scene · Chaser · EFX · Collection · Audio · Show.
//   scene      { values: { fixtureId: { channelIndex: value } }, fadeIn, fadeOut }                 (ms)
//   chaser     { steps: [{ fn, fadeIn, hold, fadeOut }], order: loop|single|pingpong, direction: forward|backward }
//   efx        { fixtures: [{ fx, head }], algo, width, height, xOffset, yOffset, rotation, duration, spread, direction, phase? (start phase in degrees) }
//   collection { members: [functionId] }
//   audio      { file, volume }
//   show       { tracks: [{ name, mute, solo, items: [{ fn, start, duration, color, locked }] }] }
//  Merge rules: HTP channels (intensity, colour mixing) take the highest value of all running functions and are scaled
//  by the grand master; LTP channels (position, wheels, …) keep the latest value written and fade from where they were.
import { store, audioFiles } from './store.js';
import { modeOf } from './library.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const EFX_ALGOS = ['Circle', 'Eight', 'Line', 'Diamond', 'Square', 'Triangle', 'Lissajous'];
/** EFX path: phase 0..1 → x, y in −1..1 */
export function efxPoint(algo, p, f) {
  const a = p * Math.PI * 2;
  switch (algo) {
    case 'Eight': return [Math.cos(a), Math.sin(a * 2)];
    case 'Line': return [Math.cos(a), Math.cos(a)];
    case 'Diamond': return [Math.pow(Math.cos(a), 3), Math.pow(Math.sin(a), 3)];
    case 'Square': { const q = (p * 4) % 4, k = q % 1; return q < 1 ? [-1 + 2 * k, 1] : q < 2 ? [1, 1 - 2 * k] : q < 3 ? [1 - 2 * k, -1] : [-1, -1 + 2 * k]; }
    case 'Triangle': { const q = (p * 3) % 3, k = q % 1; return q < 1 ? [-1 + k, 1 - 2 * k] : q < 2 ? [k, -1 + 2 * k] : [1 - 2 * k, 1]; }
    case 'Lissajous': return [Math.cos(a * (f?.xFreq || 3)), Math.sin(a * (f?.yFreq || 2))];
    default: return [Math.cos(a), Math.sin(a)];
  }
}

const audioEls = new Map();      // file name → { el, url }
export async function audioEl(name) {
  if (!name) return null;
  if (!audioEls.has(name)) { const blob = await audioFiles.get(name); if (!blob) return null; const url = URL.createObjectURL(blob), el = new Audio(url); el.preload = 'auto'; audioEls.set(name, { el, url }); }
  return audioEls.get(name).el;
}
export const forgetAudio = name => { const a = audioEls.get(name); if (a) { a.el.pause(); URL.revokeObjectURL(a.url); audioEls.delete(name); } };

/** Estimated length of a function in ms (for new timeline items); 0 = open-ended */
export function durationOf(fn) {
  if (!fn) return 0;
  if (fn.type === 'chaser') return fn.steps.reduce((s, st) => s + (st.fadeIn || 0) + Math.max(0, st.hold || 0), 0);
  if (fn.type === 'efx') return fn.duration || 0;
  if (fn.type === 'audio') { const a = audioEls.get(fn.file); return a && isFinite(a.el.duration) ? Math.round(a.el.duration * 1000) : 0; }
  if (fn.type === 'show') return Math.max(0, ...fn.tracks.flatMap(t => t.items.map(i => i.start + i.duration)));
  return 0;
}

class Runner {
  constructor(engine, fn, opts) { this.e = engine; this.fn = fn; this.o = opts; this.t = 0; this.done = false; this.stopping = false; this.intensity = opts.intensity ?? 1; this.seq = engine.seq++; }
  stop() { this.done = true; }
  tick() {}
}

class SceneRunner extends Runner {
  constructor(e, fn, o) { super(e, fn, o); this.fadeIn = o.fadeIn ?? fn.fadeIn ?? 0; this.fadeOut = o.fadeOut ?? fn.fadeOut ?? 0; this.tOut = 0; this.rev = -1; }
  compile() {                                                   // scene values → absolute channels
    this.rev = this.fn.rev || 0; this.list = [];
    for (const [fid, vals] of Object.entries(this.fn.values || {})) {
      const fx = store.fixture(+fid), mode = fx && modeOf(fx); if (!mode) continue;
      for (const [ci, val] of Object.entries(vals)) {
        const c = mode.channels[+ci], a = fx.address - 1 + +ci; if (!c || a > 511 || !this.e.out[fx.universe]) continue;
        const prev = this.list && this.from && this.from.get(fx.universe * 512 + a);
        this.list.push({ u: fx.universe, a, val, htp: c.htp, from: prev ?? this.e.ltp[fx.universe][a] });
      }
    }
    this.from = new Map(this.list.map(c => [c.u * 512 + c.a, c.from]));
  }
  stop(fade = true) { if (fade && this.fadeOut > 0 && !this.stopping) { this.stopping = true; this.tOut = 0; } else this.done = true; }
  tick(dt) {
    if (this.rev !== (this.fn.rev || 0)) this.compile();
    this.t += dt;
    const kin = this.fadeIn > 0 ? clamp(this.t / this.fadeIn, 0, 1) : 1;
    let kout = 1;
    if (this.stopping) { this.tOut += dt; kout = 1 - clamp(this.tOut / this.fadeOut, 0, 1); if (kout <= 0) this.done = true; }
    const e = this.e, k = kin * kout * this.intensity;
    for (const c of this.list) {
      if (c.htp) { const v = c.val * k; if (v > e.htp[c.u][c.a]) e.htp[c.u][c.a] = v; }
      else if (!this.stopping) e.ltp[c.u][c.a] = Math.round(c.from + (c.val - c.from) * kin);   // LTP: fade from where the channel was
    }
  }
}

class ChaserRunner extends Runner {
  constructor(e, fn, o) { super(e, fn, o); this.dir = fn.direction === 'backward' ? -1 : 1; this.i = -1; this.cur = null; this.manual = !!o.manual; this.phase = 0; this.go(this.dir > 0 ? 0 : fn.steps.length - 1); }
  go(i) {
    const steps = this.fn.steps; if (!steps.length) { this.done = true; return; }
    const prev = this.cur, pStep = steps[this.i]; this.i = ((i % steps.length) + steps.length) % steps.length; this.phase = 0;
    const st = steps[this.i];
    this.cur = this.e.spawn(st.fn, { fadeIn: st.fadeIn ?? 0, fadeOut: st.fadeOut ?? 0, parent: this });
    if (prev) { prev.fadeOut = pStep ? (pStep.fadeOut ?? 0) : 0; prev.stop(true); }
    this.e.emit('step');
  }
  next() { this.advance(1); } prev() { this.advance(-1); }
  advance(d) {
    const n = this.fn.steps.length; let i = this.i + d * this.dir;
    if (i >= n || i < 0) {
      if (this.fn.order === 'single') return this.stop();
      if (this.fn.order === 'pingpong') { this.dir = -this.dir; i = this.i + d * this.dir; }
    }
    this.go(i);
  }
  stop(fade = true) { if (this.cur) this.cur.stop(fade); this.done = true; }
  tick(dt) {
    if (this.cur) this.cur.intensity = this.intensity;
    if (this.manual) return;
    this.phase += dt;
    const st = this.fn.steps[this.i]; if (!st) return;
    if (st.hold >= 0 && this.phase >= (st.fadeIn || 0) + (st.hold || 0)) this.advance(1);        // hold < 0 = wait for a manual step
  }
}

class EfxRunner extends Runner {
  tick(dt) {
    this.t += dt;
    const f = this.fn, e = this.e, n = f.fixtures.length || 1, dur = Math.max(100, f.duration || 4000), sgn = f.direction === 'backward' ? -1 : 1;
    const rot = (f.rotation || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
    f.fixtures.forEach((ref, i) => {
      const fx = store.fixture(ref.fx), mode = fx && modeOf(fx), h = mode && mode.heads[ref.head || 0]; if (!h) return;
      const p = (((sgn * this.t / dur + (i / n) * ((f.spread ?? 0) / 360) + (f.phase ?? 0) / 360) % 1) + 1) % 1;
      const [x0, y0] = efxPoint(f.algo, p, f), x = x0 * cr - y0 * sr, y = x0 * sr + y0 * cr;
      const pan = clamp((f.xOffset ?? 127) + x * (f.width ?? 60), 0, 255), tilt = clamp((f.yOffset ?? 127) + y * (f.height ?? 60), 0, 255);
      const put = (ci, v) => { if (ci >= 0) { const a = fx.address - 1 + ci; if (a < 512) e.ltp[fx.universe][a] = v; } };
      put(h.pan, Math.floor(pan)); put(h.panFine, Math.floor((pan % 1) * 256)); put(h.tilt, Math.floor(tilt)); put(h.tiltFine, Math.floor((tilt % 1) * 256));
    });
  }
}

class CollectionRunner extends Runner {
  constructor(e, fn, o) { super(e, fn, o); this.kids = (fn.members || []).map(id => e.spawn(id, { parent: this })).filter(Boolean); }
  stop(fade = true) { this.kids.forEach(k => k.stop(fade)); this.done = true; }
  tick() { this.kids.forEach(k => { k.intensity = this.intensity; }); }
}

class AudioRunner extends Runner {
  constructor(e, fn, o) {
    super(e, fn, o);
    audioEl(fn.file).then(el => { if (!el || this.done) return; this.el = el; el.volume = clamp((fn.volume ?? 100) / 100, 0, 1); el.currentTime = (o.offset || 0) / 1000; el.play().catch(() => {}); el.onended = () => { this.done = true; }; });
  }
  stop() { if (this.el) this.el.pause(); this.done = true; }
  /** playback position in ms (the show uses a running audio item as its clock) */
  get time() { return this.el && !this.el.paused ? this.el.currentTime * 1000 : null; }
}

class ShowRunner extends Runner {
  constructor(e, fn, o) { super(e, fn, o); this.t = o.offset || 0; this.active = new Map(); this.end = durationOf(fn); }
  stop(fade = true) { for (const r of this.active.values()) r.stop(fade); this.active.clear(); this.done = true; }
  tick(dt) {
    let clock = null;                                           // follow the audio clock when an audio item is playing
    for (const [it, r] of this.active) if (r instanceof AudioRunner && r.time != null) { clock = it.start + r.time; break; }
    // …but only while that clock really advances: an audio element that was told to play and is not producing sound yet
    // (autoplay not allowed, still loading, page in the background) must not hold the whole show at its start.
    this.stall = clock != null && clock !== this.lastClock ? 0 : (this.stall || 0) + dt; this.lastClock = clock;
    this.t = clock != null && this.stall < 250 && Math.abs(clock - this.t) < 400 ? clock : this.t + dt;
    const solo = this.fn.tracks.some(t => t.solo);
    for (const tr of this.fn.tracks) {
      const on = !tr.mute && (!solo || tr.solo);
      for (const it of tr.items) {
        const inside = on && this.t >= it.start && this.t < it.start + it.duration, r = this.active.get(it);
        if (inside && !r) { const nr = this.e.spawn(it.fn, { parent: this, offset: this.t - it.start }); if (nr) this.active.set(it, nr); }
        else if (!inside && r) { r.stop(true); this.active.delete(it); }
        else if (r && r.done) this.active.set(it, DONE);
      }
    }
    if (this.end && this.t >= this.end) this.stop();
  }
}
const DONE = { stop() {}, done: true };
const RUNNERS = { scene: SceneRunner, chaser: ChaserRunner, efx: EfxRunner, collection: CollectionRunner, audio: AudioRunner, show: ShowRunner };

export class Engine {
  constructor() {
    this.seq = 1; this.runners = [];                            // every runner, top-level and children
    this.top = new Map();                                       // function id → top-level runner (started by the user)
    this.gm = 1; this.blackout = false; this.listeners = new Set(); this.frames = 0;
    this.resize(); store.on(w => { if (w === 'workspace' || w === 'universes' || w === 'fixtures') this.resize(); });
  }
  on(fn) { this.listeners.add(fn); } emit(ev) { this.listeners.forEach(f => f(ev)); }
  /** (re)allocate universes and the HTP map from the patch */
  resize() {
    const n = store.ws.universes.length, keep = (arr, mk) => Array.from({ length: n }, (_, i) => (arr && arr[i]) || mk());
    this.out = keep(this.out, () => new Uint8Array(512)); this.ltp = keep(this.ltp, () => new Uint8Array(512)); this.htp = keep(this.htp, () => new Float32Array(512));
    this.desk = keep(this.desk, () => new Int16Array(512).fill(-1));                             // Simple Desk overrides (−1 = none)
    this.mask = Array.from({ length: n }, () => new Uint8Array(512).fill(1));                    // 1 = HTP (also unpatched channels)
    this.owner = Array.from({ length: n }, () => new Int32Array(512));                           // fixture id per channel (0 = free)
    for (const fx of store.ws.fixtures) { const m = modeOf(fx); if (!m || !this.mask[fx.universe]) continue;
      m.channels.forEach((c, i) => { const a = fx.address - 1 + i; if (a < 512) { this.mask[fx.universe][a] = c.htp ? 1 : 0; this.owner[fx.universe][a] = fx.id; } }); }
  }
  /** create a runner (also used by chasers, collections and shows for their children) */
  spawn(id, opts = {}) {
    const fn = store.fn(id), R = fn && RUNNERS[fn.type]; if (!R) return null;
    if (opts.parent && this.depth(opts.parent) > 8) return null;                                 // guards against functions that contain themselves
    const r = new R(this, fn, opts); r.parent = opts.parent || null; this.runners.push(r); return r;
  }
  depth(r) { let d = 0; while (r) { d++; r = r.parent; } return d; }
  start(id, opts = {}) { this.stop(id, false); const r = this.spawn(id, opts); if (r) { this.top.set(id, r); this.emit('run'); } return r; }
  stop(id, fade = true) { const r = this.top.get(id); if (r) { r.stop(fade); this.top.delete(id); this.emit('run'); } }
  toggle(id) { if (this.isRunning(id)) this.stop(id); else this.start(id); }
  isRunning(id) { const r = this.top.get(id); return !!r && !r.done; }
  runner(id) { return this.top.get(id); }
  stopAll() { for (const r of this.runners) r.stop(false); this.runners = []; this.top.clear(); this.emit('run'); }
  /** stop everything and send every channel back to 0 */
  reset() { this.stopAll(); this.ltp.forEach(a => a.fill(0)); this.desk.forEach(a => a.fill(-1)); this.emit('desk'); }

  tick(dt) {
    for (const h of this.htp) h.fill(0);
    for (const r of this.runners) if (!r.done) r.tick(dt);
    if (this.runners.some(r => r.done)) {
      this.runners = this.runners.filter(r => !r.done);
      let changed = false; for (const [id, r] of this.top) if (r.done) { this.top.delete(id); changed = true; }
      if (changed) this.emit('run');
    }
    for (let u = 0; u < this.out.length; u++) {
      const out = this.out[u], htp = this.htp[u], ltp = this.ltp[u], mask = this.mask[u], desk = this.desk[u];
      for (let a = 0; a < 512; a++) {
        let v = desk[a] >= 0 ? desk[a] : mask[a] ? htp[a] : ltp[a];
        if (mask[a]) v = this.blackout ? 0 : v * this.gm;
        out[a] = v;
      }
    }
    this.frames++;
  }
}
