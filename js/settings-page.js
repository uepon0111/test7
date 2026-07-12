/*
 * settings-page.js
 * -----------------------------------------------------------------------
 * settings.html 専用のロジック。
 *   - 機種プロファイルの一覧・新規作成・保存・削除
 *   - サンプル画像のアップロードと、読み取り範囲(difficulty/title/breakdown/combo)の
 *     ドラッグ&ドロップ・8方向ハンドルによるビジュアル編集
 *   - 座標数値入力との双方向同期 (ドラッグ→数値、数値→ドラッグ双方に反映)
 *   - プロファイルのエクスポート/インポート (JSON)
 * -----------------------------------------------------------------------
 */

let currentProfile = null;      // 現在編集中のプロファイル(ドラフト。保存するまでlocalStorageには反映されない)
let activeRegionKey = null;     // 現在編集対象の範囲キー ('difficulty' | 'title' | 'breakdown' | 'combo')
let sampleNaturalWidth = 0;
let sampleNaturalHeight = 0;
let dragState = null;

const DIFF_WORDS = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'MASTER', 'APPEND'];
const BREAKDOWN_WORDS = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS'];
const TITLE_STOPWORDS = new Set([
  'SCORE', 'RANK', 'COMBO', 'FAST', 'LATE', 'AP', 'FC', 'FULL', 'CLEAR',
  'PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS', 'EASY', 'NORMAL', 'HARD', 'EXPERT', 'MASTER', 'APPEND'
]);


function initSettingsPage() {
  activeRegionKey = REGION_DEFS[0].key;
  renderRegionTabs();

  const profiles = getDeviceProfiles();
  loadProfileIntoEditor(profiles[0]);

  document.getElementById('btn-new-profile').addEventListener('click', () => {
    loadProfileIntoEditor(createNewProfileDraft(''));
    document.getElementById('profile-name-input').focus();
  });

  document.getElementById('sample-image-input').addEventListener('change', handleSampleImageSelected);
  document.getElementById('btn-auto-detect').addEventListener('click', autoDetectRegionsFromSampleImage);
  document.getElementById('btn-save-profile').addEventListener('click', saveCurrentProfile);
  document.getElementById('btn-delete-profile').addEventListener('click', deleteCurrentProfile);

  document.getElementById('btn-export-profiles').addEventListener('click', doExportProfiles);
  document.getElementById('btn-import-profiles').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', doImportProfiles);

  ['coord-x', 'coord-y', 'coord-w', 'coord-h'].forEach(id => {
    document.getElementById(id).addEventListener('input', onCoordInputChanged);
  });

  window.addEventListener('resize', debounce(repositionAllRegionBoxes, 100));
}

// ============================================================
// プロファイル一覧
// ============================================================

function renderProfileList() {
  const list = getDeviceProfiles();
  const container = document.getElementById('profile-list');
  container.innerHTML = list.map(p => `
    <div class="profile-list-item ${currentProfile && currentProfile.id === p.id ? 'active' : ''}" data-id="${p.id}">
      <div class="profile-list-item-name">${escapeHtml(p.name)}</div>
      <div class="profile-list-item-meta">${p.width && p.height ? `${p.width}&times;${p.height}` : '基準未設定'}</div>
    </div>
  `).join('');
  container.querySelectorAll('.profile-list-item').forEach(el => {
    el.addEventListener('click', () => {
      const profile = getDeviceProfileById(el.dataset.id);
      if (profile) loadProfileIntoEditor(profile);
    });
  });
}

// ============================================================
// 範囲タブ (難易度/曲名/判定内訳/コンボ数)
// ============================================================

function renderRegionTabs() {
  const container = document.getElementById('region-tabs');
  container.innerHTML = REGION_DEFS.map(def => `
    <button type="button" class="region-tab" data-key="${def.key}">
      <span class="region-tab-dot" style="background-color:${def.color}"></span>${def.label}
    </button>
  `).join('');
  container.querySelectorAll('.region-tab').forEach(btn => {
    btn.addEventListener('click', () => setActiveRegion(btn.dataset.key));
  });
  updateRegionTabsUI();
}

function updateRegionTabsUI() {
  document.querySelectorAll('.region-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === activeRegionKey);
  });
}

function setActiveRegion(key) {
  activeRegionKey = key;
  updateRegionTabsUI();
  updateRegionBoxesInteractivity();
  updateCoordInputsFromRegion(key);
}

// ============================================================
// プロファイルの読み込み・保存・削除
// ============================================================

function loadProfileIntoEditor(profile) {
  currentProfile = JSON.parse(JSON.stringify(profile)); // 保存を押すまで確定させないためドラフトとして複製
  document.getElementById('profile-name-input').value = currentProfile.name;
  sampleNaturalWidth = currentProfile.width || 0;
  sampleNaturalHeight = currentProfile.height || 0;

  const img = document.getElementById('sample-img');
  const placeholder = document.getElementById('no-image-placeholder');
  img.style.display = 'none';
  img.removeAttribute('src');
  placeholder.style.display = 'flex';
  placeholder.innerText = sampleNaturalWidth
    ? `このプロファイルの基準解像度は ${sampleNaturalWidth}×${sampleNaturalHeight} です。\n見た目を確認・調整するには、この機種のサンプル画像を選択してください。`
    : 'サンプル画像を選択してください';

  ensureRegionBoxes();
  repositionAllRegionBoxes();
  updateRegionBoxesInteractivity();
  updateCoordInputsFromRegion(activeRegionKey);
  renderProfileList();

  const isSaved = !!getDeviceProfileById(currentProfile.id);
  document.getElementById('btn-delete-profile').disabled = !isSaved;
}

function saveCurrentProfile() {
  const name = document.getElementById('profile-name-input').value.trim();
  if (!name) { alert('機種名を入力してください'); return; }
  currentProfile.name = name;
  upsertDeviceProfile(currentProfile);
  renderProfileList();
  document.getElementById('btn-delete-profile').disabled = false;
  alert('保存しました');
}

function deleteCurrentProfile() {
  if (!currentProfile || !getDeviceProfileById(currentProfile.id)) return;
  if (!confirm(`「${currentProfile.name}」を削除しますか？`)) return;
  deleteDeviceProfile(currentProfile.id);
  const remaining = getDeviceProfiles();
  loadProfileIntoEditor(remaining[0]);
}

// ============================================================
// サンプル画像
// ============================================================

async function handleSampleImageSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = document.getElementById('sample-img');
  const placeholder = document.getElementById('no-image-placeholder');

  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
  } catch (err) {
    alert('画像の読み込みに失敗しました');
    return;
  }

  sampleNaturalWidth = img.naturalWidth;
  sampleNaturalHeight = img.naturalHeight;
  currentProfile.width = sampleNaturalWidth;
  currentProfile.height = sampleNaturalHeight;

  img.style.display = 'block';
  placeholder.style.display = 'none';

  repositionAllRegionBoxes();
  updateCoordInputsFromRegion(activeRegionKey);
  renderProfileList();

  // サンプル画像を読み込んだら、そのまま OCR で初期値を推定する
  await autoDetectRegionsFromSampleImage();
}

// ============================================================
// 範囲ボックス (表示・配置)
// ============================================================

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function ensureRegionBoxes() {
  const container = document.getElementById('image-editor-container');
  REGION_DEFS.forEach(def => {
    let box = document.getElementById(`region-box-${def.key}`);
    if (box) return;
    box = document.createElement('div');
    box.id = `region-box-${def.key}`;
    box.className = 'region-box';
    box.style.setProperty('--region-color', def.color);
    box.style.setProperty('--region-color-bg', hexToRgba(def.color, 0.18));
    box.innerHTML = `
      <span class="region-box-label" style="background-color:${def.color}">${def.label}</span>
      ${['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(h => `<div class="region-handle handle-${h}" data-handle="${h}"></div>`).join('')}
    `;
    container.appendChild(box);
    box.addEventListener('pointerdown', (ev) => onRegionPointerDown(ev, def.key));
  });
}

function updateRegionBoxesInteractivity() {
  REGION_DEFS.forEach(def => {
    const box = document.getElementById(`region-box-${def.key}`);
    if (!box) return;
    const isActive = def.key === activeRegionKey;
    box.classList.toggle('active-region', isActive);
    box.classList.toggle('inactive-region', !isActive);
  });
}

// 画像の「表示上のサイズ」を返す。画像未選択時はコンテナ幅と基準アスペクト比から仮想サイズを計算する。
function getDisplayedImageRect() {
  const img = document.getElementById('sample-img');
  const container = document.getElementById('image-editor-container');
  if (img.style.display !== 'none' && img.clientWidth > 0) {
    return { width: img.clientWidth, height: img.clientHeight, left: img.offsetLeft, top: img.offsetTop };
  }
  const w = container.clientWidth;
  const ratio = (sampleNaturalWidth && sampleNaturalHeight) ? (sampleNaturalHeight / sampleNaturalWidth) : 1.777;
  return { width: w, height: w * ratio, left: 0, top: 0 };
}

function renderRegionBoxPosition(key) {
  const box = document.getElementById(`region-box-${key}`);
  if (!box || !currentProfile) return;
  const region = currentProfile.regions[key];
  const rect = getDisplayedImageRect();

  box.style.left = (rect.left + region.x * rect.width) + 'px';
  box.style.top = (rect.top + region.y * rect.height) + 'px';
  box.style.width = (region.w * rect.width) + 'px';
  box.style.height = (region.h * rect.height) + 'px';
}

function repositionAllRegionBoxes() {
  REGION_DEFS.forEach(def => renderRegionBoxPosition(def.key));
}

// ============================================================
// ドラッグ移動 / ハンドルによるリサイズ (Pointer Events でマウス・タッチ両対応)
// ============================================================

function onRegionPointerDown(ev, key) {
  if (key !== activeRegionKey) return; // 非アクティブな範囲は操作不可(タブで切り替えてから編集する)
  ev.preventDefault();
  ev.stopPropagation();

  const handle = ev.target.dataset ? ev.target.dataset.handle : undefined;
  const rect = getDisplayedImageRect();
  const region = currentProfile.regions[key];

  dragState = {
    mode: handle || 'move',
    startClientX: ev.clientX,
    startClientY: ev.clientY,
    startRegion: { x: region.x, y: region.y, w: region.w, h: region.h },
    rectWidth: rect.width,
    rectHeight: rect.height,
    key: key,
  };

  const box = document.getElementById(`region-box-${key}`);
  box.setPointerCapture(ev.pointerId);
  box.addEventListener('pointermove', onRegionPointerMove);
  box.addEventListener('pointerup', onRegionPointerUp);
  box.addEventListener('pointercancel', onRegionPointerUp);
}

function onRegionPointerMove(ev) {
  if (!dragState) return;
  ev.preventDefault();

  const s = dragState.startRegion;
  const MIN = 0.02;
  let dxRatio = (ev.clientX - dragState.startClientX) / dragState.rectWidth;
  let dyRatio = (ev.clientY - dragState.startClientY) / dragState.rectHeight;

  const mode = dragState.mode;
  let x = s.x, y = s.y, w = s.w, h = s.h;

  const affectsLeft = ['move', 'w', 'nw', 'sw'].includes(mode);
  const affectsRight = ['move', 'e', 'ne', 'se'].includes(mode);
  const affectsTop = ['move', 'n', 'nw', 'ne'].includes(mode);
  const affectsBottom = ['move', 's', 'sw', 'se'].includes(mode);

  if (mode === 'move') {
    dxRatio = clamp(dxRatio, -s.x, 1 - s.w - s.x);
    dyRatio = clamp(dyRatio, -s.y, 1 - s.h - s.y);
    x = s.x + dxRatio; y = s.y + dyRatio;
  } else {
    if (affectsLeft) {
      dxRatio = clamp(dxRatio, -s.x, s.w - MIN);
      x = s.x + dxRatio; w = s.w - dxRatio;
    }
    if (affectsRight) {
      dxRatio = clamp(dxRatio, MIN - s.w, 1 - s.x - s.w);
      w = s.w + dxRatio;
    }
    if (affectsTop) {
      dyRatio = clamp(dyRatio, -s.y, s.h - MIN);
      y = s.y + dyRatio; h = s.h - dyRatio;
    }
    if (affectsBottom) {
      dyRatio = clamp(dyRatio, MIN - s.h, 1 - s.y - s.h);
      h = s.h + dyRatio;
    }
  }

  currentProfile.regions[dragState.key] = { x, y, w, h };
  renderRegionBoxPosition(dragState.key);
  updateCoordInputsFromRegion(dragState.key);
}

function onRegionPointerUp(ev) {
  if (!dragState) return;
  const box = document.getElementById(`region-box-${dragState.key}`);
  box.removeEventListener('pointermove', onRegionPointerMove);
  box.removeEventListener('pointerup', onRegionPointerUp);
  box.removeEventListener('pointercancel', onRegionPointerUp);
  dragState = null;
}

// ============================================================
// 座標数値入力との同期
// ============================================================

function updateCoordInputsFromRegion(key) {
  if (!currentProfile) return;
  const region = currentProfile.regions[key];
  const refW = sampleNaturalWidth || 1000;
  const refH = sampleNaturalHeight || 1000;
  document.getElementById('coord-x').value = Math.round(region.x * refW);
  document.getElementById('coord-y').value = Math.round(region.y * refH);
  document.getElementById('coord-w').value = Math.round(region.w * refW);
  document.getElementById('coord-h').value = Math.round(region.h * refH);
  const label = REGION_DEFS.find(d => d.key === key).label;
  const refNote = sampleNaturalWidth ? `基準 ${refW}×${refH}px` : '基準画像未設定のため仮の数値(1000×1000px換算)です';
  document.getElementById('coord-panel-title').innerText = `「${label}」の範囲`;
  document.getElementById('coord-panel-hint').innerText = refNote;
}

function onCoordInputChanged() {
  if (!currentProfile) return;
  const refW = sampleNaturalWidth || 1000;
  const refH = sampleNaturalHeight || 1000;
  const MIN_RATIO = 0.02;

  const xPx = parseFloat(document.getElementById('coord-x').value) || 0;
  const yPx = parseFloat(document.getElementById('coord-y').value) || 0;
  const wPx = parseFloat(document.getElementById('coord-w').value) || 0;
  const hPx = parseFloat(document.getElementById('coord-h').value) || 0;

  const x = clamp(xPx / refW, 0, 1);
  const y = clamp(yPx / refH, 0, 1);
  const w = clamp(wPx / refW, MIN_RATIO, 1 - x);
  const h = clamp(hPx / refH, MIN_RATIO, 1 - y);

  currentProfile.regions[activeRegionKey] = { x, y, w, h };
  renderRegionBoxPosition(activeRegionKey);
}

function bboxToRect(bbox, imgW, imgH) {
  if (!bbox) return null;
  return {
    left: clamp(bbox.x0, 0, imgW),
    top: clamp(bbox.y0, 0, imgH),
    right: clamp(bbox.x1, 0, imgW),
    bottom: clamp(bbox.y1, 0, imgH),
  };
}

function unionTextBoxes(words) {
  if (!words || words.length === 0) return null;
  const rects = words.map(w => bboxToRect(w.bbox, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).filter(Boolean);
  if (rects.length === 0) return null;
  let left = rects[0].left, top = rects[0].top, right = rects[0].right, bottom = rects[0].bottom;
  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { left, top, right, bottom };
}

function groupWordsByLine(words, tolerancePx = 24) {
  const sorted = (words || []).filter(w => w && w.bbox).slice().sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2;
    const by = (b.bbox.y0 + b.bbox.y1) / 2;
    return ay - by;
  });
  const lines = [];
  for (const word of sorted) {
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    let line = lines.find(l => Math.abs(l.centerY - cy) <= tolerancePx);
    if (!line) {
      line = { centerY: cy, words: [] };
      lines.push(line);
    }
    line.words.push(word);
    line.centerY = line.words.reduce((sum, w) => sum + ((w.bbox.y0 + w.bbox.y1) / 2), 0) / line.words.length;
  }
  return lines;
}

function updateRegionFromPixelBox(key, box, imgW, imgH, padX = 0, padY = 0) {
  if (!box) return false;
  const left = clamp(box.x0 - imgW * padX, 0, imgW);
  const top = clamp(box.y0 - imgH * padY, 0, imgH);
  const right = clamp(box.x1 + imgW * padX, 0, imgW);
  const bottom = clamp(box.y1 + imgH * padY, 0, imgH);
  currentProfile.regions[key] = {
    x: left / imgW,
    y: top / imgH,
    w: Math.max(0.01, (right - left) / imgW),
    h: Math.max(0.01, (bottom - top) / imgH),
  };
  return true;
}

function updateRegionFromWords(key, words, imgW, imgH, padX = 0, padY = 0) {
  if (!words || words.length === 0) return false;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const word of words) {
    if (!word || !word.bbox) continue;
    left = Math.min(left, word.bbox.x0);
    top = Math.min(top, word.bbox.y0);
    right = Math.max(right, word.bbox.x1);
    bottom = Math.max(bottom, word.bbox.y1);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) return false;
  return updateRegionFromPixelBox(key, { x0: left, y0: top, x1: right, y1: bottom }, imgW, imgH, padX, padY);
}

function isCloseWord(word, target) {
  const cleaned = normalizeString(word || '').toUpperCase();
  const goal = String(target || '').toUpperCase();
  if (!cleaned) return false;
  if (cleaned.includes(goal)) return true;
  return levenshtein(cleaned, goal) <= 1;
}

async function getAllOcrWordsForSample(img) {
  const variants = [
    { scale: 1.5, threshold: false, contrast: 170, grayscale: true, lang: 'jpn+eng', params: { tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
    { scale: 2, threshold: false, contrast: 220, grayscale: true, lang: 'jpn+eng', params: { tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
    { scale: 2, threshold: true, contrast: 225, grayscale: true, lang: 'jpn+eng', params: { tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
  ];

  const worker = await Tesseract.createWorker(['jpn', 'eng']);
  try {
    const seen = new Set();
    const merged = [];

    for (const variant of variants) {
      const blob = await cropImage(img, 0, 0, 1, 1, variant);
      const ret = await recognizeWithParams(worker, blob, variant.lang, variant.params);
      const words = extractWordsFromOcrResult(ret);
      for (const w of words) {
        if (!w || !w.text || !w.bbox) continue;
        const textKey = normalizeString(w.text);
        const bb = w.bbox;
        const bboxKey = [
          Math.round(bb.x0 / 12),
          Math.round(bb.y0 / 12),
          Math.round(bb.x1 / 12),
          Math.round(bb.y1 / 12),
        ].join(':');
        const key = `${textKey}|${bboxKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(w);
      }
    }
    return merged;
  } finally {
    await worker.terminate();
  }
}

function mergeCandidateWords(words, predicate) {
  return (words || []).filter(w => w && w.text && w.bbox && predicate(w));
}

function pickBestTitleLine(words, imgW, imgH) {
  const lineGroups = groupWordsByLine(words, Math.max(18, imgH * 0.02));
  const candidates = [];

  for (const line of lineGroups) {
    const lineWords = line.words.filter(w => {
      const norm = normalizeString(w.text || '').toUpperCase();
      if (!norm) return false;
      if (TITLE_STOPWORDS.has(norm)) return false;
      const cx = (w.bbox.x0 + w.bbox.x1) / 2 / imgW;
      const cy = (w.bbox.y0 + w.bbox.y1) / 2 / imgH;
      return cy <= 0.22 && cx >= 0.05 && cx <= 0.72;
    });
    if (lineWords.length === 0) continue;
    const text = lineWords.map(w => w.text).join(' ').trim();
    const score = lineWords.reduce((sum, w) => sum + (w.confidence || 0), 0) + text.length * 2;
    candidates.push({ words: lineWords, text, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

// OCRによる範囲の自動推定
function wordsToLineBox(words) {
  if (!words || words.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of words) {
    if (!w || !w.bbox) continue;
    x0 = Math.min(x0, w.bbox.x0);
    y0 = Math.min(y0, w.bbox.y0);
    x1 = Math.max(x1, w.bbox.x1);
    y1 = Math.max(y1, w.bbox.y1);
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
  return { x0, y0, x1, y1 };
}

async function autoDetectRegionsFromSampleImage() {
  if (!currentProfile) return false;
  const img = document.getElementById('sample-img');
  if (!img || img.style.display === 'none' || !sampleNaturalWidth || !sampleNaturalHeight) return false;

  const hintEl = document.getElementById('coord-panel-hint');
  const originalHint = hintEl.innerText;
  hintEl.innerText = 'OCRで読み取り範囲を自動推定中...';

  try {
    const mergedWords = await getAllOcrWordsForSample(img);
    if (!mergedWords || mergedWords.length === 0) {
      hintEl.innerText = originalHint;
      return false;
    }

    const imgW = sampleNaturalWidth;
    const imgH = sampleNaturalHeight;

    // 難易度は上部中央付近の英字を優先
    const diffWords = mergedWords.filter(w => {
      const norm = normalizeString(w.text || '').toUpperCase();
      if (!norm) return false;
      return [...DIFF_WORDS].some(label => isCloseWord(norm, label));
    });
    const diffBox = wordsToLineBox(diffWords);
    if (diffBox) updateRegionFromPixelBox('difficulty', diffBox, imgW, imgH, 0.03, 0.02);

    // 判定内訳は PERFECT/GREAT/GOOD/BAD/MISS をまとめて囲う
    const breakdownWords = mergedWords.filter(w => {
      const norm = normalizeString(w.text || '').toUpperCase();
      if (!norm) return false;
      return [...BREAKDOWN_WORDS].some(label => isCloseWord(norm, label));
    });
    const breakdownBox = wordsToLineBox(breakdownWords);
    if (breakdownBox) updateRegionFromPixelBox('breakdown', breakdownBox, imgW, imgH, 0.05, 0.04);

    // コンボは COMBO ラベルまたはその近辺の数字を優先
    const comboLabelWords = mergedWords.filter(w => isCloseWord(w.text || '', 'COMBO'));
    let comboWords = comboLabelWords.slice();
    if (comboLabelWords.length > 0) {
      const anchor = comboLabelWords[0].bbox;
      const ax = (anchor.x0 + anchor.x1) / 2;
      const ay = (anchor.y0 + anchor.y1) / 2;
      comboWords = mergedWords.filter(w => {
        const bb = w.bbox;
        const cx = (bb.x0 + bb.x1) / 2;
        const cy = (bb.y0 + bb.y1) / 2;
        return Math.abs(cy - ay) <= imgH * 0.08 && cx >= ax - imgW * 0.05 && cx <= ax + imgW * 0.22;
      });
    }
    const comboBox = wordsToLineBox(comboWords);
    if (comboBox) {
      updateRegionFromPixelBox('combo', comboBox, imgW, imgH, 0.01, 0.02);
      const comboRegion = currentProfile.regions.combo;
      comboRegion.w = clamp(comboRegion.w + 0.14, 0.01, 1 - comboRegion.x);
      comboRegion.h = clamp(comboRegion.h + 0.02, 0.01, 1 - comboRegion.y);
    }

    // 曲名は上部左寄りの行を選んで、複数単語をまとめて囲う
    const titleLine = pickBestTitleLine(mergedWords, imgW, imgH);
    if (titleLine && titleLine.words.length > 0) {
      updateRegionFromWords('title', titleLine.words, imgW, imgH, 0.03, 0.02);
    }

    repositionAllRegionBoxes();
    updateCoordInputsFromRegion(activeRegionKey);
    hintEl.innerText = '自動推定を反映しました。必要なら枠を微調整してください。';
    return true;
  } catch (err) {
    console.error('OCRによる範囲の自動推定に失敗しました', err);
    hintEl.innerText = originalHint;
    alert('読み取り範囲の自動推定に失敗しました。サンプル画像を確認してください。');
    return false;
  }
}

// ============================================================
// エクスポート / インポート
// ============================================================

function doExportProfiles() {
  const json = exportProfilesJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'prsk-device-profiles.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function doImportProfiles(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const result = importProfilesJSON(reader.result);
      alert(`インポート完了 (追加:${result.added}件 / 更新:${result.updated}件)`);
      renderProfileList();
    } catch (err) {
      alert('インポートに失敗しました: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

window.onload = () => { initSettingsPage(); };
