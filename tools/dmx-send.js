#!/usr/bin/env node
/* =====================================================================
 *  dmx-send.js — command-line DMX send / test tool (no dependencies)
 *   node tools/dmx-send.js artnet 7=255 6=255 9=40          # slot=value …
 *   node tools/dmx-send.js sacn --universe 1 --host multicast 1=128 3=70 7=255 6=255
 *   options: --universe N (default artnet 0 / sacn 1) --host IP (default 127.0.0.1) --secs S (default 5) --rate Hz (default 40)
 *         --poll   Art-Net: send ArtPoll and print the ArtPollReply
 *         --rdm    Art-Net: request the device list (ArtTodRequest), then GET DEVICE_INFO and DMX_START_ADDRESS
 *         --rdm-addr N   SET the DMX start address to N over RDM
 * ===================================================================== */
'use strict';
const dgram = require('dgram');
const args = process.argv.slice(2);
const proto = args[0] === 'sacn' ? 'sacn' : 'artnet';
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const flag = n => args.includes('--' + n);
const universe = +opt('universe', proto === 'sacn' ? 1 : 0), host = opt('host', '127.0.0.1'), secs = +opt('secs', 5), rate = +opt('rate', 40);
const data = Buffer.alloc(512);
for (const a of args) { const m = /^(\d+)=(\d+)$/.exec(a); if (m && +m[1] >= 1 && +m[1] <= 512) data[+m[1] - 1] = Math.min(255, +m[2]); }

const ART = Buffer.from('Art-Net\0', 'latin1');
const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
let seq = 0;
function artDmx() { const b = Buffer.alloc(530); ART.copy(b); b.writeUInt16LE(0x5000, 8); b[11] = 14; b[12] = seq = (seq % 255) + 1; b[14] = universe & 0xff; b[15] = universe >> 8; b.writeUInt16BE(512, 16); data.copy(b, 18); return b; }
function sacn() {
  const b = Buffer.alloc(638); b.writeUInt16BE(0x10, 0); Buffer.from('ASC-E1.17\0\0\0', 'latin1').copy(b, 4); b.writeUInt16BE(0x7000 | 622, 16); b.writeUInt32BE(4, 18);
  Buffer.from('776d682d646d782d73656e642d303031', 'hex').copy(b, 22); b.writeUInt16BE(0x7000 | 600, 38); b.writeUInt32BE(2, 40); b.write('dmx-send', 44);
  b[108] = 100; b[111] = seq = (seq + 1) & 255; b.writeUInt16BE(universe, 113); b.writeUInt16BE(0x7000 | 523, 115); b[117] = 2; b[118] = 0xa1; b.writeUInt16BE(1, 121); b.writeUInt16BE(513, 123);
  data.copy(b, 126); return b;
}
const hex = b => [...b].map(v => v.toString(16).padStart(2, '0')).join('');
const MY_UID = [0x7f, 0xf0, 0, 0, 0, 1];
let tn = 0;
function rdmPacket(dest, cc, pid, pd = []) {
  const b = [0x01, 24 + pd.length, ...dest, ...MY_UID, tn = (tn + 1) & 255, 1, 0, 0, 0, cc, pid >> 8, pid & 255, pd.length, ...pd];
  let s = 0xcc; for (const v of b) s += v; b.push((s >> 8) & 255, s & 255);
  const p = Buffer.alloc(24 + b.length); ART.copy(p); p.writeUInt16LE(0x8300, 8); p[11] = 14; p[12] = 1; p[21] = universe >> 8; p[23] = universe & 255; Buffer.from(b).copy(p, 24); return p;
}

if (proto === 'artnet' && (flag('poll') || flag('rdm') || opt('rdm-addr'))) {
  const PORT = 6454; let uid = null;
  sock.on('message', m => {
    if (m.length < 10 || m.compare(ART, 0, 8, 0, 8)) return;
    const op = m.readUInt16LE(8);
    if (op === 0x2100) console.log(`ArtPollReply  ${m[10]}.${m[11]}.${m[12]}.${m[13]}  "${m.toString('latin1', 26, 44).replace(/\0.*/, '')}"  "${m.toString('latin1', 44, 108).replace(/\0.*/, '')}"  net/sub ${m[18]}/${m[19]} sw ${m[190]}  ${m.toString('latin1', 108, 172).replace(/\0.*/, '')}`);
    else if (op === 0x8100) { const n = m[27]; for (let i = 0; i < n; i++) { uid = [...m.subarray(28 + i * 6, 34 + i * 6)]; console.log(`ArtTodData    UID ${hex(uid).toUpperCase()}`); } if (!n) console.log('ArtTodData    (no RDM device — the simulator page must be open)'); }
    else if (op === 0x8300) {
      const r = m.subarray(24); if (r.length > 23 && MY_UID.every((v, i) => r[2 + i] === v) && r[19] & 1) {       // replies to my own requests only
        const pid = (r[20] << 8) | r[21], pd = r.subarray(23, 23 + r[22]), type = ['ACK', 'ACK_TIMER', 'NACK', 'ACK_OVERFLOW'][r[15]];
        let txt = hex(pd);
        if (pid === 0x60 && r[15] === 0) txt = `model 0x${hex(pd.subarray(2, 4))} footprint ${pd.readUInt16BE(10)} personality ${pd[12]}/${pd[13]} address ${pd.readUInt16BE(14)}`;
        if (pid === 0xf0 && r[15] === 0 && pd.length === 2) txt = `address ${pd.readUInt16BE(0)}`;
        console.log(`ArtRdm reply  PID 0x${pid.toString(16).padStart(4, '0')} ${type}  ${txt}`);
      }
    }
  });
  // Replies always come back to UDP 6454. On the same PC the simulator owns 6454, so bind to 127.0.0.2 to tell them apart.
  sock.bind(PORT, opt('bind', host.startsWith('127.') ? '127.0.0.2' : undefined), () => {
    const send = b => sock.send(b, PORT, host);
    if (flag('poll')) { const p = Buffer.alloc(14); ART.copy(p); p.writeUInt16LE(0x2000, 8); p[11] = 14; send(p); }
    const t = Buffer.alloc(25); ART.copy(t); t.writeUInt16LE(0x8000, 8); t[11] = 14; t[21] = universe >> 8; t[23] = 1; t[24] = universe & 255; send(t);
    setTimeout(() => {
      if (!uid) return;
      const na = opt('rdm-addr'); if (na) send(rdmPacket(uid, 0x30, 0x00f0, [+na >> 8, +na & 255]));
      setTimeout(() => { send(rdmPacket(uid, 0x20, 0x0060)); send(rdmPacket(uid, 0x20, 0x00f0)); }, 250);
    }, 400);
    setTimeout(() => { sock.close(); }, 1600);
  });
} else {
  const port = proto === 'sacn' ? 5568 : 6454, to = proto === 'sacn' && host === 'multicast' ? `239.255.${universe >> 8}.${universe & 255}` : host;
  let n = 0;
  const t = setInterval(() => { sock.send(proto === 'sacn' ? sacn() : artDmx(), port, to); n++; }, 1000 / rate);
  setTimeout(() => { clearInterval(t); sock.close(); console.log(`${proto} universe ${universe} → ${to}:${port}  ${n} frames sent`); }, secs * 1000);
}
