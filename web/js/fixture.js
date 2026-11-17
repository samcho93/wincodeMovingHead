// fixture.js — generic moving head "firmware": settings (NVS) · run modes · channels → mechanical/optical state
//  Everything model-specific (channel chart, wheels, defaults, panel type, body) comes from a model definition
//  in models/*.js. See models/index.js for the definition contract.

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

/** One axis (pan/tilt): acceleration-limited trapezoidal speed profile */
class Axis {
  constructor(vmax, acc) { this.pos = 0; this.vel = 0; this.vmax = vmax; this.acc = acc; }
  step(target, dt, speedScale) {
    const err = target - this.pos, vmax = this.vmax * speedScale;
    const want = Math.sign(err) * Math.min(vmax, Math.sqrt(2 * this.acc * Math.abs(err)));
    this.vel = approach(this.vel, want, this.acc * dt);
    this.pos += this.vel * dt;
    if (Math.abs(err) < 0.02 && Math.abs(this.vel) < 2) { this.pos = target; this.vel = 0; }
  }
}

const COMMON_SETTINGS = { address: 1, runMode: 'DMX', panInvert: false, tiltInvert: false, lang: 'EN', totalHours: 0, powerCount: 0 };

export class Fixture {
  constructor(model) {
    this.model = model; this.lsKey = `wmh.settings.${model.id}.v1`;
    this.KEYS = model.modes[model.defaultMode].channels.slice();
    for (const m of Object.values(model.modes)) for (const k of m.channels) if (!this.KEYS.includes(k)) this.KEYS.push(k);
    this.settings = this.defaults();
    try { const s = JSON.parse(localStorage.getItem(this.lsKey) || 'null'); if (s) this.settings = this.merge(this.defaults(), s); } catch (e) {}
    if (!model.modes[this.settings.mode]) this.settings.mode = model.defaultMode;
    this.manual = this.blank(model.manualDefaults);              // Manual-menu values (models with noSignal = 'manual')
    this.home = this.blank(model.homeValues);                    // state right after reset
    this.ch = Object.assign({}, this.home); this.chSource = 'home'; this.held = null;
    this.dmx = new Uint8Array(512); this.lastDmx = -1e9; this.dmxSignal = false; this.dmxFps = 0; this._fpsN = 0; this._fpsT = 0;
    this.power = false; this.resetT = -1; this.resetKind = 'all'; this.resetHold = 0; this.identify = false; this.inverted = false;
    this.local = null; this.localSrc = 'local';                  // simulator override: values set from the Status sliders ('local') or the demo ('demo')
    this.demo = false; this.demoT = 0; this.demoScene = '';
    this.lampOn = true; this.sceneEdit = null;                   // sceneEdit: index of the scene being edited on the panel
    this.sessionSec = 0; this.tempC = 26; this.time = 0;
    this.pan = new Axis(215, 900); this.tilt = new Axis(185, 900);
    this.tilt.pos = -model.spec.tiltRange / 2;                    // an unpowered head hangs down
    // optical state (actual motor positions)
    this.o = { colorPos: 0, cmy: [0, 0, 0], cto: 0, goboPos: 0, goboOfs: 0, rotPos: 0, rotOfs: 0, goboAngle: 0, zoom: 0, focus: 0.4, frost: 0,
      prism: 0, prismAngle: 0, blades: [0, 0, 0, 0, 0, 0, 0, 0], bladeRot: 0, dimmer: 0, shutter: 0 };
    this.prog = { step: 0, t: 0 }; this.scn = { i: 0, t: 0 }; this.beat = false;
    this.listeners = new Set(); this.dmxOut = null;               // dmxOut: frame sent as master (DMX OUT)
    this.log = () => {};
  }
  defaults() {
    const s = Object.assign({}, COMMON_SETTINGS, structuredClone(this.model.settings || {}), { mode: this.model.defaultMode });
    if (this.model.features.scenes) s.scenes = Array.from({ length: 10 }, (_, i) => ({ time: i ? 0 : 30, v: this.blank(i ? this.model.homeValues : this.model.sceneDefault) }));
    return s;
  }
  merge(def, saved) { for (const k of Object.keys(saved)) { if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) Object.assign(def[k], saved[k]); else def[k] = saved[k]; } return def; }
  blank(vals) { const o = {}; (this.KEYS || []).forEach(k => { o[k] = (vals && vals[k]) ?? 0; }); return o; }
  on(fn) { this.listeners.add(fn); }
  emit(ev) { this.listeners.forEach(f => f(ev)); }
  save() { try { localStorage.setItem(this.lsKey, JSON.stringify(this.settings)); } catch (e) {} this.emit('settings'); }
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
      if (M.noSignal === 'manual') return { v: pickKeys(this.manual), src: 'manual' };
      if (S.dataHold && this.held) return { v: this.held, src: 'hold' };
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
    const o = this.o;
    if (!this.power) {                               // power OFF: dark, head sags under its own weight
      o.dimmer = 0; o.shutter = 0; this.tilt.step(-SP.tiltRange / 2, dt, 0.25); this.pan.vel = 0;
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
    const t = M.decode(v);

    // 2) reset channel (held for model.resetHold seconds) / reset sequence
    const wantReset = src === 'dmx' && t.reset ? (t.reset === true ? 'all' : t.reset) : null;
    this.resetHold = wantReset ? this.resetHold + dt : 0;
    if (this.resetHold > M.resetHold && !this.resetting) { this.resetHold = -1e9; this.startReset('DMX', wantReset); }
    const [offP, offT] = M.offsets ? M.offsets(S) : [0, 0];
    let panT = (t.pan - 0.5) * SP.panRange * (S.panInvert ? -1 : 1) + offP;
    let tiltT = (t.tilt - 0.5) * SP.tiltRange * (S.tiltInvert ? -1 : 1) + offT;
    let speed = 1 - 0.965 * (t.ptSpeed || 0), homing = false, homeFx = false;
    if (this.resetting) {
      this.resetT += dt; speed = 0.8;
      if (this.resetT < 3.6) {                       // find home (end stops)
        homing = true; homeFx = this.resetKind !== 'xy';
        if (this.resetKind !== 'effect') { panT = -SP.panRange / 2; tiltT = -SP.tiltRange / 2; }
      } else if (this.resetT > 4 && Math.abs(this.pan.pos - panT) < 0.5 && Math.abs(this.tilt.pos - tiltT) < 0.5 || this.resetT > 12) {
        this.resetT = -1; this.log('Reset complete'); this.emit('reset');
      }
    }
    this.pan.step(clamp(panT, -SP.panRange / 2, SP.panRange / 2), dt, speed);
    this.tilt.step(clamp(tiltT, -SP.tiltRange / 2, SP.tiltRange / 2), dt, speed);

    // 3) wheels and lenses
    const nC = M.colors.length, nF = M.gobos.fix.length, nR = M.gobos.rot.length;
    if (homeFx) {                                    // spin the wheels once during reset
      o.colorPos = (o.colorPos + dt * 4) % nC; if (nF > 1) o.goboPos = (o.goboPos + dt * 3.5) % nF; if (nR > 1) o.rotPos = (o.rotPos + dt * 3) % nR;
      o.goboAngle = (o.goboAngle + dt * 300) % 360; o.zoom = approach(o.zoom, 0, dt * 0.9); o.prism = approach(o.prism, 0, dt * 3);
      for (let i = 0; i < 3; i++) o.cmy[i] = approach(o.cmy[i], 0, dt * 2);
      for (let i = 0; i < 8; i++) o.blades[i] = approach(o.blades[i], 0, dt * 2);
      o.bladeRot = approach(o.bladeRot, 0, dt * 2);
    } else if (!homing) {
      if (!t.color) o.colorPos = approachWheel(o.colorPos, 0, dt * 9, nC);   // wheels the model does not drive stay open
      if (!t.gobo) o.goboPos = 0;
      if (!t.rotGobo) o.rotPos = 0;
      if (t.color) { if (t.color.pos != null) o.colorPos = approachWheel(o.colorPos, t.color.pos, dt * 9, nC); else o.colorPos = wrap(o.colorPos + t.color.spin * dt, nC); }
      if (t.gobo) {
        if (t.gobo.pos != null) o.goboPos = approachWheel(o.goboPos, t.gobo.pos, dt * 8, nF); else o.goboPos = wrap(o.goboPos + t.gobo.spin * dt, nF);
        o.goboOfs = t.gobo.shake ? Math.sin(this.time * Math.PI * 2 * t.gobo.shake) * 0.13 : 0;
      }
      if (t.rotGobo) {
        if (t.rotGobo.pos != null) o.rotPos = approachWheel(o.rotPos, t.rotGobo.pos, dt * 7, nR); else o.rotPos = wrap(o.rotPos + t.rotGobo.spin * dt, nR);
        o.rotOfs = t.rotGobo.shake ? Math.sin(this.time * Math.PI * 2 * t.rotGobo.shake) * 0.13 : 0;
      }
      const gr = t.goboRot;
      if (gr) {
        if (gr.index != null) o.goboAngle = approachWheel(o.goboAngle, gr.index, dt * 420, 360);
        else if (gr.bounce) o.goboAngle = 45 * Math.sin(this.time * Math.PI * 2 * gr.bounce * 0.5);
        else o.goboAngle = wrap(o.goboAngle + gr.spin * 360 * dt, 360);
      }
      if (t.cmy) for (let i = 0; i < 3; i++) o.cmy[i] = approach(o.cmy[i], t.cmy[i], dt * 3.5);
      if (t.cto != null) o.cto = approach(o.cto, t.cto, dt * 3.5);
      if (t.blades) for (let i = 0; i < 8; i++) o.blades[i] = approach(o.blades[i], t.blades[i], dt * 2.8);
      if (t.bladeRot != null) o.bladeRot = approach(o.bladeRot, t.bladeRot, dt * 2.2);
      o.zoom = approach(o.zoom, t.zoom, dt * 0.85);
      o.focus = approach(o.focus, t.focus, dt * 1.6);
      o.frost = approach(o.frost, t.frost || 0, dt * 2.5);
      o.prism = approach(o.prism, t.prism ? 1 : 0, dt * 3.5);
      o.prismAngle = wrap(o.prismAngle + (t.prismRot || 0) * 360 * dt, 360);
    }

    // 4) dimmer and shutter (electronic LED strobe)
    const dimT = homing ? 0 : t.dimmer;
    o.dimmer += (dimT - o.dimmer) * Math.min(1, dt * 22);
    const st = t.strobe, T = this.time;
    let sh = 1;
    if (homing || st.mode === 'closed') sh = 0;
    else if (st.mode === 'strobe') sh = (T * st.hz) % 1 < 0.42 ? 1 : 0;
    else if (st.mode === 'pulse') sh = Math.pow(1 - (T * st.hz) % 1, 2.2);
    else if (st.mode === 'fadein') sh = Math.pow((T * st.hz) % 1, 1.6);
    else if (st.mode === 'random') { const n = Math.floor(T * st.hz); sh = hash(n) < 0.45 && (T * st.hz) % 1 < 0.5 ? 1 : 0; }
    if (this.identify) sh = (T * 2) % 1 < 0.5 ? 1 : 0;
    o.shutter = sh;

    // 5) temperature (display only): follows the LED output slowly
    const load = this.lampOn ? (this.identify ? 1 : o.dimmer) * (sh > 0 ? 1 : 0.2) : 0;
    this.tempC += ((30 + (SP.tempRise || 38) * load) - this.tempC) * dt * 0.03;
  }

  /** Built-in program (Auto / Host / Sound) → channel values */
  runProgram(dt, chans) {
    const p = this.prog, P = this.model.program, sound = this.settings.runMode === 'SOUND';
    p.t += dt;
    if (sound ? this.beat : p.t > 3.2) { p.step = (p.step + 1) % P.steps.length; p.t = 0; }
    this.beat = false;
    const s = Object.assign({}, P.base, P.steps[p.step]), v = {};
    chans.forEach(k => { v[k] = s[k] ?? 0; });
    if ('ptSpeed' in v) v.ptSpeed = sound ? 0 : 60;
    if (sound) v.dimmer = Math.round(255 * Math.max(0.25, 1 - p.t * 1.6));   // flash on the beat
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

  /* ── values read by the renderer ── */
  get beamAngleDeg() { const SP = this.model.spec; return SP.zoomMin + (SP.zoomMax - SP.zoomMin) * this.o.zoom; }
  get intensity() { return this.power && this.lampOn ? (this.identify ? 1 : this.o.dimmer * this.o.dimmer) * this.o.shutter : 0; }   // dimmer curve ≈ square law
  /** The in-focus position shifts slightly with zoom. 0 = sharp */
  get defocus() { const f = this.model.spec.focus; return Math.abs(this.o.focus - (f[0] + f[1] * this.o.zoom)); }
  /** Colour filtering after the wheel: CMY flags (subtractive) and CTO */
  get filter() {
    const [c, m, y] = this.o.cmy, k = this.o.cto;
    return [(1 - 0.96 * c) * (1 - 0.06 * m), (1 - 0.94 * m) * (1 - 0.12 * c) * (1 - 0.1 * y) * (1 - 0.3 * k), (1 - 0.95 * y) * (1 - 0.1 * m) * (1 - 0.62 * k)];
  }
  /** Representative colour of the current beam (for the lens glow) */
  get tint() {
    const C = this.model.colors, n = C.length, p = this.o.colorPos, i = Math.floor(p) % n, f = p - Math.floor(p);
    const a = C[i].rgb, b = C[(i + 1) % n].rgb, w = this.model.spec.ledWhite, fl = this.filter;
    return [0, 1, 2].map(k => (a[k] * (1 - f) + b[k] * f) * w[k] * fl[k]);
  }
}
