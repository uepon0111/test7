// js/virtual-scroll.js
// 2.11: 仮想スクロール実装

export class VirtualScroll {
  /**
   * @param {HTMLElement} container スクロール対象の要素
   * @param {Function} renderItem (item, index) => HTMLElement
   * @param {object} opts
   */
  constructor(container, renderItem, opts = {}) {
    this.container  = container;
    this.renderItem = renderItem;
    this.itemH      = opts.itemHeight  || 90;
    this.cols       = opts.columns     || 1;
    this.gap        = opts.gap         || 8;
    this.buffer     = opts.buffer      || 4;
    this.items      = [];
    this.rendered   = new Map(); // index → element
    this._objUrls   = new Map(); // index → [url, ...]

    // 内部スペーサー
    this.spacer = document.createElement('div');
    this.spacer.className = 'vs-spacer';
    container.innerHTML = '';
    container.appendChild(this.spacer);

    this._onScroll = this._onScroll.bind(this);
    container.addEventListener('scroll', this._onScroll, { passive: true });
    this._ro = new ResizeObserver(() => this._render());
    this._ro.observe(container);
  }

  /** レイアウト変更（レスポンシブ対応） */
  setLayout(itemH, cols) {
    if (this.itemH === itemH && this.cols === cols) return;
    this.itemH = itemH;
    this.cols  = cols;
    this._clearAll();
    this._render();
  }

  setItems(items) {
    this.items = items;
    this._clearAll();
    this._render();
  }

  scrollToTop() { this.container.scrollTop = 0; }

  destroy() {
    this.container.removeEventListener('scroll', this._onScroll);
    this._ro.disconnect();
    this._clearAll();
  }

  get _rowH()    { return this.itemH + this.gap; }
  get _rowCount(){ return Math.ceil(this.items.length / this.cols); }
  get _totalH()  { return this._rowCount * this._rowH - (this._rowCount > 0 ? this.gap : 0); }

  _visibleRows() {
    const scroll = this.container.scrollTop;
    const ch     = this.container.clientHeight;
    const first  = Math.max(0, Math.floor(scroll / this._rowH) - this.buffer);
    const last   = Math.min(this._rowCount - 1, Math.ceil((scroll + ch) / this._rowH) + this.buffer);
    return { first, last };
  }

  _render() {
    if (!this.items.length) {
      this.spacer.style.height = '0px';
      return;
    }
    this.spacer.style.height = this._totalH + 'px';
    const { first, last } = this._visibleRows();
    const startIdx = first * this.cols;
    const endIdx   = Math.min(this.items.length - 1, (last + 1) * this.cols - 1);

    // 範囲外を削除
    for (const [idx, el] of this.rendered) {
      if (idx < startIdx || idx > endIdx) {
        // Object URLの解放
        const urls = this._objUrls.get(idx) || [];
        urls.forEach(u => URL.revokeObjectURL(u));
        this._objUrls.delete(idx);
        el.remove();
        this.rendered.delete(idx);
      }
    }

    // 範囲内で未描画のものを追加
    // pixel-based 計算（コンテナのpaddingを差し引いた実使用幅を計算）
    const styleP  = window.getComputedStyle(this.container);
    const padX    = parseFloat(styleP.paddingLeft) + parseFloat(styleP.paddingRight);
    const innerW  = this.container.clientWidth - padX;
    const cellW   = Math.floor((innerW - this.gap * (this.cols - 1)) / this.cols);

    for (let i = startIdx; i <= endIdx && i < this.items.length; i++) {
      if (this.rendered.has(i)) continue;
      const row = Math.floor(i / this.cols);
      const col = i % this.cols;
      const el  = this.renderItem(this.items[i], i);

      el.style.position  = 'absolute';
      el.style.top       = `${row * this._rowH}px`;
      el.style.left      = `${col * (cellW + this.gap)}px`;
      el.style.width     = `${cellW}px`;
      el.style.height    = `${this.itemH}px`;
      el.style.boxSizing = 'border-box';

      // img の Object URL を追跡
      const trackUrls = [];
      el.querySelectorAll('img[data-obj]').forEach(img => trackUrls.push(img.src));
      if (trackUrls.length) this._objUrls.set(i, trackUrls);

      this.spacer.appendChild(el);
      this.rendered.set(i, el);
    }
  }

  _clearAll() {
    for (const [idx, el] of this.rendered) {
      const urls = this._objUrls.get(idx) || [];
      urls.forEach(u => URL.revokeObjectURL(u));
      el.remove();
    }
    this.rendered.clear();
    this._objUrls.clear();
  }

  _onScroll() { this._render(); }

  /** 特定インデックスのカードを再描画 */
  refresh(idx) {
    const el = this.rendered.get(idx);
    if (!el) return;
    const newEl = this.renderItem(this.items[idx], idx);
    newEl.style.cssText = el.style.cssText;
    el.replaceWith(newEl);
    this.rendered.set(idx, newEl);
  }
}
