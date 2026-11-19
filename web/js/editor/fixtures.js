// editor/fixtures.js — Fixture Manager: patch fixtures to universes and addresses
import { store } from './store.js';
import { library, getDef, modeOf } from './library.js';
import { h, clear, fill, select, numInput, textInput, dialog } from './ui.js';

/** first address in a universe with `count` free channels (1-based), or 0 */
export function freeAddress(universe, count, ignoreId) {
  const used = new Uint8Array(513);
  for (const f of store.ws.fixtures) if (f.universe === universe && f.id !== ignoreId) { const n = modeOf(f)?.channels.length || 0; for (let a = f.address; a < f.address + n && a <= 512; a++) used[a] = 1; }
  for (let a = 1; a + count - 1 <= 512; a++) { let ok = true; for (let k = 0; k < count; k++) if (used[a + k]) { ok = false; a += k; break; } if (ok) return a; }
  return 0;
}

export function mountFixtures(app, root) {
  let sel = null;
  const overlaps = () => {
    const bad = new Set(), ws = store.ws;
    ws.fixtures.forEach((a, i) => { const na = modeOf(a)?.channels.length || 0; if (a.address + na - 1 > 512) bad.add(a.id);
      for (let j = i + 1; j < ws.fixtures.length; j++) { const b = ws.fixtures[j], nb = modeOf(b)?.channels.length || 0; if (a.universe === b.universe && a.address < b.address + nb && b.address < a.address + na) { bad.add(a.id); bad.add(b.id); } } });
    return bad;
  };
  function addDialog() {
    const ws = store.ws; let def = library[0], mode = def.defaultMode;
    const f = { name: '', universe: 0, address: 1, amount: 1, gap: 0 };
    dialog('Add fixture', body => {
      const draw = () => {
        const n = def.modes[mode].channels.length; f.address = freeAddress(f.universe, n) || 1;
        fill(body, h('div', { class: 'form' },
          'Fixture', select(library.map(d => [d.id, `${d.manufacturer} — ${d.model}`]), def.id, v => { def = getDef(v); mode = def.defaultMode; draw(); }),
          'Mode', select(Object.values(def.modes).map(m => [m.id, `${m.label} (${m.channels.length} channels)`]), mode, v => { mode = v; draw(); }),
          'Name', textInput(f.name, v => { f.name = v; }, { placeholder: def.model }),
          'Universe', select(ws.universes.map((u, i) => [i, u.name]), f.universe, v => { f.universe = +v; draw(); }),
          'Address', numInput(f.address, 1, 512, v => { f.address = v; }),
          'Amount', numInput(f.amount, 1, 64, v => { f.amount = v; }),
          'Address gap', numInput(f.gap, 0, 100, v => { f.gap = v; })),
          h('p', { class: 'muted' }, `Channels: ${def.modes[mode].channels.map(c => c.name).slice(0, 12).join(', ')}${n > 12 ? ` … (${n})` : ''}`));
      };
      draw();
    }, [['Add', () => {
      const n = def.modes[mode].channels.length; let addr = f.address;
      for (let i = 0; i < f.amount; i++) {
        if (addr + n - 1 > 512) { alert(`Universe full after ${i} fixture(s).`); break; }
        ws.fixtures.push({ id: store.id(), name: (f.name || def.model.replace(/ \(.*/, '')) + (f.amount > 1 ? ` ${i + 1}` : ''), def: def.id, mode, universe: f.universe, address: addr });
        addr += n + f.gap;
      }
      store.emit('fixtures');
    }, 'acc']]);
  }
  function show() {
    const ws = store.ws, bad = overlaps();
    fill(root, 
      h('div', { class: 'row' },
        h('button', { class: 'tb', onclick: addDialog }, '＋ Add fixture'),
        h('button', { class: 'tb danger', disabled: sel == null, onclick: () => { if (sel == null) return; ws.fixtures = ws.fixtures.filter(f => f.id !== sel); for (const fn of ws.functions) { if (fn.values) delete fn.values[sel]; if (fn.fixtures) fn.fixtures = fn.fixtures.filter(r => r.fx !== sel); } sel = null; store.emit('fixtures'); } }, '✕ Remove'),
        h('span', { class: 'muted grow' }, `${ws.fixtures.length} fixtures · ${ws.fixtures.reduce((s, f) => s + (modeOf(f)?.channels.length || 0), 0)} channels in ${ws.universes.length} universes (${ws.universes.length * 512} available)`)),
      ...ws.universes.map((u, ui) => { const fs = ws.fixtures.filter(f => f.universe === ui); return fs.length ? h('div', { class: 'row' }, h('span', { class: 'muted', style: 'width:110px' }, u.name), h('div', { class: 'usage' }, fs.map(f => { const n = modeOf(f)?.channels.length || 0; return h('i', { class: bad.has(f.id) ? 'bad' : '', title: `${f.name} ${f.address}–${f.address + n - 1}`, style: `left:${(f.address - 1) / 5.12}%;width:${n / 5.12}%` }); }))) : null; }),
      h('table', { class: 'grid' },
        h('thead', null, h('tr', null, ['Name', 'Fixture', 'Mode', 'Universe', 'Address', 'Channels', ''].map(t => h('th', null, t)))),
        h('tbody', null, ws.fixtures.map(f => {
          const d = getDef(f.def), m = modeOf(f), n = m?.channels.length || 0;
          return h('tr', { class: (f.id === sel ? 'sel ' : '') + (bad.has(f.id) ? 'bad' : ''), onclick: e => { if (e.target.tagName === 'TD') { sel = f.id; show(); } } },
            h('td', null, textInput(f.name, v => { f.name = v; store.emit('fixtures'); })),
            h('td', null, d ? `${d.manufacturer} — ${d.model}` : `(unknown: ${f.def})`),
            h('td', null, d ? select(Object.values(d.modes).map(x => [x.id, x.label]), f.mode, v => { f.mode = v; for (const fn of ws.functions) if (fn.values) delete fn.values[f.id]; store.emit('fixtures'); }) : ''),
            h('td', null, select(ws.universes.map((u, i) => [i, u.name]), f.universe, v => { f.universe = +v; store.emit('fixtures'); })),
            h('td', null, numInput(f.address, 1, 512, v => { f.address = v; store.emit('fixtures'); })),
            h('td', null, `${f.address}–${f.address + n - 1} (${n})${bad.has(f.id) ? '  ⚠ overlap / out of range' : ''}`),
            h('td', null, d && d.sim && d.manufacturer === 'Wincode' ? h('a', { class: 'btn sm', href: `index.html?model=${d.sim}`, target: 'wmh-sim-' + f.id, title: `Opens this model in the 3D simulator. Set its DMX address to ${f.address} and DMX IN to the virtual cable (universe ${ws.universes[f.universe].outUniverse}).` }, '🔦 Simulator') : ''));
        }))),
      ws.fixtures.length ? null : h('p', { class: 'muted' }, 'No fixtures yet. Add the fixtures of your rig, then build scenes in the Functions tab.'));
  }
  store.on(w => { if (w === 'fixtures' || w === 'universes') { if (root.classList.contains('active')) show(); } });
  return { show, reload() { sel = null; } };
}
