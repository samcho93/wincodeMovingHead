// dmx.js — the fixture's "DMX IN connector". Only one input is connected at a time (like a single real XLR).
//   cable     virtual DMX cable (BroadcastChannel) — slider transmitter (console.html) and other simulator tabs in Host mode
//   artnet    Art-Net (server, UDP 6454)            sacn   sACN/E1.31 (server, UDP 5568)
//   serial    USB-DMX (server serial, ENTTEC Pro)   webserial  USB-RS485 direct (browser Web Serial, break detection)
export const SOURCES = {
  none:      { name: 'Not connected', server: false },
  cable:     { name: 'Virtual DMX cable (slider transmitter / master tab)', server: false },
  artnet:    { name: 'Art-Net (UDP 6454)', server: true },
  sacn:      { name: 'sACN / E1.31 (UDP 5568)', server: true },
  serial:    { name: 'USB-DMX — ENTTEC Pro compatible (server)', server: true },
  webserial: { name: 'USB-RS485 direct (browser Web Serial)', server: false },
};
const SRC_ID = ['artnet', 'sacn', 'serial'];
export const CABLE = 'wmh-dmx';                       // BroadcastChannel name (shared with the transmitter)

export class DmxInput {
  constructor(fx, rdm, log) {
    this.fx = fx; this.rdm = rdm; this.log = log;
    this.source = 'cable'; try { this.source = localStorage.getItem('wmh.source') || 'cable'; } catch (e) {}
    if (!SOURCES[this.source] || this.source === 'webserial') this.source = 'cable';
    this.hasServer = false; this.ws = null; this.status = null; this.onStatus = () => {}; this.tabId = Math.random().toString(36).slice(2);
    this.serial = { port: null, reading: false, frames: 0, error: '' };
    this.bc = new BroadcastChannel(CABLE);
    this.bc.onmessage = e => { const m = e.data; if (m && m.t === 'dmx' && m.from !== this.tabId && this.source === 'cable') this.frame(m.data); };
  }
  frame(data) { this.fx.feedDmx(data instanceof Uint8Array ? data : new Uint8Array(data)); }
  setSource(id) {
    if (!SOURCES[id]) return;
    this.source = id; try { localStorage.setItem('wmh.source', id); } catch (e) {}
    this.fx.lastDmx = -1e9; this.log(`DMX IN → ${SOURCES[id].name}`); this.onStatus();
  }
  /** Host (master) mode: send DMX OUT over the virtual cable → other tabs (slaves) receive it */
  sendOut(data) { this.bc.postMessage({ t: 'dmx', from: this.tabId, data }); }

  /* ── server (WebSocket) ── */
  async connect() {
    if (window.WMH_STATIC) return false;
    try { const r = await fetch('api/status', { cache: 'no-store' }); const j = await r.json(); if (j.app !== 'wincode-movinghead-sim') return false; } catch (e) { return false; }
    this.hasServer = true; this.open(); return true;
  }
  open() {
    const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.sendFixture(); this.onStatus(); };
    ws.onclose = () => { this.status = null; this.onStatus(); setTimeout(() => this.open(), 1500); };
    ws.onmessage = e => {
      if (typeof e.data !== 'string') {
        const b = new Uint8Array(e.data);
        if (b[0] === 1 && SRC_ID[b[1]] === this.source) this.frame(b.subarray(2, 514));
        return;
      }
      const m = JSON.parse(e.data);
      if (m.type === 'status') { this.status = m; this.onStatus(); }
      else if (m.type === 'log') this.log(m.line);
      else if (m.type === 'error') this.log('⚠ ' + m.message);
      else if (m.type === 'rdm') {
        const r = this.rdm.handle(new Uint8Array(m.data));
        if (r && !r.disc) this.send({ type: 'rdmReply', id: m.id, data: [...r] });
        this.log(`RDM ${this.rdm.last}`); this.onStatus();
      }
    };
  }
  get online() { return !!(this.ws && this.ws.readyState === 1); }
  send(obj) { if (this.online) this.ws.send(JSON.stringify(obj)); }
  sendFixture() { this.send({ type: 'fixture', uid: this.rdm.uid, address: this.fx.settings.address, label: this.rdm.label }); }

  /* ── Web Serial: receive the DMX line directly through a USB-RS485 adapter ──
   *  The start of a DMX frame (the break) shows up on the receiver as BreakError/FramingError → used as the frame boundary. */
  get webSerialOk() { return 'serial' in navigator; }
  async openWebSerial() {
    const S = this.serial;
    if (!this.webSerialOk) { S.error = 'This browser does not support Web Serial (Chrome or Edge required)'; this.onStatus(); return; }
    await this.closeWebSerial();
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', bufferSize: 2048, flowControl: 'none' });
      S.port = port; S.error = ''; S.reading = true; S.frames = 0;
      this.setSource('webserial'); this.readLoop(port);
    } catch (e) { S.error = e.message; this.onStatus(); }
  }
  async closeWebSerial() {
    const S = this.serial, port = S.port; S.reading = false; S.port = null;
    if (!port) return;
    try { if (S.reader) await S.reader.cancel(); } catch (e) {}
    try { await port.close(); } catch (e) {}
    if (this.source === 'webserial') this.setSource('none');
  }
  async readLoop(port) {
    const S = this.serial; let buf = [], lastT = 0;
    const flush = () => {
      if (buf.length > 1) {
        if (buf[0] === 0x00) { S.frames++; this.source === 'webserial' && this.frame(Uint8Array.from(buf.slice(1, 513))); }
        else if (buf[0] === 0xcc) this.serialRdm(port, Uint8Array.from(buf.slice(1)));
      }
      buf = [];
    };
    while (S.reading && port.readable) {
      const reader = S.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          const now = performance.now();
          if (now - lastT > 8 && buf.length >= 25) flush();              // for adapters that do not report breaks: also split on idle gaps
          lastT = now;
          for (const b of value) buf.push(b);
          if (buf.length >= 513) flush();
        }
      } catch (e) {
        if (e.name === 'BreakError' || e.name === 'FramingError') flush();   // frame boundary
        else if (e.name !== 'BufferOverrunError' && e.name !== 'ParityError') { S.error = e.message; S.reading = false; }
      } finally { try { reader.releaseLock(); } catch (e) {} }
    }
    this.onStatus();
  }
  /** Answer an RDM request on the same line (only works with auto-direction adapters — no timing guarantee) */
  async serialRdm(port, pkt) {
    const r = this.rdm.handle(pkt); this.log(`RDM (direct) ${this.rdm.last}`);
    if (!r || !port.writable) return;
    const out = r.disc ? r.disc : Uint8Array.from([0xcc, ...r]);
    try { const w = port.writable.getWriter(); if (!r.disc) { await port.setSignals({ break: true }); await port.setSignals({ break: false }); } await w.write(out); w.releaseLock(); } catch (e) {}
  }
}
