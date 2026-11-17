/* =====================================================================
 *  dmxserial.js — USB-DMX 인터페이스로 실제 DMX512 선을 수신
 *   proto 'enttec' : ENTTEC DMX USB Pro 호환(위젯 프로토콜, 0x7E … 0xE7, 라벨 5 = 수신 DMX)
 *   proto 'raw'    : USB-RS485 어댑터 직결(250kbps 8N2). 브레이크를 알 수 없어 프레임 사이 공백으로 구분(실험적)
 *                    → 브레이크 감지가 되는 브라우저 Web Serial 수신(웹 UI)이 더 정확하다.
 * ===================================================================== */
'use strict';
const { EventEmitter } = require('events');
let SerialPort = null;
try { ({ SerialPort } = require('serialport')); } catch (e) { /* 선택 의존성 */ }

class DmxSerial extends EventEmitter {
  constructor() { super(); this.port = null; this.path = ''; this.proto = 'enttec'; this.err = SerialPort ? '' : 'serialport module not installed'; this.buf = Buffer.alloc(0); this.gapT = null; }
  get open() { return !!(this.port && this.port.isOpen); }
  static async list() { if (!SerialPort) return []; try { return (await SerialPort.list()).map(p => ({ path: p.path, name: p.friendlyName || p.manufacturer || '' })); } catch (e) { return []; } }

  async close() {
    clearTimeout(this.gapT);
    const p = this.port; this.port = null;
    if (p && p.isOpen) await new Promise(r => p.close(() => r()));
  }
  async openPort(path, proto) {
    await this.close();
    if (!SerialPort) throw new Error(this.err);
    this.path = path; this.proto = proto === 'raw' ? 'raw' : 'enttec'; this.buf = Buffer.alloc(0); this.err = '';
    const opt = this.proto === 'raw' ? { path, baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none' } : { path, baudRate: 57600 };
    const p = new SerialPort({ ...opt, autoOpen: false });
    await new Promise((res, rej) => p.open(e => (e ? rej(e) : res())));
    this.port = p;
    p.on('error', e => { this.err = e.message; this.emit('log', 'USB-DMX error: ' + e.message); });
    p.on('close', () => { if (this.port === p) { this.port = null; this.emit('state'); } });
    p.on('data', d => (this.proto === 'raw' ? this.onRaw(d) : this.onEnttec(d)));
    if (this.proto === 'enttec') p.write(Buffer.from([0x7e, 8, 1, 0, 0, 0xe7]));   // 수신 모드: 변화와 무관하게 매 프레임 전달
    this.emit('log', `USB-DMX opened: ${path} (${this.proto})`); this.emit('state');
  }
  onEnttec(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const s = this.buf.indexOf(0x7e); if (s < 0) { this.buf = Buffer.alloc(0); return; }
      if (s > 0) this.buf = this.buf.subarray(s);
      if (this.buf.length < 5) return;
      const len = this.buf.readUInt16LE(2);
      if (len > 600) { this.buf = this.buf.subarray(1); continue; }
      if (this.buf.length < len + 5) return;
      if (this.buf[len + 4] === 0xe7) {
        const label = this.buf[1], data = this.buf.subarray(4, 4 + len);
        if (label === 5 && len >= 2 && !(data[0] & 0x03)) this.frame(data[1], data.subarray(2));   // [상태, 시작코드, 슬롯…]
        this.buf = this.buf.subarray(len + 5);
      } else this.buf = this.buf.subarray(1);
    }
  }
  onRaw(d) {
    this.buf = Buffer.concat([this.buf, d]);
    clearTimeout(this.gapT);
    const flush = () => { const b = this.buf; this.buf = Buffer.alloc(0); if (b.length >= 2) { const i = b[0] === 0 && b.length > 513 ? 1 : 0; this.frame(b[i], b.subarray(i + 1, i + 513)); } };
    if (this.buf.length >= 514) flush(); else this.gapT = setTimeout(flush, 4);
  }
  frame(startCode, slots) { this.emit('frame', startCode, slots); }
}

module.exports = { DmxSerial };
