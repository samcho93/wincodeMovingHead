// fixture.js — 무빙헤드 "펌웨어" 모델: 설정(NVS) · 실행 모드 · 채널 → 기구/광학 상태(모터 속도 포함)
import { MODES, KEYS, SPEC, COLORS, N_COLOR, N_FIX, N_ROT, decode } from './personality.js';

const LS_KEY = 'wmh.settings.v1';
const DEFAULT_SETTINGS = {
  address: 1, mode: 'EXT', runMode: 'DMX', panInvert: false, tiltInvert: false,
  lang: 'EN', flip: false, dispMode: 'Show',
  totalHours: 0, powerCount: 0,
  cal: { pan: 128, tilt: 128, color: 128, dimmer: 128, gobo: 128, rotGobo: 128, goboRot: 128, zoom: 128, focus: 128, frost: 128, prism: 128, prismRot: 128, reset: 128 },
};
// 수동(Manual 메뉴) 기본값: 불이 켜진 채 뒤쪽 벽을 비추도록
const DEFAULT_MANUAL = { pan: 128, tilt: 70, strobe: 255, dimmer: 255, focus: 96 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const approach = (cur, tgt, step) => (Math.abs(tgt - cur) <= step ? tgt : cur + Math.sign(tgt - cur) * step);
/** 원형 휠에서 목표까지 최단 경로로 이동 */
function approachWheel(cur, tgt, step, n) {
  let d = ((tgt - cur) % n + n) % n; if (d > n / 2) d -= n;
  if (Math.abs(d) <= step) return ((tgt % n) + n) % n;
  return (((cur + Math.sign(d) * step) % n) + n) % n;
}
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** 축 하나(팬/틸트): 가속 제한 사다리꼴 속도 프로파일 */
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

// Host(마스터)·Sound 모드의 내장 프로그램 — 한 스텝 = 채널 값 묶음
const PROGRAM = [
  { pan: 110, tilt: 80, color: 20, gobo: 0, rotGobo: 10, goboRot: 100, zoom: 0, prism: 0 },
  { pan: 150, tilt: 95, color: 60, gobo: 10, rotGobo: 0, goboRot: 0, zoom: 120, prism: 0 },
  { pan: 128, tilt: 70, color: 100, gobo: 0, rotGobo: 60, goboRot: 150, zoom: 60, prism: 200, prismRot: 210 },
  { pan: 95, tilt: 100, color: 140, gobo: 40, rotGobo: 0, goboRot: 0, zoom: 200, prism: 0 },
  { pan: 165, tilt: 85, color: 40, gobo: 0, rotGobo: 50, goboRot: 80, zoom: 0, prism: 200, prismRot: 150 },
  { pan: 128, tilt: 110, color: 120, gobo: 50, rotGobo: 0, goboRot: 0, zoom: 255, frost: 160, prism: 0 },
  { pan: 140, tilt: 60, color: 80, gobo: 0, rotGobo: 20, goboRot: 220, zoom: 30, prism: 0 },
  { pan: 115, tilt: 90, color: 180, gobo: 0, rotGobo: 30, goboRot: 110, zoom: 90, prism: 200, prismRot: 240 },
];

export class Fixture {
  constructor() {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    try { const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (s) { Object.assign(this.settings, s, { cal: Object.assign({}, DEFAULT_SETTINGS.cal, s.cal) }); } } catch (e) {}
    this.manual = {}; KEYS.forEach(k => { this.manual[k] = DEFAULT_MANUAL[k] ?? 0; });
    this.ch = Object.assign({}, this.manual);       // 현재 적용 중인 채널 값
    this.chSource = 'manual';                        // 'dmx' | 'manual' | 'host' | 'sound'
    this.dmx = new Uint8Array(512); this.lastDmx = -1e9; this.dmxSignal = false; this.dmxFps = 0; this._fpsN = 0; this._fpsT = 0;
    this.power = false; this.resetT = -1; this.resetHold = 0; this.identify = false;
    this.sessionSec = 0; this.tempC = 26; this.time = 0;
    this.pan = new Axis(215, 900); this.tilt = new Axis(185, 900);
    this.tilt.pos = -135;                             // 전원 꺼진 헤드는 처져 있다
    // 광학 상태(실제 모터 위치)
    this.o = { colorPos: 0, goboPos: 0, goboOfs: 0, rotPos: 0, rotOfs: 0, goboAngle: 0, zoom: 0, focus: 0.4, frost: 0, prism: 0, prismAngle: 0, dimmer: 0, shutter: 0 };
    this.prog = { step: 0, t: 0 }; this.beat = false;
    this.listeners = new Set(); this.dmxOut = null;   // Host 모드에서 내보내는 프레임(DMX OUT)
    this.log = () => {};
  }
  on(fn) { this.listeners.add(fn); }
  emit(ev) { this.listeners.forEach(f => f(ev)); }
  save() { try { localStorage.setItem(LS_KEY, JSON.stringify(this.settings)); } catch (e) {} this.emit('settings'); }
  set(key, val) { this.settings[key] = val; this.save(); }
  get mode() { return MODES[this.settings.mode] || MODES.EXT; }
  get footprint() { return this.mode.channels.length; }

  /* ── 전원 / 리셋 ── */
  setPower(on) {
    if (on === this.power) return;
    this.power = on;
    if (on) { this.settings.powerCount++; this.sessionSec = 0; this.save(); this.startReset('power'); }
    else { this.resetT = -1; }
    this.emit('power');
  }
  startReset(why) { if (!this.power) return; this.resetT = 0; this.log(`Reset started (${why})`); this.emit('reset'); }
  get resetting() { return this.resetT >= 0; }
  factoryDefaults() {
    const keep = { totalHours: this.settings.totalHours, powerCount: this.settings.powerCount };
    this.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), keep);
    KEYS.forEach(k => { this.manual[k] = DEFAULT_MANUAL[k] ?? 0; });
    this.save();
  }

  /* ── DMX IN ── */
  feedDmx(data) {                                   // data: 슬롯 1..512 (start code 0 프레임만)
    this.dmx.fill(0); this.dmx.set(data.subarray(0, 512));
    this.lastDmx = performance.now(); this._fpsN++;
  }

  /* ── 한 프레임 ── */
  update(dt) {
    const now = performance.now();
    this.time += dt;
    if (now - this._fpsT > 1000) { this.dmxFps = this._fpsN * 1000 / (now - this._fpsT); this._fpsN = 0; this._fpsT = now; }
    const sig = now - this.lastDmx < 1500;
    if (sig !== this.dmxSignal) { this.dmxSignal = sig; this.emit('signal'); }
    const o = this.o;
    if (!this.power) {                               // 전원 OFF: 소등, 헤드는 자중으로 처짐
      o.dimmer = 0; o.shutter = 0; this.tilt.step(-135, dt, 0.25); this.pan.vel = 0;
      this.tempC += (24 - this.tempC) * dt * 0.02; this.dmxOut = null;
      return;
    }
    this.sessionSec += dt;
    this.settings.totalHours += dt / 3600;
    if (((this.sessionSec / 60) | 0) !== (((this.sessionSec - dt) / 60) | 0)) this.save();

    // 1) 채널 값의 출처
    const S = this.settings, chans = this.mode.channels;
    let v = {};
    this.dmxOut = null;
    if (S.runMode === 'DMX' && sig) {
      this.chSource = 'dmx';
      chans.forEach((k, i) => { const a = S.address - 1 + i; v[k] = a < 512 ? this.dmx[a] : 0; });
    } else if (S.runMode === 'DMX') {
      this.chSource = 'manual';
      chans.forEach(k => { v[k] = this.manual[k]; });
    } else {
      this.chSource = S.runMode === 'HOST' ? 'host' : 'sound';
      v = this.runProgram(dt, chans);
      const out = new Uint8Array(512); chans.forEach((k, i) => { out[i] = v[k]; });   // 슬레이브는 주소 1 로 받는다
      this.dmxOut = out;
    }
    this.ch = v;
    const t = decode(v);

    // 2) 리셋 채널(200–250 을 3초 유지) / 리셋 시퀀스
    this.resetHold = t.reset ? this.resetHold + dt : 0;
    if (this.resetHold > 3 && !this.resetting) { this.resetHold = -1e9; this.startReset('DMX'); }
    if (!t.reset && this.resetHold < 0) this.resetHold = 0;
    const cal = S.cal;
    let panT = (t.pan - 0.5) * SPEC.panRange * (S.panInvert ? -1 : 1) + (cal.pan - 128) * 0.1;
    let tiltT = (t.tilt - 0.5) * SPEC.tiltRange * (S.tiltInvert ? -1 : 1) + (cal.tilt - 128) * 0.1;
    let speed = 1 - 0.965 * t.ptSpeed, homing = false;
    if (this.resetting) {
      this.resetT += dt; speed = 0.8;
      if (this.resetT < 3.6) { panT = -SPEC.panRange / 2; tiltT = -SPEC.tiltRange / 2; homing = true; }   // 원점(끝단) 찾기
      else if (this.resetT > 4 && Math.abs(this.pan.pos - panT) < 0.5 && Math.abs(this.tilt.pos - tiltT) < 0.5 || this.resetT > 12) {
        this.resetT = -1; this.log('Reset complete'); this.emit('reset');
      }
    }
    this.pan.step(clamp(panT, -270, 270), dt, speed);
    this.tilt.step(clamp(tiltT, -135, 135), dt, speed);

    // 3) 휠 · 렌즈
    if (homing) {                                    // 리셋 중 휠 한 바퀴
      o.colorPos = (o.colorPos + dt * 4) % N_COLOR; o.goboPos = (o.goboPos + dt * 3.5) % N_FIX; o.rotPos = (o.rotPos + dt * 3) % N_ROT;
      o.goboAngle = (o.goboAngle + dt * 300) % 360; o.zoom = approach(o.zoom, 0, dt * 0.9); o.prism = approach(o.prism, 0, dt * 3);
    } else {
      if (t.color.pos != null) o.colorPos = approachWheel(o.colorPos, t.color.pos, dt * 9, N_COLOR);
      else o.colorPos = (((o.colorPos + t.color.spin * dt) % N_COLOR) + N_COLOR) % N_COLOR;
      if (t.gobo.pos != null) o.goboPos = approachWheel(o.goboPos, t.gobo.pos, dt * 8, N_FIX);
      else o.goboPos = (((o.goboPos + t.gobo.spin * dt) % N_FIX) + N_FIX) % N_FIX;
      o.goboOfs = t.gobo.shake ? Math.sin(this.time * Math.PI * 2 * t.gobo.shake) * 0.13 : 0;
      if (t.rotGobo.pos != null) o.rotPos = approachWheel(o.rotPos, t.rotGobo.pos, dt * 7, N_ROT);
      else o.rotPos = (((o.rotPos + t.rotGobo.spin * dt) % N_ROT) + N_ROT) % N_ROT;
      o.rotOfs = t.rotGobo.shake ? Math.sin(this.time * Math.PI * 2 * t.rotGobo.shake) * 0.13 : 0;
      const gr = t.goboRot;
      if (gr.index != null) o.goboAngle = approachWheel(o.goboAngle, gr.index, dt * 420, 360);
      else if (gr.bounce) o.goboAngle = 45 * Math.sin(this.time * Math.PI * 2 * gr.bounce * 0.5);
      else o.goboAngle = (((o.goboAngle + gr.spin * 360 * dt) % 360) + 360) % 360;
      o.zoom = approach(o.zoom, t.zoom, dt * 0.85);
      o.focus = approach(o.focus, t.focus, dt * 1.6);
      o.frost = approach(o.frost, t.frost, dt * 2.5);
      o.prism = approach(o.prism, t.prism ? 1 : 0, dt * 3.5);
      o.prismAngle = (((o.prismAngle + t.prismRot * 360 * dt) % 360) + 360) % 360;
    }

    // 4) 디머 · 셔터(LED 전자식 스트로브)
    const dimT = homing ? 0 : t.dimmer;
    o.dimmer += (dimT - o.dimmer) * Math.min(1, dt * 22);
    const st = t.strobe, T = this.time;
    let sh = 1;
    if (homing || st.mode === 'closed') sh = 0;
    else if (st.mode === 'strobe') sh = (T * st.hz) % 1 < 0.42 ? 1 : 0;
    else if (st.mode === 'pulse') { const p = (T * st.hz) % 1; sh = Math.pow(1 - p, 2.2); }
    else if (st.mode === 'random') { const n = Math.floor(T * st.hz); sh = hash(n) < 0.45 && (T * st.hz) % 1 < 0.5 ? 1 : 0; }
    if (this.identify) sh = (T * 2) % 1 < 0.5 ? 1 : 0;
    o.shutter = sh;

    // 5) 온도(표시용): LED 출력에 따라 완만히 변화
    const load = (this.identify ? 1 : o.dimmer) * (sh > 0 ? 1 : 0.2);
    this.tempC += ((30 + 38 * load) - this.tempC) * dt * 0.03;
  }

  /** Host / Sound 내장 프로그램 → 채널 값 */
  runProgram(dt, chans) {
    const p = this.prog, sound = this.settings.runMode === 'SOUND';
    p.t += dt;
    if (sound ? this.beat : p.t > 3.2) { p.step = (p.step + 1) % PROGRAM.length; p.t = 0; }
    this.beat = false;
    const s = PROGRAM[p.step], v = {};
    chans.forEach(k => { v[k] = s[k] ?? 0; });
    v.dimmer = 255; v.strobe = 255; v.ptSpeed = sound ? 0 : 60; v.focus = 96; v.reset = 0;
    if ('dimmerFine' in v) v.dimmerFine = 0;
    if (sound) v.dimmer = Math.round(255 * Math.max(0.25, 1 - p.t * 1.6));   // 비트에 맞춰 번쩍
    return v;
  }

  /* ── 렌더러가 읽는 값 ── */
  get beamAngleDeg() { return SPEC.zoomMin + (SPEC.zoomMax - SPEC.zoomMin) * this.o.zoom; }
  get intensity() { return this.power ? (this.identify ? 1 : this.o.dimmer * this.o.dimmer) * this.o.shutter : 0; }   // 디머 곡선 ≈ 제곱
  /** 포커스가 맞는 위치는 줌에 따라 조금 이동한다. 0 = 선명 */
  get defocus() { const ideal = 0.33 + 0.22 * this.o.zoom; return Math.abs(this.o.focus - ideal); }
  /** 현재 빔의 대표 색(렌즈 글로우용) */
  get tint() {
    const p = this.o.colorPos, i = Math.floor(p) % N_COLOR, f = p - Math.floor(p);
    const a = COLORS[i].rgb, b = COLORS[(i + 1) % N_COLOR].rgb, w = SPEC.ledWhite;
    return [0, 1, 2].map(k => (a[k] * (1 - f) + b[k] * f) * w[k]);
  }
}
