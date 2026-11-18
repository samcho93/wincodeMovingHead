// editor/shows.js — Show Manager: a multitrack timeline where functions and audio are placed against time.
//  As in QLC+: pick or create a show, add tracks, add existing functions or audio at the cursor, drag items along
//  their track (snap to grid optional), lock / colour / delete them, mute or solo tracks, play from the cursor.
import { store } from './store.js';
import { audioEl, durationOf } from './engine.js';
import { audioFiles } from './store.js';
import { newFunction, pickFunctions } from './functions.js';
import { h, clear, fill, select, numInput, fmtTime, dialog, TYPE_ICON } from './ui.js';

const HEAD = 150, RULER = 26, TRACK = 56;
const COLORS = ['#3b6ea8', '#2f8f5b', '#a8673b', '#8a4fb0', '#a83b5c', '#3b9aa8', '#8f8a2f'];
const peaksCache = new Map();          // audio file → Float32Array of peaks (one per 20 ms)
async function peaksOf(name) {
  if (peaksCache.has(name)) return peaksCache.get(name);
  peaksCache.set(name, null);
  try {
    const blob = await audioFiles.get(name); if (!blob) return null;
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 44100);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer()), ch = buf.getChannelData(0), step = Math.floor(buf.sampleRate * 0.02), out = new Float32Array(Math.ceil(ch.length / step));
    for (let i = 0; i < out.length; i++) { let m = 0; for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 8) { const v = Math.abs(ch[j]); if (v > m) m = v; } out[i] = m; }
    peaksCache.set(name, out); return out;
  } catch (e) { return null; }
}

export function mountShows(app, root) {
  const { engine } = app;
  root.classList.add('split');
  const wrap = h('div', { id: 'showWrap' }), bar = h('div', { class: 'showbar' }), cv = h('canvas', { id: 'tl', tabIndex: 0 }), g = cv.getContext('2d');
  wrap.append(bar, cv); root.append(wrap);
  let showId = null, cursor = 0, zoom = 60, scroll = 0, selItem = null, selTrack = 0, snap = true, grid = 'time', bpm = 120, drag = null;
  const cur = () => store.fn(showId);
  const shows = () => store.ws.functions.filter(f => f.type === 'show');
  const gridMs = () => (grid === 'time' ? (zoom > 150 ? 100 : zoom > 60 ? 500 : 1000) : 60000 / bpm);
  const x2t = x => Math.max(0, (x - HEAD) / zoom * 1000 + scroll), t2x = t => HEAD + (t - scroll) * zoom / 1000;
  const snapT = t => (snap ? Math.round(t / gridMs()) * gridMs() : Math.round(t));
  const playing = () => showId != null && engine.isRunning(showId);
  const touch = () => store.emit('function:' + showId);

  function addItems(ids) {
    const s = cur(); if (!s) return; const tr = s.tracks[selTrack] || s.tracks[0]; let t = cursor;
    for (const id of ids) { const f = store.fn(id); if (!f) continue; const d = durationOf(f) || 5000; tr.items.push({ fn: id, start: Math.round(t), duration: d, color: COLORS[tr.items.length % COLORS.length], locked: false }); t += d; }
    touch(); draw();
  }
  function drawBar() {
    const s = cur(), list = shows();
    fill(bar, 
      h('button', { class: 'tb', title: 'New show', onclick: () => { showId = newFunction('show').id; selItem = null; selTrack = 0; cursor = 0; drawBar(); draw(); } }, '＋ Show'),
      select(list.length ? list.map(f => [f.id, f.name]) : [['', '(no show)']], showId ?? '', v => { showId = +v || null; selItem = null; cursor = 0; drawBar(); draw(); }),
      s ? h('input', { type: 'text', value: s.name, style: 'width:140px', onchange: e => { s.name = e.target.value; store.emit('functions'); drawBar(); } }) : null,
      h('button', { class: 'tb', disabled: !s, title: 'Add a track', onclick: () => { s.tracks.push({ name: `Track ${s.tracks.length + 1}`, mute: false, solo: false, items: [] }); selTrack = s.tracks.length - 1; touch(); draw(); } }, '＋ Track'),
      h('button', { class: 'tb', disabled: !s, title: 'Add existing functions at the cursor, on the selected track', onclick: () => pickFunctions('Add functions at the cursor', ['scene', 'chaser', 'efx', 'collection'], showId, addItems) }, '＋ Function'),
      h('button', { class: 'tb', disabled: !s, title: 'Add an audio function at the cursor', onclick: () => {
        const au = store.ws.functions.filter(f => f.type === 'audio');
        const file = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: async e => { const f = e.target.files[0]; if (!f) return; await audioFiles.put(f.name, f); const fn = newFunction('audio', f.name.replace(/\.\w+$/, '')); fn.file = f.name; const el = await audioEl(f.name); const go = () => addItems([fn.id]); if (el && !isFinite(el.duration)) el.addEventListener('loadedmetadata', go, { once: true }); else go(); } });
        bar.append(file);
        if (!au.length) return file.click();
        dialog('Add audio', body => body.append(au.map(f => h('div', { class: 'fnrow', onclick: () => { addItems([f.id]); body.closest('.dlg-back').remove(); } }, TYPE_ICON.audio, h('span', { class: 'nm' }, `${f.name} — ${f.file || 'no file'}`)))), [['Load a new file…', () => file.click(), 'acc']]);
      } }, '🎵 Audio'),
      h('button', { class: 'tb danger', disabled: !selItem, title: 'Remove the selected item from the show (Del)', onclick: delItem }, '✕ Item'),
      h('button', { class: 'tb', disabled: !selItem, title: 'Item colour', onclick: () => { selItem.color = COLORS[(COLORS.indexOf(selItem.color) + 1) % COLORS.length]; touch(); draw(); } }, '🎨'),
      h('button', { class: 'tb' + (selItem && selItem.locked ? ' on' : ''), disabled: !selItem, title: 'Lock: a locked item cannot be dragged', onclick: () => { selItem.locked = !selItem.locked; touch(); drawBar(); draw(); } }, '🔒'),
      h('button', { class: 'tb', disabled: !selItem, title: 'Start time and duration of the selected item', onclick: () => { const it = selItem; dialog('Time / duration', body => body.append(h('div', { class: 'form' }, 'Start (s)', h('input', { type: 'number', step: 0.01, value: it.start / 1000, onchange: e => { it.start = Math.max(0, Math.round(+e.target.value * 1000)); } }), 'Duration (s)', h('input', { type: 'number', step: 0.01, value: it.duration / 1000, onchange: e => { it.duration = Math.max(50, Math.round(+e.target.value * 1000)); } }))), [['OK', () => { touch(); draw(); }, 'acc']]); } }, '⏱'),
      h('button', { class: 'tb' + (snap ? ' on' : ''), title: 'Snap to grid', onclick: () => { snap = !snap; drawBar(); } }, '▦ Snap'),
      h('span', { class: 'time' }, fmtTime(cursor)),
      h('button', { class: 'tb' + (playing() ? ' on' : ''), disabled: !s, title: 'Play from the cursor / pause (Space)', onclick: playPause }, playing() ? '❚❚' : '▶'),
      h('button', { class: 'tb', disabled: !s, title: 'Stop. Press again to return to 0', onclick: stop }, '■'),
      select([['time', 'Time'], ['bpm', 'BPM 4/4']], grid, v => { grid = v; drawBar(); draw(); }),
      grid === 'bpm' ? numInput(bpm, 20, 240, v => { bpm = v; draw(); }) : null,
      h('label', { class: 'chk' }, 'Zoom', h('input', { type: 'range', min: 8, max: 400, value: zoom, oninput: e => { zoom = +e.target.value; draw(); } })));
  }
  function playPause() { const s = cur(); if (!s) return; if (playing()) { cursor = engine.runner(showId).t; engine.stop(showId, false); } else engine.start(showId, { offset: cursor }); drawBar(); }
  function stop() { if (playing()) { cursor = engine.runner(showId).t; engine.stop(showId, false); } else cursor = 0; drawBar(); draw(); }
  function delItem() { const s = cur(); if (!s || !selItem) return; s.tracks.forEach(t => { t.items = t.items.filter(i => i !== selItem); }); selItem = null; touch(); drawBar(); draw(); }

  function draw() {
    const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!W || !H) return;
    if (cv.width !== Math.floor(W * dpr) || cv.height !== Math.floor(H * dpr)) { cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.font = '12px "Segoe UI", sans-serif'; g.textBaseline = 'middle';
    const s = cur();
    if (!s) { g.fillStyle = '#8b96a3'; g.fillText('Create a show (＋ Show), add tracks, then place functions and audio on the timeline.', 20, 40); return; }
    if (playing()) { cursor = engine.runner(showId).t; if (t2x(cursor) > W - 60) scroll = cursor - (W - HEAD) * 0.2 / zoom * 1000; }
    // grid + ruler
    const gm = gridMs(), major = grid === 'time' ? (zoom > 60 ? 1000 : zoom > 20 ? 5000 : 10000) : gm * 4;
    for (let t = Math.floor(scroll / gm) * gm; t2x(t) < W; t += gm) { const x = t2x(t); if (x < HEAD) continue; g.strokeStyle = Math.round(t) % major === 0 ? '#2a323b' : '#161b21'; g.beginPath(); g.moveTo(x + 0.5, RULER); g.lineTo(x + 0.5, H); g.stroke(); }
    g.fillStyle = '#101317'; g.fillRect(0, 0, W, RULER); g.fillStyle = '#8b96a3';
    for (let t = Math.floor(scroll / major) * major; t2x(t) < W; t += major) { const x = t2x(t); if (x >= HEAD) { g.fillText(grid === 'time' ? fmtTime(t).slice(0, 5) : String(Math.round(t / major) + 1), x + 4, RULER / 2); g.fillRect(x, RULER - 6, 1, 6); } }
    // tracks
    s.tracks.forEach((tr, ti) => {
      const y = RULER + ti * TRACK;
      g.fillStyle = ti === selTrack ? '#151b22' : '#0d1014'; g.fillRect(HEAD, y, W - HEAD, TRACK - 1);
      for (const it of tr.items) {
        const x = t2x(it.start), w = Math.max(3, it.duration * zoom / 1000); if (x + w < HEAD || x > W) continue;
        const f = store.fn(it.fn);
        g.fillStyle = it.color || COLORS[0]; g.globalAlpha = tr.mute ? 0.35 : 0.9; g.fillRect(x, y + 4, w, TRACK - 9); g.globalAlpha = 1;
        if (f && f.type === 'audio' && f.file) { const pk = peaksCache.get(f.file); if (pk === undefined) peaksOf(f.file).then(draw); else if (pk) { g.fillStyle = 'rgba(255,255,255,.55)'; const mid = y + TRACK / 2, hh = (TRACK - 14) / 2; for (let px = Math.max(HEAD, x); px < Math.min(W, x + w); px++) { const i = Math.floor((px - x) / zoom * 50); if (i >= pk.length) break; const a = pk[i] * hh; g.fillRect(px, mid - a, 1, a * 2); } } }
        g.save(); g.beginPath(); g.rect(Math.max(HEAD, x), y + 4, w, TRACK - 9); g.clip(); g.fillStyle = '#fff'; g.fillText(`${f ? TYPE_ICON[f.type] + ' ' + f.name : '(deleted)'}${it.locked ? ' 🔒' : ''}`, Math.max(HEAD, x) + 5, y + 15); g.restore();
        if (it === selItem) { g.strokeStyle = '#f0923a'; g.lineWidth = 2; g.strokeRect(x + 1, y + 5, w - 2, TRACK - 11); g.lineWidth = 1; }
      }
      // header: name, mute, solo
      g.fillStyle = ti === selTrack ? '#1a2532' : '#14181d'; g.fillRect(0, y, HEAD - 1, TRACK - 1);
      g.fillStyle = '#e8ecf0'; g.fillText(tr.name, 8, y + 16);
      const btn = (label, x, on, col) => { g.fillStyle = on ? col : '#262c33'; g.fillRect(x, y + 30, 24, 18); g.fillStyle = '#fff'; g.fillText(label, x + 8, y + 39); };
      btn('M', 8, tr.mute, '#a83b3b'); btn('S', 38, tr.solo, '#a8873b'); btn('✕', 118, false, '#262c33');
    });
    // cursor
    const cx = t2x(cursor); if (cx >= HEAD) { g.strokeStyle = '#e8c547'; g.beginPath(); g.moveTo(cx + 0.5, 0); g.lineTo(cx + 0.5, H); g.stroke(); g.fillStyle = '#e8c547'; g.beginPath(); g.moveTo(cx - 5, 0); g.lineTo(cx + 6, 0); g.lineTo(cx + 0.5, 8); g.fill(); }
    const tm = bar.querySelector('.time'); if (tm) tm.textContent = fmtTime(cursor);
  }
  const hit = (x, y) => {
    const s = cur(); if (!s || y < RULER) return {};
    const ti = Math.floor((y - RULER) / TRACK), tr = s.tracks[ti]; if (!tr) return {};
    if (x < HEAD) return { ti, tr, head: true, btn: y - RULER - ti * TRACK >= 30 ? (x >= 8 && x < 32 ? 'mute' : x >= 38 && x < 62 ? 'solo' : x >= 118 && x < 142 ? 'del' : null) : null };
    const t = x2t(x), it = [...tr.items].reverse().find(i => t >= i.start && t <= i.start + i.duration);
    return { ti, tr, it, edge: it && t2x(it.start + it.duration) - x < 7 };
  };
  cv.addEventListener('pointerdown', e => {
    cv.focus(); const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, s = cur(); if (!s) return;
    const hh = hit(x, y);
    if (hh.ti != null) selTrack = hh.ti;
    if (hh.head) {
      if (hh.btn === 'mute') hh.tr.mute = !hh.tr.mute; else if (hh.btn === 'solo') hh.tr.solo = !hh.tr.solo;
      else if (hh.btn === 'del') { if (s.tracks.length > 1 && (!hh.tr.items.length || confirm(`Delete "${hh.tr.name}" and its items?`))) { s.tracks.splice(hh.ti, 1); selTrack = 0; selItem = null; } }
      else if (e.detail === 2) { const n = prompt('Track name', hh.tr.name); if (n) hh.tr.name = n; }
      touch(); drawBar(); draw(); return;
    }
    if (hh.it) { selItem = hh.it; if (!hh.it.locked) drag = { it: hh.it, mode: hh.edge ? 'size' : 'move', x0: x, start: hh.it.start, dur: hh.it.duration }; }
    else { selItem = null; if (x >= HEAD) { cursor = snapT(x2t(x)); if (playing()) engine.start(showId, { offset: cursor }); } drag = x >= HEAD ? { mode: 'cursor' } : null; }
    cv.setPointerCapture(e.pointerId); drawBar(); draw();
  });
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!drag) { const hh = hit(x, y); cv.style.cursor = hh.it ? (hh.it.locked ? 'not-allowed' : hh.edge ? 'ew-resize' : 'grab') : 'default'; return; }
    if (drag.mode === 'cursor') cursor = snapT(x2t(x));
    else { const dt = (x - drag.x0) / zoom * 1000; if (drag.mode === 'move') drag.it.start = Math.max(0, snapT(drag.start + dt)); else drag.it.duration = Math.max(50, snapT(drag.start + drag.dur + dt) - drag.it.start); }
    draw();
  });
  cv.addEventListener('pointerup', () => { if (drag && drag.it) touch(); drag = null; });
  cv.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey) zoom = Math.min(400, Math.max(8, zoom * (e.deltaY < 0 ? 1.15 : 0.87))); else scroll = Math.max(0, scroll + (e.deltaY + e.deltaX) / zoom * 1000); draw(); }, { passive: false });
  cv.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); playPause(); } else if (e.key === 'Delete') delItem(); });
  new ResizeObserver(draw).observe(cv);
  engine.on(ev => { if (ev === 'run' && root.classList.contains('active')) drawBar(); });

  return {
    show() { if (!cur()) showId = shows()[0]?.id ?? null; drawBar(); draw(); },
    fast() { if (playing()) draw(); },
    reload() { showId = null; selItem = null; cursor = 0; scroll = 0; },
  };
}
