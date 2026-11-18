/* =====================================================================
 *  agent.js — "Add model" agent (development only)
 * ---------------------------------------------------------------------
 *  Takes a product page link, the user manual (PDF) and optionally a mechanical drawing, and has the installed
 *  Claude Code CLI write a new fixture model definition (web/js/models/<id>.js) and register it.
 *
 *   GET  /api/agent/info                      { enabled, cli, running }
 *   PUT  /api/agent/upload?job=&kind=&name=   raw file body → work/agent/<job>/<kind>.<ext>
 *   POST /api/agent/run     { job, url, notes, id }
 *   GET  /api/agent/events?job=               server-sent events: log lines, then the result
 *   POST /api/agent/stop    { job }
 *   POST /api/agent/discard { job }           undo the files this job created or changed
 *
 *  Only reachable from this computer (loopback + same-origin check), and switched off entirely in distribution mode
 *  (`node server/index.js --dist` or WMH_DIST=1). The static web build does not contain the agent page at all.
 *  The CLI runs with edits auto-accepted and may run python / node only (PDF rendering and the model validator).
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORK = path.join(ROOT, 'work', 'agent');
const PROMPT = path.join(ROOT, 'tools', 'agent-prompt.md');
const ALLOWED = 'Read,Write,Edit,Glob,Grep,WebFetch,Bash(python:*),Bash(node:*)';
const MAX_UPLOAD = 120 * 1024 * 1024;
const jobs = new Map();           // id → { id, dir, log: [], clients: Set, proc, state, files, baseline, result }
let running = null;

const isLoopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
function sameOrigin(req) {
  const o = req.headers.origin; if (!o) return true;                       // same-origin GETs and non-browser clients send no Origin
  try { const u = new URL(o); return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch (e) { return false; }
}
const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
const readBody = (req, limit) => new Promise((resolve, reject) => { const chunks = []; let n = 0; req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); });
const safeId = s => /^[a-z0-9]{6,32}$/.test(s || '') ? s : null;

let cliVersion;
function cli() {
  if (cliVersion === undefined) { try { cliVersion = execFileSync('claude', ['--version'], { shell: true, encoding: 'utf8', timeout: 15000 }).trim().split('\n')[0]; } catch (e) { cliVersion = null; } }
  return cliVersion;
}
/** files that differ from HEAD or are untracked: path → 'M' | '?' … */
function gitStatus() {
  try { return new Map(execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).map(l => [l.slice(3).replace(/^"|"$/g, ''), l.slice(0, 2).trim()])); } catch (e) { return new Map(); }
}
function job(id) {
  if (!jobs.has(id)) { const dir = path.join(WORK, id); fs.mkdirSync(dir, { recursive: true }); jobs.set(id, { id, dir, log: [], clients: new Set(), proc: null, state: 'idle', files: {}, result: null }); }
  return jobs.get(id);
}
function emit(j, ev) { j.log.push(ev); const s = `data: ${JSON.stringify(ev)}\n\n`; for (const c of j.clients) c.write(s); }
const short = (s, n = 160) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

/** one line of the CLI's stream-json output → events for the page */
function onLine(j, line) {
  let m; try { m = JSON.parse(line); } catch (e) { return; }
  if (m.type === 'system' && m.subtype === 'init') emit(j, { kind: 'info', text: `Claude session started (${m.model || 'default model'})` });
  else if (m.type === 'assistant' && m.message) for (const c of m.message.content || []) {
    if (c.type === 'text' && c.text.trim()) emit(j, { kind: 'text', text: c.text });
    else if (c.type === 'tool_use') { const i = c.input || {}; emit(j, { kind: 'tool', text: `${c.name}: ${short(i.file_path || i.command || i.url || i.pattern || i.path || JSON.stringify(i))}` }); }
  } else if (m.type === 'result') { j.summary = m.result || ''; j.cost = m.total_cost_usd; j.isError = !!m.is_error; }
}

function finish(j, code) {
  running = null; j.proc = null;
  const after = gitStatus(), changed = [...after.keys()].filter(f => !j.baseline.has(f) && !f.startsWith('work/'));
  const models = changed.map(f => /^web\/js\/models\/([a-z0-9]+)\.js$/.exec(f)).filter(m => m && !['index', 'util'].includes(m[1])).map(m => m[1]);
  let check = [];
  try { const r = spawnSync('node', ['tools/check-model.mjs', '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 }); check = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { check = [{ id: '?', ok: false, errors: ['The validator did not run: ' + e.message], warnings: [] }]; }
  const modelId = models[0] || null, mine = check.find(c => c.id === modelId);
  j.changed = changed; j.state = 'done';
  j.result = { kind: 'done', ok: code === 0 && !j.isError && !!modelId && !!(mine && mine.ok) && check.every(c => c.ok), exitCode: code, stopped: !!j.stopped, modelId, changed, check, summary: j.summary || '', cost: j.cost ?? null };
  emit(j, j.result);
  for (const c of j.clients) c.end(); j.clients.clear();
}

function run(j, { url, notes, id }) {
  j.baseline = gitStatus(); j.state = 'running'; j.log = []; j.result = null; j.stopped = false; j.summary = ''; running = j;
  const rel = f => (f ? path.relative(ROOT, f).replace(/\\/g, '/') : '(none)');
  const prompt = fs.readFileSync(PROMPT, 'utf8')
    .replace('{{URL}}', url || '(none)').replace('{{MANUAL}}', rel(j.files.manual)).replace('{{DRAWING}}', rel(j.files.drawing))
    .replace('{{NOTES}}', notes || '(none)').replace('{{ID}}', id || '(choose one)').replace(/\{\{WORK\}\}/g, rel(j.dir));
  emit(j, { kind: 'info', text: `Starting: ${cli()}` });
  const p = j.proc = spawn(`claude -p --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools "${ALLOWED}"`, { cwd: ROOT, shell: true, windowsHide: true });
  let buf = '';
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(j, buf.slice(0, i)); buf = buf.slice(i + 1); } });
  p.stderr.on('data', d => { const t = String(d).trim(); if (t) emit(j, { kind: 'err', text: short(t, 400) }); });
  p.on('error', e => { emit(j, { kind: 'err', text: 'Could not start the Claude CLI: ' + e.message }); finish(j, -1); });
  p.on('close', code => { if (buf.trim()) onLine(j, buf); finish(j, code); });
  p.stdin.end(prompt);
}
function kill(j) {
  if (!j.proc) return; j.stopped = true;
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(j.proc.pid), '/T', '/F']); else j.proc.kill('SIGTERM'); } catch (e) {}
}
/** undo what the job did: delete the files it created, restore the tracked files it changed */
function discard(j) {
  const now = gitStatus(), undone = [];
  for (const f of j.changed || []) {
    const st = now.get(f); if (!st) continue;
    const abs = path.join(ROOT, f); if (!abs.startsWith(ROOT)) continue;
    try { if (st === '??') fs.rmSync(abs, { force: true }); else execFileSync('git', ['checkout', '--', f], { cwd: ROOT }); undone.push(f); } catch (e) {}
  }
  j.changed = []; return undone;
}

/** returns true when the request was an agent request (handled here) */
async function handle(req, res, url, opts) {
  if (!url.pathname.startsWith('/api/agent/')) return false;
  const action = url.pathname.slice('/api/agent/'.length);
  if (!opts.enabled) { json(res, action === 'info' ? 200 : 404, { enabled: false }); return true; }
  if (!isLoopback(req) || !sameOrigin(req)) { json(res, 403, { error: 'The agent only accepts requests from this computer.' }); return true; }
  try {
    if (action === 'info' && req.method === 'GET') return json(res, 200, { enabled: true, cli: cli(), running: running ? running.id : null }), true;
    const id = safeId(url.searchParams.get('job'));
    if (action === 'upload' && req.method === 'PUT') {
      const kind = url.searchParams.get('kind'), ext = (path.extname(url.searchParams.get('name') || '').toLowerCase().match(/^\.(pdf|png|jpe?g|svg|dxf|webp)$/) || [])[0];
      if (!id || !['manual', 'drawing'].includes(kind) || !ext) return json(res, 400, { error: 'Unsupported file (manual: PDF · drawing: PDF, PNG, JPG, SVG, DXF).' }), true;
      const j = job(id), file = path.join(j.dir, kind + ext);
      fs.writeFileSync(file, await readBody(req, MAX_UPLOAD)); j.files[kind] = file;
      return json(res, 200, { ok: true, size: fs.statSync(file).size }), true;
    }
    if (action === 'events' && req.method === 'GET') {
      if (!id || !jobs.has(id)) return json(res, 404, { error: 'unknown job' }), true;
      const j = jobs.get(id);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      for (const ev of j.log) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (j.state === 'done') return res.end(), true;
      j.clients.add(res); req.on('close', () => j.clients.delete(res)); return true;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' }), true;
    const body = JSON.parse((await readBody(req, 1e6)).toString() || '{}'), jid = safeId(body.job);
    if (!jid) return json(res, 400, { error: 'bad job id' }), true;
    const j = job(jid);
    if (action === 'run') {
      if (running) return json(res, 409, { error: 'Another job is running.' }), true;
      if (!cli()) return json(res, 500, { error: 'The Claude CLI was not found (install Claude Code and sign in: `claude`).' }), true;
      if (!j.files.manual && !body.url) return json(res, 400, { error: 'Give at least the manual or the product link.' }), true;
      if (body.url && !/^https?:\/\/[^\s"'<>]+$/.test(body.url)) return json(res, 400, { error: 'The product link must be an http(s) URL.' }), true;
      if (body.id && !/^[a-z][a-z0-9]{1,23}$/.test(body.id)) return json(res, 400, { error: 'Model id: lower-case letters and digits.' }), true;
      run(j, { url: body.url, notes: String(body.notes || '').slice(0, 2000), id: body.id });
      return json(res, 200, { ok: true }), true;
    }
    if (action === 'stop') { kill(j); return json(res, 200, { ok: true }), true; }
    if (action === 'discard') { if (j.state === 'running') return json(res, 409, { error: 'Still running.' }), true; return json(res, 200, { ok: true, undone: discard(j) }), true; }
    json(res, 404, { error: 'unknown action' });
  } catch (e) { json(res, 500, { error: e.message }); }
  return true;
}

module.exports = { handle };
