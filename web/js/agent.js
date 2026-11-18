// agent.js — page of the development-only "Add model" agent (agent.html). Server side: server/agent.js.
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const job = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
let busy = false;

const state = (text, cls = '') => { const s = $('#state'); s.textContent = text; s.className = 'pill ' + cls; };
function log(kind, text) { const el = $('#log'), line = document.createElement('div'); line.className = kind; line.textContent = (kind === 'tool' ? '› ' : '') + text; el.append(line); el.scrollTop = el.scrollHeight; }
const api = async (path, opt) => { const r = await fetch('api/agent/' + path, opt), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job, ...body }) });
const setBusy = b => { busy = b; $('#start').disabled = b; $('#stop').disabled = !b; document.querySelectorAll('.form input, .form textarea').forEach(e => { e.disabled = b; }); };

async function init() {
  try {
    const i = await api('info');
    if (!i.enabled) return state('The agent is disabled (distribution mode)', 'off'), setBusy(true), ($('#stop').disabled = true);
    if (!i.cli) return state('Claude CLI not found — install Claude Code and sign in', 'off'), ($('#start').disabled = true);
    state(i.running ? 'Another job is running' : `Ready · ${i.cli}`, i.running ? 'warn' : 'on');
  } catch (e) { state('Local server not reachable', 'off'); $('#start').disabled = true; }
}

async function upload(kind, file) {
  log('info', `Uploading ${kind}: ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`);
  await api(`upload?job=${job}&kind=${kind}&name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
}

$('#start').addEventListener('click', async () => {
  const url = $('#url').value.trim(), manual = $('#manual').files[0], drawing = $('#drawing').files[0];
  if (!url && !manual) return alert('Give at least the manual or the product link.');
  $('#log').textContent = ''; $('#result').hidden = true; setBusy(true); state('Running…', 'warn');
  try {
    if (manual) await upload('manual', manual);
    if (drawing) await upload('drawing', drawing);
    await post('run', { url, notes: $('#notes').value, id: $('#mid').value.trim() || undefined });
  } catch (e) { log('err', e.message); setBusy(false); return state('Could not start', 'off'); }
  const es = new EventSource(`api/agent/events?job=${job}`);
  es.onmessage = e => { const ev = JSON.parse(e.data); if (ev.kind === 'done') { es.close(); done(ev); } else log(ev.kind, ev.text); };
  es.onerror = () => { if (busy) { es.close(); log('err', 'Lost the connection to the server.'); setBusy(false); state('Disconnected', 'off'); } };
});
$('#stop').addEventListener('click', () => post('stop', {}).catch(e => log('err', e.message)));

function done(r) {
  setBusy(false);
  state(r.stopped ? 'Stopped' : r.ok ? 'Finished — model added' : 'Finished with problems', r.ok ? 'on' : 'off');
  const el = $('#result'); el.hidden = false; el.className = r.ok ? 'ok' : 'bad';
  const check = r.check.map(c => `<li><b>${c.ok ? 'OK' : 'FAIL'}</b> ${esc(c.id)} — ${esc(c.name || '')} · ${esc((c.modes || []).join(', '))}${c.errors.map(e => `<br><span style="color:var(--red)">error: ${esc(e)}</span>`).join('')}${c.warnings.map(w => `<br><span class="note">warning: ${esc(w)}</span>`).join('')}</li>`).join('');
  el.innerHTML = `
    <h3>${r.ok ? `Model <code>${esc(r.modelId)}</code> was added` : r.modelId ? `Model <code>${esc(r.modelId)}</code> was written but needs attention` : 'No new model file was created'}</h3>
    <p class="note">Changed files: ${r.changed.length ? r.changed.map(f => `<code>${esc(f)}</code>`).join(', ') : 'none'}${r.cost != null ? ` · API cost reported by the CLI: $${r.cost.toFixed(2)}` : ''}</p>
    <h3>Validator</h3><ul>${check}</ul>
    <h3>Agent summary</h3><pre>${esc(r.summary || '(none)')}</pre>
    <div class="bar">
      ${r.modelId ? `<a class="btn acc" href="index.html?model=${esc(r.modelId)}" target="wmh-sim">🔦 Open in the simulator</a>` : ''}
      ${r.changed.length ? '<button class="btn" id="discard">↩ Discard these changes</button>' : ''}
      <span class="note">Nothing is committed. Keep the files and commit them yourself, or discard them.</span>
    </div>`;
  const d = $('#discard');
  if (d) d.addEventListener('click', async () => { if (!confirm('Delete the new model file and restore the changed files?')) return; try { const x = await post('discard', {}); log('info', `Discarded: ${x.undone.join(', ') || 'nothing'}`); d.disabled = true; state('Changes discarded'); } catch (e) { log('err', e.message); } });
}
init();
