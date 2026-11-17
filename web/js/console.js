// console.js — slider-type DMX512 test transmitter (a device separate from the fixture)
//  Sends the 512-slot universe periodically (40 Hz by default).
//   Virtual DMX cable : BroadcastChannel → simulator tabs of the same browser (DMX IN = virtual cable)
//   Art-Net · sACN    : the local server sends real UDP packets → reaches the simulator and real devices alike
import { LIST, MODELS, currentModelId } from './models/index.js';
import { CABLE } from './dmx.js';

const $ = s => document.querySelector(s);
const LS = 'wmh.tx.v1';
const uni = new Uint8Array(512);
const st = { out: 'cable', uni: 0, host: '127.0.0.1', rate: 40, addr: 1, model: currentModelId(), mode: '', view: 'fx', run: true };
try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j) { Object.assign(st, j.st); uni.set(j.data.slice(0, 512)); } } catch (e) {}
// fixture profile = which model's channel names and meanings label the faders (embedded in the simulator: always its model)
if (!MODELS[st.model] || new URLSearchParams(location.search).has('embed')) st.model = currentModelId();
const model = () => MODELS[st.model];
if (!model().modes[st.mode]) st.mode = model().defaultMode;
const save = () => { try { localStorage.setItem(LS, JSON.stringify({ st, data: [...uni] })); } catch (e) {} };

/* ── Output ── */
const bc = new BroadcastChannel(CABLE), tabId = 'tx-' + Math.random().toString(36).slice(2);
let ws = null, hasServer = false;
async function connect() {
  if (window.WMH_STATIC) return;
  try { const j = await (await fetch('api/status', { cache: 'no-store' })).json(); if (j.app !== 'wincode-movinghead-sim') return; } catch (e) { return; }
  hasServer = true;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'txcfg', host: st.host }));
    ws.onclose = () => setTimeout(open, 1500);
  };
  open();
}
const online = () => ws && ws.readyState === 1;
function transmit() {
  if (!st.run) return;
  if (st.out === 'cable') { bc.postMessage({ t: 'dmx', from: tabId, data: uni.slice() }); return; }
  if (!online()) return;
  const b = new Uint8Array(516); b[0] = 2; b[1] = st.out === 'sacn' ? 1 : 0; b[2] = st.uni & 0xff; b[3] = st.uni >> 8; b.set(uni, 4);
  ws.send(b);
}
let timer = null;
const restart = () => { clearInterval(timer); timer = setInterval(transmit, 1000 / st.rate); };

/* ── UI ── */
const chans = () => model().modes[st.mode].channels;
function buildFaders() {
  $('#faders').innerHTML = chans().map((k, i) => {
    const a = st.addr + i, out = a > 512;
    return `<div class="fd ${out ? 'out' : ''}" data-i="${i}"><div class="no">CH ${i + 1} · ${out ? '—' : a}</div><div class="nm">${model().ch[k]}</div>
      <input type="range" min="0" max="255" ${out ? 'disabled' : ''}><input type="number" min="0" max="255" ${out ? 'disabled' : ''}><div class="ds"></div></div>`;
  }).join('');
  $('#fxNote').textContent = `Uses slots ${st.addr}–${Math.min(512, st.addr + chans().length - 1)} · match the fixture's Dmx Address / Dmx Mode`;
  syncFaders();
}
function syncFaders() {
  document.querySelectorAll('.fd').forEach(fd => {
    const i = +fd.dataset.i, a = st.addr - 1 + i; if (a > 511) return;
    const v = uni[a], [r, n] = fd.querySelectorAll('input');
    if (document.activeElement !== r) r.value = v;
    if (document.activeElement !== n) n.value = v;
    fd.querySelector('.ds').textContent = model().describe(chans()[i], v);
  });
}
function buildGrid() {
  const lo = st.addr, hi = st.addr + chans().length - 1;
  $('#grid').innerHTML = Array.from(uni, (v, i) => `<div class="c ${i + 1 >= lo && i + 1 <= hi ? 'fx' : ''}" title="Slot ${i + 1}"><i style="width:${v / 2.55}%"></i>${i + 1}<input type="number" min="0" max="255" data-a="${i}" value="${v}"></div>`).join('');
}
function syncGrid() {
  document.querySelectorAll('#grid .c').forEach((c, i) => { const inp = c.lastChild; if (document.activeElement !== inp) inp.value = uni[i]; c.firstChild.style.width = (uni[i] / 2.55) + '%'; });
}
const sync = () => (st.view === 'fx' ? syncFaders() : syncGrid());
function applyView() {
  $('#faders').hidden = st.view !== 'fx'; $('#grid').hidden = st.view !== 'all';
  if (st.view === 'fx') buildFaders(); else buildGrid();
  $('#lblUni').hidden = $('#lblHost').hidden = st.out === 'cable';
}
const setCh = (key, v) => { const i = chans().indexOf(key); if (i >= 0 && st.addr - 1 + i < 512) uni[st.addr - 1 + i] = v; };
const clampV = v => Math.min(255, Math.max(0, +v | 0));
let demo = false, demoT = 0;

$('#faders').addEventListener('input', e => { const fd = e.target.closest('.fd'); if (!fd) return; uni[st.addr - 1 + +fd.dataset.i] = clampV(e.target.value); demo = false; syncFaders(); save(); });
$('#faders').addEventListener('wheel', e => {
  const fd = e.target.closest('.fd'); if (!fd) return; e.preventDefault();
  const a = st.addr - 1 + +fd.dataset.i; if (a > 511) return;
  uni[a] = clampV(uni[a] + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1)); demo = false; syncFaders(); save();
}, { passive: false });
$('#grid').addEventListener('input', e => { const a = e.target.dataset.a; if (a == null) return; uni[+a] = clampV(e.target.value); demo = false; syncGrid(); save(); });
const bind = (id, key, num, after) => {
  const el = $(id);
  if (el.type === 'checkbox') el.checked = st[key]; else el.value = st[key];
  el.addEventListener('change', () => { st[key] = el.type === 'checkbox' ? el.checked : num ? (+el.value | 0) : el.value; save(); if (after) after(); });
};
bind('#out', 'out', false, applyView); bind('#uni', 'uni', true); bind('#rate', 'rate', true, restart); bind('#run', 'run');
bind('#host', 'host', false, () => online() && ws.send(JSON.stringify({ type: 'txcfg', host: st.host })));
bind('#addr', 'addr', true, () => { st.addr = Math.min(512, Math.max(1, st.addr)); applyView(); });
const fillModes = () => { $('#mode').innerHTML = Object.values(model().modes).map(m => `<option value="${m.id}">${m.id === m.label ? m.label : m.id + ' · ' + m.label}</option>`).join(''); $('#mode').value = st.mode; };
$('#model').innerHTML = LIST.map(m => `<option value="${m.id}">${m.name} · ${m.code}</option>`).join('');
fillModes();
bind('#model', 'model', false, () => { st.mode = model().defaultMode; fillModes(); save(); applyView(); });
bind('#mode', 'mode', false, applyView); bind('#view', 'view', false, applyView);
$('#pOpen').onclick = () => { setCh('strobe', 255); setCh('dimmer', 255); sync(); save(); };
$('#pBlack').onclick = () => { setCh('dimmer', 0); setCh('dimmerFine', 0); sync(); save(); };
$('#pCenter').onclick = () => { setCh('pan', 128); setCh('panFine', 0); setCh('tilt', 128); setCh('tiltFine', 0); sync(); save(); };
$('#pZero').onclick = () => { uni.fill(0); demo = false; sync(); save(); };
$('#pDemo').onclick = () => { demo = !demo; demoT = 0; };

setInterval(() => {
  $('#pDemo').classList.toggle('acc', demo);
  if (demo) {                                                    // demo: pan/tilt sweep + colour, gobo and zoom cycling
    demoT += 0.05; const t = demoT, step = Math.floor(t / 4);
    setCh('strobe', 255); setCh('dimmer', 255);
    setCh('pan', Math.round(128 + 40 * Math.sin(t * 0.5))); setCh('tilt', Math.round(72 + 22 * Math.sin(t * 0.37)));
    setCh('color', (step % 8) * 20); setCh('rotGobo', step % 2 ? ((step >> 1) % 6 + 1) * 10 : 0); setCh('gobo', step % 4 === 2 ? ((step >> 2) % 5 + 1) * 10 : 0);
    setCh('goboRot', 100); setCh('zoom', Math.round(127 + 127 * Math.sin(t * 0.2))); setCh('focus', 96);
    setCh('prism', step % 3 === 2 ? 200 : 0); setCh('prismRot', 220);
    // CMY / framing fixtures (channels that a model does not have are simply skipped)
    setCh('cyan', Math.round(127 + 127 * Math.sin(t * 0.31))); setCh('magenta', Math.round(127 + 127 * Math.sin(t * 0.23 + 2))); setCh('yellow', Math.round(127 + 127 * Math.sin(t * 0.17 + 4)));
    const cut = Math.round(60 + 60 * Math.sin(t * 0.4)); for (let i = 1; i <= 8; i++) setCh('cut' + i, step % 2 ? cut + (i % 2 ? 25 : -25) : 0);
    setCh('cutRot', Math.round(128 + 100 * Math.sin(t * 0.25)));
    sync();
  }
  const ok = st.run && (st.out === 'cable' || online()), s = $('#txState');
  s.className = 'pill ' + (ok ? 'on' : 'off');
  s.textContent = !st.run ? 'Stopped' : st.out === 'cable' ? `Sending · virtual cable · ${st.rate}Hz`
    : online() ? `Sending · ${st.out === 'sacn' ? 'sACN' : 'Art-Net'} U${st.uni} → ${st.host}` : hasServer ? 'Connecting to server…' : 'Local server required (npm start)';
}, 50);

applyView(); restart(); connect();
