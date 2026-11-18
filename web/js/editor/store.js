// editor/store.js — the workspace (what QLC+ calls a project): universes, patched fixtures, functions, virtual console.
//  Saved as JSON (file download / upload) and autosaved to localStorage. Audio files live in IndexedDB, keyed by name.
const LS = 'wmh.editor.workspace.v1';
export const MAX_UNIVERSES = 32;

export function blankWorkspace() {
  return {
    app: 'wmh-dmx-editor', version: 1, name: 'New workspace', nextId: 1,
    universes: [1, 2, 3, 4].map(n => ({ name: `Universe ${n}`, out: n === 1 ? 'cable' : 'none', outUniverse: n - 1, host: '127.0.0.1' })),
    fixtures: [],        // { id, name, def, mode, universe (0-based), address (1-based) }
    functions: [],       // { id, type, name, … } — see engine.js for the fields of each type
    vc: { widgets: [] }, // virtual console
  };
}

export const store = {
  ws: blankWorkspace(), listeners: new Set(), dirty: false,
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  /** what: 'fixtures' | 'functions' | 'function:<id>' | 'universes' | 'vc' | 'workspace' */
  emit(what) { this.dirty = true; this.listeners.forEach(f => f(what)); clearTimeout(this._t); this._t = setTimeout(() => this.autosave(), 600); },
  id() { return this.ws.nextId++; },
  fixture(id) { return this.ws.fixtures.find(f => f.id === id); },
  fn(id) { return this.ws.functions.find(f => f.id === id); },
  autosave() { try { localStorage.setItem(LS, JSON.stringify(this.ws)); } catch (e) {} },
  restore() { try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j && j.app === 'wmh-dmx-editor') { this.ws = Object.assign(blankWorkspace(), j); return true; } } catch (e) {} return false; },
  load(json) { if (!json || json.app !== 'wmh-dmx-editor') throw new Error('Not a DMX editor workspace file'); this.ws = Object.assign(blankWorkspace(), json); this.emit('workspace'); },
  reset() { this.ws = blankWorkspace(); this.emit('workspace'); },
  download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(this.ws, null, 1)], { type: 'application/json' }));
    a.download = (this.ws.name || 'workspace').replace(/[^\w.-]+/g, '_') + '.wmx.json'; a.click(); URL.revokeObjectURL(a.href); this.dirty = false;
  },
};

/* ── audio files (IndexedDB) ── */
let dbP = null;
const db = () => dbP || (dbP = new Promise((res, rej) => { const r = indexedDB.open('wmh-editor', 1); r.onupgradeneeded = () => r.result.createObjectStore('audio'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('audio', mode), rq = fn(t.objectStore('audio')); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
export const audioFiles = {
  put: (name, blob) => tx('readwrite', s => s.put(blob, name)),
  get: name => tx('readonly', s => s.get(name)),
  names: () => tx('readonly', s => s.getAllKeys()),
  del: name => tx('readwrite', s => s.delete(name)),
};
