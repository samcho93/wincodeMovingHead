// fixture.js — generic moving head "firmware": settings (NVS) · run modes · channels → mechanical/optical state
//  Everything model-specific (channel chart, wheels, defaults, panel type, body) comes from a model definition
//  in models/*.js. See models/index.js for the definition contract.
//  A fixture has one or more heads (model.heads). Each Head owns its pan/tilt axes and optical state and is what the
//  renderer reads; the Fixture's own pan/tilt/o/intensity… getters are shortcuts to head 1.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const approach = (cur, tgt, step) => (Math.abs(tgt - cur) <= step ? tgt : cur + Math.sign(tgt - cur) * step);
/** Move along a circular wheel to the target by the shortest path */
function approachWheel(cur, tgt, step, n) {
  let d = ((tgt - cur) % n + n) % n; if (d > n / 2) d -= n;
  if (Math.abs(d) <= step) return ((tgt % n) + n) % n;
  return (((cur + Math.sign(d) * step) % n) + n) % n;
}
const wrap = (v, n) => ((v % n) + n) % n;
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** Dimmer curves (0..1 → 0..1). Models without a curve setting use the square law. */
const CURVES = {
  'Linear': d => d, 'Square Law': d => d * d, 'Inv SQ Law': d => 1 - (1 - d) * (1 - d), 'S Curve': d => d * d * (3 - 2 * d),
};
/** Shutter opening (0..1) of a strobe target at time T */
function shutter(st, T) {
  if (!st || st.mode === 'open') return 1;
  if (st.mode === 'closed') return 0;
  if (st.mode === 'strobe') return (T * st.hz) % 1 < 0.42 ? 1 : 0;
  if (st.mode === 'pulse') return Math.pow(1 - (T * st.hz) % 1, 2.2);       // fast open, slow close
  if (st.mode === 'fadein') return Math.pow((T * st.hz) % 1, 1.6);          // slow open, fast close
  if (st.mode === 'random') { const n = Math.floor(T * st.hz); return hash(n) < 0.45 && (T * st.hz) % 1 < 0.5 ? 1 : 0; }
  return 1;
}

/** One axis (pan/tilt): critically damped follower with a speed limit.
 *  A real head's motor driver smooths the 8-bit / 40 Hz steps of a DMX channel; chasing the target directly made the
 *  speed jump by ~15°/s from frame to frame, which showed as a shaking beam. This keeps frame-to-frame speed changes tiny. */
class Axis {
  constructor(vmax, smooth) { this.pos = 0; this.vel = 0; this.vmax = vmax; this.smooth = smooth; }
  step(target, dt, speedScale) {
    const sc = Math.max(0.03, speedScale), st = this.smooth / Math.sqrt(sc), om = 2 / st, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const maxC = this.vmax * sc * st, ch = Math.min(maxC, Math.max(-maxC, this.pos - target)), tg = this.pos - ch;
    const tmp = (this.vel + om * ch) * dt;
    this.vel = (this.vel - om * tmp) * ex;
    let out = tg + (ch + tmp) * ex;
    if ((target - this.pos > 0) === (out > target)) { out = target; this.vel = 0; }   // never overshoot
    this.pos = out;
  }
}

/** One head: axes + optical state (actual motor positions) + the values the renderer reads */
export class Head {
  constructor(fx, index) {
    this.fx = fx; this.index = index;
    this.pan = new Axis(215, 0.2); this.tilt = new Axis(185, 0.2);
    this.tilt.pos = -fx.model.spec.tiltRange / 2;                // an unpowered head hangs down
    this.o = { colorPos: 0, cmy: [0, 0, 0], cto: 0, goboPos: 0, goboOfs: 0, rotPos: 0, rotOfs: 0, goboAngle: 0, zoom: 0, focus: 0.4, frost: 0,
      prism: 0, prismAngle: 0, blades: [0, 0, 0, 0, 0, 0, 0, 0], bladeRot: 0, dimmer: 0, shutter: 0,
      rgb: [1, 1, 1], level: 1,                                 // colour-mixing LED engines: hue (max component 1) and output level
      ring: Array.from({ length: 8 }, () => [0, 0, 0]) };       // pixel ring: 8 blocks, RGB 0..1 (after macro and strobe)
  }
  get model() { return this.fx.model; }
  get beamAngleDeg() { const SP = this.model.spec; return SP.zoomMin + (SP.zoomMax - SP.zoomMin) * this.o.zoom; }
  get intensity() {
    const fx = this.fx; if (!fx.power || !fx.lampOn) return 0;
    const curve = CURVES[fx.settings.dimCurve] || CURVES['Square Law'];
    return (fx.identify ? 1 : curve(this.o.dimmer)) * this.o.shutter * (this.model.features.rgbl ? this.o.level : 1);
  }
  /** The in-focus position shifts slightly with zoom. 0 = sharp (fixtures without a focus channel are always sharp) */
  get defocus() { const f = this.model.spec.focus; return f ? Math.abs(this.o.focus - (f[0] + f[1] * this.o.zoom)) : 0; }
  /** Colour filtering after the wheel: CMY flags (subtractive) and CTO */
  get filter() {
    const [c, m, y] = this.o.cmy, k = this.o.cto;
    return [(1 - 0.96 * c) * (1 - 0.06 * m), (1 - 0.94 * m) * (1 - 0.12 * c) * (1 - 0.1 * y) * (1 - 0.3 * k), (1 - 0.95 * y) * (1 - 0.1 * m) * (1 - 0.62 * k)];
  }
  /** Colour of the beam */
  get tint() {
    const M = this.model, w = M.spec.ledWhite;
    if (M.features.rgbl) return this.o.rgb.map((v, k) => v * w[k]);
    const C = M.colors, n = C.length, p = this.o.colorPos, i = Math.floor(p) % n, f = p - Math.floor(p);
    const a = C[i].rgb, b = C[(i + 1) % n].rgb, fl = this.filter;
    return [0, 1, 2].map(k => (a[k] * (1 - f) + b[k] * f) * w[k] * fl[k]);
  }
}

const COMMON_SETTINGS = { address: 1, runMode: 'DMX', panInvert: false, tiltInvert: false, lang: 'EN', totalHours: 0, powerCount: 0 };

export class Fixture {
  /** opts.persist === false: settings are not loaded from / saved to the browser (several fixtures of one model on a stage);
   *  opts.settings: initial settings (address, mode, …) */
  constructor(model, opts = {}) {
    this.model = model; this.lsKey = opts.persist === false ? null : `wmh.settings.${model.id}.v1`;
    this.KEYS = model.modes[model.defaultMode].channels.slice();
    for (const m of Object.values(model.modes)) for (const k of m.channels) if (!this.KEYS.includes(k)) this.KEYS.push(k);
    this.settings = this.defaults();
    if (this.lsKey) try { const s = JSON.parse(localStorage.getItem(this.lsKey) || 'null'); if (s) this.settings = this.merge(this.defaults(), s); } catch (e) {}
    if (opts.settings) Object.assign(this.settings, opts.settings);
    if (!model.modes[this.settings.mode]) this.settings.mode = model.defaultMode;
    this.manual = this.blank(model.manualDefaults);              // Manual-menu values (models with noSignal = 'manual')
    this.home = this.blank(model.homeValues);                    // state right after reset
    this.ch = Object.assign({}, this.home); this.chSource = 'home'; this.held = null;
    this.dmx = new Uint8Array(512); this.lastDmx = -1e9; this.dmxSignal = false; this.dmxFps = 0; this._fpsN = 0; this._fpsT = 0;
    this.power = false; this.resetT = -1; this.resetKind = 'all'; this.resetHold = 0; this.funcHold = 0; this.funcKey = ''; this.identify = false; this.inverted = false;
    this.local = null; this.localSrc = 'local';                  // simulator override: values set from the Status sliders ('local') or the demo ('demo')
    this.demo = false; this.demoT = 0; this.demoScene = '';
    this.lampOn = true; this.sceneEdit = null;                   // sceneEdit: index of the scene being edited on the panel
    this.sessionSec = 0; this.tempC = 26; this.time = 0;
    this.heads = Array.from({ length: model.heads || 1 }, (_, i) => new Head(this, i));
    this.prog = { step: 0, t: 0 }; this.scn = { i: 0, t: 0 }; this.beat = false;
    this.listeners = new Set(); this.dmxOut = null;               // dmxOut: frame sent as master (DMX OUT)
    this.log = () => {};
  }
  // shortcuts to head 1 (single-head fixtures, panels, status)
  get pan() { return this.heads[0].pan; }
  get tilt() { return this.heads[0].tilt; }
  get o() { return this.heads[0].o; }
  get beamAngleDeg() { return this.heads[0].beamAngleDeg; }
  get defocus() { return this.heads[0].defocus; }
  get filter() { return this.heads[0].filter; }
  get tint() { return this.heads[0].tint; }
  /** Brightest head (for "is the fixture lit" decisions) */
  get intensity() { let m = 0; for (const h of this.heads) m = Math.max(m, h.intensity); return m; }

  defaults() {
    const s = Object.assign({}, COMMON_SETTINGS, structuredClone(this.model.settings || {}), { mode: this.model.defaultMode });
    if (this.model.features.scenes) s.scenes = Array.from({ length: 10 }, (_, i) => ({ time: i ? 0 : 30, v: this.blank(i ? this.model.homeValues : this.model.sceneDefault) }));
    return s;
  }
  merge(def, saved) { for (const k of Object.keys(saved)) { if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) Object.assign(def[k], saved[k]); else def[k] = saved[k]; } return def; }
  /** A value for every channel key; `vals` may be an object or a function key → value */
  blank(vals) { const o = {}, f = typeof vals === 'function' ? vals : k => vals && vals[k]; (this.KEYS || []).forEach(k => { o[k] = f(k) ?? 0; }); return o; }
  on(fn) { this.listeners.add(fn); }
  emit(ev) { this.listeners.forEach(f => f(ev)); }
  save() { if (this.lsKey) try { localStorage.setItem(this.lsKey, JSON.stringify(this.settings)); } catch (e) {} this.emit('settings'); }
  /** Skip the power-up homing sequence (stage view: fixtures are ready at once) */
  skipReset() { this.resetT = -1; for (const h of this.heads) { h.pan.pos = 0; h.pan.vel = 0; h.tilt.pos = 0; h.tilt.vel = 0; } }
  set(key, val) { this.settings[key] = val; this.save(); }
  get mode() { return this.model.modes[this.settings.mode] || this.model.modes[this.model.defaultMode]; }
  get footprint() { return this.mode.channels.length; }
  /** Is the display upside down? (manual flip, or auto-rotate when hung inverted) */
  get displayFlipped() { const S = this.settings; return S.rot ? (S.rot === 'ON' || (S.rot === 'AUTO' && this.inverted)) : !!S.flip; }

  /* ── power / reset ── */
  setPower(on) {
    if (on === this.power) return;
    this.power = on;
    if (on) { this.settings.powerCount++; this.sessionSec = 0; this.lampOn = this.settings.lampMode !== 'Manual'; this.save(); this.startReset('power'); }
    else { this.resetT = -1; this.held = null; }
    this.emit('power');
  }
  /** kind: 'all' | 'xy' (pan/tilt only) | 'effect' (wheels and lenses only) */
  startReset(why, kind = 'all') { if (!this.power) return; this.resetT = 0; this.resetKind = kind; this.log(`Reset started (${why}${kind === 'all' ? '' : ', ' + kind})`); this.emit('reset'); }
  get resetting() { return this.resetT >= 0; }
  factoryDefaults() {
    const keep = { totalHours: this.settings.totalHours, powerCount: this.settings.powerCount };
    this.settings = Object.assign(this.defaults(), keep);
    this.manual = this.blank(this.model.manualDefaults);
    this.save();
  }

  /** Take direct control of the channel values (starts from what is in effect now). src: 'local' | 'demo' */
  override(src = 'local') { if (!this.local) this.local = Object.assign({}, this.ch); this.localSrc = src; return this.local; }
  /** Give control back to the fixture's own run mode / DMX input */
  release() { this.local = null; this.demo = false; this.emit('override'); }

  /* ── DMX IN ── */
  feedDmx(data) {                                   // data: slots 1..512 (start-code-0 frames only)
    this.dmx.fill(0); this.dmx.set(data.subarray(0, 512));
    this.lastDmx = performance.now(); this._fpsN++;
  }

  /** Where the channel values come from this frame → { v, src } */
  source(dt, sig) {
    const S = this.settings, M = this.model, F = M.features, chans = this.mode.channels;
    const pickKeys = o => { const v = {}; chans.forEach(k => { v[k] = o[k] | 0; }); return v; };
    if (this.local) return { v: pickKeys(this.local), src: this.localSrc };
    if (this.sceneEdit != null && F.scenes) return { v: pickKeys(S.scenes[this.sceneEdit].v), src: 'edit' };
    if (S.runMode === 'DMX' || (F.ms && S.msMode === 'Auto' && sig)) {
      if (sig) { const v = {}; chans.forEach((k, i) => { const a = S.address - 1 + i; v[k] = a < 512 ? this.dmx[a] : 0; }); this.held = v; return { v, src: 'dmx' }; }
      if (S.dataHold && this.held) return { v: pickKeys(this.held), src: 'hold' };   // "Data hold" / "No DMX State: Keep"
      if (M.noSignal === 'manual') return { v: pickKeys(this.manual), src: 'manual' };
      return { v: pickKeys(this.home), src: 'home' };
    }
    if (S.runMode === 'SCENE' && F.scenes) return { v: pickKeys(this.runScenes(dt)), src: 'scene' };
    return { v: this.runProgram(dt, chans), src: S.runMode === 'SOUND' ? 'sound' : 'auto' };
  }

  /* ── one frame ── */
  update(dt) {
    const now = performance.now(), M = this.model, SP = M.spec;
    this.time += dt;
    if (now - this._fpsT > 1000) { this.dmxFps = this._fpsN * 1000 / (now - this._fpsT); this._fpsN = 0; this._fpsT = now; }
    const sig = now - this.lastDmx < 1500;
    if (sig !== this.dmxSignal) { this.dmxSignal = sig; this.emit('signal'); }
    if (!this.power) {                               // power OFF: dark, heads sag under their own weight
      for (const h of this.heads) { h.o.dimmer = 0; h.o.shutter = 0; h.tilt.step(-SP.tiltRange / 2, dt, 0.25); h.pan.vel = 0; for (const b of h.o.ring) b[0] = b[1] = b[2] = 0; }
      this.tempC += (24 - this.tempC) * dt * 0.02; this.dmxOut = null;
      return;
    }
    this.sessionSec += dt;
    this.settings.totalHours += dt / 3600;
    if (((this.sessionSec / 60) | 0) !== (((this.sessionSec - dt) / 60) | 0)) this.save();

    // 1) channel values
    const S = this.settings, chans = this.mode.channels;
    const { v, src } = this.source(dt, sig);
    this.ch = v; this.chSource = src;
    this.dmxOut = null;
    if (src === 'auto' || src === 'sound' || src === 'scene') {       // running stand-alone → may drive slaves (they listen at address 1)
      if (M.features.ms ? (S.msMode === 'Master' && !sig) : true) { const out = new Uint8Array(512); chans.forEach((k, i) => { out[i] = v[k]; }); this.dmxOut = out; }
    }
    const t = M.decode(v), ts = t.heads || [t];

    // 2) reset / function channel (value held for model.resetHold seconds) and the reset sequence
    const live = src === 'dmx' || src === 'local';
    const wantReset = live && t.reset ? (t.reset === true ? 'all' : t.reset) : null;
    this.resetHold = wantReset ? this.resetHold + dt : 0;
    if (this.resetHold > M.resetHold && !this.resetting) { this.resetHold = -1e9; this.startReset('DMX', wantReset); }
    const fk = live && t.apply ? JSON.stringify(t.apply) : '';   // settings a "function" channel asks for (dimmer curve, …)
    this.funcHold = fk && fk === this.funcKey ? this.funcHold + dt : 0; this.funcKey = fk;
    if (fk && this.funcHold > M.resetHold) { this.funcHold = -1e9; Object.assign(S, t.apply); this.save(); this.log(`Function channel: ${Object.entries(t.apply).map(e => e.join(' = ')).join(', ')}`); }
    let homing = false, homeFx = false, homeXY = false;
    if (this.resetting) {
      this.resetT += dt;
      if (this.resetT < 3.6) { homing = true; homeFx = this.resetKind !== 'xy'; homeXY = this.resetKind !== 'effect'; }   // find home (end stops)
    }
    const [offP, offT] = M.offsets ? M.offsets(S) : [0, 0];
    const nC = M.colors.length, nF = M.gobos.fix.length, nR = M.gobos.rot.length, T = this.time;
    let arrived = true, load = 0;

    this.heads.forEach((h, hi) => {
      const th = ts[Math.min(hi, ts.length - 1)], o = h.o;
      let panT = (th.pan - 0.5) * SP.panRange * (S.panInvert ? -1 : 1) + offP;
      let tiltT = (th.tilt - 0.5) * SP.tiltRange * (S.tiltInvert ? -1 : 1) + offT;
      if (homeXY) { panT = -SP.panRange / 2; tiltT = -SP.tiltRange / 2; }
      const speed = this.resetting ? 0.8 : 1 - 0.965 * (th.ptSpeed ?? t.ptSpeed ?? 0);
      h.pan.step(clamp(panT, -SP.panRange / 2, SP.panRange / 2), dt, speed);
      h.tilt.step(clamp(tiltT, -SP.tiltRange / 2, SP.tiltRange / 2), dt, speed);
      if (Math.abs(h.pan.pos - panT) > 0.5 || Math.abs(h.tilt.pos - tiltT) > 0.5) arrived = false;

      // wheels and lenses
      if (homeFx) {                                  // spin the wheels once during reset
        o.colorPos = (o.colorPos + dt * 4) % nC; if (nF > 1) o.goboPos = (o.goboPos + dt * 3.5) % nF; if (nR > 1) o.rotPos = (o.rotPos + dt * 3) % nR;
        o.goboAngle = (o.goboAngle + dt * 300) % 360; o.zoom = approach(o.zoom, 0, dt * 0.9); o.prism = approach(o.prism, 0, dt * 3);
        for (let i = 0; i < 3; i++) o.cmy[i] = approach(o.cmy[i], 0, dt * 2);
        for (let i = 0; i < 8; i++) o.blades[i] = approach(o.blades[i], 0, dt * 2);
        o.bladeRot = approach(o.bladeRot, 0, dt * 2);
      } else if (!homing) {
        if (!th.color) o.colorPos = approachWheel(o.colorPos, 0, dt * 9, nC);   // wheels the model does not drive stay open
        if (!th.gobo) o.goboPos = 0;
        if (!th.rotGobo) o.rotPos = 0;
        if (th.color) { if (th.color.pos != null) o.colorPos = approachWheel(o.colorPos, th.color.pos, dt * 9, nC); else o.colorPos = wrap(o.colorPos + th.color.spin * dt, nC); }
        if (th.gobo) {
          if (th.gobo.pos != null) o.goboPos = approachWheel(o.goboPos, th.gobo.pos, dt * 8, nF); else o.goboPos = wrap(o.goboPos + th.gobo.spin * dt, nF);
          o.goboOfs = th.gobo.shake ? Math.sin(T * Math.PI * 2 * th.gobo.shake) * 0.13 : 0;
        }
        if (th.rotGobo) {
          if (th.rotGobo.pos != null) o.rotPos = approachWheel(o.rotPos, th.rotGobo.pos, dt * 7, nR); else o.rotPos = wrap(o.rotPos + th.rotGobo.spin * dt, nR);
          o.rotOfs = th.rotGobo.shake ? Math.sin(T * Math.PI * 2 * th.rotGobo.shake) * 0.13 : 0;
        }
        const gr = th.goboRot;
        if (gr) {
          if (gr.index != null) o.goboAngle = approachWheel(o.goboAngle, gr.index, dt * 420, 360);
          else if (gr.bounce) o.goboAngle = 45 * Math.sin(T * Math.PI * 2 * gr.bounce * 0.5);
          else o.goboAngle = wrap(o.goboAngle + gr.spin * 360 * dt, 360);
        }
        if (th.cmy) for (let i = 0; i < 3; i++) o.cmy[i] = approach(o.cmy[i], th.cmy[i], dt * 3.5);
        if (th.cto != null) o.cto = approach(o.cto, th.cto, dt * 3.5);
        if (th.blades) for (let i = 0; i < 8; i++) o.blades[i] = approach(o.blades[i], th.blades[i], dt * 2.8);
        if (th.bladeRot != null) o.bladeRot = approach(o.bladeRot, th.bladeRot, dt * 2.2);
        o.zoom = approach(o.zoom, th.zoom, dt * 0.85);
        if (th.focus != null) o.focus = approach(o.focus, th.focus, dt * 1.6);
        o.frost = approach(o.frost, th.frost || 0, dt * 2.5);
        o.prism = approach(o.prism, th.prism ? 1 : 0, dt * 3.5);
        o.prismAngle = wrap(o.prismAngle + (th.prismRot || 0) * 360 * dt, 360);
      }
      // colour-mixing LED engine (electronic → near instant)
      if (th.rgb) { const k = Math.min(1, dt * 30); for (let i = 0; i < 3; i++) o.rgb[i] += (th.rgb[i] - o.rgb[i]) * k; o.level += ((th.level ?? 1) - o.level) * k; }

      // dimmer and shutter (electronic LED strobe)
      const dimRate = S.dimSpeed === 'Smooth' ? 6 : 22;
      o.dimmer += ((homing ? 0 : th.dimmer) - o.dimmer) * Math.min(1, dt * dimRate);
      o.shutter = this.identify ? ((T * 2) % 1 < 0.5 ? 1 : 0) : homing ? 0 : shutter(th.strobe, T);
      load += (this.lampOn ? (this.identify ? 1 : o.dimmer) * (o.shutter > 0 ? 1 : 0.2) : 0) / this.heads.length;

      // pixel ring: 8 blocks; the model supplies either the blocks themselves or a base colour + macro
      if (th.ring) {
        const rs = homing ? 0 : shutter(th.ring.strobe, T), blocks = th.ring.blocks || M.ringMacro(th.ring, T, hi);
        for (let b = 0; b < 8; b++) for (let c = 0; c < 3; c++) o.ring[b][c] = blocks[b][c] * rs;
      }
    });

    if (this.resetting && !homing && (this.resetT > 4 && arrived || this.resetT > 12)) { this.resetT = -1; this.log('Reset complete'); this.emit('reset'); }
    // temperature (display only): follows the LED output slowly
    this.tempC += ((30 + (SP.tempRise || 38) * load) - this.tempC) * dt * 0.03;
  }

  /** Built-in program (Auto / Host / Sound) → channel values */
  runProgram(dt, chans) {
    const p = this.prog, P = this.model.program, sound = this.settings.runMode === 'SOUND';
    p.t += dt;
    if (sound ? this.beat : p.t > (P.stepTime || 3.2)) { p.step = (p.step + 1) % P.steps.length; p.t = 0; }
    this.beat = false;
    const s = Object.assign({}, P.base, P.steps[p.step]), v = {};
    chans.forEach(k => { v[k] = s[k] ?? (P.fill ? P.fill(k, s, p.step) : undefined) ?? 0; });
    if ('ptSpeed' in v) v.ptSpeed = sound ? 0 : 60;
    if (sound && 'dimmer' in v) v.dimmer = Math.round(255 * Math.max(0.25, 1 - p.t * 1.6));   // flash on the beat
    return v;
  }
  /** Scene mode: one fixed scene (1–10) or an automatic loop over the scenes whose time is not 0 */
  runScenes(dt) {
    const S = this.settings, sc = S.scenes;
    if (S.sceneSel !== 'Auto') return sc[clamp((S.sceneSel | 0) - 1, 0, 9)].v;
    const live = sc.map((s, i) => i).filter(i => sc[i].time > 0);
    if (!live.length) return this.home;
    if (!live.includes(this.scn.i)) { this.scn.i = live[0]; this.scn.t = 0; }
    this.scn.t += dt;
    if (this.scn.t > sc[this.scn.i].time * 0.1) { this.scn.i = live[(live.indexOf(this.scn.i) + 1) % live.length]; this.scn.t = 0; }
    return sc[this.scn.i].v;
  }
}
