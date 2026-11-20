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
// distribution build: the development-only "Add model" agent (agent.html, js/agent.js) is left out
const DEV_ONLY = /[\\/](agent\.html|agent\.js)$/;
cpDir(path.join(ROOT, 'web'), OUT, f => f.endsWith('.html') && !DEV_ONLY.test(f));
// Scripts and styles go into a folder named after this build. Static hosts cache files for a while
// (GitHub Pages: 10 minutes); without this a browser can mix a new page with old modules after a deploy.
let stamp = (process.env.GITHUB_SHA || '').slice(0, 8);
if (!stamp) { try { stamp = require('child_process').execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: ROOT }).toString().trim() + '-' + Date.now().toString(36); } catch (e) { stamp = Date.now().toString(36); } }
const A = `a/${stamp}`;
cpDir(path.join(ROOT, 'web', 'js'), path.join(OUT, A, 'js'), f => !DEV_ONLY.test(f) && !f.endsWith('package.json'));
cpDir(path.join(ROOT, 'web', 'css'), path.join(OUT, A, 'css'));
cpDir(path.join(ROOT, 'web', 'manual'), path.join(OUT, 'manual'), f => !f.endsWith('.html'));   // the manuals' pages were copied above; these are their stylesheet and pictures
for (const page of ['index.html', 'console.html', 'editor.html', 'stage.html', 'rig.html']) {
  const f = path.join(OUT, page);
  const html = fs.readFileSync(f, 'utf8')
    .replace('<link rel="stylesheet" href="css/', `<script>window.WMH_STATIC = 1; window.WMH_BUILD = '${stamp}';</script>\n<link rel="stylesheet" href="${A}/css/`)
    .replace(/<link rel="stylesheet" href="css\//g, `<link rel="stylesheet" href="${A}/css/`)
    .replace(/<script type="module" src="js\//, `<script type="module" src="${A}/js/`);
  if (!html.includes(`${A}/js/`) || !html.includes(`${A}/css/`)) { console.error(`✖ ${page}: could not rewrite asset paths`); process.exit(1); }
  fs.writeFileSync(f, html);
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
