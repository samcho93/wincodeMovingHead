// panel.js — side panel: Status · DMX Input · Guide. Everything shown follows the selected model definition.
import { SOURCES } from './dmx.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = rgb => `rgb(${rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;
const slotName = (names, pos, n) => { const i = Math.round(pos) % n, f = Math.abs(pos - Math.round(pos)); return f < 0.08 ? names[i] : `${names[Math.floor(pos) % n]} → ${names[Math.ceil(pos) % n]}`; };
const err = t => `<span style="color:var(--red)">${esc(t)}</span>`;
const pc = v => (v * 100).toFixed(0) + '%';
const SRC_TEXT = {
  dmx: 'DMX signal', manual: 'Manual menu values — no DMX signal', hold: 'Last DMX frame (Data hold ON) — no DMX signal', home: 'Post-reset state — no DMX signal (Data hold OFF)',
  local: 'Status-panel sliders (override)', demo: 'Demo sequence',
  auto: 'Built-in program (auto run)', sound: 'Built-in program (sound)', scene: 'Scene mode', edit: 'Scene being edited on the panel',
};
const RUN_TEXT = { DMX: 'DMX', AUTO: 'Auto / Host', SOUND: 'Sound', SCENE: 'Scene' };

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
      <h3>Channel values <span id="chSrc" class="note"></span></h3>
      <div class="note" id="ovrBox">Drag a slider to set a channel directly. <span id="ovrOn" hidden><b style="color:var(--acc)">Override active</b> — DMX and the run mode are ignored. <button class="btn sm acc" id="btnRelease">Release</button></span></div>
      <table class="ch" id="chTable"></table>
      <div id="soundBox" hidden><h3>Sound mode</h3><div class="note">The built-in program advances one step on every beat picked up by the microphone. <button class="btn sm" id="btnBeat">♪ Beat (manual)</button> <span id="micState"></span></div></div>`;
    this.buildChTable();
    // sliders: take direct control of the channel values (a running demo hands over to the sliders)
    $('#chTable').addEventListener('input', e => {
      const k = e.target.dataset.k, fx = this.fx; if (!k) return;
      fx.demo = false; fx.override('local')[k] = +e.target.value;
    });
    $('#btnRelease').addEventListener('click', () => this.fx.release());
  }
  buildChTable() {
    const chans = this.fx.mode.channels, a = this.fx.settings.address, CH = this.fx.model.ch;
    $('#chTable').innerHTML = chans.map((k, i) => `<tr data-k="${k}"><td class="n">${a + i}</td><td>${CH[k]}</td><td class="v"></td><td class="bar"><input type="range" min="0" max="255" value="0" data-k="${k}" title="${CH[k]}"></td><td class="d"></td></tr>`).join('');
  }
  updateStatus() {
    const fx = this.fx, S = fx.settings, o = fx.o, m = fx.mode, M = fx.model, F = M.features, src = SRC_TEXT[fx.chSource];
    $('#kvFix').innerHTML = `
      <span>Model</span><b>${M.code} · ${M.title}</b>
      <span>Power</span><b>${fx.power ? (fx.resetting ? 'Resetting…' : 'ON') : 'OFF'}${F.lamp && fx.power ? ` · lamp ${fx.lampOn ? 'ON' : 'OFF'}` : ''}${fx.identify ? ' · RDM IDENTIFY' : ''}</b>
      <span>DMX address</span><b>${String(S.address).padStart(3, '0')} – ${String(S.address + m.channels.length - 1).padStart(3, '0')} · ${m.label}${m.id !== m.label ? ` (${m.id})` : ''}</b>
      <span>Run mode</span><b>${RUN_TEXT[S.runMode]}${F.ms ? ` · M/S ${S.msMode}` : ''}${S.runMode === 'SCENE' ? ` · scene ${S.sceneSel}` : ''}</b>
      <span>Value source</span><b>${fx.power ? src : '—'}</b>
      <span>DMX IN</span><b>${fx.dmxSignal ? `Receiving ${fx.dmxFps.toFixed(0)} Hz` : 'No signal'}${fx.dmxOut ? ' · DMX OUT (master)' : ''}</b>
      <span>LED temp.</span><b>${fx.tempC.toFixed(0)} ℃</b>
      <span>Operating time</span><b>${(fx.sessionSec / 60).toFixed(0)} min / total ${S.totalHours.toFixed(1)} H · ${S.powerCount} power-ups</b>`;
    const rows = [
      ['Pan / Tilt', `${fx.pan.pos.toFixed(1)}° / ${fx.tilt.pos.toFixed(1)}°${S.panInvert ? ' · pan inverted' : ''}${S.tiltInvert ? ' · tilt inverted' : ''}`],
      ['Output', `${pc(fx.intensity)} (dimmer ${pc(o.dimmer)} · shutter ${o.shutter > 0.5 ? 'open' : o.shutter > 0 ? 'pulse' : 'closed'})`],
      ['Beam colour', `<i class="swatch" style="background:${css(fx.tint)}"></i>wheel: ${slotName(M.colors.map(c => c.name), o.colorPos, M.colors.length)}`],
    ];
    if (F.cmy) rows.push(['CMY', `C ${pc(o.cmy[0])} · M ${pc(o.cmy[1])} · Y ${pc(o.cmy[2])}${F.cto ? ` · CTO ${pc(o.cto)}` : ''}`]);
    if (F.gobos) rows.push(['Static gobo', slotName(M.gobos.fix, o.goboPos, M.gobos.fix.length)], ['Rotating gobo', `${slotName(M.gobos.rot, o.rotPos, M.gobos.rot.length)} · ${o.goboAngle.toFixed(0)}°`]);
    if (F.blades) rows.push(['Framing blades', `${[0, 1, 2, 3].map(k => 'TRBL'[k] + ' ' + pc((o.blades[2 * k] + o.blades[2 * k + 1]) / 2)).join(' · ')} · rot ${(o.bladeRot * 45).toFixed(0)}°`]);
    rows.push(['Zoom', `${fx.beamAngleDeg.toFixed(1)}° (${M.spec.zoomMin}°–${M.spec.zoomMax}°)`], ...(M.spec.focus ? [['Focus', `${pc(o.focus)} ${fx.defocus < 0.03 ? '· sharp' : '· soft'}`]] : []), ['Frost', pc(o.frost)]);
    if (F.prism) rows.push(['Prism', o.prism > 0.5 ? `3-facet ON · ${o.prismAngle.toFixed(0)}°` : 'OFF']);
    if (fx.heads.length > 1) {                                    // multi-head fixture: one line per head
      rows.length = 0;
      fx.heads.forEach((h, i) => rows.push([`Head ${i + 1}`, `<i class="swatch" style="background:${css(h.tint.map(v => v * Math.min(1, h.intensity * 4)))}"></i>${h.pan.pos.toFixed(0)}° / ${h.tilt.pos.toFixed(0)}° · zoom ${h.beamAngleDeg.toFixed(0)}° · ${pc(h.intensity)}`]));
      if (F.ring) rows.push(['Pixel rings', fx.heads.map(h => h.o.ring.map(c => `<i class="swatch" style="background:${css(c)};width:5px;margin:0;border:0;border-radius:0"></i>`).join('')).join(' ')]);
    }
    $('#kvOpt').innerHTML = rows.map(r => `<span>${r[0]}</span><b>${r[1]}</b>`).join('');
    $('#chSrc').textContent = fx.power ? `— ${src}` : '';
    for (const tr of $('#chTable').rows) {
      const v = fx.ch[tr.dataset.k] | 0;
      if (tr._v === v) continue; tr._v = v;
      const sl = tr.cells[3].firstChild; if (document.activeElement !== sl) sl.value = v;
      tr.cells[2].textContent = v; tr.cells[4].textContent = M.describe(tr.dataset.k, v);
    }
    $('#ovrOn').hidden = !fx.local;
    $('#soundBox').hidden = S.runMode !== 'SOUND';
  }

  /* ── DMX input ── */
  buildDmx() {
    const F = this.fx.model.features;
    $('#tab-dmx').innerHTML = `
      <h3>Input connected to the DMX IN socket</h3>
      <div id="srcList"></div>
      <h3>RDM</h3><div class="kv" id="kvRdm"></div>
      <h3>Master / Slave</h3>
      <div class="note">${F.ms
        ? 'Outside DMX mode this fixture runs stand-alone (Auto Run, Sound Ctrl or Scene Mode). With <b>M/S Choose = Master</b> and no DMX signal it sends its values on <b>DMX OUT</b> (the virtual cable).'
        : 'With Run Mode set to <b>Host</b> (or Sound) this fixture sends its built-in program on <b>DMX OUT</b> (the virtual cable).'}
        Open the simulator in a second tab with the same model, DMX IN = virtual cable and address 001, and it follows as a slave.</div>
      <h3>Log</h3><div id="log"></div>`;
    const list = $('#srcList');
    list.addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'src') this.dmx.setSource(t.value);
      else if (t.id === 'uniArt') this.dmx.send({ type: 'cfg', artnet: { universe: +t.value | 0 } });
      else if (t.id === 'uniSacn') this.dmx.send({ type: 'cfg', sacn: { universe: +t.value | 0 } });
      else if (t.id === 'uniCable') this.dmx.setCableUniverse(+t.value);
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
    const sig = JSON.stringify([d.source, d.cableU, srv, st && [st.artnet.universe, st.artnet.error, st.artnet.seen, st.sacn.universe, st.sacn.error, st.sacn.seen, st.serial.open, st.serial.error, st.serial.path], this.ports, !!W.port, W.error]);
    const live = id => (id === d.source && this.fx.dmxSignal) || (st && st[id] && st[id].active);
    if (sig !== this._srcSig) {
      this._srcSig = sig;
      const more = {
        cable: `Cable universe <input type="number" id="uniCable" min="0" max="32767" value="${d.cableU}"> Links to other tabs/windows of the same browser: the slider transmitter (universe 0) and the DMX Editor (the output universe set in its Inputs / Outputs tab).`,
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

  /* ── Guide: operation of the selected model's panel, its channels and the assumptions made for it ── */
  buildHelp() {
    const M = this.fx.model, P = M.panel;
    const operate = P.type === 'touch' ? `
      <h3>Operating the fixture — touch LCD + encoder</h3>
      <ul><li><b>Touch</b>: tap the LCD (on the 3D fixture or the enlarged LCD below). ON/OFF and list items change at once; numbers open a dialog (slider, ▲▼, <i>apply</i>, ⏎ = save).</li>
      <li><b>Encoder</b>: turn to move / change a value, press to select / save. On the 3D fixture: mouse wheel over the knob = turn, click = press.</li>
      <li><b>BACK</b> (Esc) leaves a dialog or page.</li></ul>
      <h3>Pages</h3>
      <ul><li><code>Address</code> DMX address · channel mode · Previous / Next (± one fixture) · fixture reset</li>
      <li><code>WorkMode</code> DMX Ctrl / Auto Run / Sound Ctrl / Scene Mode (01–10, Auto) · M/S Choose · Lamp Switch</li>
      <li><code>Display</code> language · screen saver · screen rotation (AUTO follows the mounting) · DMX indicator · brightness · touch enable</li>
      <li><code>Scene</code> edit 10 scenes channel by channel (applied live; DMX is ignored while this page is open)</li>
      <li><code>Advanced</code> pan/tilt invert · offsets · Data hold · lamp mode · factory setting</li>
      <li><code>Status</code> versions · temperatures · positions · operating time</li></ul>` : `
      <h3>Operating the fixture — LCD + buttons</h3>
      <ul><li><b>MENU</b> open the menu / go back without saving · hold 1 s to leave the menu</li><li><b>▲ UP / ▼ DOWN</b> move between items · change a value (hold to go faster)</li>
      <li><b>ENTER</b> select → the value blinks → change it, then ENTER again to confirm</li><li>After one minute without a key press the display returns to the home screen.</li></ul>
      <p>The five buttons on the 3D fixture (cross layout): top = UP, bottom = DOWN, left = MENU, centre and right = ENTER.</p>
      <h3>Menu</h3>
      <ul><li><code>Dmx Address</code> 001–512</li><li><code>Fixture</code> Dmx Mode · Run Mode DMX / Host / Sound · Pan / Tilt Invert</li>
      <li><code>Manual</code> values used while there is no DMX signal (applied live)</li><li><code>Information</code> time · sensor · temperature · versions</li>
      <li><code>Display</code> language · display flip · display mode (60s = backlight off)</li><li><code>Factory</code> calibration offsets (password ${String(P.password).padStart(3, '0')})</li><li><code>Reset</code> all reset · factory defaults</li></ul>`;
    $('#tab-help').innerHTML = `<div class="help">
      <p><b>${M.code}</b> — ${M.title}. Change the model with the selector at the top left.</p>
      ${operate}
      <p>The red switch on the rear panel is the power switch.</p>
      <h3>Supported communication</h3>
      <ul><li>DMX512 — USB-DMX (ENTTEC Pro compatible) · USB-RS485 direct</li><li>RDM — address · personality · invert · identify · reset</li><li>Art-Net 4 · sACN (E1.31)</li><li>Master / slave · sound active</li></ul>
      <h3>Channel chart</h3>
      <p>${Object.values(M.modes).map(m => `<b>${m.label}</b>: ${m.channels.map((k, i) => `${i + 1} ${M.ch[k]}`).join(' · ')}`).join('</p><p>')}</p>
      <h3>Assumptions (not stated in the manual)</h3>
      <ul>${M.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    </div>`;
  }
}
