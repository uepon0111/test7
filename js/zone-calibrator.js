// js/zone-calibrator.js
// 6.6: 機種登録・OCR範囲の手動設定

import { DEFAULT_OCR_ZONES } from './constants.js';

const ZONE_KEYS  = ['title', 'difficulty', 'level', 'results', 'combo'];
const ZONE_NAMES = { title:'タイトル', difficulty:'難易度', level:'レベル', results:'リザルト', combo:'コンボ' };

export class ZoneCalibrator {
  constructor(canvasEl, imgEl) {
    this.canvas  = canvasEl;
    this.img     = imgEl;
    this.zones   = JSON.parse(JSON.stringify(DEFAULT_OCR_ZONES)); // ディープコピー
    this.active  = null;   // 現在編集中のゾーンキー
    this.drawing = false;
    this.startX  = 0; this.startY = 0;
    this._bind();
  }

  _bind() {
    this.canvas.style.cursor = 'crosshair';
    this.canvas.addEventListener('mousedown',  e => this._down(e));
    this.canvas.addEventListener('mousemove',  e => this._move(e));
    this.canvas.addEventListener('mouseup',    e => this._up(e));
    this.canvas.addEventListener('touchstart', e => this._down(e.touches[0]), { passive: true });
    this.canvas.addEventListener('touchmove',  e => { e.preventDefault(); this._move(e.touches[0]); }, { passive: false });
    this.canvas.addEventListener('touchend',   e => this._up(e.changedTouches[0]));
  }

  setActiveZone(key) {
    this.active = key;
    this.canvas.style.cursor = key ? 'crosshair' : 'default';
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top)  / rect.height,
    };
  }

  _down(e) {
    if (!this.active) return;
    this.drawing = true;
    const p = this._pos(e);
    this.startX = p.x; this.startY = p.y;
  }

  _move(e) {
    if (!this.drawing || !this.active) return;
    const p = this._pos(e);
    const x = Math.min(this.startX, p.x);
    const y = Math.min(this.startY, p.y);
    const w = Math.abs(p.x - this.startX);
    const h = Math.abs(p.y - this.startY);
    this.zones[this.active] = { ...this.zones[this.active], x, y, w, h };
    this.redraw();
  }

  _up(e) {
    if (!this.drawing) return;
    this.drawing = false;
    this._move(e);
  }

  /** 全ゾーンをキャンバスに描画 */
  redraw() {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const CW = this.canvas.width, CH = this.canvas.height;

    for (const [key, zone] of Object.entries(this.zones)) {
      const x = zone.x * CW, y = zone.y * CH;
      const w = zone.w * CW, h = zone.h * CH;
      const isActive = key === this.active;

      ctx.strokeStyle = zone.color;
      ctx.lineWidth   = isActive ? 3 : 2;
      if (isActive) ctx.setLineDash([5, 3]);
      else          ctx.setLineDash([]);
      ctx.strokeRect(x, y, w, h);

      // ラベル背景
      ctx.fillStyle = zone.color;
      ctx.fillRect(x, y, Math.min(w, 90), 20);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${isActive ? 13 : 12}px sans-serif`;
      ctx.fillText(ZONE_NAMES[key], x + 4, y + 14);
    }
  }

  /** canvas のサイズを img に合わせる */
  resize() {
    this.canvas.width  = this.img.clientWidth  || this.img.naturalWidth;
    this.canvas.height = this.img.clientHeight || this.img.naturalHeight;
    this.redraw();
  }

  getZones() { return JSON.parse(JSON.stringify(this.zones)); }
  setZones(z) { this.zones = JSON.parse(JSON.stringify(z)); this.redraw(); }
  resetZone(key) {
    this.zones[key] = JSON.parse(JSON.stringify(DEFAULT_OCR_ZONES[key]));
    this.redraw();
  }
  resetAll() {
    this.zones = JSON.parse(JSON.stringify(DEFAULT_OCR_ZONES));
    this.redraw();
  }
}
