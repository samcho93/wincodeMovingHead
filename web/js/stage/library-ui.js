// stage/library-ui.js — the fixture library window of the stage editor: search every fixture that can stand on the
//  stage (Wincode models, the bundled Open Fixture Library, files the user imported), choose mode and quantity, add.
import { h, fill, select, numInput } from '../editor/ui.js';
import { library, getDef } from '../editor/library.js';
import { register } from '../library/desc.js';
import { oflIndex, oflDesc, userLibrary, importFile } from '../library/catalog.js';

const SHOW = 150;                                            // rows drawn at once
const KINDS = [['', 'All kinds'], ['Moving Head', 'Moving heads'], ['Color Changer', 'Colour changers'], ['Pixel Bar', 'Pixel bars'], ['Blinder', 'Blinders'], ['Strobe', 'Strobes'], ['Scanner', 'Scanners'], ['Dimmer', 'Dimmers'], ['Effect', 'Effects'], ['Matrix', 'Matrices']];

/** onAdd({ def, desc, mode, count, mount }) — desc is null for a built-in model */
export async function openLibrary(onAdd) {
  const back = h('div', { class: 'dlg-back' }), close = () => back.remove();
  const listEl = h('div', { class: 'lib-list' }), detail = h('div', { class: 'lib-detail' }), countEl = h('span', { class: 'note' });
  let rows = [], q = '', kind = '', src = '', picked = null;

  const wincode = library.filter(d => d.sim && d.manufacturer === 'Wincode').map(d => ({ id: d.id, m: 'Wincode', n: d.model, c: ['Moving Head'], k: Object.fromEntries(Object.values(d.modes).map(m => [m.id, m.channels.length])), f: ['moving'], src: 'wincode' }));
  const users = () => Object.values(userLibrary.all()).map(D => ({ id: D.id, m: D.manufacturer, n: D.name, c: D.categories || [], k: Object.fromEntries(D.modes.map(m => [m.id, m.channels.length])), f: [], src: 'user' }));
  let ofl = []; fill(listEl, h('p', { class: 'note', style: 'padding:10px' }, 'Loading the library…'));
  const build = () => { rows = [...wincode, ...users(), ...ofl]; draw(); };
  oflIndex().then(ix => { ofl = ix.map(x => Object.assign({ src: 'ofl' }, x)); build(); }).catch(e => { build(); countEl.textContent = e.message; });

  function draw() {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = rows.filter(r => (!src || r.src === src) && (!kind || r.c.includes(kind)) && words.every(w => (r.m + ' ' + r.n).toLowerCase().includes(w)));
    countEl.textContent = `${hit.length} of ${rows.length} fixtures${hit.length > SHOW ? ` — showing the first ${SHOW}, type to narrow down` : ''}`;
    fill(listEl, hit.slice(0, SHOW).map(r => h('div', { class: 'fnrow' + (picked && picked.id === r.id ? ' sel' : ''), onclick: () => pick(r) },
      h('span', { class: 'nm' }, h('b', null, r.n), h('span', { class: 'note' }, '  ' + r.m)),
      h('span', { class: 'note' }, [r.src === 'wincode' ? '3D model' : r.src === 'user' ? 'imported' : '', ...r.f.filter(x => x !== 'moving')].filter(Boolean).join(' · ')),
      h('span', { class: 'note', style: 'min-width:74px;text-align:right' }, Object.values(r.k).sort((a, b) => a - b).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4).join('/') + ' ch'))),
      !hit.length && h('p', { class: 'note', style: 'padding:10px' }, 'Nothing matches. Import a GDTF file for a fixture that is not in the library.'));
  }
  async function pick(r) {
    picked = r; draw(); fill(detail, h('p', { class: 'note' }, 'Loading…'));
    let def, desc = null;
    try {
      if (r.src === 'wincode') def = getDef(r.id);
      else { desc = r.src === 'user' ? userLibrary.all()[r.id] : await oflDesc(r.id); def = register(desc); }
    } catch (e) { return fill(detail, h('p', { class: 'note', style: 'color:#ff9c8a' }, 'This fixture could not be loaded: ' + e.message)); }
    if (picked !== r) return;
    let mode = def.defaultMode, count = 1, mount = 'truss';
    const chans = h('div', { class: 'lib-chans' }), showChans = () => fill(chans, def.modes[mode].channels.map((c, i) => h('div', null, h('span', { class: 'note' }, String(i + 1).padStart(2, '0') + '  '), c.name)));
    showChans();
    fill(detail,
      h('h3', null, r.n), h('div', { class: 'note' }, [r.m, ...r.c].join(' · ')),
      h('div', { class: 'kv', style: 'margin-top:10px' },
        h('span', null, 'Channel mode'), select(Object.values(def.modes).map(m => [m.id, m.label]), mode, v => { mode = v; showChans(); }),
        h('span', null, 'Quantity'), numInput(1, 1, 48, v => { count = v; }),
        h('span', null, 'Mounting'), select([['truss', 'Hung from the truss'], ['floor', 'On the floor']], mount, v => { mount = v; })),
      h('div', { class: 'row', style: 'margin:10px 0' }, h('button', { class: 'btn acc', onclick: () => { onAdd({ def, desc, mode, count, mount }); close(); } }, '＋ Add to the stage'),
        r.src === 'user' && h('button', { class: 'btn sm danger', title: 'Remove this imported fixture from the library in this browser (stages that use it keep their copy)', onclick: () => { userLibrary.remove(r.id); picked = null; fill(detail); build(); } }, 'Forget')),
      r.src !== 'wincode' && h('p', { class: 'note' }, (desc && desc.shape ? 'Library fixture: the body is the 3D model of its GDTF file, and its channels and ranges drive it —' : 'Library fixture: its body is generated from its kind and size, and its channels and ranges drive it —') + ' beam, colour, gobo wheels, prism, zoom and movement are simulated; macro and effect channels are not.'),
      h('div', { class: 'note', style: 'margin-top:6px' }, 'Channels'), chans);
  }
  async function importFiles(files) {
    const done = [], failed = [];
    for (const f of files) try { const D = await importFile(f); register(D); userLibrary.add(D); done.push(D); } catch (e) { failed.push(`${f.name}: ${e.message}`); }
    build(); if (done.length) { src = 'user'; srcSel.value = 'user'; draw(); pick(rows.find(r => r.id === done[done.length - 1].id)); }
    if (failed.length) alert('Could not import:\n' + failed.join('\n'));
  }
  const file = h('input', { type: 'file', accept: '.gdtf,.json', multiple: true, hidden: true, onchange: e => { const fs = [...e.target.files]; e.target.value = ''; importFiles(fs); } });
  const srcSel = select([['', 'All sources'], ['wincode', 'Wincode (full 3D models)'], ['ofl', 'Open Fixture Library'], ['user', 'Imported files']], src, v => { src = v; draw(); });
  const search = h('input', { type: 'text', placeholder: 'Search by name or manufacturer…', style: 'flex:1;min-width:180px', oninput: e => { q = e.target.value; draw(); } });
  back.append(h('div', { class: 'dlg lib' },
    h('h3', null, 'Fixture library'),
    h('div', { class: 'row' }, search, select(KINDS, kind, v => { kind = v; draw(); }), srcSel, h('button', { class: 'btn', title: 'Add a fixture from a GDTF file (.gdtf) or an Open Fixture Library file (.json)', onclick: () => file.click() }, 'Import GDTF / OFL file…'), file),
    h('div', { class: 'lib-body' }, h('div', { class: 'lib-left' }, listEl, countEl), detail),
    h('div', { class: 'btns' }, h('span', { class: 'note', style: 'flex:1' }, 'Library data: Open Fixture Library (open-fixture-library.org, MIT licence).'), h('button', { class: 'btn', onclick: close }, 'Close'))));
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('dragover', e => e.preventDefault());
  back.addEventListener('drop', e => { e.preventDefault(); importFiles([...e.dataTransfer.files]); });
  document.body.append(back); fill(detail, h('p', { class: 'note' }, 'Choose a fixture on the left. Files can also be dropped on this window.')); search.focus();
}
