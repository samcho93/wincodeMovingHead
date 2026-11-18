/* =====================================================================
 *  Wincode MovingHead Sim server — 3D digital twin of the 250W BSW moving head
 * ---------------------------------------------------------------------
 *   http://127.0.0.1:7740            3D web UI (web/)
 *   http://127.0.0.1:7740/console.html  slider-type DMX512 transmitter (for testing)
 *   ws://127.0.0.1:7740/ws           browser ↔ server (status JSON + binary DMX frames)
 *   udp 6454 (Art-Net) · udp 5568 (sACN/E1.31) · USB-DMX (serial)  → DMX input
 *
 *  The fixture behaviour (channel decoding, motors, menu) lives in the browser: web/js/fixture.js.
 *  The server is the "DMX IN connector": it receives what a browser cannot open itself (UDP, serial) and passes it on.
 *
 *  Binary frames
 *   server→browser  [1, src(0=Art-Net 1=sACN 2=USB-DMX), 512 slot bytes]
 *   browser→server  [2, proto(0=Art-Net 1=sACN), universe lo, hi, 512 slot bytes]   ← transmitter
 * ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { DmxNet, ARTNET_PORT, SACN_PORT, localIPv4 } = require('./dmxnet');
const { DmxSerial } = require('./dmxserial');

const agent = require('./agent');

const HTTP_PORT = +(process.env.WMH_PORT || 7740);
// Distribution mode (`--dist` or WMH_DIST=1): the development-only "Add model" agent is switched off
const DIST = process.argv.includes('--dist') || process.env.WMH_DIST === '1';
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

/* ── persisted settings ── */
const CFG_FILE = path.join(DATA, 'movinghead.json');
let cfg = { artnet: { universe: 0 }, sacn: { universe: 1 }, serial: { path: '', proto: 'enttec' } };
try { const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); for (const k of Object.keys(cfg)) Object.assign(cfg[k], j[k]); } catch (e) {}
const saveCfg = () => { try { fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2)); } catch (e) {} };

/* ── browser WebSocket ── */
const clients = new Set();
const broadcast = obj => { const s = JSON.stringify(obj); for (const c of clients) if (c.readyState === 1) c.send(s); };
const broadcastBin = buf => { for (const c of clients) if (c.readyState === 1 && c.bufferedAmount < 1e6) c.send(buf); };
const log = line => { console.log('[wmh]', line); broadcast({ type: 'log', line }); };

/* ── DMX input ── */
const SRC = { artnet: 0, sacn: 1, serial: 2 };
const stat = {};
for (const k of Object.keys(SRC)) stat[k] = { packets: 0, n: 0, fps: 0, last: 0, from: '', universes: {} };
function dmxIn(src, data) {
  const b = Buffer.alloc(514); b[0] = 1; b[1] = SRC[src];
  Buffer.from(data).copy(b, 2, 0, Math.min(512, data.length));
  broadcastBin(b);
}
const net = new DmxNet();
net.node.universe = cfg.artnet.universe;
net.on('log', log);
net.on('dmx', (proto, universe, data, from) => {
  const s = stat[proto]; s.universes[universe] = Date.now();
  if (universe !== cfg[proto].universe) return;
  s.packets++; s.n++; s.last = Date.now(); s.from = from;
  dmxIn(proto, data);
});
net.startArtNet();
net.startSacn(cfg.sacn.universe);

const serial = new DmxSerial();
serial.on('log', log);
serial.on('state', () => broadcast(status()));
serial.on('frame', (sc, slots) => {
  const s = stat.serial;
  if (sc === 0) { s.packets++; s.n++; s.last = Date.now(); s.from = serial.path; dmxIn('serial', slots); }
  else if (sc === 0xcc) rdmIn(Buffer.from(slots), { serial: true });
});

/* ── RDM: the responder lives in the browser (the fixture). Forward requests, return its replies ── */
let fixtureClient = null, rdmSeq = 0;
const rdmPending = new Map();
function rdmIn(packet, origin) {
  if (!fixtureClient || fixtureClient.readyState !== 1) return;
  const id = ++rdmSeq; rdmPending.set(id, origin);
  if (rdmPending.size > 64) rdmPending.delete(rdmPending.keys().next().value);
  fixtureClient.send(JSON.stringify({ type: 'rdm', id, data: [...packet] }));
}
net.on('rdm', rdmIn);

function status() {
  const now = Date.now(), src = {};
  for (const [k, s] of Object.entries(stat)) {
    for (const u of Object.keys(s.universes)) if (now - s.universes[u] > 3000) delete s.universes[u];
    src[k] = { packets: s.packets, fps: s.fps, active: now - s.last < 1500, from: s.from, seen: Object.keys(s.universes).map(Number).sort((a, b) => a - b) };
  }
  src.artnet.universe = cfg.artnet.universe; src.artnet.port = ARTNET_PORT; src.artnet.error = net.art ? '' : (net.artErr || 'starting');
  src.sacn.universe = cfg.sacn.universe; src.sacn.port = SACN_PORT; src.sacn.error = net.sacn ? '' : (net.sacnErr || 'starting');
  src.serial.open = serial.open; src.serial.path = serial.path || cfg.serial.path; src.serial.proto = serial.proto; src.serial.error = serial.err;
  return { type: 'status', app: 'wincode-movinghead-sim', sources: src, ip: localIPv4().map(i => i.address), clients: clients.size, agent: !DIST };
}
setInterval(() => { for (const s of Object.values(stat)) { s.fps = s.n; s.n = 0; } broadcast(status()); }, 1000);

/* ── HTTP ── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.glb': 'model/gltf-binary' };
function sendFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname);
  if (await agent.handle(req, res, url, { enabled: !DIST })) return;
  if (DIST && /^\/(agent\.html|js\/agent\.js)$/.test(p)) { res.writeHead(404); return res.end('404'); }
  if (p === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(status())); }
  if (p === '/api/ports') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(await DmxSerial.list())); }
  if (p.startsWith('/vendor/three/')) return sendFile(res, THREE_DIR, p.slice('/vendor/three/'.length));
  if (p.startsWith('/docs/')) return sendFile(res, path.join(ROOT, 'docs'), p.slice('/docs/'.length));
  if (p === '/') p = '/index.html';
  sendFile(res, WEB, p.slice(1));
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  clients.add(ws); ws.txHost = '127.0.0.1';
  ws.send(JSON.stringify(status()));
  ws.on('close', () => { clients.delete(ws); if (fixtureClient === ws) { fixtureClient = null; net.node.uid = null; } });
  ws.on('message', async (raw, isBinary) => {
    if (isBinary) {                                   // transmitter → real UDP output
      if (raw.length >= 516 && raw[0] === 2) {
        const universe = raw[2] | (raw[3] << 8), data = raw.subarray(4, 516);
        raw[1] === 1 ? net.sendSacn(universe, data, ws.txHost) : net.sendArtDmx(universe, data, ws.txHost);
      } else if (raw.length >= 517 && raw[0] === 3) {   // DMX editor: [3, proto, universe lo, hi, host length, host…, 512 slots] — one target per universe
        const hl = raw[4], host = raw.subarray(5, 5 + hl).toString('latin1'), data = raw.subarray(5 + hl, 5 + hl + 512), universe = raw[2] | (raw[3] << 8);
        if (data.length === 512 && /^[\w.:-]{1,64}$/.test(host)) raw[1] === 1 ? net.sendSacn(universe, data, host) : net.sendArtDmx(universe, data, host);
      }
      return;
    }
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    try {
      if (m.type === 'fixture') {                     // fixture info (for ArtPollReply and the RDM device list)
        fixtureClient = ws; net.node.uid = m.uid; net.node.address = m.address;
        if (m.label) net.node.shortName = String(m.label).slice(0, 17);
      } else if (m.type === 'cfg') {
        if (m.artnet && Number.isInteger(m.artnet.universe)) { cfg.artnet.universe = Math.min(32767, Math.max(0, m.artnet.universe)); net.node.universe = cfg.artnet.universe; }
        if (m.sacn && Number.isInteger(m.sacn.universe)) { cfg.sacn.universe = Math.min(63999, Math.max(1, m.sacn.universe)); net.joinSacn(cfg.sacn.universe); }
        saveCfg(); broadcast(status());
      } else if (m.type === 'serial') {
        if (m.action === 'open') { cfg.serial = { path: String(m.path || ''), proto: m.proto === 'raw' ? 'raw' : 'enttec' }; saveCfg(); await serial.openPort(cfg.serial.path, cfg.serial.proto); }
        else await serial.close();
        broadcast(status());
      } else if (m.type === 'txcfg') { ws.txHost = /^[\w.:-]{1,64}$/.test(m.host || '') ? m.host : '127.0.0.1'; }
      else if (m.type === 'rdmReply') {
        const origin = rdmPending.get(m.id); rdmPending.delete(m.id);
        if (origin && Array.isArray(m.data) && m.data.length) {
          if (origin.serial) { /* RDM replies through a widget are not supported (timing) */ } else net.sendRdm(Buffer.from(m.data), origin);
        }
      }
    } catch (e) { log('Error: ' + e.message); ws.send(JSON.stringify({ type: 'error', message: e.message })); }
  });
});

server.listen(HTTP_PORT, () => {
  console.log(`\n  Wincode MovingHead Sim  →  http://127.0.0.1:${HTTP_PORT}`);
  console.log(`  DMX transmitter (sliders) →  http://127.0.0.1:${HTTP_PORT}/console.html`);
  console.log(`  DMX editor                →  http://127.0.0.1:${HTTP_PORT}/editor.html`);
  console.log(DIST ? '  Distribution mode: the Add-model agent is disabled' : '  Add-model agent: Ctrl + double-click the WINCODE logo (development only)');
  console.log(`  Art-Net UDP ${ARTNET_PORT} (universe ${cfg.artnet.universe}) · sACN UDP ${SACN_PORT} (universe ${cfg.sacn.universe})\n`);
});
