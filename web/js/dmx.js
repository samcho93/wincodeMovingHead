// dmx.js — 조명기의 "DMX IN 커넥터". 한 번에 한 입력만 연결한다(실제 XLR 한 개와 같음).
//   cable     가상 DMX 케이블(BroadcastChannel) — 슬라이더 송신기(console.html)·Host 모드의 다른 시뮬레이터 탭
//   artnet    Art-Net (서버 UDP 6454)            sacn   sACN/E1.31 (서버 UDP 5568)
//   serial    USB-DMX (서버 시리얼, ENTTEC Pro)   webserial  USB-RS485 직결(브라우저 Web Serial, 브레이크 감지)
export const SOURCES = {
  none:      { name: 'Not connected', server: false },
  cable:     { name: 'Virtual DMX cable (slider transmitter / master tab)', server: false },
  artnet:    { name: 'Art-Net (UDP 6454)', server: true },
  sacn:      { name: 'sACN / E1.31 (UDP 5568)', server: true },
  serial:    { name: 'USB-DMX — ENTTEC Pro compatible (server)', server: true },
  webserial: { name: 'USB-RS485 direct (browser Web Serial)', server: false },
};
const SRC_ID = ['artnet', 'sacn', 'serial'];
export const CABLE = 'wmh-dmx';                       // BroadcastChannel 이름(송신기와 공유)

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
  /** Host(마스터) 모드: DMX OUT 을 가상 케이블로 내보낸다 → 다른 탭(슬레이브)이 받는다 */
  sendOut(data) { this.bc.postMessage({ t: 'dmx', from: this.tabId, data }); }

  /* ── 서버(WebSocket) ── */
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

  /* ── Web Serial: USB-RS485 어댑터로 DMX 선을 직접 수신 ──
   *  DMX 프레임의 시작(브레이크)은 수신 측에서 BreakError/FramingError 로 나타난다 → 그 지점을 프레임 경계로 쓴다. */
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
          if (now - lastT > 8 && buf.length >= 25) flush();              // 브레이크를 알려 주지 않는 어댑터 대비: 공백으로도 구분
          lastT = now;
          for (const b of value) buf.push(b);
          if (buf.length >= 513) flush();
        }
      } catch (e) {
        if (e.name === 'BreakError' || e.name === 'FramingError') flush();   // 프레임 경계
        else if (e.name !== 'BufferOverrunError' && e.name !== 'ParityError') { S.error = e.message; S.reading = false; }
      } finally { try { reader.releaseLock(); } catch (e) {} }
    }
    this.onStatus();
  }
  /** RDM 요청에 같은 선으로 응답(어댑터가 자동 방향 전환일 때만 통한다 — 타이밍 보장 없음) */
  async serialRdm(port, pkt) {
    const r = this.rdm.handle(pkt); this.log(`RDM (direct) ${this.rdm.last}`);
    if (!r || !port.writable) return;
    const out = r.disc ? r.disc : Uint8Array.from([0xcc, ...r]);
    try { const w = port.writable.getWriter(); if (!r.disc) { await port.setSignals({ break: true }); await port.setSignals({ break: false }); } await w.write(out); w.releaseLock(); } catch (e) {}
  }
}
