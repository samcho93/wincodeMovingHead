// menu-none.js — the "panel" of a fixture that has no simulated menu (panel.type 'none': fixtures made from a
//  library description). Same interface as menu.js / menu-touch.js; the display only shows name, address and mode.
export class NullMenu {
  constructor(fx) {
    this.fx = fx; this.canvas = document.createElement('canvas'); this.canvas.width = 320; this.canvas.height = 240;
    this.g = this.canvas.getContext('2d'); this.asleep = false; this.lastKey = performance.now(); this.dirty = true; this.keyLabels = {}; this._sig = '';
  }
  key() {} touch() {} home() {}
  draw() {
    const fx = this.fx, S = fx.settings, sig = [fx.power, S.address, S.mode, fx.dmxSignal].join();
    if (!this.dirty && sig === this._sig) return false;
    this._sig = sig; this.dirty = false;
    const g = this.g; g.fillStyle = '#05080c'; g.fillRect(0, 0, 320, 240); if (!fx.power) return true;
    g.fillStyle = '#9fb4c8'; g.font = '600 22px sans-serif'; g.textAlign = 'center'; g.fillText(fx.model.lcdTitle.slice(0, 22), 160, 60);
    g.fillStyle = '#fff'; g.font = '700 64px sans-serif'; g.fillText('A' + String(S.address).padStart(3, '0'), 160, 140);
    g.fillStyle = fx.dmxSignal ? '#4bd37b' : '#7d8894'; g.font = '20px sans-serif'; g.fillText(`${fx.mode.label} · ${fx.dmxSignal ? 'DMX' : 'no DMX'}`, 160, 190);
    return true;
  }
}
