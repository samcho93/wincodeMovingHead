/* =====================================================================
 *  dmxnet.js — network DMX: Art-Net 4 (UDP 6454) · sACN / E1.31 (UDP 5568)
 *   receive: ArtDmx, E1.31 Data  → 'dmx' (proto, universe, Buffer(≤512), from)
 *   reply:   ArtPoll → ArtPollReply, ArtTodRequest/Control → ArtTodData (RDM device list)
 *   relay:   ArtRdm → 'rdm' (packet without start code, rinfo) / answer with sendRdm()
 *   send:    sendArtDmx / sendSacn — used by the slider test transmitter
 * ===================================================================== */
'use strict';
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const ARTNET_PORT = 6454, SACN_PORT = 5568;
const ART_ID = Buffer.from('Art-Net\0', 'latin1');
const OP = { Poll: 0x2000, PollReply: 0x2100, Dmx: 0x5000, TodRequest: 0x8000, TodData: 0x8100, TodControl: 0x8200, Rdm: 0x8300 };
const ACN_ID = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);   // "ASC-E1.17"
const sacnGroup = u => `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;

function localIPv4() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i);
  return out;
}

class DmxNet extends EventEmitter {
  constructor() {
    super();
    this.node = { shortName: 'Wincode BSW250', longName: 'Wincode WOP-LM1012B 250W BSW Moving Head (simulator)', universe: 0, uid: null, address: 1 };
    this.art = null; this.sacn = null; this.artErr = ''; this.sacnErr = '';
    this.sacnUniverse = 0; this.sacnSources = new Map();     // cid → {prio, last}
    this.cid = crypto.randomBytes(16); this.seq = { art: 0, sacn: 0 };
  }

  /* ───────── Art-Net ───────── */
  startArtNet() {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('error', e => { this.artErr = e.code || e.message; this.emit('log', `Art-Net socket error: ${e.message}`); try { s.close(); } catch (x) {} this.art = null; });
    s.on('message', (m, r) => { try { this.onArt(m, r); } catch (e) { this.emit('log', 'Art-Net parse error: ' + e.message); } });
    s.bind(ARTNET_PORT, () => { try { s.setBroadcast(true); } catch (e) {} this.art = s; this.artErr = ''; this.emit('log', `Art-Net listening: UDP ${ARTNET_PORT}`); });
  }
  onArt(m, r) {
    if (m.length < 12 || m.compare(ART_ID, 0, 8, 0, 8) !== 0) return;
    const op = m.readUInt16LE(8);
    if (op === OP.Dmx && m.length >= 18) {
      const universe = ((m[15] & 0x7f) << 8) | m[14], len = Math.min(512, m.readUInt16BE(16), m.length - 18);
      this.emit('dmx', 'artnet', universe, m.subarray(18, 18 + len), r.address);
    } else if (op === OP.Poll) this.sendPollReply(r);
    else if (op === OP.TodRequest || op === OP.TodControl) this.sendTod(r);
    else if (op === OP.Rdm && m.length > 25) {
      if ((((m[21] & 0x7f) << 8) | m[23]) !== this.node.universe) return;
      this.emit('rdm', Buffer.from(m.subarray(24)), r);
    }
  }
  sendPollReply(r) {
    const n = this.node, b = Buffer.alloc(239), ifc = localIPv4()[0];
    ART_ID.copy(b); b.writeUInt16LE(OP.PollReply, 8);
    (ifc ? ifc.address : '127.0.0.1').split('.').forEach((v, i) => { b[10 + i] = +v; b[207 + i] = +v; });
    b.writeUInt16LE(ARTNET_PORT, 14); b[16] = 1; b[17] = 0;
    b[18] = (n.universe >> 8) & 0x7f; b[19] = (n.universe >> 4) & 0x0f;
    b[23] = 0xd2;                                   // indicators normal · address set over the network · RDM capable
    b.writeUInt16LE(0x7ff0, 24);                    // ESTA prototype manufacturer ID
    b.write(n.shortName.slice(0, 17), 26, 'latin1'); b.write(n.longName.slice(0, 63), 44, 'latin1');
    b.write(`#0001 [0001] DMX start ${n.address}`, 108, 'latin1');
    b[173] = 1; b[174] = 0x80; b[182] = 0x80; b[190] = n.universe & 0x0f;
    if (ifc && ifc.mac) ifc.mac.split(':').forEach((v, i) => { b[201 + i] = parseInt(v, 16); });
    b[211] = 1; b[212] = 0x08;                      // 15-bit port address
    this.art && this.art.send(b, ARTNET_PORT, r.address);
  }
  sendTod(r) {
    const n = this.node, uids = n.uid ? [n.uid] : [], b = Buffer.alloc(28 + uids.length * 6);
    ART_ID.copy(b); b.writeUInt16LE(OP.TodData, 8); b[11] = 14; b[12] = 1; b[13] = 1; b[20] = 1;
    b[21] = (n.universe >> 8) & 0x7f; b[22] = 0; b[23] = n.universe & 0xff; b[25] = uids.length; b[27] = uids.length;
    uids.forEach((u, i) => Buffer.from(u).copy(b, 28 + i * 6));
    this.art && this.art.send(b, ARTNET_PORT, r.address);
  }
  /** Send an RDM response (without the 0xCC start code) back to the requesting controller */
  sendRdm(packet, r) {
    const n = this.node, b = Buffer.alloc(24 + packet.length);
    ART_ID.copy(b); b.writeUInt16LE(OP.Rdm, 8); b[11] = 14; b[12] = 1;
    b[21] = (n.universe >> 8) & 0x7f; b[22] = 0; b[23] = n.universe & 0xff;
    Buffer.from(packet).copy(b, 24);
    this.art && this.art.send(b, ARTNET_PORT, r.address);
  }
  sendArtDmx(universe, data, host) {
    if (!this.art) return false;
    const b = Buffer.alloc(18 + 512);
    ART_ID.copy(b); b.writeUInt16LE(OP.Dmx, 8); b[11] = 14;
    b[12] = this.seq.art = (this.seq.art % 255) + 1; b[14] = universe & 0xff; b[15] = (universe >> 8) & 0x7f; b.writeUInt16BE(512, 16);
    Buffer.from(data).copy(b, 18, 0, 512);
    this.art.send(b, ARTNET_PORT, host || '127.0.0.1');
    return true;
  }

  /* ───────── sACN (E1.31) ───────── */
  startSacn(universe) {
    this.sacnUniverse = universe;
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('error', e => { this.sacnErr = e.code || e.message; this.emit('log', `sACN socket error: ${e.message}`); try { s.close(); } catch (x) {} this.sacn = null; });
    s.on('message', (m, r) => { try { this.onSacn(m, r); } catch (e) { this.emit('log', 'sACN parse error: ' + e.message); } });
    s.bind(SACN_PORT, () => { this.sacn = s; this.sacnErr = ''; this.joinSacn(universe); this.emit('log', `sACN listening: UDP ${SACN_PORT} (${sacnGroup(universe)})`); });
  }
  joinSacn(universe) {
    if (!this.sacn) { this.sacnUniverse = universe; return; }
    const ifs = localIPv4().map(i => i.address).concat(['127.0.0.1']);
    for (const a of ifs) { try { this.sacn.dropMembership(sacnGroup(this.sacnUniverse), a); } catch (e) {} }
    this.sacnUniverse = universe; this.sacnSources.clear();
    if (universe < 1 || universe > 63999) return;
    for (const a of ifs) { try { this.sacn.addMembership(sacnGroup(universe), a); } catch (e) {} }
  }
  onSacn(m, r) {
    if (m.length < 126 || m.readUInt16BE(0) !== 0x0010 || m.compare(ACN_ID, 0, 12, 4, 16) !== 0) return;
    if (m.readUInt32BE(18) !== 4 || m.readUInt32BE(40) !== 2 || m[117] !== 0x02) return;      // data packets only
    const universe = m.readUInt16BE(113), prio = m[108], opts = m[112];
    if (opts & 0x80) return;                                                                    // ignore preview data
    const cid = m.toString('hex', 22, 38), now = Date.now();
    if (universe === this.sacnUniverse) {                                                       // only the highest-priority source is used
      if (opts & 0x40) { this.sacnSources.delete(cid); return; }                               // stream terminated
      this.sacnSources.set(cid, { prio, last: now });
      let top = 0; for (const [k, v] of this.sacnSources) { if (now - v.last > 2500) this.sacnSources.delete(k); else top = Math.max(top, v.prio); }
      if (prio < top) return;
    }
    if (m[125] !== 0) return;                                                                   // start code 0 (dimmer data) only
    const count = Math.min(512, m.readUInt16BE(123) - 1, m.length - 126);
    this.emit('dmx', 'sacn', universe, m.subarray(126, 126 + count), r.address);
  }
  sendSacn(universe, data, host) {
    if (!this.sacn) return false;
    const b = Buffer.alloc(638);
    b.writeUInt16BE(0x0010, 0); ACN_ID.copy(b, 4); b.writeUInt16BE(0x7000 | (638 - 16), 16); b.writeUInt32BE(4, 18); this.cid.copy(b, 22);
    b.writeUInt16BE(0x7000 | (638 - 38), 38); b.writeUInt32BE(2, 40); b.write('WMH DMX Transmitter', 44, 'utf8');
    b[108] = 100; b[111] = this.seq.sacn = (this.seq.sacn + 1) & 0xff; b.writeUInt16BE(universe, 113);
    b.writeUInt16BE(0x7000 | (638 - 115), 115); b[117] = 0x02; b[118] = 0xa1; b.writeUInt16BE(1, 121); b.writeUInt16BE(513, 123);
    Buffer.from(data).copy(b, 126, 0, 512);
    this.sacn.send(b, SACN_PORT, !host || host === 'multicast' ? sacnGroup(universe) : host);
    return true;
  }
}

module.exports = { DmxNet, ARTNET_PORT, SACN_PORT, localIPv4 };
