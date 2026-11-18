// stage/beat.js — synthesises a short backing track for the example shows (kick, hi-hat, bass, pad).
//  Generated in the browser so the examples have music without shipping an audio file.

/** → WAV Blob (mono, 16 bit, 22.05 kHz) of `seconds` at `bpm` */
export function makeBeat(seconds = 48, bpm = 120) {
  const sr = 22050, n = Math.floor(sr * seconds), out = new Float32Array(n), beat = 60 / bpm;
  const NOTES = [55, 55, 65.4, 49];                         // bass root per bar (A1, A1, C2, G1)
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr, b = t / beat, bi = Math.floor(b), bp = (b - bi) * beat, bar = Math.floor(bi / 4), section = Math.floor(bar / 4);
    let s = 0;
    if (section !== 0 || bar >= 2) s += Math.sin(2 * Math.PI * (45 * bp + (120 - 45) * 0.045 * (1 - Math.exp(-bp / 0.045)))) * Math.exp(-bp * 9) * 0.9;   // kick on every beat
    const hp = ((b + 0.5) % 1) * beat; if (section >= 1) s += rnd() * Math.exp(-hp * 55) * 0.22;                                                      // off-beat hi-hat
    const eighth = (b * 2) % 1, f = NOTES[bar % 4] * (section % 2 && Math.floor(b * 2) % 4 === 3 ? 2 : 1);
    s += (((t * f) % 1) * 2 - 1) * Math.exp(-eighth * 3.2) * 0.2;                                                                                     // sawtooth bass, eighth notes
    if (section >= 2) { const r = NOTES[bar % 4] * 4; s += (Math.sin(2 * Math.PI * r * t) + Math.sin(2 * Math.PI * r * 1.5 * t) + Math.sin(2 * Math.PI * r * 1.26 * t)) * 0.045; }   // pad
    out[i] = s * Math.min(1, t / 0.5, (seconds - t) / 2);                                                                                             // fade in / out
  }
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf), w = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, out[i])) * 30000, true);
  return new Blob([buf], { type: 'audio/wav' });
}
