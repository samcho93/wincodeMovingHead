// editor/ui.js — small DOM helpers shared by the editor views
/** h('div', { class: 'x', onclick: fn, dataset: {…} }, child, 'text', [more]) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') el[k] = v; else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const clear = el => { while (el.firstChild) el.firstChild.remove(); return el; };
/** replace the content of el; null / false children are skipped (conditional parts of a view) */
export const fill = (el, ...kids) => { clear(el); for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k); return el; };
export const select = (opts, value, onchange, props = {}) => {
  const el = h('select', { ...props, onchange: e => onchange && onchange(e.target.value) }, opts.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h('option', { value: String(v) }, t); }));
  el.value = String(value ?? ''); return el;
};
export const numInput = (value, min, max, onchange, props = {}) => h('input', { type: 'number', min, max, value, ...props, onchange: e => { const v = Math.min(max, Math.max(min, +e.target.value || 0)); e.target.value = v; onchange(v); } });
export const textInput = (value, onchange, props = {}) => h('input', { type: 'text', value, ...props, onchange: e => onchange(e.target.value) });
/** seconds field bound to a millisecond value */
export const secInput = (ms, onchange, props = {}) => h('input', { type: 'number', min: -1, max: 3600, step: 0.1, value: (ms / 1000).toFixed(1), style: 'width:70px', ...props, onchange: e => onchange(Math.round((+e.target.value || 0) * 1000)) });
export const fmtTime = ms => { const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };

/** Modal dialog. build(body, close) fills it; returns the close function */
export function dialog(title, build, buttons = []) {
  const back = h('div', { class: 'dlg-back' }), close = () => back.remove(), body = h('div');
  const box = h('div', { class: 'dlg' }, h('h3', null, title), body, h('div', { class: 'btns' }, buttons.map(([label, fn, cls]) => h('button', { class: 'btn ' + (cls || ''), onclick: () => { if (fn() !== false) close(); } }, label)), h('button', { class: 'btn', onclick: close }, 'Cancel')));
  back.append(box); back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  build(body, close); document.body.append(back); return close;
}
export const TYPE_ICON = { scene: '🎬', chaser: '⏭', efx: '➰', collection: '🗂', audio: '🎵', show: '🎞' };
export const TYPE_NAME = { scene: 'Scene', chaser: 'Chaser', efx: 'EFX', collection: 'Collection', audio: 'Audio', show: 'Show' };
