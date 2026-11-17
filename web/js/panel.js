// panel.js — side panel: Status · DMX Input · Guide
import { CH, COLORS, FIX_GOBOS, ROT_GOBOS, N_COLOR, N_FIX, N_ROT, describe, MODES } from './personality.js';
import { SOURCES } from './dmx.js';
import { FACTORY_PASSWORD } from './menu.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = rgb => `rgb(${rgb.map(v => Math.round(Math.min(1, v) * 255)).join(',')})`;
const slotName = (names, pos, n) => { const i = Math.round(pos) % n, f = Math.abs(pos - Math.round(pos)); return f < 0.08 ? names[i] : `${names[Math.floor(pos) % n]} → ${names[Math.ceil(pos) % n]}`; };
const err = t => `<span style="color:var(--red)">${esc(t)}</span>`;

export class Panel {
  constructor(fx, dmx, rdm) {
    this.fx = fx; this.dmx = dmx; this.rdm = rdm; this.logLines = [];
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
    }));
    this.buildStatus(); this.buildDmx(); this.buildHelp();
    dmx.onStatus = () => this.refreshDmx();
    fx.on(ev => { if (ev === 'settings' || ev === 'signal') { this.buildChTable(); this.refreshDmx(); } });
  }
  log(line) {
    const t = new Date().toTimeString().slice(0, 8);
    this.logLines.push(`${t}  ${line}`); if (this.logLines.length > 200) this.logLines.shift();
    const el = $('#log'); if (el) { el.textContent = this.logLines.join('\n'); el.scrollTop = el.scrollHeight; }
  }

  /* ── Status ── */
  buildStatus() {
    $('#tab-status').innerHTML = `
      <h3>Fixture</h3><div class="kv" id="kvFix"></div>
      <h3>Mechanics · Optics (actual motor positions)</h3><div class="kv" id="kvOpt"></div>
      <h3>Channel values <span id="chSrc" class="note"></span></h3><table class="ch" id="chTable"></table>
      <div id="soundBox" hidden><h3>Sound mode</h3><div class="note">The built-in program advances one step on every beat picked up by the microphone. <button class="btn sm" id="btnBeat">♪ Beat (manual)</button> <span id="micState"></span></div></div>`;
    this.buildChTable();
  }
  buildChTable() {
    const chans = this.fx.mode.channels, a = this.fx.settings.address;
    $('#chTable').innerHTML = chans.map((k, i) => `<tr data-k="${k}"><td class="n">${a + i}</td><td>${CH[k].name}</td><td class="v"></td><td class="bar"><i></i></td><td class="d"></td></tr>`).join('');
  }
  updateStatus() {
    const fx = this.fx, S = fx.settings, o = fx.o, m = fx.mode;
    const src = { dmx: 'DMX signal', manual: 'Manual menu values — no DMX signal', host: 'Host — built-in program (master)', sound: 'Sound — built-in program' }[fx.chSource];
    $('#kvFix').innerHTML = `
      <span>Power</span><b>${fx.power ? (fx.resetting ? 'Resetting…' : 'ON') : 'OFF'}${fx.identify ? ' · RDM IDENTIFY' : ''}</b>
      <span>DMX address</span><b>${String(S.address).padStart(3, '0')} – ${String(S.address + m.channels.length - 1).padStart(3, '0')} · ${m.label} (${m.id})</b>
      <span>Run mode</span><b>${{ DMX: 'DMX', HOST: 'Host (master)', SOUND: 'Sound' }[S.runMode]}</b>
      <span>Value source</span><b>${fx.power ? src : '—'}</b>
      <span>DMX IN</span><b>${fx.dmxSignal ? `Receiving ${fx.dmxFps.toFixed(0)} Hz` : 'No signal'}</b>
      <span>LED temp.</span><b>${fx.tempC.toFixed(0)} ℃</b>
      <span>Operating time</span><b>${(fx.sessionSec / 60).toFixed(0)} min / total ${S.totalHours.toFixed(1)} H · ${S.powerCount} power-ups</b>`;
    $('#kvOpt').innerHTML = `
      <span>Pan / Tilt</span><b>${fx.pan.pos.toFixed(1)}° / ${fx.tilt.pos.toFixed(1)}°${S.panInvert ? ' · pan inverted' : ''}${S.tiltInvert ? ' · tilt inverted' : ''}</b>
      <span>Output</span><b>${(fx.intensity * 100).toFixed(0)}% (dimmer ${(o.dimmer * 100).toFixed(0)}% · shutter ${o.shutter > 0.5 ? 'open' : o.shutter > 0 ? 'pulse' : 'closed'})</b>
      <span>Colour wheel</span><b><i class="swatch" style="background:${css(fx.tint)}"></i>${slotName(COLORS.map(c => c.name), o.colorPos, N_COLOR)}</b>
      <span>Static gobo</span><b>${slotName(FIX_GOBOS, o.goboPos, N_FIX)}</b>
      <span>Rotating gobo</span><b>${slotName(ROT_GOBOS, o.rotPos, N_ROT)} · ${o.goboAngle.toFixed(0)}°</b>
      <span>Zoom</span><b>${fx.beamAngleDeg.toFixed(1)}° (6°–26°)</b>
      <span>Focus</span><b>${(o.focus * 100).toFixed(0)}% ${fx.defocus < 0.03 ? '· sharp' : '· soft'}</b>
      <span>Frost</span><b>${(o.frost * 100).toFixed(0)}%</b>
      <span>Prism</span><b>${o.prism > 0.5 ? `3-facet ON · ${o.prismAngle.toFixed(0)}°` : 'OFF'}</b>`;
    $('#chSrc').textContent = fx.power ? `— ${src}` : '';
    for (const tr of $('#chTable').rows) {
      const v = fx.ch[tr.dataset.k] | 0;
      if (tr._v === v) continue; tr._v = v;
      tr.cells[2].textContent = v; tr.cells[3].firstChild.style.width = (v / 2.55) + '%'; tr.cells[4].textContent = describe(tr.dataset.k, v);
    }
    $('#soundBox').hidden = S.runMode !== 'SOUND';
  }

  /* ── DMX input ── */
  buildDmx() {
    $('#tab-dmx').innerHTML = `
      <h3>Input connected to the DMX IN socket</h3>
      <div id="srcList"></div>
      <h3>RDM</h3><div class="kv" id="kvRdm"></div>
      <h3>Master / Slave</h3>
      <div class="note">With Run Mode set to <b>Host</b> (or Sound) this fixture sends its built-in program on <b>DMX OUT</b> (the virtual cable).
        Open the simulator in a second tab with DMX IN = virtual cable and address 001, and it follows as a slave.</div>
      <h3>Log</h3><div id="log"></div>`;
    const list = $('#srcList');
    list.addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'src') this.dmx.setSource(t.value);
      else if (t.id === 'uniArt') this.dmx.send({ type: 'cfg', artnet: { universe: +t.value | 0 } });
      else if (t.id === 'uniSacn') this.dmx.send({ type: 'cfg', sacn: { universe: +t.value | 0 } });
    });
    list.addEventListener('click', async e => {
      const id = e.target.id;
      if (id === 'serOpen') this.dmx.send({ type: 'serial', action: 'open', path: $('#serPort').value, proto: $('#serProto').value });
      else if (id === 'serClose') this.dmx.send({ type: 'serial', action: 'close' });
      else if (id === 'serScan') { this.ports = await (await fetch('api/ports')).json(); this._srcSig = ''; this.refreshDmx(); }
      else if (id === 'wsOpen') await this.dmx.openWebSerial();
      else if (id === 'wsClose') await this.dmx.closeWebSerial();
    });
    this.ports = []; this.refreshDmx();
  }
  refreshDmx() {
    const d = this.dmx, st = d.status && d.status.sources, srv = d.hasServer && d.online && !!st, W = d.serial;
    const sig = JSON.stringify([d.source, srv, st && [st.artnet.universe, st.artnet.error, st.artnet.seen, st.sacn.universe, st.sacn.error, st.sacn.seen, st.serial.open, st.serial.error, st.serial.path], this.ports, !!W.port, W.error]);
    const live = id => (id === d.source && this.fx.dmxSignal) || (st && st[id] && st[id].active);
    if (sig !== this._srcSig) {
      this._srcSig = sig;
      const more = {
        cable: 'Links to other tabs/windows of the same browser. Use [🎚 Add DMX Transmitter] in the top bar to try it right away.',
        artnet: st ? `Universe <input type="number" id="uniArt" min="0" max="32767" value="${st.artnet.universe}"> ${st.artnet.error ? err('Port error: ' + st.artnet.error) : 'Answers ArtPoll · RDM (ArtRdm) supported'}` : '',
        sacn: st ? `Universe <input type="number" id="uniSacn" min="1" max="63999" value="${st.sacn.universe}"> ${st.sacn.error ? err('Port error: ' + st.sacn.error) : 'Multicast 239.255.x.x · unicast'}` : '',
        serial: st ? `<select id="serPort">${[...new Set([st.serial.path, ...this.ports.map(p => p.path)].filter(Boolean))].map(p => `<option ${p === st.serial.path ? 'selected' : ''}>${esc(p)}</option>`).join('') || '<option value="">(no ports)</option>'}</select>
          <select id="serProto"><option value="enttec" ${st.serial.proto === 'enttec' ? 'selected' : ''}>ENTTEC Pro</option><option value="raw" ${st.serial.proto === 'raw' ? 'selected' : ''}>Raw RS485 (experimental)</option></select>
          <button class="btn sm" id="serScan">Scan</button>${st.serial.open ? '<button class="btn sm" id="serClose">Close</button>' : '<button class="btn sm acc" id="serOpen">Open</button>'}
          ${st.serial.error ? err(st.serial.error) : ''}` : '',
        webserial: d.webSerialOk ? `250 kbps 8N2 · break detection ${W.port ? '<button class="btn sm" id="wsClose">Disconnect</button>' : '<button class="btn sm acc" id="wsOpen">Choose port…</button>'} ${W.error ? err(W.error) : ''}` : 'Chrome or Edge only.',
      };
      $('#srcList').innerHTML = Object.entries(SOURCES).map(([id, s]) => {
        const dis = (s.server && !srv) || (id === 'webserial' && !W.port);
        return `<label class="src ${id === d.source ? 'sel' : ''} ${s.server && !srv ? 'dis' : ''}"><div class="row"><input type="radio" name="src" value="${id}" ${id === d.source ? 'checked' : ''} ${dis ? 'disabled' : ''}><b>${s.name}</b><span class="dot" data-dot="${id}"></span></div>
          ${s.server && !srv ? '<div class="more">Local server only (npm start).</div>' : more[id] ? `<div class="more">${more[id]}${st && st[id] && st[id].seen && st[id].seen.length ? ` · universes seen: ${st[id].seen.join(', ')}` : ''}</div>` : ''}</label>`;
      }).join('');
    }
    document.querySelectorAll('[data-dot]').forEach(el => el.classList.toggle('on', !!live(el.dataset.dot)));
    $('#kvRdm').innerHTML = `<span>UID</span><b>${this.rdm.uidText}</b><span>Device label</span><b>${esc(this.rdm.label)}</b><span>Last request</span><b>${esc(this.rdm.last || '—')}</b><span>Transport</span><b>${srv ? 'Art-Net (ArtRdm) · USB-RS485 direct (experimental)' : 'USB-RS485 direct (experimental)'}</b>`;
    const c = $('#conn');
    c.className = 'pill ' + (srv ? 'on' : d.hasServer ? 'off' : 'web');
    c.textContent = srv ? `Server connected${d.status.ip.length ? ' · ' + d.status.ip[0] : ''}` : d.hasServer ? 'Server lost — reconnecting' : '🌐 Web version';
    c.title = srv ? 'Art-Net, sACN and USB-DMX input available' : 'Static web version: only the virtual cable and Web Serial are available';
  }

  buildHelp() {
    $('#tab-help').innerHTML = `<div class="help">
      <h3>Operating the fixture (manual 4.1 · 4.3)</h3>
      <ul><li><b>MENU</b> open the menu / go back without saving · hold 1 s to leave the menu</li><li><b>▲ UP / ▼ DOWN</b> move between items · change a value (hold to go faster)</li>
      <li><b>ENTER</b> select → the value blinks → change it, then ENTER again to confirm</li><li>After one minute without a key press the display returns to the home screen.</li></ul>
      <p>The five buttons on the 3D fixture (cross layout): top = UP, bottom = DOWN, left = MENU, centre and right = ENTER. The red switch on the rear panel is the power switch.</p>
      <h3>Menu</h3>
      <ul><li><code>Dmx Address</code> 001–512</li><li><code>Fixture</code> Dmx Mode STD (17CH) / EXT (20CH) · Run Mode DMX / Host / Sound · Pan / Tilt Invert</li>
      <li><code>Manual</code> values used while there is no DMX signal (applied live)</li><li><code>Information</code> time · sensor · temperature · versions</li>
      <li><code>Display</code> language · display flip · display mode (60s = backlight off)</li><li><code>Factory</code> calibration offsets (password ${String(FACTORY_PASSWORD).padStart(3, '0')})</li><li><code>Reset</code> all reset · factory defaults</li></ul>
      <h3>Supported communication</h3>
      <ul><li>DMX512 — USB-DMX (ENTTEC Pro compatible) · USB-RS485 direct</li><li>RDM — address · personality · invert · identify · reset</li><li>Art-Net 4 · sACN (E1.31)</li><li>Master / slave (Host) · sound active</li>
      <li>KlingNet is a closed protocol and is not supported.</li></ul>
      <h3>Channel chart</h3>
      <p>${Object.values(MODES).map(m => `<b>${m.label}</b>: ${m.channels.map((k, i) => `${i + 1} ${CH[k].name}`).join(' · ')}`).join('</p><p>')}</p>
      <p id="manualLink" hidden><a class="btn sm" href="docs/WOP-LM1012B%20250W%20BSW%20LED%20Moving%20Head%20Light%20User%20Manual.pdf" target="_blank" rel="noopener">📄 User manual (PDF)</a></p>
    </div>`;
    // The manual PDF is not shipped with the repository — show the link only where the file exists
    const a = $('#manualLink a');
    fetch(a.href, { method: 'HEAD' }).then(r => { if (r.ok && (r.headers.get('content-type') || '').includes('pdf')) $('#manualLink').hidden = false; }).catch(() => {});
  }
}
