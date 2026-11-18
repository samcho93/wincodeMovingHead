// editor/main.js — DMX editor shell: toolbar, tabs, the 40 Hz clock and the outputs.
//  The working method follows QLC+: Fixtures (patch) → Functions → Shows (timeline) → Virtual Console → Simple Desk,
//  with Inputs/Outputs mapping each universe to a real or virtual DMX line. Design mode edits, Operate mode runs.
import { store } from './store.js';
import { Engine } from './engine.js';
import { $ } from './ui.js';
import { CABLE } from '../dmx.js';
import { mountFixtures } from './fixtures.js';
import { mountFunctions } from './functions.js';
import { mountShows } from './shows.js';
import { mountVC } from './vc.js';
import { mountDesk, mountIO } from './desk.js';

store.restore();
const engine = new Engine();
const app = { engine, store, operate: false, tab: 'fixtures', views: {} };
window.WMX = app;                                              // for debugging from the console

/* ── outputs ── */
const bc = new BroadcastChannel(CABLE), tabId = 'ed-' + Math.random().toString(36).slice(2);
let ws = null, hasServer = false;
async function connect() {
  if (window.WMH_STATIC) return;
  try { const j = await (await fetch('api/status', { cache: 'no-store' })).json(); if (j.app !== 'wincode-movinghead-sim') return; } catch (e) { return; }
  hasServer = true;
  const open = () => { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); ws.onclose = () => setTimeout(open, 1500); };
  open();
}
const online = () => ws && ws.readyState === 1;
app.serverOnline = () => hasServer && online();
const enc = new TextEncoder();
function send() {
  store.ws.universes.forEach((u, i) => {
    const data = engine.out[i]; if (!data || u.out === 'none') return;
    if (u.out === 'cable') bc.postMessage({ t: 'dmx', from: tabId, u: u.outUniverse | 0, data: data.slice() });
    else if (online()) {                                       // [3, proto, universe lo, hi, host length, host…, 512 slots] → real Art-Net / sACN packet
      const host = enc.encode(u.host || '127.0.0.1'), b = new Uint8Array(5 + host.length + 512);
      b[0] = 3; b[1] = u.out === 'sacn' ? 1 : 0; b[2] = u.outUniverse & 255; b[3] = (u.outUniverse >> 8) & 255; b[4] = host.length; b.set(host, 5); b.set(data, 5 + host.length);
      ws.send(b);
    }
  });
}

/* ── clock: a worker timer keeps 40 Hz even when this tab is in the background ── */
let last = performance.now();
const clock = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 25)'], { type: 'text/javascript' })));
clock.onmessage = () => { const now = performance.now(), dt = Math.min(200, now - last); last = now; engine.tick(dt); send(); };

/* ── toolbar ── */
const syncBar = () => {
  $('#wsName').value = store.ws.name;
  $('#btnMode').textContent = app.operate ? '▶ Operate' : '✎ Design'; $('#btnMode').classList.toggle('on', app.operate);
  document.body.classList.toggle('operate', app.operate);
  $('#btnBlackout').classList.toggle('on', engine.blackout);
};
$('#wsName').addEventListener('change', e => { store.ws.name = e.target.value || 'Workspace'; store.emit('name'); });
$('#btnNew').addEventListener('click', () => { if (confirm('Start a new workspace? Unsaved changes are lost.')) { engine.reset(); store.reset(); } });
$('#btnSave').addEventListener('click', () => store.download());
$('#btnOpen').addEventListener('click', () => $('#fileOpen').click());
$('#fileOpen').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { engine.reset(); store.load(JSON.parse(await f.text())); } catch (err) { alert('Could not open the file: ' + err.message); } });
$('#btnMode').addEventListener('click', () => { app.operate = !app.operate; if (app.operate) Object.values(app.views).forEach(v => v.hide && v.hide()); syncBar(); refresh(); });
$('#btnBlackout').addEventListener('click', () => { engine.blackout = !engine.blackout; syncBar(); });
$('#btnStopAll').addEventListener('click', () => engine.stopAll());
$('#btnReset').addEventListener('click', () => engine.reset());
$('#gm').addEventListener('input', e => { engine.gm = e.target.value / 100; $('#gmVal').textContent = e.target.value + '%'; });
addEventListener('beforeunload', () => store.autosave());

/* ── tabs ── */
const refresh = () => { const v = app.views[app.tab]; if (v && v.show) v.show(); };
document.querySelectorAll('.etab').forEach(t => t.addEventListener('click', () => {
  const prev = app.views[app.tab]; if (prev && prev.hide && t.dataset.tab !== app.tab) prev.hide();   // e.g. stop a scene's live-edit preview
  app.tab = t.dataset.tab;
  document.querySelectorAll('.etab').forEach(x => x.classList.toggle('active', x === t));
  document.querySelectorAll('.epane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + app.tab));
  refresh();
}));
app.views.fixtures = mountFixtures(app, $('#tab-fixtures'));
app.views.functions = mountFunctions(app, $('#tab-functions'));
app.views.shows = mountShows(app, $('#tab-shows'));
app.views.vc = mountVC(app, $('#tab-vc'));
app.views.desk = mountDesk(app, $('#tab-desk'));
app.views.io = mountIO(app, $('#tab-io'));
store.on(w => { if (w === 'workspace') { syncBar(); Object.values(app.views).forEach(v => v.reload && v.reload()); refresh(); } });

/* ── status + live views (10 Hz) ── */
let f0 = 0;
setInterval(() => {
  const n = engine.top.size; $('#runPill').textContent = `${n} running`; $('#runPill').className = 'pill ' + (n ? 'on' : '');
  const outs = store.ws.universes.filter(u => u.out !== 'none'), net = outs.some(u => u.out !== 'cable'), fps = (engine.frames - f0) * 2; f0 = engine.frames;
  const o = $('#outPill');
  o.className = 'pill ' + (!outs.length || (net && !online()) ? 'off' : 'on');
  o.textContent = !outs.length ? 'No output' : `${outs.length} universe${outs.length > 1 ? 's' : ''} out · ${fps} Hz${net && !online() ? ' · server offline' : ''}`;
  const v = app.views[app.tab]; if (v && v.live) v.live();
}, 500);
setInterval(() => { const v = app.views[app.tab]; if (v && v.fast) v.fast(); }, 66);

syncBar(); refresh(); connect();
