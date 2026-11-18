// editor/vc.js — Virtual Console: a free-form surface of widgets for running the show.
//  Design mode: add, move, resize and configure widgets. Operate mode: the widgets are live.
//   Button   toggles a function (or flashes it while held)
//   Slider   playback (function intensity — starts it above 0), or grand master
//   Cue list steps through a chaser by hand (Go / Back / Stop)
//   Label    text
import { store } from './store.js';
import { h, clear, select, textInput, TYPE_ICON } from './ui.js';

const DEFAULTS = {
  button: { w: 110, h: 70, caption: 'Button', fn: null, action: 'toggle' },
  slider: { w: 70, h: 220, caption: 'Slider', fn: null, mode: 'playback', value: 0 },
  cuelist: { w: 240, h: 260, caption: 'Cue list', fn: null },
  label: { w: 160, h: 40, caption: 'Label' },
};

export function mountVC(app, root) {
  const { engine } = app;
  const area = h('div', { id: 'vcArea' }), props = h('div', { id: 'vcProps' });
  root.style.padding = '0'; root.append(h('div', { id: 'vcWrap' }, area, props));
  let sel = null;
  const W = () => store.ws.vc.widgets, touch = () => store.emit('vc');
  const fnOpts = types => [['', '(none)'], ...store.ws.functions.filter(f => types.includes(f.type)).map(f => [f.id, `${TYPE_ICON[f.type]} ${f.name}`])];

  function add(type) { const w = Object.assign({ id: store.id(), type, x: 20 + (W().length % 6) * 30, y: 20 + (W().length % 6) * 30 }, DEFAULTS[type]); W().push(w); sel = w.id; touch(); show(); }
  function drawProps() {
    clear(props);
    props.append(h('h3', null, 'Add widget'), h('div', { class: 'row' }, ['button', 'slider', 'cuelist', 'label'].map(t => h('button', { class: 'btn sm', onclick: () => add(t) }, '＋ ' + t[0].toUpperCase() + t.slice(1)))));
    const w = W().find(x => x.id === sel);
    if (!w) { props.append(h('p', { class: 'muted' }, 'Select a widget to edit it. Drag to move, drag the corner to resize. Switch to Operate (top bar) to use the console.')); return; }
    const all = ['scene', 'chaser', 'efx', 'collection', 'audio', 'show'];
    props.append(h('h3', null, w.type[0].toUpperCase() + w.type.slice(1)),
      h('div', { class: 'form', style: 'display:grid;grid-template-columns:70px 1fr;gap:6px;align-items:center' },
        'Caption', textInput(w.caption, v => { w.caption = v; touch(); show(); }),
        ...(w.type === 'button' ? ['Function', select(fnOpts(all), w.fn ?? '', v => { w.fn = +v || null; const f = store.fn(w.fn); if (f && w.caption === 'Button') w.caption = f.name; touch(); show(); }),
          'Action', select([['toggle', 'Toggle on / off'], ['flash', 'Flash while held']], w.action, v => { w.action = v; touch(); })] : []),
        ...(w.type === 'slider' ? ['Mode', select([['playback', 'Playback (function intensity)'], ['gm', 'Grand master']], w.mode, v => { w.mode = v; touch(); show(); }),
          ...(w.mode === 'playback' ? ['Function', select(fnOpts(['scene', 'chaser', 'collection']), w.fn ?? '', v => { w.fn = +v || null; const f = store.fn(w.fn); if (f && w.caption === 'Slider') w.caption = f.name; touch(); show(); })] : [])] : []),
        ...(w.type === 'cuelist' ? ['Chaser', select(fnOpts(['chaser']), w.fn ?? '', v => { w.fn = +v || null; touch(); show(); })] : [])),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn sm danger', onclick: () => { store.ws.vc.widgets = W().filter(x => x.id !== w.id); sel = null; touch(); show(); } }, '✕ Delete widget')));
  }
  function body(w) {
    const f = store.fn(w.fn);
    if (w.type === 'button') return [h('span', { class: 'cap' }, w.caption), h('span', { class: 'val' }, f ? '' : 'no function')];
    if (w.type === 'label') return [w.caption];
    if (w.type === 'slider') {
      const val = h('span', { class: 'val' }, '0%');
      const sl = h('input', { type: 'range', min: 0, max: 100, value: w.mode === 'gm' ? Math.round(engine.gm * 100) : w.value || 0, disabled: !app.operate, oninput: e => {
        const v = +e.target.value; val.textContent = v + '%';
        if (w.mode === 'gm') { engine.gm = v / 100; const g = document.querySelector('#gm'); if (g) { g.value = v; document.querySelector('#gmVal').textContent = v + '%'; } return; }
        w.value = v; if (!w.fn) return;
        if (v > 0) { const r = engine.runner(w.fn) && engine.isRunning(w.fn) ? engine.runner(w.fn) : engine.start(w.fn, { intensity: v / 100 }); if (r) r.intensity = v / 100; } else engine.stop(w.fn);
      } });
      val.textContent = sl.value + '%';
      return [h('span', { class: 'cap' }, w.caption), sl, val];
    }
    if (w.type === 'cuelist') {
      const r = w.fn && engine.runner(w.fn), go = d => { if (!w.fn) return; const cur = engine.isRunning(w.fn) && engine.runner(w.fn); if (cur && cur.advance) (d > 0 ? cur.next() : cur.prev()); else engine.start(w.fn, { manual: true }); };
      return [h('span', { class: 'cap' }, w.caption + (f ? ` — ${f.name}` : '')),
        h('div', { class: 'cues' }, f ? f.steps.map((st, i) => h('div', { class: 'cue' + (r && !r.done && r.i === i ? ' cur' : '') }, `${i + 1}. ${store.fn(st.fn)?.name || '(deleted)'}`)) : 'no chaser'),
        h('div', { class: 'row', style: 'margin:4px 0 0;justify-content:center' }, h('button', { class: 'btn sm', disabled: !app.operate, onclick: () => go(-1) }, '◀ Back'), h('button', { class: 'btn sm acc', disabled: !app.operate, onclick: () => go(1) }, 'GO ▶'), h('button', { class: 'btn sm', disabled: !app.operate, onclick: () => w.fn && engine.stop(w.fn) }, '■'))];
    }
    return [];
  }
  function show() {
    clear(area);
    for (const w of W()) {
      const el = h('div', { class: `vcw ${w.type}` + (w.id === sel && !app.operate ? ' sel' : '') + (w.type === 'button' && w.fn && engine.isRunning(w.fn) ? ' on' : ''), style: `left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px` }, body(w), h('div', { class: 'grip' }));
      el.addEventListener('pointerdown', e => {
        if (app.operate) {
          if (w.type === 'button' && w.fn) { if (w.action === 'flash') { engine.start(w.fn); const up = () => { engine.stop(w.fn); removeEventListener('pointerup', up); }; addEventListener('pointerup', up); } else engine.toggle(w.fn); }
          return;
        }
        if (['INPUT', 'BUTTON', 'SELECT'].includes(e.target.tagName)) return;
        sel = w.id; const size = e.target.classList.contains('grip'), x0 = e.clientX, y0 = e.clientY, o = { x: w.x, y: w.y, w: w.w, h: w.h };
        document.querySelectorAll('.vcw.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); drawProps();
        const move = ev => { const dx = ev.clientX - x0, dy = ev.clientY - y0, sn = v => Math.round(v / 10) * 10;
          if (size) { w.w = Math.max(40, sn(o.w + dx)); w.h = Math.max(30, sn(o.h + dy)); } else { w.x = Math.max(0, sn(o.x + dx)); w.y = Math.max(0, sn(o.y + dy)); }
          el.style.cssText = `left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px`; };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); touch(); };
        addEventListener('pointermove', move); addEventListener('pointerup', up); e.preventDefault();
      });
      area.append(el);
    }
    if (!W().length) area.append(h('p', { class: 'muted', style: 'padding:20px' }, 'The virtual console is empty. Add buttons, sliders and cue lists from the panel on the right, then switch to Operate to run them.'));
    drawProps();
  }
  // redraw on run/step changes — but never while a slider is being dragged (the redraw would replace it mid-drag)
  engine.on(ev => { const a = document.activeElement; if ((ev === 'run' || ev === 'step') && root.classList.contains('active') && !(a && a.type === 'range' && area.contains(a))) show(); });
  return { show, reload() { sel = null; } };
}
