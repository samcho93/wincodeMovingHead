// menu.js — 본체 컬러 LCD(320×240)와 메뉴(메뉴얼 4.3 "Main Function" 표 그대로)
//  버튼: MENU / UP / DOWN / ENTER. 조작법 = 메뉴얼: ENTER 로 선택하면 값이 깜박이고, UP/DOWN 으로 바꾼 뒤 ENTER 로 확정,
//  MENU 는 변경 없이 뒤로. MENU 를 1초 누르거나 1분간 조작이 없으면 메뉴에서 나간다.
import { MODES, KEYS, CH, describe } from './personality.js';

const ZH = {
  'Dmx Address': '地址码', 'Fixture': '灯具设置', 'Dmx Mode': '通道模式', 'Run Mode': '运行模式', 'Pan Invert': 'X轴反向', 'Tilt Invert': 'Y轴反向',
  'Manual': '手动控制', 'Information': '系统信息', 'Time': '时间', 'Sensor': '传感器', 'Temperature': '温度', 'Software Version': '软件版本',
  'Display': '显示设置', 'Language': '语言', 'Display Flip': '屏幕翻转', 'Display Mode': '显示模式', 'Factory': '工厂设置', 'Password': '密码',
  'Reset': '复位', 'All Reset': '全部复位', 'Close': '关', 'Open': '开', 'Off': '关', 'On': '开', 'Show': '常亮', 'Host': '主机', 'Sound': '声控',
  'Pan': 'X轴', 'Pan Fine': 'X轴微调', 'Tilt': 'Y轴', 'Tilt Fine': 'Y轴微调', 'PTSpeed': 'XY速度', 'Strobe': '频闪', 'Dimmer': '调光', 'Dimmer Fine': '调光微调',
  'Color': '颜色', 'Color Fine': '颜色微调', 'FixGobo': '固定图案', 'RotGobo': '旋转图案', 'GoboRot': '图案自转', 'Zoom': '放大', 'Focus': '调焦', 'Focus Fine': '调焦微调',
  'Frost': '雾化', 'Prism': '棱镜', 'PrismRot': '棱镜旋转', 'Current Time': '本次时间', 'Total Time': '累计时间', 'Power Count': '开机次数',
  'Resetting...': '复位中...', 'No Signal': '无信号', 'Menu': '菜单', 'Locked': '已锁定', 'Type Information': '类型信息',
};
export const FACTORY_PASSWORD = 50;   // 메뉴얼에 없는 값 — 시뮬레이터 가정(README)

export class Menu {
  constructor(fx) {
    this.fx = fx;
    this.canvas = document.createElement('canvas'); this.canvas.width = 320; this.canvas.height = 240;
    this.g = this.canvas.getContext('2d');
    this.stack = []; this.edit = null; this.info = null; this.lastKey = performance.now(); this.asleep = false;
    this.unlocked = false; this.dirty = true; this._sig = '';
    this.root = this.build();
  }
  t(s) { return this.fx.settings.lang === 'CH' ? (ZH[s] || s) : s; }

  build() {
    const fx = this.fx, S = () => fx.settings;
    const onoff = (label, key, a = 'Close', b = 'Open') => ({ label, type: 'enum', opts: [[false, a], [true, b]], get: () => S()[key], set: v => fx.set(key, v) });
    // 메뉴얼의 Manual 목록(Pan … Reset) + 표에서 빠진 고정 고보(FixGobo)
    const manualKeys = ['pan', 'panFine', 'tilt', 'tiltFine', 'ptSpeed', 'strobe', 'dimmer', 'color', 'gobo', 'rotGobo', 'goboRot', 'zoom', 'focus', 'frost', 'prism', 'prismRot', 'reset'];
    const calKeys = ['pan', 'tilt', 'color', 'dimmer', 'gobo', 'rotGobo', 'goboRot', 'zoom', 'focus', 'frost', 'prism', 'prismRot', 'reset'];
    return { label: 'Menu', items: [
      { label: 'Dmx Address', type: 'num', min: 1, max: 512, pad: 3, get: () => S().address, set: v => fx.set('address', v) },
      { label: 'Fixture', items: [
        { label: 'Dmx Mode', type: 'enum', opts: [['STD', 'STD (17CH)'], ['EXT', 'EXT (20CH)']], get: () => S().mode, set: v => fx.set('mode', v) },
        { label: 'Run Mode', type: 'enum', opts: [['DMX', 'DMX'], ['HOST', 'Host'], ['SOUND', 'Sound']], get: () => S().runMode, set: v => fx.set('runMode', v) },
        onoff('Pan Invert', 'panInvert'), onoff('Tilt Invert', 'tiltInvert'),
      ] },
      { label: 'Manual', items: manualKeys.map(k => ({ label: CH[k].name, type: 'num', min: 0, max: 255, pad: 3, live: true, hint: v => describe(k, v), get: () => fx.manual[k], set: v => { fx.manual[k] = v; fx.emit('manual'); } })) },
      { label: 'Information', items: [
        { label: 'Time', type: 'info', lines: () => [`${this.t('Current Time')}: ${(fx.sessionSec / 3600).toFixed(1)} H`, `${this.t('Total Time')}: ${S().totalHours.toFixed(1)} H`, `${this.t('Power Count')}: ${S().powerCount}`] },
        { label: 'Sensor', type: 'info', lines: () => [this.t('Type Information'), 'Pan/Tilt: Hall + Encoder', 'Wheels: Hall', 'LED: NTC 10K'] },
        { label: 'Temperature', type: 'info', lines: () => [`LED: ${fx.tempC.toFixed(0)} ℃`] },
        { label: 'Software Version', type: 'info', lines: () => ['Panel: V1.012', 'XY Motor: V1.004', 'Motor: V1.006'] },
      ] },
      { label: 'Display', items: [
        { label: 'Language', type: 'enum', opts: [['CH', '中文'], ['EN', 'English']], get: () => S().lang, set: v => fx.set('lang', v) },
        onoff('Display Flip', 'flip'),
        { label: 'Display Mode', type: 'enum', opts: [['Show', 'Show'], ['60s', '60s']], get: () => S().dispMode, set: v => fx.set('dispMode', v) },
      ] },
      { label: 'Factory', items: [
        { label: 'Password', type: 'num', min: 0, max: 255, pad: 3, get: () => 0, set: v => { this.unlocked = v === FACTORY_PASSWORD; } },
        ...calKeys.map(k => ({ label: CH[k].name, type: 'num', min: 0, max: 255, pad: 3, locked: () => !this.unlocked, get: () => S().cal[k], set: v => { S().cal[k] = v; fx.save(); } })),
      ] },
      { label: 'Reset', items: [
        { label: 'All Reset', type: 'enum', opts: [[false, 'Off'], [true, 'On']], get: () => false, set: v => { if (v) { fx.startReset('menu'); this.home(); } } },
        { label: 'Factory', type: 'enum', opts: [[false, 'Off'], [true, 'On']], get: () => false, set: v => { if (v) { fx.factoryDefaults(); this.unlocked = false; this.home(); } } },
      ] },
    ] };
  }
  home() { this.stack = []; this.cancelEdit(); this.info = null; this.dirty = true; }
  cancelEdit() { if (this.edit) { if (this.edit.item.live) this.edit.item.set(this.edit.orig); this.edit = null; } }
  get cur() { return this.stack[this.stack.length - 1]; }

  /** key: 'menu' | 'up' | 'down' | 'enter', rep: 누르고 있는 동안의 반복 횟수(값 가속), long: MENU 길게 */
  key(key, { rep = 0, long = false } = {}) {
    const fx = this.fx; if (!fx.power) return;
    this.lastKey = performance.now(); this.dirty = true;
    if (this.asleep) { this.asleep = false; return; }                  // 꺼진 화면은 첫 키로 켜기만 한다
    if (fx.resetting) return;
    if (long && key === 'menu') return this.home();
    if (!this.stack.length) { if (key === 'menu' || key === 'enter') this.stack.push({ node: this.root, sel: 0 }); return; }
    if (this.info) { this.info = null; return; }
    const c = this.cur, e = this.edit;
    if (e) {
      const it = e.item;
      if (key === 'up' || key === 'down') {
        const dir = key === 'up' ? 1 : -1;
        if (it.type === 'num') { const step = rep > 40 ? 10 : rep > 12 ? 4 : 1; e.value = Math.min(it.max, Math.max(it.min, e.value + dir * step)); }
        else { const i = it.opts.findIndex(o => o[0] === e.value); e.value = it.opts[(i + dir + it.opts.length) % it.opts.length][0]; }
        if (it.live) it.set(e.value);
      } else if (key === 'enter') { it.set(e.value); this.edit = null; }
      else if (key === 'menu') this.cancelEdit();
      return;
    }
    const items = c.node.items;
    if (key === 'up') c.sel = (c.sel - 1 + items.length) % items.length;
    else if (key === 'down') c.sel = (c.sel + 1) % items.length;
    else if (key === 'menu') this.stack.pop();
    else if (key === 'enter') {
      const it = items[c.sel];
      if (it.items) this.stack.push({ node: it, sel: 0 });
      else if (it.type === 'info') this.info = it;
      else if (!(it.locked && it.locked())) this.edit = { item: it, value: it.get(), orig: it.get() };
    }
  }

  valueText(it, v) {
    if (it.type === 'num') return String(v).padStart(it.pad || 1, '0');
    if (it.type === 'enum') { const o = it.opts.find(o => o[0] === v); return o ? this.t(o[1]) : ''; }
    return '';
  }

  /** 변경이 있을 때만 다시 그린다. 다시 그렸으면 true */
  draw(now) {
    const fx = this.fx, S = fx.settings, g = this.g, W = 320, H = 240;
    if (fx.power && (this.stack.length || this.asleep === false) && now - this.lastKey > 60000) {
      if (this.stack.length) this.home();
      if (S.dispMode === '60s' && !this.asleep) { this.asleep = true; this.dirty = true; }
    }
    const blink = Math.floor(now / 350) % 2;
    const sig = [fx.power, fx.resetting, Math.floor(fx.resetT * 4), fx.dmxSignal, fx.chSource, Math.round(fx.tempC), S.flip, this.asleep, this.edit ? blink : 0, this.info ? Math.floor(now / 500) : 0, !this.stack.length ? Math.floor(now / 500) : 0].join();
    if (!this.dirty && sig === this._sig) return false;
    this._sig = sig; this.dirty = false;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (!fx.power || this.asleep) return true;
    if (S.flip) g.setTransform(-1, 0, 0, -1, W, H);
    const F = (px, bold = true) => `${bold ? '600 ' : ''}${px}px "Segoe UI", "Malgun Gothic", "Microsoft YaHei", sans-serif`;
    g.fillStyle = '#0a1220'; g.fillRect(0, 0, W, H);
    const header = (title, right) => {
      g.fillStyle = '#12336b'; g.fillRect(0, 0, W, 34);
      g.fillStyle = '#fff'; g.font = F(18); g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(title, 10, 18);
      if (right) { g.textAlign = 'right'; g.font = F(13, false); g.fillStyle = '#b8cdf0'; g.fillText(right, W - 10, 18); }
    };
    g.textBaseline = 'middle';
    if (fx.resetting) {
      header('250W BSW');
      g.fillStyle = '#ffd24a'; g.font = F(26); g.textAlign = 'center'; g.fillText(this.t('Resetting...'), W / 2, 110);
      g.strokeStyle = '#36527f'; g.strokeRect(40, 150, 240, 16); g.fillStyle = '#ffd24a'; g.fillRect(42, 152, 236 * Math.min(1, fx.resetT / 6.5), 12);
      return true;
    }
    if (!this.stack.length) {                                           // 대기 화면
      const m = MODES[S.mode];
      header('250W BSW', `${fx.tempC.toFixed(0)}℃`);
      g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = F(74); g.fillText('A' + String(S.address).padStart(3, '0'), W / 2, 100);
      g.font = F(17, false); g.fillStyle = '#9fc0ff';
      g.fillText(`${m.label} ${m.id}  ·  ${this.t({ DMX: 'DMX', HOST: 'Host', SOUND: 'Sound' }[S.runMode])}`, W / 2, 158);
      const ok = fx.dmxSignal;
      g.fillStyle = S.runMode !== 'DMX' ? '#ffd24a' : ok ? '#39d98a' : '#ff5b4d'; g.beginPath(); g.arc(98, 198, 7, 0, 7); g.fill();
      g.textAlign = 'left'; g.font = F(16); g.fillText(S.runMode !== 'DMX' ? (S.runMode === 'HOST' ? 'MASTER  AUTO' : 'SOUND ACTIVE') : ok ? `DMX  ${fx.dmxFps.toFixed(0)}Hz` : `${this.t('No Signal')} (Manual)`, 114, 199);
      return true;
    }
    if (this.info) {
      header(this.t(this.info.label));
      g.textAlign = 'left'; g.font = F(19, false); g.fillStyle = '#e6eeff';
      this.info.lines().forEach((l, i) => g.fillText(l, 16, 66 + i * 34));
      return true;
    }
    const c = this.cur, items = c.node.items, rows = 5, rh = 40;
    header(this.t(c.node.label), `${c.sel + 1}/${items.length}`);
    const first = Math.min(Math.max(0, c.sel - 2), Math.max(0, items.length - rows));
    for (let r = 0; r < rows && first + r < items.length; r++) {
      const i = first + r, it = items[i], y = 36 + r * rh, sel = i === c.sel, ed = this.edit && sel;
      if (sel) { g.fillStyle = ed ? '#5b3a08' : '#1d4fa8'; g.fillRect(2, y, W - 4, rh - 2); }
      const locked = it.locked && it.locked();
      g.textAlign = 'left'; g.font = F(19); g.fillStyle = locked ? '#5f6b7f' : '#fff'; g.fillText(this.t(it.label), 12, y + rh / 2);
      g.textAlign = 'right';
      if (it.items || it.type === 'info') { g.fillStyle = '#8fa9d8'; g.fillText('›', W - 12, y + rh / 2 - 1); }
      else if (locked) { g.font = F(13, false); g.fillStyle = '#5f6b7f'; g.fillText(this.t('Locked'), W - 12, y + rh / 2); }
      else {
        const v = ed ? this.edit.value : it.get();
        if (!(ed && blink)) { g.fillStyle = ed ? '#ffd24a' : '#9fe0b0'; g.fillText(this.valueText(it, v), W - 12, y + rh / 2); }
        if (ed && it.hint) { g.font = F(11, false); g.fillStyle = '#ffd9a0'; g.textAlign = 'left'; g.fillText(it.hint(v), 150, y + rh - 8); }
      }
    }
    return true;
  }
}
