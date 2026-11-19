// library/catalog.js — where fixture descriptions come from in the browser.
//  · the bundled Open Fixture Library (data/ofl: an index for searching, one file per manufacturer, loaded when needed;
//    built by tools/import-ofl.mjs)
//  · fixtures the user imported from a GDTF or Open Fixture Library file — kept in this browser
import { fromOFL } from './ofl.js';
import { fromGDTF } from './gdtf.js';

const BASE = new URL('./data/ofl/', import.meta.url), LS = 'wmh.library.user.v1';
let indexP = null; const packs = new Map();
/** [{ id, m: manufacturer, n: name, c: categories, k: { mode: channels }, f: ['moving', 'rgb', 'gobo', 'prism'] }] */
export const oflIndex = () => indexP || (indexP = fetch(new URL('index.json', BASE)).then(r => { if (!r.ok) throw new Error('The bundled fixture library is missing'); return r.json(); }).catch(e => { indexP = null; throw e; }));
export async function oflDesc(id) {
  const [, man, key] = id.split('/');
  if (!packs.has(man)) packs.set(man, fetch(new URL(man + '.json', BASE)).then(r => r.json()));
  const D = (await packs.get(man))[key]; if (!D) throw new Error('Fixture not found in the library: ' + id); return D;
}

export const userLibrary = {
  all() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } },
  add(D) { const all = this.all(); all[D.id] = D; try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} },
  remove(id) { const all = this.all(); delete all[id]; try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} },
};
/** a .gdtf file or an Open Fixture Library .json file → description */
export async function importFile(file) {
  if (/\.gdtf$/i.test(file.name)) return fromGDTF(file);
  const J = JSON.parse(await file.text());
  const D = fromOFL(J, 'file', file.name.replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'Imported'); D.id = D.id.replace(/^ofl\//, 'user/'); return D;
}
