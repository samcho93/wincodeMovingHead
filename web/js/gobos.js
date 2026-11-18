// gobos.js — beam-section compositing (colour wheel · CMY/CTO · gobo wheels · framing blades · prism · focus/frost)
//  The single canvas made by BeamImage feeds ① the spot projected on floor/walls (SpotLight.map) ② the beam in the air (volumetric) ③ the lens glow.
//  Gobo artwork is supplied by the model definition (model.gobos.draw).

const G = 256;                       // resolution of one gobo
const TAU = Math.PI * 2;
function mk(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }
const PRISM3 = { id: 'c3', rings: [[3, 0.5]], scale: 0.5 };
const css = rgb => `rgb(${rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;

export class BeamImage {
  constructor(model, size = 384) {
    this.model = model; this.S = size; this.R = size * 0.46;
    this.out = mk(size); this.a = mk(size); this.m = mk(size); this.m2 = mk(size);
    this.og = this.out.getContext('2d'); this.ag = this.a.getContext('2d'); this.mg = this.m.getContext('2d'); this.m2g = this.m2.getContext('2d');
    this.key = ''; this.cache = { fix: [], rot: [] };
  }
  /** One gobo: white where light passes, on a transparent background (slot 0 = open aperture) */
  goboCanvas(wheel, idx) {
    const names = this.model.gobos[wheel], n = names.length; idx = ((idx % n) + n) % n;
    if (!this.cache[wheel][idx]) {
      const c = mk(G), g = c.getContext('2d'), R = G * 0.47;
      g.translate(G / 2, G / 2);
      g.beginPath(); g.arc(0, 0, R, 0, TAU); g.clip();
      if (idx === 0 || !this.model.gobos.draw) { g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); }
      else this.model.gobos.draw(g, wheel, idx, R);
      this.cache[wheel][idx] = c;
    }
    return this.cache[wheel][idx];
  }
  /** Mask of one wheel: draws the two slots around pos (fractional) as they pass the optical axis */
  wheelMask(g, wheel, pos, angleDeg) {
    const { S, R } = this, i0 = Math.floor(pos), pitch = R * 2.35;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    for (let k = i0; k <= i0 + 1; k++) {
      const dx = (k - pos) * pitch; if (Math.abs(dx) > R * 2.3) continue;
      g.setTransform(1, 0, 0, 1, S / 2 + dx, S / 2 - Math.abs(dx) * 0.06);
      if (angleDeg) g.rotate(angleDeg * Math.PI / 180);
      g.drawImage(this.goboCanvas(wheel, k), -R, -R, R * 2, R * 2);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** Framing shutters: four blades, each driven at both ends (blades[2k], blades[2k+1]); the whole module rotates ±45° */
  cutBlades(g, blades, rot) {
    const { S, R } = this, L = R * 2.2;
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (let k = 0; k < 4; k++) {
      const a = blades[2 * k], b = blades[2 * k + 1]; if (a < 0.002 && b < 0.002) continue;
      g.setTransform(1, 0, 0, 1, S / 2, S / 2); g.rotate(rot * Math.PI / 4 + k * Math.PI / 2);
      g.beginPath(); g.moveTo(-L, -L); g.lineTo(L, -L); g.lineTo(L, -R + b * 2 * R); g.lineTo(-L, -R + a * 2 * R); g.closePath(); g.fill();
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
  }
  /** Optical state of one head → beam section. Returns false when nothing changed */
  render(fx) {                                                  // fx: a Head (or the Fixture, which forwards to head 1)
    const o = fx.o, M = this.model, F = M.features, { S, R } = this;
    const blur = (fx.defocus * 46 + o.frost * 34 + (M.spec.soft || 0)) * (S / 512), fl = fx.filter;
    const key = [o.colorPos.toFixed(3), (o.goboPos + o.goboOfs).toFixed(3), (o.rotPos + o.rotOfs).toFixed(3), o.goboAngle.toFixed(1), o.prism.toFixed(2), o.prismAngle.toFixed(1), o.prismShape ? o.prismShape.id : '', blur.toFixed(1), F.rgbl ? o.rgb.map(v => v.toFixed(3)).join() : '',
      fl.map(v => v.toFixed(3)).join(), F.blades ? o.blades.map(v => v.toFixed(3)).join() + o.bladeRot.toFixed(3) : ''].join('|');
    if (key === this.key) return false;
    this.key = key;
    const ag = this.ag, w = M.spec.ledWhite, C = M.colors, nC = C.length;
    // 1) colour wheel: the filters are butted together, so a half position shows two colours split down the middle
    ag.setTransform(1, 0, 0, 1, 0, 0); ag.globalCompositeOperation = 'source-over'; ag.clearRect(0, 0, S, S);
    const c0 = Math.floor(o.colorPos);
    if (F.rgbl) { ag.fillStyle = css(o.rgb.map((v, i) => v * w[i])); ag.fillRect(0, 0, S, S); }   // colour-mixing LED engine: no wheel
    else for (let k = c0; k <= c0 + 1; k++) {
      const x0 = S / 2 + (k - o.colorPos) * R * 2 - R;
      ag.fillStyle = css(C[((k % nC) + nC) % nC].rgb.map((v, i) => v * w[i]));
      ag.fillRect(Math.floor(x0), 0, Math.ceil(R * 2) + 1, S);
    }
    //    CMY flags and CTO: subtractive, over the whole aperture
    if (fl[0] < 0.999 || fl[1] < 0.999 || fl[2] < 0.999) { ag.globalCompositeOperation = 'multiply'; ag.fillStyle = css(fl); ag.fillRect(0, 0, S, S); ag.globalCompositeOperation = 'source-over'; }
    // 2) gobos + framing blades + gate (circular aperture)
    const mg = this.mg;
    this.wheelMask(mg, 'fix', o.goboPos + o.goboOfs, 0);
    if (M.gobos.rot.length > 1) { this.wheelMask(this.m2g, 'rot', o.rotPos + o.rotOfs, o.goboAngle); mg.globalCompositeOperation = 'destination-in'; mg.drawImage(this.m2, 0, 0); }
    mg.globalCompositeOperation = 'destination-in'; mg.beginPath(); mg.arc(S / 2, S / 2, R, 0, TAU); mg.fill(); mg.globalCompositeOperation = 'source-over';
    if (F.blades) this.cutBlades(mg, o.blades, o.bladeRot);
    ag.globalCompositeOperation = 'destination-in'; ag.drawImage(this.m, 0, 0); ag.globalCompositeOperation = 'source-over';
    // 3) prism (3-facet) · focus/frost blur
    const og = this.og;
    og.setTransform(1, 0, 0, 1, 0, 0); og.globalCompositeOperation = 'source-over'; og.globalAlpha = 1; og.filter = 'none';
    og.fillStyle = '#000'; og.fillRect(0, 0, S, S);
    og.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : 'none';
    const p = o.prism;
    if (p < 0.02) og.drawImage(this.a, 0, 0);
    else {
      // The prism multiplies the image. Shape: { rings: [[count, radius]], line: count, scale, colors } — default 3-facet circular.
      const P = o.prismShape || PRISM3, rot = o.prismAngle * Math.PI / 180, pts = [];
      for (const [n, rad] of P.rings || []) for (let i = 0; i < n; i++) { const a = rot + i * TAU / n; pts.push([Math.cos(a) * rad, Math.sin(a) * rad]); }
      if (P.line) for (let i = 0; i < P.line; i++) { const d = (i - (P.line - 1) / 2) * P.scale * 2.1; pts.push([Math.cos(rot) * d, Math.sin(rot) * d]); }
      const sc = 1 - (1 - P.scale) * p, alpha = Math.min(0.65, Math.max(0.3, 2 / pts.length));
      og.globalCompositeOperation = 'lighter';
      pts.forEach(([x, y], i) => {
        let src = this.a;
        if (P.colors) {                                               // multicoloured prism: each facet tints its copy
          const tg = this.m2g; tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, S, S); tg.drawImage(this.a, 0, 0);
          tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = `hsla(${Math.round(i * 360 / pts.length)},100%,50%,0.75)`; tg.fillRect(0, 0, S, S); tg.globalCompositeOperation = 'source-over';
          src = this.m2;
        }
        og.setTransform(sc, 0, 0, sc, S / 2 + x * R * p - S / 2 * sc, S / 2 + y * R * p - S / 2 * sc);
        og.globalAlpha = 1 - (1 - alpha) * p;
        og.drawImage(src, 0, 0);
      });
    }
    og.setTransform(1, 0, 0, 1, 0, 0); og.filter = 'none'; og.globalAlpha = 1; og.globalCompositeOperation = 'source-over';
    return true;
  }
}
