#!/usr/bin/env node
/* =====================================================================
 *  check-model.mjs — validate the fixture model definitions (web/js/models/*.js)
 *    node tools/check-model.mjs            all registered models
 *    node tools/check-model.mjs tb5        one model
 *    node tools/check-model.mjs --json     machine-readable result
 *  Checks the definition contract (models/index.js), every channel mode, decode()/describe() over the whole
 *  value range, the body dimensions needed by the 3D builder, and runs the demo sequence against the model.
 *  Exit code 1 when a model has errors.
 * ===================================================================== */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const url = rel => pathToFileURL(path.join(ROOT, rel)).href;
const args = process.argv.slice(2), json = args.includes('--json'), only = args.find(a => !a.startsWith('--'));

const { LIST } = await import(url('web/js/models/index.js'));
const { demoValues } = await import(url('web/js/demo.js'));
const num = v => typeof v === 'number' && isFinite(v);

function check(M) {
  const errors = [], warnings = [], E = m => errors.push(m), W = m => warnings.push(m);
  for (const k of ['id', 'code', 'name', 'title', 'lcdTitle']) if (typeof M[k] !== 'string' || !M[k]) E(`missing string field "${k}"`);
  if (M.id && !/^[a-z][a-z0-9]*$/.test(M.id)) E(`id "${M.id}" must be lower-case letters and digits`);
  const S = M.spec || {};
  for (const k of ['panRange', 'tiltRange', 'zoomMin', 'zoomMax', 'cd']) if (!num(S[k])) E(`spec.${k} must be a number`);
  if (!Array.isArray(S.ledWhite) || S.ledWhite.length !== 3) E('spec.ledWhite must be [r, g, b]');
  if (S.focus && !(Array.isArray(S.focus) && S.focus.length === 2)) E('spec.focus must be [a, b] or omitted');
  if (!Array.isArray(M.colors) || !M.colors.length || !M.colors.every(c => c.name && Array.isArray(c.rgb))) E('colors must be a non-empty list of { name, rgb }');
  if (!M.gobos || !Array.isArray(M.gobos.fix) || !Array.isArray(M.gobos.rot)) E('gobos must be { fix: [...], rot: [...], draw }');
  else if ((M.gobos.fix.length > 1 || M.gobos.rot.length > 1) && typeof M.gobos.draw !== 'function') E('gobos.draw is required when the model has gobos');
  if (typeof M.decode !== 'function' || typeof M.describe !== 'function') E('decode() and describe() are required');
  if (!M.features || typeof M.features !== 'object') E('features object is required');
  if (!['manual', 'hold'].includes(M.noSignal)) E("noSignal must be 'manual' or 'hold'");
  if (!num(M.resetHold)) E('resetHold (seconds) is required');
  if (!M.program || !Array.isArray(M.program.steps) || !M.program.steps.length) E('program.steps is required (built-in auto program)');
  if (!M.panel || !['buttons', 'touch'].includes(M.panel.type)) E("panel.type must be 'buttons' or 'touch'");
  else if (M.panel.type === 'buttons' && !M.panel.menu && !(Array.isArray(M.panel.manualKeys) && Array.isArray(M.panel.calKeys))) E('a buttons panel needs panel.menu(), or panel.manualKeys + panel.calKeys for the default menu');
  if (!M.rdm || !num(M.rdm.modelId) || !M.rdm.description) E('rdm { modelId, description, software } is required');
  if (!Array.isArray(M.assumptions)) E('assumptions must be an array (may be empty only if the manual states everything)');
  else if (!M.assumptions.length) W('assumptions is empty — is everything really stated in the manual?');
  const heads = M.heads || 1;

  // channel modes
  const modes = M.modes || {};
  if (!Object.keys(modes).length) E('no channel modes');
  if (!modes[M.defaultMode]) E(`defaultMode "${M.defaultMode}" is not one of the modes`);
  for (const [id, m] of Object.entries(modes)) {
    if (m.id !== id) E(`mode ${id}: id field is "${m.id}"`);
    if (!Array.isArray(m.channels) || !m.channels.length) { E(`mode ${id}: no channels`); continue; }
    if (new Set(m.channels).size !== m.channels.length) E(`mode ${id}: duplicate channel keys`);
    const n = /(\d+)\s*CH/i.exec(m.label || ''); if (n && +n[1] !== m.channels.length) E(`mode ${id}: label says ${n[1]} channels but ${m.channels.length} are listed`);
    for (const k of m.channels) if (typeof (M.ch || {})[k] !== 'string') E(`mode ${id}: channel "${k}" has no name in ch`);
    if (errors.length) continue;
    try {
      const zero = Object.fromEntries(m.channels.map(k => [k, 0]));
      for (const k of m.channels) for (const v of [0, 1, 64, 127, 128, 200, 255]) {
        const t = M.decode({ ...zero, [k]: v }), list = t.heads || [t];
        if (heads > 1 && (!Array.isArray(t.heads) || t.heads.length !== heads)) throw new Error(`decode() must return heads[${heads}]`);
        for (const h of list) {
          for (const f of ['pan', 'tilt', 'dimmer', 'zoom']) if (!num(h[f]) || h[f] < -0.001 || h[f] > 1.001) throw new Error(`decode(): ${f} = ${h[f]} (channel ${k} = ${v}) must be 0..1`);
          if (!h.strobe || !['open', 'closed', 'strobe', 'pulse', 'fadein', 'random'].includes(h.strobe.mode)) throw new Error(`decode(): bad strobe target for ${k} = ${v}`);
          if (M.features.rgbl && (!Array.isArray(h.rgb) || !num(h.level))) throw new Error('decode(): rgbl models must return rgb[3] and level');
        }
        const d = M.describe(k, v); if (typeof d !== 'string') throw new Error(`describe(${k}, ${v}) returned ${typeof d}`);
      }
      for (const t of [0, 3, 7.5, 12, 26, 41]) { const d = demoValues(M, m.channels, t); for (const [k, v] of Object.entries(d.values)) if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`demo: ${k} = ${v}`); }
    } catch (e) { E(`mode ${id}: ${e.message}`); }
  }
  // defaults must resolve for every channel key
  for (const f of ['manualDefaults', 'homeValues', 'sceneDefault']) if (M[f] != null && typeof M[f] !== 'object' && typeof M[f] !== 'function') E(`${f} must be an object or a function`);
  if (M.noSignal === 'manual' && M.manualDefaults == null) E("noSignal 'manual' needs manualDefaults");
  if (M.features && M.features.scenes && M.sceneDefault == null) E('features.scenes needs sceneDefault');
  if (M.features && M.features.ring && typeof M.ringMacro !== 'function') E('features.ring needs ringMacro()');

  // body (3D builder)
  const B = M.body;
  if (!B) E('body is required');
  else {
    if (!['box', 'round', 'bar'].includes(B.style)) E("body.style must be 'box', 'round' or 'bar'");
    for (const k of ['H', 'panY', 'tiltY', 'lensY', 'lensR', 'ringR', 'lcdX', 'ctrlX']) if (!num(B[k])) E(`body.${k} must be a number (metres)`);
    if (!Array.isArray(B.lcd) || B.lcd.length !== 2) E('body.lcd must be [width, height]');
    if (!['cross5', 'col4', 'encoder'].includes(B.controls)) E("body.controls must be 'cross5', 'col4' or 'encoder'");
    if (!Array.isArray(B.head) || B.head.length < 2) E('body.head must list at least two loft sections');
    const b = B.base || {};
    for (const k of ['depth', 'bot', 'top', 'panelY', 'frameW', 'frameH']) if (!num(b[k])) E(`body.base.${k} must be a number`);
    if (B.style === 'bar') { if (!num(b.length) || !num(B.headPitch) || !num(B.headCount) || !B.yoke) E('bar bodies need base.length, headPitch, headCount and yoke'); if (B.headCount !== heads) E(`body.headCount (${B.headCount}) must equal heads (${heads})`); }
    else { for (const k of ['hw', 'shoulder', 'chamfer']) if (!num(b[k])) E(`body.base.${k} must be a number`); if (!B.feet || !B.turntable || !(B.yoke || (Array.isArray(B.bridge) && B.arm))) E('box / round bodies need feet, turntable and either yoke or bridge + arm'); }
    if (num(B.H) && (B.H < 0.1 || B.H > 2)) W(`body.H = ${B.H} m looks wrong (expected metres)`);
  }
  return { id: M.id, name: M.name, ok: !errors.length, errors, warnings, modes: Object.values(modes).map(m => `${m.id} (${m.channels ? m.channels.length : '?'})`) };
}

const ids = new Set();
const results = LIST.filter(M => !only || M.id === only).map(M => { const r = check(M); if (ids.has(M.id)) { r.ok = false; r.errors.push('duplicate model id'); } ids.add(M.id); return r; });
if (only && !results.length) { console.error(`model "${only}" is not registered in web/js/models/index.js`); process.exit(1); }
if (json) console.log(JSON.stringify(results));
else for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id} — ${r.name} · ${r.modes.join(', ')}`);
  r.errors.forEach(e => console.log('   error:   ' + e)); r.warnings.forEach(w => console.log('   warning: ' + w));
}
process.exit(results.every(r => r.ok) ? 0 : 1);
