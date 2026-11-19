#!/usr/bin/env node
/* =====================================================================
 *  import-ofl.mjs — build the bundled fixture library from the Open Fixture Library
 *    git clone --depth 1 https://github.com/OpenLightingProject/open-fixture-library
 *    node tools/import-ofl.mjs <path to that checkout>
 *  Writes web/js/library/data/ofl/index.json (one line per fixture, for the browser's search) and one file per
 *  manufacturer with the converted descriptions (library/desc.js). Every fixture is converted with the same code the
 *  browser uses (library/ofl.js) and its model is run once in every mode; what fails or carries no light is left out.
 *  The Open Fixture Library is MIT licensed — its notice is copied next to the data.
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromOFL } from '../web/js/library/ofl.js';
import { modelFromDesc } from '../web/js/library/desc.js';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(path.join(SRC, 'fixtures', 'manufacturers.json'))) { console.error('Usage: node tools/import-ofl.mjs <open-fixture-library checkout>'); process.exit(1); }
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js', 'library', 'data', 'ofl');
const mans = JSON.parse(fs.readFileSync(path.join(SRC, 'fixtures', 'manufacturers.json'), 'utf8'));
const LIGHT = new Set(['Intensity', 'ColorIntensity', 'WheelSlot', 'Shutter']);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const index = [], skipped = [];
for (const man of fs.readdirSync(path.join(SRC, 'fixtures')).sort()) {
  const dir = path.join(SRC, 'fixtures', man); if (!fs.statSync(dir).isDirectory()) continue;
  const pack = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const key = f.slice(0, -5);
    try {
      const J = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (J.redirectTo) continue;
      const D = fromOFL(J, man, key, (mans[man] || {}).name), M = modelFromDesc(D);
      if (!Object.values(D.channels).some(c => (c.caps || []).some(x => LIGHT.has(x.type)))) { skipped.push(`${man}/${key}: no light output`); continue; }
      for (const m of Object.values(M.modes)) for (const vals of [M.homeValues, M.highlight]) {   // run it once: a model that throws must not reach the stage
        const v = {}; for (const k of m.channels) v[k] = vals[k] | 0; const t = M.decode(v);
        for (const x of [t.pan, t.tilt, t.dimmer, t.zoom]) if (!Number.isFinite(x)) throw new Error(`mode ${m.id}: decode gave ${x}`);
        for (const k of m.channels) M.describe(k, v[k]);
      }
      pack[key] = D;
      index.push({ id: D.id, m: D.manufacturer, n: D.name, c: D.categories, k: Object.fromEntries(D.modes.map(x => [x.id, x.channels.length])), f: [M.moving ? 'moving' : '', M.features.rgbl ? 'rgb' : '', M.features.gobos ? 'gobo' : '', M.features.prism ? 'prism' : ''].filter(Boolean) });
    } catch (e) { skipped.push(`${man}/${key}: ${e.message}`); }
  }
  if (Object.keys(pack).length) fs.writeFileSync(path.join(OUT, man + '.json'), JSON.stringify(pack));
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(OUT, 'LICENSE-open-fixture-library.txt'));
const size = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`${index.length} fixtures from ${new Set(index.map(x => x.m)).size} manufacturers → ${(size / 1e6).toFixed(1)} MB in ${path.relative(process.cwd(), OUT)}`);
console.log(`${skipped.length} left out:`); for (const s of skipped) console.log('  ' + s);
