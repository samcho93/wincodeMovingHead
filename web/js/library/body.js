// library/body.js — the body (machine.js `body` data) of a fixture that comes from a library.
//  A library has no drawing of the fixture, but it says what kind of fixture it is, how large it is and how its
//  light-emitting cells are laid out. That is enough for a body of the right kind and size:
//    mover    base + yoke + head (spot: moulded head with a lens barrel · wash: short round head, large lens · beam)
//    par      a can or a flat housing in a bracket, one lens
//    bar      a long housing in a bracket with a row of cells
//    panel    a flat housing with a grid of cells (matrix, blinder) or one wide window (strobe)
//    effect   a box with small apertures (flower, laser, effect)
//    scanner  a fixed housing with a moving mirror
//  A GDTF file brings its own 3D model (`shape`, see gdtf.js): that is used as it is (kind 'model').
//  Sizes are metres. A description gives `size` [width, height, depth] in mm (0 = unknown) and `pixels` [columns, rows].
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const has = (D, ...names) => names.some(n => (D.categories || []).includes(n));

/** f: { moving, gobos, additive } — what the channels of the fixture say (desc.js) */
export function kindOf(D, f) {
  if (has(D, 'Scanner', 'Barrel Scanner')) return 'scanner';
  if (f.moving || has(D, 'Moving Head')) return 'mover';
  const [w, h, d] = (D.size || []).map(x => x || 0), long = w > 0 && h > 0 && d > 0 && w >= 2.6 * Math.max(h, d);
  if (has(D, 'Pixel Bar', 'Stand') || long) return 'bar';
  if (has(D, 'Matrix', 'Blinder', 'Strobe')) return 'panel';
  if (has(D, 'Flower', 'Laser', 'Effect')) return 'effect';
  return 'par';
}
export const KIND_LABEL = { model: '3D model', mover: 'moving head', par: 'PAR / wash', bar: 'bar', panel: 'panel', effect: 'effect', scanner: 'scanner' };

const PAINT = 0x24272c;
/** [w, h, d] in metres, each inside sane limits; `fallback` where the library gives nothing */
function dims(D, fallback) {
  const s = (D.size || []).map(x => (x > 0 ? x / 1000 : 0));
  return s.length === 3 && s.every(x => x > 0) ? s.map(x => clamp(x, 0.04, 2)) : fallback;
}

function mover(D, f) {
  const sorted = dims(D, [0.3, 0.45, 0.24]).slice().sort((a, b) => b - a);          // standing: the tallest side is the height
  const H = clamp(sorted[0], 0.2, 1.2), W = clamp(sorted[1], 0.16, H * 0.95), Dd = clamp(sorted[2], 0.12, W), s = H / 0.45;
  const bot = 0.014 * s, baseH = clamp(H * 0.19, 0.05, 0.16), top = bot + baseH, hw = W * 0.42, depth = clamp(Dd * 0.82, W * 0.5, W * 0.84);
  const frameW = Math.min(0.166, hw * 1.5), frameH = Math.min(0.062, baseH * 0.72), tth = 0.012 * s, panY = top + tth;
  const R = H - panY, tiltY = R * 0.5, t = W * 0.13, inner = W - 2 * t - 0.012 * s, arm = depth * 0.5;
  const yoke = { W, t, wb: W * 0.72, h1: R * 0.1, h2: R * 0.2, yf: R * 0.11, c: R * 0.07, d: depth * 0.62, armW: arm, top: tiltY + arm * 0.45, inlay: false };
  const back = tiltY - yoke.yf - 0.012 * s, front = R - tiltY - 0.01 * s, shape = f.gobos ? 'spot' : f.additive ? 'wash' : 'beam';
  let head, lensR, extra = {};
  if (shape === 'spot') {                                       // moulded head tapering into a lens barrel
    const hd = inner * 0.9, r = inner * 0.2;
    head = [{ y: -back, w: inner * 0.6, d: hd * 0.6, r: r * 0.7 }, { y: -back * 0.86, w: inner * 0.88, d: hd * 0.88, r }, { y: -back * 0.45, w: inner, d: hd, r }, { y: front * 0.35, w: inner, d: hd, r },
      { y: front * 0.78, w: inner * 0.82, d: hd * 0.84, r: inner * 0.3 }, { y: front * 0.9, w: inner * 0.74 }, { y: front, w: inner * 0.72 }];
    lensR = inner * 0.29; extra.vents = [{ side: 'z', off: hd / 2, y: -back * 0.5, h: back * 0.4, n: 7, pitch: inner * 0.08 }];
  } else {                                                      // round head: a wash is short with a wide lens, a beam is long
    const k = shape === 'wash' ? 0.72 : 1, bk = back * k, fr = front * k;
    head = [{ y: -bk, w: inner * 0.5 }, { y: -bk * 0.9, w: inner * 0.78 }, { y: -bk * 0.55, w: inner * 0.96 }, { y: fr * 0.55, w: inner * 0.96 }, { y: fr * 0.55, w: inner }, { y: fr, w: inner }];
    lensR = inner * (shape === 'wash' ? 0.44 : 0.4); extra.ribs = { y0: -bk * 0.5, y1: fr * 0.4, n: 26, r: inner * 0.48 };
  }
  const headTop = head[head.length - 1].y;
  return Object.assign({ H, style: shape === 'spot' ? 'box' : 'round', color: PAINT, kind: 'mover', viewScale: H / 0.492,
    base: { hw, bot, top, shoulder: top - baseH * 0.22, chamfer: baseH * 0.2, depth, frameW, frameH, panelY: bot + baseH * 0.48, corner: 0.02 * s },
    feet: { r: 0.014 * s, h: bot, x: hw * 0.72, z: depth * 0.34 }, turntable: { r: Math.min(hw, depth / 2) * 0.74, h: tth }, panY, yoke, tiltY, head,
    lensY: headTop + 0.006 * s, lensR, ringR: lensR * 1.13,
    lcd: [frameW * 0.34, frameH * 0.68], lcdX: -frameW * 0.2, controls: 'cross5', ctrlX: frameW * 0.26 }, extra);
}

/** a housing in a bracket; `cells` = what its front face shows */
function fixed(kind, w, h, len, head, cells, more) {
  const t = clamp(0.003 + Math.max(w, h, len) * 0.012, 0.004, 0.012), aw = clamp(Math.min(h, len) * 0.4, 0.02, 0.07), swing = Math.hypot(len / 2, h / 2);
  const tiltY = t + swing + 0.006, cw = cells.r || cells.w / 2, cd = cells.r || cells.d / 2;
  return Object.assign({ H: tiltY + Math.max(len, h) / 2, style: 'fixed', color: PAINT, kind,
    base: { depth: Math.max(h, aw), panelY: tiltY, top: t, bot: 0, hw: w / 2 },                // what the simulator's camera views read
    bracket: { W: w + 0.008, t, d: aw, top: tiltY + aw * 0.45 }, panY: 0, tiltY, head, cells,
    lensY: len / 2 + 0.004, lensR: clamp(Math.sqrt(((cells.nx - 1) * cells.px + cw * 2) * ((cells.ny - 1) * cells.pz + cd * 2)) * 0.5, Math.min(w, h) * 0.3, Math.min(w, h) * 1.4) }, more);
}
const boxHead = (w, h, len) => { const r = Math.min(w, h) * 0.12; return [{ y: -len / 2, w: w * 0.94, d: h * 0.94, r }, { y: -len / 2 + Math.min(0.008, len * 0.2), w, d: h, r }, { y: len / 2, w, d: h, r }]; };
/** nx × ny cells spread over a face of fw × fd */
const grid = (nx, ny, fw, fd, round) => { const px = fw / nx, pz = fd / ny; return round ? { nx, ny, px, pz, r: Math.min(px, pz) * 0.42 } : { nx, ny, px, pz, w: px * 0.9, d: pz * 0.86 }; };

function par(D) {
  const [w, h, len] = dims(D, [0.22, 0.22, 0.2]), round = Math.abs(w - h) / Math.max(w, h) < 0.25;
  if (!round) return fixed('par', w, h, len, boxHead(w, h, len), grid(1, 1, Math.min(w, h) * 0.9, Math.min(w, h) * 0.9, true), { sink: len > 0.12 ? { y0: -len / 2 - 0.012, y1: -len / 2, w: w * 0.8, d: h * 0.7, n: 9 } : null });
  const dia = Math.min(w, h), k = len / 2;
  const head = [{ y: -k, w: dia * 0.62 }, { y: -k + len * 0.14, w: dia * 0.94 }, { y: k - len * 0.12, w: dia * 0.94 }, { y: k - len * 0.12, w: dia }, { y: k, w: dia }];
  return fixed('par', dia, dia, len, head, grid(1, 1, dia * 0.88, dia * 0.88, true), len > 0.16 ? { ribs: { y0: -k + len * 0.2, y1: k - len * 0.2, n: 22, r: dia * 0.47 } } : null);
}
function bar(D) {
  const [w, h, len] = dims(D, [1, 0.08, 0.09]), px = (D.pixels || [])[0] || 0, pz = (D.pixels || [])[1] || 0;
  const nx = clamp(px > 1 ? px : Math.round(w / 0.11), 2, 32), ny = clamp(pz > 1 ? pz : 1, 1, 6);
  return fixed('bar', w, h, len, boxHead(w, h, len), grid(nx, ny, w * 0.95, h * 0.84, true));
}
function panel(D) {
  const [w, h, len] = dims(D, [0.3, 0.3, 0.12]), [px, pz] = D.pixels || [], strobe = has(D, 'Strobe') && !has(D, 'Matrix');
  const nx = clamp(px > 1 ? px : strobe ? 1 : has(D, 'Blinder') ? Math.max(1, Math.round(w / h)) * 2 : 5, 1, 16), ny = clamp(pz > 1 ? pz : strobe || has(D, 'Blinder') ? 1 : 5, 1, 16);
  return fixed('panel', w, h, len, boxHead(w, h, len), grid(nx, ny, w * 0.92, h * 0.88, !(strobe && nx * ny === 1)));
}
function effect(D) {
  const [w, h, len] = dims(D, [0.25, 0.2, 0.25]), n = has(D, 'Flower') ? [3, 2] : has(D, 'Laser') ? [1, 1] : [2, 1];
  return fixed('effect', w, h, len, boxHead(w, h, len), grid(n[0], n[1], w * 0.6 * (n[0] > 1 ? 1 : 0.35), h * 0.6 * (n[0] > 1 ? 1 : 0.5), true),
    { vents: [{ side: 'x', off: w / 2, y: 0, h: len * 0.4, n: 6, pitch: h * 0.1 }] });
}
function scanner(D) {
  const [len, a, b] = dims(D, [0.2, 0.16, 0.45]).slice().sort((x, y) => y - x), w = Math.max(a, b), h = Math.min(a, b);   // lying: the longest side is the length
  const t = 0.006, yc = t + h / 2 + 0.03, mw = w * 0.62, lean = 0.95;
  return { H: yc + h / 2 + mw * 0.6, style: 'fixed', color: PAINT, kind: 'scanner', base: { depth: len, panelY: yc, top: t, bot: 0, hw: w / 2 },
    bracket: { W: w + 0.008, t, d: clamp(len * 0.2, 0.03, 0.08), top: yc + 0.03, axis: yc }, block: { w, h, d: len, y: yc, r: Math.min(w, h) * 0.1 },
    panY: yc, panZ: len / 2 + mw * 0.55, lean, tiltY: 0, mirror: { w: mw, h: mw * 1.25 }, lensY: 0.004, lensR: mw * 0.36 };
}

/** body data for machine.js, and the kind it was made as */
export function bodyFromDesc(D, f) {
  const S = D.shape;
  if (S && S.parts) return { H: S.size[1], style: 'mesh', color: PAINT, kind: 'model', viewScale: S.size[1] / 0.492, base: { depth: S.size[2], panelY: S.size[1] / 2, top: 0, bot: 0, hw: S.size[0] / 2 },
    parts: S.parts, panPos: S.panPos, tiltPos: S.tiltPos, lensY: S.lensY, lensR: S.lensR, tris: S.tris };
  const kind = kindOf(D, f);
  return ({ mover, par, bar, panel, effect, scanner })[kind](D, f);
}
