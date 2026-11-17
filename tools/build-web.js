#!/usr/bin/env node
/* =====================================================================
 *  build-web.js — assemble the static site (dist/) for web hosting
 *   dist/index.html, console.html, js, css   web/ as is (+ WMH_STATIC flag: skip server detection)
 *   dist/vendor/three/...                    three.js (only the modules that are used)
 *   (the manufacturer's manual PDF in docs/ is deliberately not published)
 *  The static build has no server, so only the virtual DMX cable and Web Serial inputs work.
 *  Usage: node tools/build-web.js [--out dist]
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(ROOT, arg('out', 'dist'));
const cp = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };
const cpDir = (src, dst, filter = () => true) => {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) cpDir(s, d, filter); else if (filter(s)) cp(s, d);
  }
};

fs.rmSync(OUT, { recursive: true, force: true });
cpDir(path.join(ROOT, 'web'), OUT);
for (const page of ['index.html', 'console.html']) {
  const f = path.join(OUT, page);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('<link rel="stylesheet"', '<script>window.WMH_STATIC = 1;</script>\n<link rel="stylesheet"'));
}
const THREE = path.join(ROOT, 'node_modules', 'three');
cp(path.join(THREE, 'build', 'three.module.js'), path.join(OUT, 'vendor/three/build/three.module.js'));
for (const d of ['controls', 'environments', 'postprocessing', 'shaders'])
  cpDir(path.join(THREE, 'examples/jsm', d), path.join(OUT, 'vendor/three/examples/jsm', d), f => f.endsWith('.js'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

let total = 0;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else total += fs.statSync(p).size; });
walk(OUT);
console.log(`dist assembled: ${OUT} (${(total / 1048576).toFixed(1)} MB)`);
