// editor/functions.js — Function Manager: create and edit Scenes, Chasers, EFX, Collections and Audio
import { store, audioFiles } from './store.js';
import { getDef, modeOf } from './library.js';
import { EFX_ALGOS, efxPoint, audioEl, durationOf, forgetAudio } from './engine.js';
import { h, clear, fill, select, numInput, textInput, secInput, dialog, TYPE_ICON, TYPE_NAME, fmtTime } from './ui.js';

const NEW = {
  scene: () => ({ values: {}, fadeIn: 0, fadeOut: 0, rev: 0 }),
  chaser: () => ({ steps: [], order: 'loop', direction: 'forward' }),
  efx: () => ({ fixtures: [], algo: 'Circle', width: 60, height: 60, xOffset: 127, yOffset: 127, rotation: 0, duration: 4000, spread: 0, direction: 'forward' }),
  collection: () => ({ members: [] }),
  audio: () => ({ file: '', volume: 100 }),
  show: () => ({ tracks: [{ name: 'Track 1', mute: false, solo: false, items: [] }] }),
};
export function newFunction(type, name) {
  const fn = Object.assign({ id: store.id(), type, name: name || `${TYPE_NAME[type]} ${store.ws.functions.filter(f => f.type === type).length + 1}` }, NEW[type]());
  store.ws.functions.push(fn); store.emit('functions'); return fn;
}
/** remove a function and every reference to it */
export function deleteFunction(id) {
  const ws = store.ws; ws.functions = ws.functions.filter(f => f.id !== id);
  for (const f of ws.functions) {
    if (f.steps) f.steps = f.steps.filter(s => s.fn !== id);
    if (f.members) f.members = f.members.filter(m => m !== id);
    if (f.tracks) f.tracks.forEach(t => { t.items = t.items.filter(i => i.fn !== id); });
  }
  ws.vc.widgets.forEach(w => { if (w.fn === id) w.fn = null; });
  store.emit('functions');
}
/** dialog: pick functions (multi-select) of the given types */
export function pickFunctions(title, types, exclude, onPick) {
  const picked = new Set();
  dialog(title, body => {
    const list = store.ws.functions.filter(f => types.includes(f.type) && f.id !== exclude);
    body.append(list.length ? h('div', null, list.map(f => h('label', { class: 'fnrow' }, h('input', { type: 'checkbox', onchange: e => (e.target.checked ? picked.add(f.id) : picked.delete(f.id)) }), TYPE_ICON[f.type], h('span', { class: 'nm' }, f.name))))
      : h('p', { class: 'muted' }, 'No suitable functions yet.'));
  }, [['Add', () => onPick([...picked]), 'acc']]);
}

export function mountFunctions(app, root) {
  const { engine } = app;
  root.classList.add('split');
  const side = h('div', { class: 'side' }), work = h('div', { class: 'work' });
  root.append(side, work);
  let sel = null, live = true, raf = 0;
  const touch = fn => { fn.rev = (fn.rev || 0) + 1; store.emit('function:' + fn.id); };

  function drawSide() {
    clear(side);
    for (const type of ['scene', 'chaser', 'efx', 'collection', 'audio']) {
      side.append(h('h4', null, `${TYPE_ICON[type]} ${TYPE_NAME[type]}s`, h('button', { class: 'btn sm', title: `New ${TYPE_NAME[type]}`, onclick: () => { sel = newFunction(type).id; show(); } }, '＋')));
      for (const f of store.ws.functions.filter(x => x.type === type)) {
        side.append(h('div', { class: 'fnrow' + (f.id === sel ? ' sel' : ''), onclick: () => { sel = f.id; show(); } },
          h('button', { class: 'run' + (engine.isRunning(f.id) ? ' on' : ''), title: 'Run / stop', onclick: e => { e.stopPropagation(); engine.toggle(f.id); } }, engine.isRunning(f.id) ? '■' : '▶'),
          h('span', { class: 'nm' }, f.name)));
      }
    }
  }
  const header = fn => h('div', { class: 'row' },
    h('b', null, `${TYPE_ICON[fn.type]} ${TYPE_NAME[fn.type]}`),
    textInput(fn.name, v => { fn.name = v; store.emit('functions'); }),
    h('button', { class: 'tb' + (engine.isRunning(fn.id) ? ' on' : ''), onclick: () => { engine.toggle(fn.id); show(); } }, engine.isRunning(fn.id) ? '■ Stop' : '▶ Run'),
    h('button', { class: 'tb', title: 'Duplicate', onclick: () => { const c = JSON.parse(JSON.stringify(fn)); c.id = store.id(); c.name += ' copy'; store.ws.functions.push(c); sel = c.id; store.emit('functions'); show(); } }, '⧉ Copy'),
    h('button', { class: 'tb danger', onclick: () => { engine.stop(fn.id, false); deleteFunction(fn.id); sel = null; show(); } }, '✕ Delete'));

  /* ── Scene ── */
  function sceneEditor(fn) {
    const ws = store.ws, inScene = Object.keys(fn.values).map(Number).filter(id => store.fixture(id));
    const preview = () => { if (live && !engine.isRunning(fn.id)) engine.start(fn.id, { fadeIn: 0 }); };
    const blocks = inScene.map(fid => {
      const fx = store.fixture(fid), d = getDef(fx.def), m = modeOf(fx), vals = fn.values[fid];
      const strips = m.channels.map((c, ci) => {
        const on = ci in vals, v = vals[ci] ?? 0;
        const ds = h('div', { class: 'ds' }, on ? d.describe(c.key, v) : ''), nu = h('input', { type: 'number', min: 0, max: 255, value: v, disabled: !on }), rg = h('input', { type: 'range', min: 0, max: 255, value: v, disabled: !on });
        const strip = h('div', { class: 'strip' + (on ? '' : ' off') + (c.htp ? ' htp' : ''), title: `${c.name} · ${c.htp ? 'HTP' : 'LTP'} · DMX ${fx.address + ci}` });
        const set = x => { const val = Math.min(255, Math.max(0, x | 0)); vals[ci] = val; rg.value = val; nu.value = val; ds.textContent = d.describe(c.key, val); touch(fn); preview(); };
        rg.addEventListener('input', () => set(+rg.value)); nu.addEventListener('change', () => set(+nu.value));
        const cb = h('input', { type: 'checkbox', checked: on, title: 'Include this channel in the scene', onchange: e => { if (e.target.checked) vals[ci] = +rg.value; else delete vals[ci]; touch(fn); preview(); show(); } });
        strip.append(cb, h('div', { class: 'nm' }, c.name), rg, nu, ds); return strip;
      });
      const all = on => { m.channels.forEach((c, ci) => { if (on) vals[ci] = vals[ci] ?? 0; else delete vals[ci]; }); touch(fn); show(); };
      return h('div', { class: 'fxblock' },
        h('div', { class: 'hd' }, h('b', null, `${fx.name}`), h('span', { class: 'muted' }, `${d.model} · ${m.label} · U${fx.universe + 1}.${fx.address}`),
          h('button', { class: 'btn sm', onclick: () => all(true) }, 'All'), h('button', { class: 'btn sm', onclick: () => all(false) }, 'None'),
          h('button', { class: 'btn sm', title: 'Copy these values to the other fixtures of the same type and mode in this scene', onclick: () => { for (const o of inScene) { const of = store.fixture(o); if (o !== fid && of.def === fx.def && of.mode === fx.mode) fn.values[o] = { ...vals }; } touch(fn); show(); } }, 'Copy to same type'),
          h('button', { class: 'btn sm danger', onclick: () => { delete fn.values[fid]; touch(fn); show(); } }, '✕')),
        h('div', { class: 'strips' }, strips));
    });
    return [header(fn),
      h('div', { class: 'row' },
        h('label', null, 'Fade in (s)', secInput(fn.fadeIn, v => { fn.fadeIn = Math.max(0, v); touch(fn); })), h('label', null, 'Fade out (s)', secInput(fn.fadeOut, v => { fn.fadeOut = Math.max(0, v); touch(fn); })),
        h('label', { title: 'Send the scene to the outputs while editing (QLC+: not "blind")' }, h('input', { type: 'checkbox', checked: live, onchange: e => { live = e.target.checked; if (!live) engine.stop(fn.id, false); else preview(); } }), 'Live edit'),
        h('button', { class: 'tb', onclick: () => { const free = ws.fixtures.filter(f => !(f.id in fn.values)); if (!free.length) return alert('All patched fixtures are already in this scene.');
          const picked = new Set(); dialog('Add fixtures to the scene', body => body.append(free.map(f => h('label', { class: 'fnrow' }, h('input', { type: 'checkbox', onchange: e => (e.target.checked ? picked.add(f.id) : picked.delete(f.id)) }), h('span', { class: 'nm' }, `${f.name} — U${f.universe + 1}.${f.address}`)))),
            [['Add', () => { picked.forEach(id => { fn.values[id] = {}; }); touch(fn); show(); }, 'acc'], ['Add all', () => { free.forEach(f => { fn.values[f.id] = {}; }); touch(fn); show(); }]]); } }, '＋ Fixtures')),
      blocks.length ? blocks : h('p', { class: 'muted' }, ws.fixtures.length ? 'Add fixtures to this scene, tick the channels it should control and set their values.' : 'Patch fixtures first (Fixtures tab).')];
  }

  /* ── Chaser ── */
  function chaserEditor(fn) {
    const total = durationOf(fn), r = engine.runner(fn.id);
    return [header(fn),
      h('div', { class: 'row' },
        h('label', null, 'Run order', select([['loop', 'Loop'], ['single', 'Single shot'], ['pingpong', 'Ping pong']], fn.order, v => { fn.order = v; touch(fn); })),
        h('label', null, 'Direction', select([['forward', 'Forward'], ['backward', 'Backward']], fn.direction, v => { fn.direction = v; touch(fn); })),
        h('button', { class: 'tb', onclick: () => pickFunctions('Add steps', ['scene', 'chaser', 'efx', 'collection', 'audio'], fn.id, ids => { ids.forEach(id => fn.steps.push({ fn: id, fadeIn: 0, hold: 1000, fadeOut: 0 })); touch(fn); show(); }) }, '＋ Steps'),
        h('span', { class: 'muted' }, `${fn.steps.length} steps · ${fmtTime(total)} per cycle · hold −1 = wait for a manual step (cue list)`)),
      h('table', { class: 'grid' },
        h('thead', null, h('tr', null, ['#', 'Function', 'Fade in (s)', 'Hold (s)', 'Fade out (s)', ''].map(t => h('th', null, t)))),
        h('tbody', null, fn.steps.map((st, i) => { const f = store.fn(st.fn); const mv = d => { const j = i + d; if (j < 0 || j >= fn.steps.length) return; [fn.steps[i], fn.steps[j]] = [fn.steps[j], fn.steps[i]]; touch(fn); show(); };
          return h('tr', { class: r && r.i === i ? 'sel' : '' }, h('td', null, i + 1), h('td', null, f ? `${TYPE_ICON[f.type]} ${f.name}` : '(deleted)'),
            h('td', null, secInput(st.fadeIn, v => { st.fadeIn = Math.max(0, v); touch(fn); })), h('td', null, secInput(st.hold, v => { st.hold = v; touch(fn); })), h('td', null, secInput(st.fadeOut, v => { st.fadeOut = Math.max(0, v); touch(fn); })),
            h('td', null, h('button', { class: 'btn sm', onclick: () => mv(-1) }, '▲'), ' ', h('button', { class: 'btn sm', onclick: () => mv(1) }, '▼'), ' ', h('button', { class: 'btn sm danger', onclick: () => { fn.steps.splice(i, 1); touch(fn); show(); } }, '✕'))); })))];
  }

  /* ── EFX ── */
  function efxEditor(fn) {
    const cv = h('canvas', { width: 260, height: 260, style: 'background:#0a0c0f;border:1px solid var(--line);border-radius:8px' }), g = cv.getContext('2d');
    const draw = () => {
      if (!cv.isConnected) return; raf = requestAnimationFrame(draw);
      g.clearRect(0, 0, 260, 260); g.strokeStyle = '#262c33'; g.strokeRect(2.5, 2.5, 255, 255);
      const rot = fn.rotation * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
      const pt = p => { const [x0, y0] = efxPoint(fn.algo, p, fn), x = x0 * cr - y0 * sr, y = x0 * sr + y0 * cr; return [2 + fn.xOffset + x * fn.width, 258 - (fn.yOffset + y * fn.height)]; };
      g.strokeStyle = '#f0923a'; g.beginPath(); for (let i = 0; i <= 200; i++) { const [x, y] = pt(i / 200); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
      const n = fn.fixtures.length || 1, t = performance.now() / Math.max(100, fn.duration) * (fn.direction === 'backward' ? -1 : 1);
      for (let i = 0; i < n; i++) { const [x, y] = pt((((t + (i / n) * fn.spread / 360) % 1) + 1) % 1); g.fillStyle = '#4fd1d9'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    };
    cancelAnimationFrame(raf); requestAnimationFrame(draw);
    const N = (label, key, min, max) => h('label', null, label, numInput(fn[key], min, max, v => { fn[key] = v; touch(fn); }));
    const heads = store.ws.fixtures.flatMap(f => (modeOf(f)?.heads || []).map((hd, hi) => ({ fx: f.id, head: hi, label: `${f.name}${(modeOf(f).heads.length > 1) ? ` · head ${hi + 1}` : ''}` })));
    const has = r => fn.fixtures.some(x => x.fx === r.fx && x.head === r.head);
    return [header(fn),
      h('div', { class: 'row', style: 'align-items:flex-start' }, cv,
        h('div', null,
          h('div', { class: 'row' }, h('label', null, 'Pattern', select(EFX_ALGOS, fn.algo, v => { fn.algo = v; touch(fn); })), h('label', null, 'Direction', select([['forward', 'Forward'], ['backward', 'Backward']], fn.direction, v => { fn.direction = v; touch(fn); }))),
          h('div', { class: 'row' }, N('Width', 'width', 0, 127), N('Height', 'height', 0, 127), N('Rotation °', 'rotation', 0, 359)),
          h('div', { class: 'row' }, N('X offset (pan)', 'xOffset', 0, 255), N('Y offset (tilt)', 'yOffset', 0, 255)),
          h('div', { class: 'row' }, h('label', null, 'Duration (s)', secInput(fn.duration, v => { fn.duration = Math.max(100, v); touch(fn); })), N('Spread °', 'spread', 0, 360)),
          h('p', { class: 'muted' }, 'Writes pan / tilt (16 bit) for every head listed below. Spread offsets the heads along the path.'))),
      h('div', { class: 'row' }, h('b', null, 'Fixtures / heads'), h('button', { class: 'btn sm', onclick: () => { fn.fixtures = heads.map(r => ({ fx: r.fx, head: r.head })); touch(fn); show(); } }, 'All'), h('button', { class: 'btn sm', onclick: () => { fn.fixtures = []; touch(fn); show(); } }, 'None')),
      heads.length ? h('div', null, heads.map(r => h('label', { class: 'fnrow' }, h('input', { type: 'checkbox', checked: has(r), onchange: e => { if (e.target.checked) fn.fixtures.push({ fx: r.fx, head: r.head }); else fn.fixtures = fn.fixtures.filter(x => !(x.fx === r.fx && x.head === r.head)); touch(fn); } }), h('span', { class: 'nm' }, r.label))))
        : h('p', { class: 'muted' }, 'No patched fixture has pan / tilt channels.')];
  }

  /* ── Collection ── */
  const collectionEditor = fn => [header(fn),
    h('div', { class: 'row' }, h('button', { class: 'tb', onclick: () => pickFunctions('Add functions', ['scene', 'chaser', 'efx', 'audio'], fn.id, ids => { ids.forEach(id => { if (!fn.members.includes(id)) fn.members.push(id); }); touch(fn); show(); }) }, '＋ Functions'),
      h('span', { class: 'muted' }, 'A collection starts all of its functions together.')),
    h('div', null, fn.members.map((id, i) => { const f = store.fn(id); return h('div', { class: 'fnrow' }, h('span', { class: 'nm' }, f ? `${TYPE_ICON[f.type]} ${f.name}` : '(deleted)'), h('button', { class: 'btn sm danger', onclick: () => { fn.members.splice(i, 1); touch(fn); show(); } }, '✕')); }))];

  /* ── Audio ── */
  function audioEditor(fn) {
    const info = h('span', { class: 'muted' }, fn.file ? fn.file : 'No file');
    if (fn.file) audioEl(fn.file).then(el => { if (el) { const upd = () => { info.textContent = `${fn.file} · ${isFinite(el.duration) ? fmtTime(el.duration * 1000) : '…'}`; }; upd(); el.addEventListener('loadedmetadata', upd, { once: true }); } else info.textContent = `${fn.file} — file missing: choose it again (audio is stored in this browser, not in the workspace file)`; });
    const pick = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: async e => { const f = e.target.files[0]; if (!f) return; forgetAudio(f.name); await audioFiles.put(f.name, f); fn.file = f.name; if (/^Audio \d+$/.test(fn.name)) fn.name = f.name.replace(/\.\w+$/, ''); touch(fn); store.emit('functions'); show(); } });
    return [header(fn), h('div', { class: 'row' }, h('button', { class: 'tb', onclick: () => pick.click() }, '📂 Choose audio file…'), pick, info),
      h('div', { class: 'row' }, h('label', null, 'Volume %', numInput(fn.volume, 0, 100, v => { fn.volume = v; touch(fn); }))),
      h('p', { class: 'muted' }, 'Add this audio function to a show track (Shows tab) to program lights against the music.')];
  }

  const EDITORS = { scene: sceneEditor, chaser: chaserEditor, efx: efxEditor, collection: collectionEditor, audio: audioEditor };
  let previewId = null;                                         // scene currently sent to the outputs by "Live edit"
  function show() {
    drawSide(); cancelAnimationFrame(raf);
    const fn = store.fn(sel);
    if (previewId != null && previewId !== sel) { engine.stop(previewId, false); previewId = null; }
    fill(work, ...(fn && EDITORS[fn.type] ? [EDITORS[fn.type](fn)].flat() : [h('p', { class: 'muted' }, 'Functions automate DMX values. Create a Scene (static look), a Chaser (steps of functions with fade / hold times), an EFX (pan / tilt movement), a Collection (several functions at once) or an Audio function, then select it to edit.')]));
    if (fn && fn.type === 'scene' && live && !app.operate && !engine.isRunning(fn.id)) { engine.start(fn.id, { fadeIn: 0 }); previewId = fn.id; }
  }
  engine.on(ev => { if (root.classList.contains('active')) { if (ev === 'run') drawSide(); if (ev === 'step') { const fn = store.fn(sel); if (fn && fn.type === 'chaser') show(); } } });
  store.on(w => { if (w === 'functions' && root.classList.contains('active')) drawSide(); });
  const hide = () => { if (previewId != null) { engine.stop(previewId, false); previewId = null; } };
  return { show, hide, reload() { sel = null; }, select(id) { sel = id; } };
}
