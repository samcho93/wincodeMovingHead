// editor/desk.js — Simple Desk (direct control of every channel of a universe) and Inputs / Outputs (universe mapping + monitor)
import { store, MAX_UNIVERSES } from './store.js';
import { getDef, modeOf } from './library.js';
import { h, clear, fill, select, numInput, textInput } from './ui.js';

/** label of a DMX channel from the patch */
function chanInfo(u, a) {
  for (const f of store.ws.fixtures) { if (f.universe !== u) continue; const m = modeOf(f); if (m && a >= f.address - 1 && a < f.address - 1 + m.channels.length) return { fx: f, ch: m.channels[a - f.address + 1], def: getDef(f.def) }; }
  return null;
}

export function mountDesk(app, root) {
  const { engine } = app;
  let uni = 0, page = 0; const PER = 32; let cells = [];
  function show() {
    const ws = store.ws; if (uni >= ws.universes.length) uni = 0;
    const desk = engine.desk[uni], faders = h('div', { class: 'deskfaders' }); cells = [];
    for (let i = 0; i < PER; i++) {
      const a = page * PER + i; if (a > 511) break;
      const info = chanInfo(uni, a), v = h('div', { class: 'v' }, '0');
      const rg = h('input', { type: 'range', min: 0, max: 255, value: desk[a] >= 0 ? desk[a] : engine.out[uni][a], oninput: e => { desk[a] = +e.target.value; cell.classList.add('ovr'); v.textContent = e.target.value; } });
      const cell = h('div', { class: 'dk' + (desk[a] >= 0 ? ' ovr' : '') + (info ? ' used' : ''), title: info ? `${info.fx.name} — ${info.ch.name}` : 'unpatched' },
        h('div', { class: 'no' }, a + 1), rg, v, h('div', { class: 'nm' }, info ? `${info.fx.name} ${info.ch.name}` : ''),
        h('button', { class: 'btn sm', title: 'Release this channel', onclick: () => { desk[a] = -1; cell.classList.remove('ovr'); } }, '↺'));
      cells.push({ a, rg, v }); faders.append(cell);
    }
    fill(root, 
      h('div', { class: 'row' },
        h('label', null, 'Universe', select(ws.universes.map((u, i) => [i, u.name]), uni, x => { uni = +x; page = 0; show(); })),
        h('label', null, 'Channels', select(Array.from({ length: 16 }, (_, i) => [i, `${i * PER + 1}–${i * PER + PER}`]), page, x => { page = +x; show(); })),
        h('button', { class: 'tb', onclick: () => { page = Math.max(0, page - 1); show(); } }, '◀'), h('button', { class: 'tb', onclick: () => { page = Math.min(15, page + 1); show(); } }, '▶'),
        h('button', { class: 'tb', title: 'Release every Simple Desk channel of this universe', onclick: () => { desk.fill(-1); show(); } }, '↺ Reset universe'),
        h('span', { class: 'muted' }, 'A fader moved here overrides the functions for that channel until it is released (orange border).')),
      faders);
    fast();
  }
  function fast() { const desk = engine.desk[uni], out = engine.out[uni]; if (!out) return; for (const c of cells) { if (desk[c.a] < 0 && document.activeElement !== c.rg) c.rg.value = out[c.a]; c.v.textContent = out[c.a]; } }
  engine.on(ev => { if (ev === 'desk' && root.classList.contains('active')) show(); });
  return { show, fast };
}

export function mountIO(app, root) {
  const { engine } = app;
  let uni = 0, mon = null;
  function show() {
    const ws = store.ws; if (uni >= ws.universes.length) uni = 0;
    const srv = app.serverOnline();
    mon = h('div', { class: 'mon' }, Array.from({ length: 512 }, (_, a) => h('div', { class: engine.owner[uni] && engine.owner[uni][a] ? 'pat' : '', title: `Channel ${a + 1}` }, h('i'), h('b', null, '0'))));
    fill(root, 
      h('div', { class: 'row' },
        h('button', { class: 'tb', disabled: ws.universes.length >= MAX_UNIVERSES, onclick: () => { const n = ws.universes.length + 1; ws.universes.push({ name: `Universe ${n}`, out: 'none', outUniverse: n - 1, host: '127.0.0.1' }); store.emit('universes'); show(); } }, '＋ Universe'),
        h('button', { class: 'tb danger', disabled: ws.universes.length <= 1, onclick: () => { const last = ws.universes.length - 1; if (ws.fixtures.some(f => f.universe === last)) return alert('The last universe still has fixtures patched to it.'); ws.universes.pop(); store.emit('universes'); show(); } }, '✕ Last universe'),
        h('span', { class: 'muted' }, `${ws.universes.length} universes · ${ws.universes.length * 512} channels (up to ${MAX_UNIVERSES} universes / ${MAX_UNIVERSES * 512} channels) · ${srv ? 'local server connected: Art-Net and sACN available' : 'no local server: only the virtual cable is available (run npm start for Art-Net / sACN)'}`)),
      h('table', { class: 'grid' },
        h('thead', null, h('tr', null, ['Universe', 'Output', 'Output universe', 'Target IP', 'Patched', ''].map(t => h('th', null, t)))),
        h('tbody', null, ws.universes.map((u, i) => h('tr', { class: i === uni ? 'sel' : '', onclick: e => { if (e.target.tagName === 'TD') { uni = i; show(); } } },
          h('td', null, textInput(u.name, v => { u.name = v; store.emit('universes'); })),
          h('td', null, select([['none', 'None'], ['cable', 'Virtual DMX cable (simulator windows)'], ['artnet', 'Art-Net'], ['sacn', 'sACN / E1.31']], u.out, v => { u.out = v; store.emit('universes'); show(); })),
          h('td', null, u.out === 'none' ? '' : numInput(u.outUniverse, 0, 32767, v => { u.outUniverse = v; store.emit('universes'); })),
          h('td', null, u.out === 'artnet' || u.out === 'sacn' ? textInput(u.host, v => { u.host = v || '127.0.0.1'; store.emit('universes'); }, { title: 'Device IP, broadcast address, or "multicast" for sACN' }) : ''),
          h('td', null, `${ws.fixtures.filter(f => f.universe === i).length} fixtures`),
          h('td', null, u.out === 'cable' ? h('span', { class: 'muted' }, `simulator: DMX IN = virtual cable, cable universe ${u.outUniverse}`) : u.out !== 'none' && !srv ? h('span', { style: 'color:var(--red)' }, 'needs the local server') : ''))))),
      h('h3', null, `DMX monitor — ${ws.universes[uni].name}`), mon);
    fast();
  }
  function fast() { if (!mon || !engine.out[uni]) return; const out = engine.out[uni], kids = mon.children; for (let a = 0; a < 512; a++) { const v = out[a], k = kids[a]; if (k._v === v) continue; k._v = v; k.lastChild.textContent = v; k.firstChild.style.height = (v / 2.55) + '%'; } }
  return { show, fast };
}
