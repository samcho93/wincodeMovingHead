// models/util.js — helpers shared by the model definition files
export const lerp = (a, b, t) => a + (b - a) * t;
export const frac = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
export const pct = (v, lo, hi) => Math.round(frac(v, lo, hi) * 100) + '%';
export const p255 = v => Math.round(v / 2.55) + '%';
const TAU = Math.PI * 2;
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export { TAU };
