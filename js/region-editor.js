/**
 * region-editor.js
 * ---------------------------------------------------------------------------
 * サンプル画像の上に、読み取り範囲（曲名・難易度・判定内訳・コンボ数）を
 * ドラッグ移動・四隅ハンドルでリサイズできる矩形として重ねて表示する
 * 再利用可能なコンポーネント。settings.html から利用する。
 *
 * 座標はすべて画像に対する比率（0〜1）で管理する。
 * ドラッグ/リサイズで値が変わるたびに onChange(key, {x,y,w,h}) を呼び出し、
 * 数値入力側（settings-main.js）と双方向に同期できるようにしている。
 * ---------------------------------------------------------------------------
 */
const RegionEditor = (() => {
  const MIN_SIZE = 0.02; // 最小サイズ（比率）

  let wrapperEl = null;
  let regions = {};   // key -> {x,y,w,h}
  let boxEls = {};    // key -> element
  let onChangeCb = null;
  let activePointer = null;

  function mount(wrapper, initialRegions, onChange) {
    wrapperEl = wrapper;
    regions = JSON.parse(JSON.stringify(initialRegions || {}));
    onChangeCb = onChange || null;
    boxEls = {};

    wrapperEl.querySelectorAll('.region-box').forEach((el) => el.remove());

    Config.REGION_KEYS.forEach((key) => {
      if (regions[key]) _createBox(key);
    });
  }

  function _createBox(key) {
    const meta = Config.REGION_META[key] || { label: key, color: '#888' };
    const box = document.createElement('div');
    box.className = 'region-box';
    box.dataset.key = key;
    box.style.borderColor = meta.color;
    box.style.background = meta.color + '26';

    const label = document.createElement('div');
    label.className = 'region-box-label';
    label.style.background = meta.color;
    label.textContent = meta.label;
    box.appendChild(label);

    ['nw', 'ne', 'sw', 'se'].forEach((pos) => {
      const h = document.createElement('div');
      h.className = `region-handle region-handle-${pos}`;
      h.dataset.handle = pos;
      h.style.borderColor = meta.color;
      box.appendChild(h);
    });

    box.addEventListener('pointerdown', (e) => _onPointerDown(e, key));
    wrapperEl.appendChild(box);
    boxEls[key] = box;
    _applyBoxStyle(key);
  }

  function _applyBoxStyle(key) {
    const r = regions[key];
    const box = boxEls[key];
    if (!box || !r) return;
    box.style.left = (r.x * 100) + '%';
    box.style.top = (r.y * 100) + '%';
    box.style.width = (r.w * 100) + '%';
    box.style.height = (r.h * 100) + '%';
  }

  function _onPointerDown(e, key) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.target && e.target.dataset ? e.target.dataset.handle : null;
    const rect = wrapperEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    activePointer = {
      key,
      mode: handle ? 'resize' : 'move',
      handle: handle || null,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRegion: { ...regions[key] },
      wrapperW: rect.width,
      wrapperH: rect.height,
    };
    _bringToFront(key);
    window.addEventListener('pointermove', _onPointerMove);
    window.addEventListener('pointerup', _onPointerUp);
  }

  function _bringToFront(key) {
    Object.keys(boxEls).forEach((k) => { boxEls[k].style.zIndex = 1; });
    if (boxEls[key]) boxEls[key].style.zIndex = 10;
  }

  function _onPointerMove(e) {
    const ap = activePointer;
    if (!ap) return;
    e.preventDefault();
    const dxRatio = (e.clientX - ap.startClientX) / ap.wrapperW;
    const dyRatio = (e.clientY - ap.startClientY) / ap.wrapperH;
    const r = { ...ap.startRegion };

    if (ap.mode === 'move') {
      r.x = Utils.clamp(ap.startRegion.x + dxRatio, 0, 1 - r.w);
      r.y = Utils.clamp(ap.startRegion.y + dyRatio, 0, 1 - r.h);
    } else {
      if (ap.handle.includes('e')) {
        r.w = Utils.clamp(ap.startRegion.w + dxRatio, MIN_SIZE, 1 - r.x);
      }
      if (ap.handle.includes('s')) {
        r.h = Utils.clamp(ap.startRegion.h + dyRatio, MIN_SIZE, 1 - r.y);
      }
      if (ap.handle.includes('w')) {
        const newX = Utils.clamp(ap.startRegion.x + dxRatio, 0, ap.startRegion.x + ap.startRegion.w - MIN_SIZE);
        r.w = ap.startRegion.w + (ap.startRegion.x - newX);
        r.x = newX;
      }
      if (ap.handle.includes('n')) {
        const newY = Utils.clamp(ap.startRegion.y + dyRatio, 0, ap.startRegion.y + ap.startRegion.h - MIN_SIZE);
        r.h = ap.startRegion.h + (ap.startRegion.y - newY);
        r.y = newY;
      }
    }

    regions[ap.key] = r;
    _applyBoxStyle(ap.key);
    if (onChangeCb) onChangeCb(ap.key, { ...r });
  }

  function _onPointerUp() {
    activePointer = null;
    window.removeEventListener('pointermove', _onPointerMove);
    window.removeEventListener('pointerup', _onPointerUp);
  }

  // 数値入力側からの反映（外部から呼ばれる。onChangeは呼ばない＝ループ防止）
  function setRegion(key, region) {
    regions[key] = { ...region };
    if (!boxEls[key] && wrapperEl) _createBox(key);
    _applyBoxStyle(key);
  }

  function getRegions() {
    return JSON.parse(JSON.stringify(regions));
  }

  function focusRegion(key) {
    _bringToFront(key);
    const box = boxEls[key];
    if (box) {
      box.classList.add('focused');
      setTimeout(() => box.classList.remove('focused'), 600);
    }
  }

  return { mount, setRegion, getRegions, focusRegion };
})();
