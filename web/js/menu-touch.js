// menu-touch.js — panel type 'touch': touch TFT (320×240) + rotary encoder with push button.
//  Used by models whose definition has panel.type = 'touch' (first: WOP-LM500WF, manual chapter 2, figures 3–6).
//  Main screen: title, six function buttons, status bar. Each button opens a page; the column on the left switches pages.
//   Touch:   tap a tab / item. Boolean and list items change at once, key items ask "SURE", numbers open the value dialog
//            (slider, ▲▼, apply = try without leaving, ⏎ = save and quit).
//   Encoder: turn = move / change value, press = select / save. BACK leaves a dialog or page.
//  Same interface as menu.js: canvas, key(), touch(), draw(), home(), asleep, lastKey, dirty, keyLabels.

const ZH = {
  'Address': '地址', 'WorkMode': '模式', 'Display': '显示', 'Scene': '场景', 'Advanced': '高级', 'Status': '状态',
  'DMX Address': 'DMX地址', 'Channel mode': '通道模式', 'Previous': '上一个', 'Next': '下一个', 'Fixture reset': '灯具复位',
  'DMX Ctrl': 'DMX控制', 'Auto Run': '自动运行', 'Sound Ctrl': '声控', 'Scene Mode': '场景模式', 'M/S Choose': '主从选择', 'Lamp Switch': '光源开关',
  'Language': '语言', 'Screen saver': '屏幕保护', 'Screen Rot': '屏幕旋转', 'DMX Indicate': '信号指示', 'Signal Bright': '指示亮度', 'Screen Light': '屏幕亮度', 'Touch Enable': '触摸开关',
  'Scene Select': '场景选择', 'Scene Time': '场景时间', 'Pan Invert': 'X轴反向', 'Tilt Invert': 'Y轴反向', 'P/T Rectify': 'XY纠正', 'Pan Offset': 'X轴偏移', 'Tilt Offset': 'Y轴偏移',
  'Data hold': '数据保持', 'Lamp mode': '开灯方式', 'Factory Setting': '恢复出厂', 'SURE': '确定', 'CANCEL': '取消', 'apply': '应用',
  'Master': '主机', 'Slave': '从机', 'Auto': '自动', 'ON': '开', 'OFF': '关', 'Manual': '手动', 'Power on': '上电', 'After reset': '复位后', 'Resetting...': '复位中...',
};
const TABS = ['Address', 'WorkMode', 'Display', 'Scene', 'Advanced', 'Status'];
const W = 320, H = 240, TABW = 70, ROWH = 34, ROWS = 7;

export class TouchMenu {
  constructor(fx) {
    this.fx = fx;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.screen = 'home'; this.tab = 0; this.sel = 0; this.dlg = null; this.sceneIdx = 0;
    this.lastKey = performance.now(); this.asleep = false; this.dirty = true; this._sig = ''; this.hits = [];
    this.keyLabels = { up: ['↺', 'TURN ◀'], down: ['↻', 'TURN ▶'], enter: ['●', 'PRESS'], menu: ['↩', 'BACK'] };
  }
  t(s) { return this.fx.settings.lang === 'CH' ? (ZH[s] || s) : s; }

  /** Items of one page (rebuilt on every draw so they always show live values) */
  items(tab) {
    const fx = this.fx, S = fx.settings, M = fx.model, V = M.panel.versions, n = fx.footprint;
    const onoff = (label, key) => ({ label, type: 'enum', opts: [[false, 'OFF'], [true, 'ON']], get: () => S[key], set: v => fx.set(key, v) });
    const list = (label, key, vals) => ({ label, type: 'enum', opts: vals.map(v => [v, String(v)]), get: () => S[key], set: v => fx.set(key, v) });
    const num = (label, key, min, max) => ({ label, type: 'num', min, max, get: () => S[key], set: v => fx.set(key, v) });
    const info = (label, text) => ({ label, type: 'info', text });
    const step = d => () => fx.set('address', Math.min(513 - n, Math.max(1, S.address + d * n)));
    switch (TABS[tab]) {
      case 'Address': return [
        { label: 'DMX Address', type: 'num', min: 1, max: 513 - n, pad: 3, get: () => S.address, set: v => fx.set('address', v) },   // unusable addresses are filtered out
        { label: 'Channel mode', type: 'enum', opts: Object.values(M.modes).map(m => [m.id, m.label]), get: () => S.mode, set: v => fx.set('mode', v) },
        { label: 'Previous', type: 'action', run: step(-1) }, { label: 'Next', type: 'action', run: step(1) },
        { label: 'Fixture reset', type: 'action', confirm: true, run: () => { fx.startReset('panel'); this.home(); } },
      ];
      case 'WorkMode': {
        const radio = (label, mode) => ({ label, type: 'radio', on: () => S.runMode === mode, run: () => fx.set('runMode', mode) });
        const scenes = ['Auto', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        return [radio('DMX Ctrl', 'DMX'), radio('Auto Run', 'AUTO'), radio('Sound Ctrl', 'SOUND'),
          { label: 'Scene Mode', type: 'radio', on: () => S.runMode === 'SCENE', value: () => (S.sceneSel === 'Auto' ? 'Auto' : String(S.sceneSel).padStart(2, '0')),
            run: () => { if (S.runMode !== 'SCENE') fx.set('runMode', 'SCENE'); else fx.set('sceneSel', scenes[(scenes.indexOf(S.sceneSel) + 1) % scenes.length]); } },
          list('M/S Choose', 'msMode', ['Master', 'Slave', 'Auto']),
          { label: 'Lamp Switch', type: 'enum', confirm: true, opts: [[false, 'OFF'], [true, 'ON']], get: () => fx.lampOn, set: v => { fx.lampOn = v; fx.emit('settings'); } },
        ];
      }
      case 'Display': return [
        { label: 'Language', type: 'enum', opts: [['EN', 'English'], ['CH', '中文']], get: () => S.lang, set: v => fx.set('lang', v) },
        list('Screen saver', 'saver', ['OFF', 'Mode1', 'Mode2', 'Mode3']), list('Screen Rot', 'rot', ['OFF', 'ON', 'AUTO']),
        list('DMX Indicate', 'dmxInd', ['Mode1', 'Mode2', 'Mode3']), num('Signal Bright', 'sigBright', 1, 10), num('Screen Light', 'scrLight', 1, 10),
        onoff('Touch Enable', 'touch'),
      ];
      case 'Scene': {
        const sc = S.scenes[this.sceneIdx];
        return [
          { label: 'Scene Select', type: 'num', min: 1, max: 10, get: () => this.sceneIdx + 1, set: v => { this.sceneIdx = v - 1; } },
          { label: 'Scene Time', type: 'num', min: 0, max: 255, fmt: v => (v / 10).toFixed(1) + 's', get: () => sc.time, set: v => { sc.time = v; fx.save(); } },
          ...fx.mode.channels.map((k, i) => ({ label: `${String(i + 1).padStart(2, '0')}.${M.ch[k]}`, type: 'num', min: 0, max: 255, pad: 3, live: true, hint: v => M.describe(k, v),
            get: () => sc.v[k] | 0, set: v => { sc.v[k] = v; fx.save(); } })),
        ];
      }
      case 'Advanced': return [
        onoff('Pan Invert', 'panInvert'), onoff('Tilt Invert', 'tiltInvert'), onoff('P/T Rectify', 'rectify'),
        num('Pan Offset', 'panOffset', 4, 150), num('Tilt Offset', 'tiltOffset', 4, 48), onoff('Data hold', 'dataHold'),
        list('Lamp mode', 'lampMode', ['Power on', 'After reset', 'Manual']),
        { label: 'Factory Setting', type: 'action', confirm: true, run: () => { fx.factoryDefaults(); this.home(); } },
      ];
      default: return [
        info('Device', () => V.device), info('Model', () => V.model), info('Panel', () => V.panel), info('Main Board', () => V.main),
        info('Light Temp', () => `${fx.tempC.toFixed(0)}℃`), info('Panel Temp', () => `${(25 + (fx.tempC - 26) * 0.15).toFixed(0)}℃`),
        info('PAN / TILT', () => `${fx.pan.pos.toFixed(0)}° / ${fx.tilt.pos.toFixed(0)}°`), info('Comm prec', () => '100%'), info('Error Logging', () => '0'),
        info('Light time', () => `${Math.round(fx.settings.totalHours * 60)} min`), info('Total time', () => `${fx.settings.totalHours.toFixed(1)} H`),
      ];
    }
  }

  home() { this.closeDlg(false); this.screen = 'home'; this.sel = 0; this.fx.sceneEdit = null; this.dirty = true; }
  openPage(tab) { this.closeDlg(false); this.screen = 'page'; this.tab = tab; this.sel = 0; this.fx.sceneEdit = TABS[tab] === 'Scene' ? this.sceneIdx : null; this.dirty = true; }
  closeDlg(save) {
    const d = this.dlg; if (!d) return; this.dlg = null;
    if (d.type === 'num') { if (save) d.item.set(d.value); else if (d.applied) d.item.set(d.orig); }
  }
  /** Tap or press on an item */
  activate(it, confirmed = false) {
    if (it.type === 'info') return;
    if (it.confirm && !confirmed) { this.dlg = { type: 'confirm', item: it, yes: true }; return; }
    if (it.type === 'num') this.dlg = { type: 'num', item: it, value: it.get(), orig: it.get(), applied: false };
    else if (it.type === 'enum') { const i = it.opts.findIndex(o => o[0] === it.get()); it.set(it.opts[(i + 1) % it.opts.length][0]); }
    else it.run();
    if (TABS[this.tab] === 'Scene' && this.screen === 'page') this.fx.sceneEdit = this.sceneIdx;
  }
  bump(d, delta) { d.value = Math.min(d.item.max, Math.max(d.item.min, d.value + delta)); if (d.item.live) { d.item.set(d.value); d.applied = true; } }
  wake() { this.lastKey = performance.now(); this.dirty = true; if (this.asleep) { this.asleep = false; return true; } return false; }

  /** key: 'up' (turn left) | 'down' (turn right) | 'enter' (press) | 'menu' (back) */
  key(key, { rep = 0, long = false } = {}) {
    const fx = this.fx; if (!fx.power) return;
    if (this.wake() || fx.resetting) return;
    if (long && key === 'menu') return this.home();
    const dir = key === 'down' ? 1 : key === 'up' ? -1 : 0, d = this.dlg;
    if (d) {
      if (d.type === 'num') { if (dir) this.bump(d, dir * (rep > 40 ? 10 : rep > 12 ? 4 : 1)); else this.closeDlg(key === 'enter'); }
      else if (dir) d.yes = !d.yes;
      else { this.dlg = null; if (key === 'enter' && d.yes) this.activate(d.item, true); }
      if (TABS[this.tab] === 'Scene' && this.screen === 'page') fx.sceneEdit = this.sceneIdx;
      return;
    }
    if (this.screen === 'home') { if (dir) this.sel = (this.sel + dir + 6) % 6; else if (key === 'enter') this.openPage(this.sel); return; }
    const items = this.items(this.tab);
    if (dir) this.sel = (this.sel + dir + items.length) % items.length;
    else if (key === 'enter') this.activate(items[this.sel]);
    else if (key === 'menu') this.home();
  }
  /** Touch at canvas coordinates (0..320, 0..240) */
  touch(x, y) {
    const fx = this.fx; if (!fx.power) return;
    if (this.wake() || fx.resetting || !fx.settings.touch) return;
    if (fx.displayFlipped) { x = W - x; y = H - y; }
    for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]; if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) { h.fn(x, y); this.dirty = true; return; } }
  }

  /** Redraws only when something changed. Returns true if it redrew */
  draw(now) {
    const fx = this.fx, S = fx.settings, g = this.g, idle = now - this.lastKey;
    if (fx.power && S.saver !== 'OFF' && idle > 30000 && !this.asleep && !this.dlg) { this.asleep = true; this.dirty = true; }
    const dim = idle > 10000 ? 1 - S.scrLight / 10 : 0;
    const live = this.screen === 'home' || TABS[this.tab] === 'Status' || this.asleep ? Math.floor(now / 500) : 0;
    const sig = [fx.power, fx.resetting, Math.floor(fx.resetT * 4), fx.dmxSignal, fx.lampOn, fx.displayFlipped, this.asleep, dim, live, fx.rdmAt && now - fx.rdmAt < 5000].join();
    if (!this.dirty && sig === this._sig) return false;
    this._sig = sig; this.dirty = false; this.hits = [];
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (!fx.power) return true;
    if (fx.displayFlipped) g.setTransform(-1, 0, 0, -1, W, H);
    const F = (px, bold = true) => `${bold ? '600 ' : ''}${px}px "Segoe UI", "Malgun Gothic", "Microsoft YaHei", sans-serif`;
    const text = (s, x, y, font, color, align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
    const addr = 'A' + String(S.address).padStart(3, '0');
    const modeName = { DMX: 'DMX Ctrl', AUTO: 'Auto Run', SOUND: 'Sound Ctrl', SCENE: 'Scene Mode' }[S.runMode];
    if (this.asleep) {                                              // screen saver (Display → Screen saver)
      if (S.saver === 'Mode2') text(addr, 10, H - 18, F(20), '#8fb4ff');
      if (S.saver === 'Mode3') { text('WINCODE', W / 2, 90, F(34), '#f0923a', 'center'); text(`${addr}   ${this.t(modeName)}`, W / 2, 140, F(18, false), '#cfe0ff', 'center'); }
      return true;
    }
    g.fillStyle = '#eef2f6'; g.fillRect(0, 0, W, H);
    if (fx.resetting) {
      g.fillStyle = '#1438d6'; g.fillRect(0, 0, W, 38); text(fx.model.lcdTitle, 10, 20, F(18), '#fff');
      text(this.t('Resetting...'), W / 2, 110, F(26), '#1438d6', 'center');
      g.strokeStyle = '#1438d6'; g.strokeRect(40, 150, 240, 16); g.fillStyle = '#19c8e0'; g.fillRect(42, 152, 236 * Math.min(1, fx.resetT / 6.5), 12);
    } else if (this.screen === 'home') {                            // main screen: title · six function buttons · status bar
      g.fillStyle = '#1438d6'; g.fillRect(0, 0, W, 38); text(fx.model.lcdTitle, 10, 20, F(18), '#fff'); text(addr, W - 10, 20, F(18), '#fff', 'right');
      TABS.forEach((name, i) => {
        const x = 10 + (i % 2) * 154, y = 46 + Math.floor(i / 2) * 52, w = 146, h = 46;
        g.fillStyle = i === this.sel ? '#0aa4c8' : '#19c8e0'; g.fillRect(x, y, w, h);
        if (i === this.sel) { g.strokeStyle = '#1438d6'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2); }
        text(this.t(name), x + w / 2, y + h / 2, F(18), '#06222c', 'center');
        this.hits.push({ x, y, w, h, fn: () => this.openPage(i) });
      });
      g.fillStyle = '#d5dbe3'; g.fillRect(0, 206, W, 34);
      g.fillStyle = fx.dmxSignal ? '#12a150' : '#c0392b'; g.beginPath(); g.arc(16, 223, 6, 0, 7); g.fill();
      text(fx.dmxSignal ? 'DMX' : 'NO DMX', 28, 223, F(14), '#222');
      if (fx.rdmAt && now - fx.rdmAt < 5000) text('RDM', 88, 223, F(13), '#1438d6');
      text(`LAMP ${fx.lampOn ? 'ON' : 'OFF'}`, 122, 223, F(13), '#222');
      text(this.t(modeName), 198, 223, F(12, false), '#222'); text('NOR', W - 8, 223, F(14), '#12a150', 'right');
    } else {                                                        // page: tab column + item list
      TABS.forEach((name, i) => {
        const y = i * 40;
        g.fillStyle = i === this.tab ? '#eef2f6' : '#19c8e0'; g.fillRect(0, y + 1, TABW - 2, 38);
        text(this.t(name), (TABW - 2) / 2, y + 20, F(12), '#06222c', 'center');
        this.hits.push({ x: 0, y, w: TABW, h: 40, fn: () => this.openPage(i) });
      });
      const items = this.items(this.tab), first = Math.min(Math.max(0, this.sel - 3), Math.max(0, items.length - ROWS));
      for (let r = 0; r < ROWS && first + r < items.length; r++) {
        const i = first + r, it = items[i], y = 1 + r * ROWH, sel = i === this.sel;
        g.fillStyle = sel ? '#b9ecf5' : '#fff'; g.fillRect(TABW, y, W - TABW, ROWH - 2);
        text(this.t(it.label), TABW + 8, y + ROWH / 2 - 1, F(15), '#111');
        let val = '';
        if (it.type === 'num') { const v = it.get(); val = it.fmt ? it.fmt(v) : String(v).padStart(it.pad || 1, '0'); }
        else if (it.type === 'enum') { const o = it.opts.find(o => o[0] === it.get()); val = o ? this.t(o[1]) : ''; }
        else if (it.type === 'radio') val = (it.value ? it.value() + ' ' : '') + (it.on() ? '✓' : '');
        else if (it.type === 'info') val = it.text();
        else val = '▶';
        text(val, W - 8, y + ROWH / 2 - 1, F(15), it.type === 'info' ? '#444' : '#1438d6', 'right');
        this.hits.push({ x: TABW, y, w: W - TABW, h: ROWH, fn: () => { this.sel = i; this.activate(it); } });
      }
      if (items.length > ROWS) { g.fillStyle = '#9aa7b6'; const h = H * ROWS / items.length; g.fillRect(W - 3, (H - h) * first / (items.length - ROWS), 3, h); }
    }
    const d = this.dlg;
    if (d) {                                                        // dialogs (figures 4 and 5)
      this.hits = [{ x: 0, y: 0, w: W, h: H, fn: () => {} }];
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.fillRect(40, 30, 240, 180); g.strokeStyle = '#1438d6'; g.lineWidth = 3; g.strokeRect(40, 30, 240, 180);
      g.fillStyle = '#1438d6'; g.fillRect(40, 30, 240, 26); text(this.t(d.item.label), 50, 44, F(14), '#fff');
      const btn = (label, x, y, w, h, fn) => { g.fillStyle = '#19c8e0'; g.fillRect(x, y, w, h); text(label, x + w / 2, y + h / 2, F(16), '#06222c', 'center'); this.hits.push({ x, y, w, h, fn }); };
      if (d.type === 'num') {
        const it = d.item, x0 = 56, x1 = 264, k = (d.value - it.min) / (it.max - it.min || 1);
        g.strokeStyle = '#1438d6'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, 72); g.lineTo(x1, 72); g.stroke();
        g.fillStyle = '#e83e8c'; g.beginPath(); g.arc(x0 + (x1 - x0) * k, 72, 6, 0, 7); g.fill();
        this.hits.push({ x: 44, y: 58, w: 232, h: 28, fn: x => { d.value = Math.round(it.min + (it.max - it.min) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0)))); if (it.live) { it.set(d.value); d.applied = true; } } });
        g.strokeStyle = '#1438d6'; g.lineWidth = 2; g.strokeRect(70, 92, 130, 64);
        text(it.fmt ? it.fmt(d.value) : String(d.value).padStart(it.pad || 3, '0'), 135, 125, F(44), '#111', 'center');
        if (it.hint) text(it.hint(d.value), 135, 166, F(11, false), '#444', 'center');
        btn('▲', 214, 92, 46, 30, () => this.bump(d, 1)); btn('▼', 214, 126, 46, 30, () => this.bump(d, -1));
        btn(this.t('apply'), 52, 176, 70, 26, () => { it.set(d.value); d.applied = true; }); btn('⏎', 206, 176, 62, 26, () => this.closeDlg(true));
      } else {
        const act = yes => () => { this.dlg = null; if (yes) this.activate(d.item, true); };
        btn(this.t('SURE'), 62, 106, 86, 40, act(true)); btn(this.t('CANCEL'), 172, 106, 86, 40, act(false));
        g.strokeStyle = '#e83e8c'; g.lineWidth = 3; g.strokeRect(d.yes ? 62 : 172, 106, 86, 40);
      }
    }
    if (dim > 0) { g.fillStyle = `rgba(0,0,0,${(dim * 0.85).toFixed(2)})`; g.fillRect(0, 0, W, H); }   // Display → Screen Light: backlight after 10 s idle
    return true;
  }
}
