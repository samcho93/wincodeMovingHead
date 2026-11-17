// gobos.js — 고보 무늬(메뉴얼 4.2 GOBO1/GOBO2 그림 기준)와 빔 단면 합성
//  BeamImage 가 만드는 캔버스 하나가 ① 바닥·벽에 투사되는 스폿(SpotLight.map) ② 공기 중 빔(볼류메트릭) ③ 렌즈 발광에 같이 쓰인다.
import { COLORS, N_COLOR, N_FIX, N_ROT, SPEC } from './personality.js';

const G = 256;                       // 고보 한 장 해상도
const TAU = Math.PI * 2;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function mk(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

/** 고보 한 장: 투명 배경 위에 빛이 통과하는 부분을 흰색으로. 원점 = 중심, R = 구경 반지름 */
function drawGobo(g, wheel, idx, R) {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  if (idx === 0) return dot(0, 0, R);
  if (wheel === 'fix') {
    switch (idx) {
      case 1: {                                   // 삼각형 윤곽
        g.lineWidth = R * 0.085; g.beginPath();
        for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * TAU / 3; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66 + R * 0.08); }
        g.closePath(); g.stroke(); break;
      }
      case 2: {                                   // 세 조각 링
        g.lineWidth = R * 0.14;
        for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * TAU / 3; g.beginPath(); g.arc(0, 0, R * 0.62, a + 0.2, a + TAU / 3 - 0.2); g.stroke(); }
        break;
      }
      case 3: for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; dot(Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42, R * 0.25); } break;   // 네 점
      case 4: {                                   // 꽃(잎 6장 + 사이 작은 잎)
        for (let i = 0; i < 6; i++) { g.save(); g.rotate(i * TAU / 6); g.beginPath(); g.ellipse(0, -R * 0.47, R * 0.11, R * 0.26, 0, 0, TAU); g.fill(); g.restore(); }
        for (let i = 0; i < 6; i++) { g.save(); g.rotate(i * TAU / 6 + TAU / 12); g.beginPath(); g.ellipse(0, -R * 0.2, R * 0.045, R * 0.1, 0, 0, TAU); g.fill(); g.restore(); }
        break;
      }
      case 5: {                                   // 크고 작은 방울
        const r = rng(11); dot(0, 0, R * 0.2);
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6; dot(Math.cos(a) * R * 0.44, Math.sin(a) * R * 0.44, R * 0.15); }
        for (let i = 0; i < 16; i++) { const a = r() * TAU, d = R * (0.2 + r() * 0.62); dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.03 + r() * 0.045)); }
        break;
      }
      case 6: dot(0, 0, R * 0.55); break;         // 빔 축소(중)
      case 7: dot(0, 0, R * 0.3); break;          // 빔 축소(소)
    }
    return;
  }
  switch (idx) {                                  // 회전 고보(유리)
    case 1: for (let i = -2; i <= 2; i++) dot(i * R * 0.34, 0, R * 0.13); break;                          // 다섯 점 한 줄
    case 2: {                                     // 장미(선화)
      g.lineWidth = R * 0.035; g.beginPath();
      for (let i = 0; i <= 720; i++) { const t = i / 720 * TAU * 3, rr = R * 0.8 * (t / (TAU * 3)) * (0.82 + 0.18 * Math.sin(t * 2.5)); g[i ? 'lineTo' : 'moveTo'](Math.cos(t) * rr, Math.sin(t) * rr); }
      g.stroke();
      for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + 0.3; g.beginPath(); g.arc(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, R * 0.36, a + 2.2, a + 4.0); g.stroke(); }
      break;
    }
    case 3: {                                     // 물결 결
      g.lineWidth = R * 0.04; const r = rng(5);
      for (let j = -6; j <= 6; j++) { const y0 = j * R * 0.125, half = Math.sqrt(Math.max(0, 0.72 - (j / 7.5) ** 2)) * R, ph = r() * 6; g.beginPath();
        for (let x = -half; x <= half; x += R * 0.04) g[x === -half ? 'moveTo' : 'lineTo'](x, y0 + Math.sin(x / R * 9 + ph) * R * 0.035); g.stroke(); }
      break;
    }
    case 4: {                                     // 붓 자국(방사 긁힘)
      const r = rng(23);
      for (let i = 0; i < 70; i++) { const a = -0.5 + (r() - 0.5) * 1.1, y = (r() - 0.5) * R * 1.3, l = R * (0.3 + r() * 0.9), x = -R * 0.7 + r() * R * 0.4;
        g.lineWidth = R * (0.008 + r() * 0.022); g.globalAlpha = 0.45 + r() * 0.55; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
      g.globalAlpha = 1; break;
    }
    case 5: {                                     // 별밭
      const r = rng(77);
      for (let i = 0; i < 90; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.88; dot(Math.cos(a) * d, Math.sin(a) * d, R * (0.012 + r() * r() * 0.07)); }
      break;
    }
    case 6: {                                     // 4×4 격자
      const s = R * 0.3, gap = R * 0.045;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect((i - 2) * s + gap / 2, (j - 2) * s + gap / 2, s - gap, s - gap);
      break;
    }
  }
}

const cache = { fix: [], rot: [] };
export function goboCanvas(wheel, idx) {
  const n = wheel === 'fix' ? N_FIX : N_ROT; idx = ((idx % n) + n) % n;
  if (!cache[wheel][idx]) {
    const c = mk(G), g = c.getContext('2d'), R = G * 0.47;
    g.translate(G / 2, G / 2);
    g.beginPath(); g.arc(0, 0, R, 0, TAU); g.clip();
    drawGobo(g, wheel, idx, R);
    cache[wheel][idx] = c;
  }
  return cache[wheel][idx];
}

const css = rgb => `rgb(${rgb.map(v => Math.round(Math.min(1, v) * 255)).join(',')})`;

export class BeamImage {
  constructor(size = 384) {
    this.S = size; this.R = size * 0.46;
    this.out = mk(size); this.a = mk(size); this.m = mk(size); this.m2 = mk(size);
    this.og = this.out.getContext('2d'); this.ag = this.a.getContext('2d'); this.mg = this.m.getContext('2d'); this.m2g = this.m2.getContext('2d');
    this.key = '';
  }
  /** 휠 한 장의 마스크: 위치 pos(실수) 주변 두 칸을 광축 앞을 지나가는 모습으로 그린다 */
  wheelMask(g, wheel, pos, n, angleDeg) {
    const { S, R } = this, i0 = Math.floor(pos), pitch = R * 2.35;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    for (let k = i0; k <= i0 + 1; k++) {
      const dx = (k - pos) * pitch; if (Math.abs(dx) > R * 2.3) continue;
      g.setTransform(1, 0, 0, 1, S / 2 + dx, S / 2 - Math.abs(dx) * 0.06);
      if (angleDeg) g.rotate(angleDeg * Math.PI / 180);
      g.drawImage(goboCanvas(wheel, k), -R, -R, R * 2, R * 2);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** fixture 의 광학 상태 → 빔 단면. 바뀐 게 없으면 false */
  render(fx) {
    const o = fx.o, { S, R } = this;
    const blur = (fx.defocus * 46 + o.frost * 34) * (S / 512);
    const key = [o.colorPos.toFixed(3), (o.goboPos + o.goboOfs).toFixed(3), (o.rotPos + o.rotOfs).toFixed(3), o.goboAngle.toFixed(1), o.prism.toFixed(2), o.prismAngle.toFixed(1), blur.toFixed(1)].join('|');
    if (key === this.key) return false;
    this.key = key;
    const ag = this.ag, w = SPEC.ledWhite;
    // 1) 컬러 휠: 필터가 빈틈 없이 이어져 있어 반 칸 위치에서는 두 색이 반반 걸린다
    ag.setTransform(1, 0, 0, 1, 0, 0); ag.globalCompositeOperation = 'source-over'; ag.clearRect(0, 0, S, S);
    const c0 = Math.floor(o.colorPos);
    for (let k = c0; k <= c0 + 1; k++) {
      const x0 = S / 2 + (k - o.colorPos) * R * 2 - R;
      ag.fillStyle = css(COLORS[((k % N_COLOR) + N_COLOR) % N_COLOR].rgb.map((v, i) => v * w[i]));
      ag.fillRect(Math.floor(x0), 0, Math.ceil(R * 2) + 1, S);
    }
    // 2) 고보 두 장 + 게이트(원형 구경)
    this.wheelMask(this.mg, 'fix', o.goboPos + o.goboOfs, N_FIX, 0);
    this.wheelMask(this.m2g, 'rot', o.rotPos + o.rotOfs, N_ROT, o.goboAngle);
    this.mg.globalCompositeOperation = 'destination-in'; this.mg.drawImage(this.m2, 0, 0);
    this.mg.beginPath(); this.mg.arc(S / 2, S / 2, R, 0, TAU); this.mg.fill(); this.mg.globalCompositeOperation = 'source-over';
    ag.globalCompositeOperation = 'destination-in'; ag.drawImage(this.m, 0, 0); ag.globalCompositeOperation = 'source-over';
    // 3) 프리즘(3면) · 포커스/프로스트 흐림
    const og = this.og;
    og.setTransform(1, 0, 0, 1, 0, 0); og.globalCompositeOperation = 'source-over'; og.globalAlpha = 1; og.filter = 'none';
    og.fillStyle = '#000'; og.fillRect(0, 0, S, S);
    og.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : 'none';
    const p = o.prism;
    if (p < 0.02) og.drawImage(this.a, 0, 0);
    else {
      og.globalCompositeOperation = 'lighter';
      const sc = 1 - 0.5 * p, off = R * 0.5 * p;
      for (let i = 0; i < 3; i++) {
        const a = (o.prismAngle + i * 120) * Math.PI / 180;
        og.setTransform(sc, 0, 0, sc, S / 2 + Math.cos(a) * off - S / 2 * sc, S / 2 + Math.sin(a) * off - S / 2 * sc);
        og.globalAlpha = 1 - 0.35 * p;
        og.drawImage(this.a, 0, 0);
      }
    }
    og.setTransform(1, 0, 0, 1, 0, 0); og.filter = 'none'; og.globalAlpha = 1; og.globalCompositeOperation = 'source-over';
    return true;
  }
}
