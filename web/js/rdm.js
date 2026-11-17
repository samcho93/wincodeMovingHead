// rdm.js — RDM (ANSI E1.20) responder. Manual chapter 2: "Support RDM function".
//  Packets are exchanged without the start code (0xCC) (= the Art-Net ArtRdm payload).
import { MODES } from './personality.js';

const CC = { DISC: 0x10, DISC_RESP: 0x11, GET: 0x20, GET_RESP: 0x21, SET: 0x30, SET_RESP: 0x31 };
const PID = {
  DISC_UNIQUE_BRANCH: 0x0001, DISC_MUTE: 0x0002, DISC_UN_MUTE: 0x0003, SUPPORTED_PARAMETERS: 0x0050,
  DEVICE_INFO: 0x0060, DEVICE_MODEL_DESCRIPTION: 0x0080, MANUFACTURER_LABEL: 0x0081, DEVICE_LABEL: 0x0082, SOFTWARE_VERSION_LABEL: 0x00c0,
  DMX_PERSONALITY: 0x00e0, DMX_PERSONALITY_DESCRIPTION: 0x00e1, DMX_START_ADDRESS: 0x00f0, DEVICE_HOURS: 0x0400, DEVICE_POWER_CYCLES: 0x0405,
  DISPLAY_INVERT: 0x0500, PAN_INVERT: 0x0600, TILT_INVERT: 0x0601, IDENTIFY_DEVICE: 0x1000, RESET_DEVICE: 0x1001,
};
const PID_NAME = Object.fromEntries(Object.entries(PID).map(([k, v]) => [v, k]));
const NACK = { UNKNOWN_PID: 0x0000, FORMAT_ERROR: 0x0001, UNSUPPORTED_CC: 0x0005, DATA_OUT_OF_RANGE: 0x0006 };
const PERS = ['STD', 'EXT'];
const ascii = s => [...String(s).slice(0, 32)].map(c => c.charCodeAt(0) & 0x7f);
const u16 = v => [(v >> 8) & 0xff, v & 0xff];
const u32 = v => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

export class RdmResponder {
  constructor(fx) {
    this.fx = fx; this.muted = false; this.label = 'Wincode BSW250'; this.last = '';
    let id = 0; try { id = parseInt(localStorage.getItem('wmh.rdm.id') || '0', 10); } catch (e) {}
    if (!id) { id = (Math.random() * 0xfffffffe + 1) >>> 0; try { localStorage.setItem('wmh.rdm.id', String(id)); } catch (e) {} }
    this.uid = [0x7f, 0xf0, ...u32(id)];                         // 0x7FF0 = ESTA prototype manufacturer ID
    try { this.label = localStorage.getItem('wmh.rdm.label') || this.label; } catch (e) {}
  }
  get uidText() { const h = this.uid.map(b => b.toString(16).padStart(2, '0')).join(''); return (h.slice(0, 4) + ':' + h.slice(4)).toUpperCase(); }
  static checksum(bytes) { let s = 0xcc; for (const b of bytes) s += b; return s & 0xffff; }

  /** Request → response, or null when there is none. DISC_UNIQUE_BRANCH returns { disc: Uint8Array } (serial only, with preamble) */
  handle(pkt) {
    if (pkt.length < 25 || pkt[0] !== 0x01) return null;
    const len = pkt[1]; if (pkt.length < len + 1) return null;      // len includes the start code
    const body = pkt.subarray(0, len - 1), sum = (pkt[len - 1] << 8) | pkt[len];
    if (RdmResponder.checksum(body) !== sum) return null;
    const dest = [...pkt.subarray(2, 8)], src = [...pkt.subarray(8, 14)], tn = pkt[14], sub = (pkt[17] << 8) | pkt[18];
    const cc = pkt[19], pid = (pkt[20] << 8) | pkt[21], pdl = pkt[22], pd = pkt.subarray(23, 23 + pdl);
    const mine = dest.every((b, i) => b === this.uid[i]);
    const bcast = dest.slice(2).every(b => b === 0xff) && (dest[0] === 0xff && dest[1] === 0xff || dest[0] === this.uid[0] && dest[1] === this.uid[1]);
    if (!mine && !bcast) return null;
    this.last = `${cc === CC.GET ? 'GET' : cc === CC.SET ? 'SET' : 'DISC'} ${PID_NAME[pid] || '0x' + pid.toString(16)}`;
    const reply = (type, data, rcc = cc + 1) => {
      if (!mine) return null;                                       // no reply to broadcasts
      const b = [0x01, 24 + data.length, ...src, ...this.uid, tn, type, 0, ...u16(sub), rcc, ...u16(pid), data.length, ...data];
      return new Uint8Array([...b, ...u16(RdmResponder.checksum(b))]);
    };
    const ack = data => reply(0x00, data || []), nack = why => reply(0x02, u16(why));
    const fx = this.fx, S = fx.settings;

    if (cc === CC.DISC) {
      if (pid === PID.DISC_UNIQUE_BRANCH && pdl === 12) {
        if (this.muted) return null;
        const n = a => a.reduce((s, b) => s * 256 + b, 0), me = n(this.uid);
        if (me < n([...pd.subarray(0, 6)]) || me > n([...pd.subarray(6, 12)])) return null;
        const enc = []; let cs = 0;
        for (const b of this.uid) { enc.push(b | 0xaa, b | 0x55); cs += (b | 0xaa) + (b | 0x55); }
        return { disc: new Uint8Array([0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xaa, ...enc, (cs >> 8) | 0xaa, (cs >> 8) | 0x55, (cs & 0xff) | 0xaa, (cs & 0xff) | 0x55]) };
      }
      if (pid === PID.DISC_MUTE) { this.muted = true; return ack([0, 0]); }
      if (pid === PID.DISC_UN_MUTE) { this.muted = false; return ack([0, 0]); }
      return null;
    }
    if (cc !== CC.GET && cc !== CC.SET) return nack(NACK.UNSUPPORTED_CC);
    const set = cc === CC.SET, pers = PERS.indexOf(S.mode) + 1;
    const bool = (get, apply) => { if (!set) return ack([get() ? 1 : 0]); if (pdl !== 1 || pd[0] > 1) return nack(NACK.FORMAT_ERROR); apply(!!pd[0]); return ack(); };
    switch (pid) {
      case PID.SUPPORTED_PARAMETERS:
        return ack([PID.DEVICE_MODEL_DESCRIPTION, PID.MANUFACTURER_LABEL, PID.DEVICE_LABEL, PID.DMX_PERSONALITY, PID.DMX_PERSONALITY_DESCRIPTION,
          PID.DEVICE_HOURS, PID.DEVICE_POWER_CYCLES, PID.DISPLAY_INVERT, PID.PAN_INVERT, PID.TILT_INVERT, PID.RESET_DEVICE].flatMap(u16));
      case PID.DEVICE_INFO:
        return ack([0x01, 0x00, 0x10, 0x12, 0x01, 0x02, ...u32(0x01000c00), ...u16(fx.footprint), pers, PERS.length, ...u16(S.address), 0, 0, 0]);
      case PID.DEVICE_MODEL_DESCRIPTION: return ack(ascii('WOP-LM1012B 250W BSW'));
      case PID.MANUFACTURER_LABEL: return ack(ascii('Wincode Optronics (sim)'));
      case PID.SOFTWARE_VERSION_LABEL: return ack(ascii('Panel V1.012'));
      case PID.DEVICE_LABEL:
        if (!set) return ack(ascii(this.label));
        this.label = String.fromCharCode(...pd); try { localStorage.setItem('wmh.rdm.label', this.label); } catch (e) {} fx.emit('settings'); return ack();
      case PID.DMX_PERSONALITY:
        if (!set) return ack([pers, PERS.length]);
        if (pdl !== 1 || pd[0] < 1 || pd[0] > PERS.length) return nack(NACK.DATA_OUT_OF_RANGE);
        fx.set('mode', PERS[pd[0] - 1]); return ack();
      case PID.DMX_PERSONALITY_DESCRIPTION: {
        if (set) return nack(NACK.UNSUPPORTED_CC);
        const m = MODES[PERS[pd[0] - 1]]; if (pdl !== 1 || !m) return nack(NACK.DATA_OUT_OF_RANGE);
        return ack([pd[0], ...u16(m.channels.length), ...ascii(`${m.id} ${m.label}`)]);
      }
      case PID.DMX_START_ADDRESS: {
        if (!set) return ack(u16(S.address));
        const a = (pd[0] << 8) | pd[1]; if (pdl !== 2 || a < 1 || a > 512) return nack(NACK.DATA_OUT_OF_RANGE);
        fx.set('address', a); return ack();
      }
      case PID.DEVICE_HOURS: return set ? nack(NACK.UNSUPPORTED_CC) : ack(u32(Math.floor(S.totalHours)));
      case PID.DEVICE_POWER_CYCLES: return set ? nack(NACK.UNSUPPORTED_CC) : ack(u32(S.powerCount));
      case PID.DISPLAY_INVERT: return bool(() => S.flip, v => fx.set('flip', v));
      case PID.PAN_INVERT: return bool(() => S.panInvert, v => fx.set('panInvert', v));
      case PID.TILT_INVERT: return bool(() => S.tiltInvert, v => fx.set('tiltInvert', v));
      case PID.IDENTIFY_DEVICE: return bool(() => fx.identify, v => { fx.identify = v; fx.emit('settings'); });
      case PID.RESET_DEVICE: if (!set) return nack(NACK.UNSUPPORTED_CC); fx.startReset('RDM'); return ack();
      default: return nack(NACK.UNKNOWN_PID);
    }
  }
}
