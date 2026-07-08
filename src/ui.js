
import { state, DIFFICULTIES, DIFF_COLORS, DIFF_ORDER, formatDateTime, nextFrame, delay, clamp, getDifficultyColor, getDifficultyLabel } from './state.js';
import { analyzeLoadedImage, createTesseractWorker } from './ocr.js';
import { getCurrentPreset, getPresetById, setCurrentPresetId, setBestOnly, saveSettings, matchPresetForImage, setPresetCanvasSize, setPresetRegions, createPresetFromImageMeta, getPresets } from './settings.js';
import { executeUploads, executeEdits, deleteDriveFiles, refreshRecordsAfterMutation, getRecordKey, buildNewFileName } from './drive.js';

function escapeHtml(t) {
  return String(t ?? '').replace(/[&<>\"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

export function setLoaderVisible(visible, text = '') {
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loader-text');
  if (loader) loader.style.display = visible ? 'flex' : 'none';
  if (loaderText && text) loaderText.innerText = text;
}

export function setProgress(visible, percent = 0, text = '') {
  const wrap = document.getElementById('view-progress');
  const bar = document.getElementById('view-progress-bar');
  const label = document.getElementById('view-progress-label');
  if (!wrap || !bar || !label) return;
  wrap.style.display = visible ? 'block' : 'none';
  bar.style.width = `${clamp(percent, 0, 100)}%`;
  if (text) label.innerText = text;
}

export function showToast(title, message, type = 'info') {
  const root = document.getElementById('toast-container');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderLeftColor = type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#5b8cff';
  el.innerHTML = `<strong>${title}</strong><div>${message}</div>`;
  root.appendChild(el);
  const timer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    el.style.transition = 'all .2s ease';
    setTimeout(() => el.remove(), 220);
  }, 3500);
  state.toastTimers.set(el, timer);
}

function getDateValue(record) {
  return new Date(record.createdTime || record.modifiedTime || 0).getTime() || 0;
}

export function compareBestForView(a, b) {
  const missA = a.totalMiss ?? 999999;
  const missB = b.totalMiss ?? 999999;
  if (missA !== missB) return missA - missB;
  const comboA = a.combo ?? 0;
  const comboB = b.combo ?? 0;
  if (comboA !== comboB) return comboB - comboA;
  const perfectA = a.perfect ?? 0;
  const perfectB = b.perfect ?? 0;
  if (perfectA !== perfectB) return perfectB - perfectA;
  const greatA = a.great ?? 0;
  const greatB = b.great ?? 0;
  if (greatA !== greatB) return greatA - greatB;
  const goodA = a.good ?? 0;
  const goodB = b.good ?? 0;
  if (goodA !== goodB) return goodA - goodB;
  return getDateValue(a) - getDateValue(b);
}

function buildBestMap(records) {
  const map = new Map();
  for (const rec of records) {
    const key = getRecordKey(rec);
    const current = map.get(key);
    if (!current || compareBestForView(rec, current) < 0) map.set(key, rec);
  }
  return map;
}

function getFilterValue(id, fallback = '') {
  return document.getElementById(id)?.value ?? fallback;
}

function getChecked(id) {
  return !!document.getElementById(id)?.checked;
}

function getPrimarySortMode() {
  return getFilterValue('sort-order', 'title');
}

function getSortDirection() {
  return getFilterValue('sort-direction', 'asc');
}

function getSortComparator(mode, direction) {
  const dir = direction === 'desc' ? -1 : 1;
  const diffAsc = (a, b) => (DIFF_ORDER[a.difficultyRaw] ?? 99) - (DIFF_ORDER[b.difficultyRaw] ?? 99);
  const titleAsc = (a, b) => a.title.localeCompare(b.title, 'ja');
  const missAsc = (a, b) => (a.totalMiss ?? 0) - (b.totalMiss ?? 0);
  const levelAsc = (a, b) => (a.level ?? 0) - (b.level ?? 0);
  const dateAsc = (a, b) => getDateValue(a) - getDateValue(b);

  const compare = {
    title: (a, b) => {
      const p = titleAsc(a, b) * dir;
      return p || diffAsc(a, b) || missAsc(a, b) || dateAsc(a, b);
    },
    level: (a, b) => {
      const p = levelAsc(a, b) * dir;
      return p || diffAsc(a, b) || titleAsc(a, b) || missAsc(a, b) || dateAsc(a, b);
    },
    miss: (a, b) => {
      const p = missAsc(a, b) * dir;
      return p || levelAsc(a, b) || diffAsc(a, b) || titleAsc(a, b) || dateAsc(a, b);
    },
    date: (a, b) => (dateAsc(a, b) * dir),
  };
  return compare[mode] || compare.title;
}

function recordMatchesFilters(record) {
  const fc = getFilterValue('filter-fc', 'all');
  const missMin = getFilterValue('filter-miss-min', '');
  const missMax = getFilterValue('filter-miss-max', '');
  const diff = getFilterValue('filter-diff', 'all');
  const level = getFilterValue('filter-level', '');
  const title = getFilterValue('filter-title', '').trim().toLowerCase();

  if (fc === 'fc' && !record.isFC) return false;
  if (fc === 'unfc' && record.isFC) return false;
  const missValue = record.totalMiss ?? 0;
  if (missMin !== '' && missValue < parseInt(missMin, 10)) return false;
  if (missMax !== '' && missValue > parseInt(missMax, 10)) return false;
  if (diff !== 'all' && record.difficultyRaw !== diff) return false;
  if (level !== '' && String(record.level ?? '') !== String(level)) return false;
  if (title && !String(record.title || '').toLowerCase().includes(title)) return false;
  if (state.settings.bestOnly && !record.isBest) return false;
  return true;
}

function setResultCount(text) {
  const el = document.getElementById('result-count');
  if (el) el.innerText = text;
}

export async function updateView() {
  if (!state.allRecords) return;
  const token = ++state.currentViewToken;
  state.viewBusy = true;
  setProgress(true, 0, '絞り込み中...');
  setResultCount('処理中...');
  await nextFrame();

  const records = state.allRecords;
  const list = [];
  const total = records.length || 1;
  for (let i = 0; i < records.length; i++) {
    if (token !== state.currentViewToken) return;
    const record = records[i];
    if (recordMatchesFilters(record)) list.push(record);
    if (i % 120 === 0) {
      setProgress(true, (i / total) * 45, `絞り込み中... ${i}/${records.length}`);
      await nextFrame();
    }
  }

  const comparator = getSortComparator(getPrimarySortMode(), getSortDirection());
  list.sort(comparator);

  state.filteredRecords = list;
  state.bestMap = buildBestMap(state.allRecords);

  setProgress(true, 50, '描画中...');
  await renderGrid(list, token);

  if (token !== state.currentViewToken) return;
  setProgress(false, 100, '');
  setResultCount(`表示: ${list.length} 件`);
  state.viewBusy = false;
}

export async function renderGrid(records, token = state.currentViewToken) {
  const grid = document.getElementById('grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!records.length) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  const total = records.length || 1;
  for (let i = 0; i < records.length; i++) {
    if (token !== state.currentViewToken) return;
    fragment.appendChild(createCard(records[i]));
    if (i % 80 === 0) {
      setProgress(true, 50 + (i / total) * 50, `描画中... ${i}/${records.length}`);
      await nextFrame();
    }
  }
  grid.appendChild(fragment);
  updateSelectionUI();
}

function createCard(rec) {
  const card = document.createElement('div');
  const best = state.bestMap.get(getRecordKey(rec));
  const isBest = best && best.fileId === rec.fileId;
  rec.isBest = isBest;
  card.className = `card ${rec.isFC ? 'is-fc' : ''} ${isBest ? 'best' : ''}`;
  card.id = `card-${rec.id}`;
  card.dataset.id = rec.id;
  if (state.selectedIds.has(rec.id)) card.classList.add('selected');

  const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w600') : '';
  const large = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
  const diffColor = getDifficultyColor(rec.difficultyRaw);
  const diffLabel = getDifficultyLabel(rec.difficultyRaw);
  const bestRibbon = isBest ? '<div class="best-ribbon">自己ベスト</div>' : '';
  const missDisplay = rec.isFC ? '<span class="miss-val zero">FC-0</span>' : `FC -<span class="miss-val">${rec.totalMiss ?? 0}</span>`;
  const combo = Number(rec.combo || 0);
  const stats = [
    ['P', rec.perfect ?? 0],
    ['G', rec.great ?? 0],
    ['GD', rec.good ?? 0],
    ['B', rec.bad ?? 0],
    ['M', rec.miss ?? 0],
    ['CMB', combo],
  ];

  card.innerHTML = `
    ${bestRibbon}
    <img class="card-img" src="${thumb}" alt="${rec.title || ''}" crossorigin="anonymous">
    <div class="card-body">
      <div class="card-title-row">
        <div class="card-title">${escapeHtml(rec.title || '')}</div>
        <span class="difficulty-badge" style="background:${diffColor}">${diffLabel}</span>
      </div>
      <div class="card-subtitle">Lv.${rec.level ?? ''} / ${formatDateTime(rec.createdTime || rec.modifiedTime)}</div>
      <div class="record-meta">
        <span class="record-mini">ミス ${rec.totalMiss ?? 0}</span>
        <span class="record-mini">コンボ ${combo}</span>
        <span class="record-mini">P ${rec.perfect ?? 0}</span>
        <span class="record-mini">G ${rec.great ?? 0}</span>
      </div>
      <div class="card-footer">
        <div class="miss-display">${missDisplay}</div>
        <div class="stats-row">${stats.map(([k,v]) => `<span>${k} ${v}</span>`).join('')}</div>
      </div>
    </div>
    <div class="card-overlay">
      ${state.isSelectMode ? '' : `
        <button class="btn-overlay" title="編集" data-action="edit">✎</button>
        <button class="btn-overlay del" title="削除" data-action="delete">🗑</button>
      `}
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (state.isSelectMode) {
      toggleSelection(rec.id);
      return;
    }
    if (e.target.closest('[data-action="edit"]')) {
      individualEdit(rec.id);
      return;
    }
    if (e.target.closest('[data-action="delete"]')) {
      individualDelete(rec.id);
      return;
    }
    openImageModal(large);
  });
  return card;
}

function escapeHtml(t) {
  return String(t ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

export function openImageModal(src) {
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalImg');
  if (!modal || !img) return;
  img.src = src;
  modal.style.display = 'flex';
}

export function closeImageModal() {
  const modal = document.getElementById('imageModal');
  if (modal) modal.style.display = 'none';
}

export function updateSelectionUI() {
  const bar = document.getElementById('batch-actions');
  const countSpan = document.getElementById('selected-count');
  if (countSpan) countSpan.innerText = state.selectedIds.size;
  if (bar) bar.style.display = state.selectedIds.size > 0 ? 'flex' : 'none';
}

export function toggleSelectMode() {
  state.isSelectMode = !state.isSelectMode;
  const btn = document.getElementById('btn-select-mode');
  if (btn) btn.classList.toggle('active', state.isSelectMode);
  if (!state.isSelectMode) {
    state.selectedIds.clear();
    updateSelectionUI();
  }
  renderGrid(state.filteredRecords);
}

export function toggleSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  const card = document.getElementById(`card-${id}`);
  if (card) card.classList.toggle('selected', state.selectedIds.has(id));
  updateSelectionUI();
}

export function clearSelection() {
  state.selectedIds.clear();
  updateSelectionUI();
  renderGrid(state.filteredRecords);
}

export function openBatchModal(mode) {
  state.currentMode = mode;
  state.uploadQueue = [];
  state.activeItemId = null;
  document.getElementById('batchModal').style.display = 'flex';
  document.getElementById('batch-sidebar-list').innerHTML = '';
  document.getElementById('batch-editor-container').style.display = 'none';
  document.getElementById('batch-empty-msg').style.display = 'block';
  document.getElementById('batch-status-msg').innerText = '待機中...';
  document.getElementById('btn-exec-batch').disabled = true;
  if (mode === 'upload') {
    document.getElementById('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
    document.getElementById('upload-initial').style.display = 'flex';
    document.getElementById('batch-workspace').style.display = 'none';
    document.getElementById('up-file').value = '';
    document.getElementById('btn-exec-batch').innerText = '全てアップロード';
  } else {
    document.getElementById('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
    document.getElementById('upload-initial').style.display = 'none';
    document.getElementById('batch-workspace').style.display = 'flex';
    document.getElementById('btn-exec-batch').innerText = '保存して反映';
  }
  refreshDeviceSelects();
}

export function closeBatchModal() {
  document.getElementById('batchModal').style.display = 'none';
}

function refreshDeviceSelects() {
  const select = document.getElementById('up-device');
  if (!select) return;
  const presets = getPresets();
  const options = presets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.width && p.height ? ` (${p.width}×${p.height})` : ''}</option>`).join('');
  select.innerHTML = options;
  const current = state.currentUploadDeviceId || state.settings.currentPresetId || presets[0]?.id || '';
  select.value = current;
}

async function loadImageMeta(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight, url });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした'));
    };
    img.src = url;
  });
}

export async function handleFiles(files) {
  if (!files || files.length === 0) return;
  openBatchModal('upload');
  document.getElementById('upload-initial').style.display = 'none';
  document.getElementById('batch-workspace').style.display = 'flex';
  document.getElementById('batch-status-msg').innerText = '画像を処理中...';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const qId = `new_${Date.now()}_${i}`;
    const meta = await loadImageMeta(file);
    const preset = matchPresetForImage(meta.width, meta.height) || getCurrentPreset();
    state.currentUploadDeviceId = preset?.id || state.settings.currentPresetId;
    const item = {
      id: qId,
      file,
      imgUrl: meta.url,
      status: 'pending',
      createdTime: Date.now(),
      devicePresetId: preset?.id || state.settings.currentPresetId,
      originalId: null,
      originalParent: null,
      data: {
        title: '',
        level: '',
        difficultyRaw: 'EXPERT',
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        miss: 0,
        combo: 0,
        totalMiss: 0,
        musicId: null,
      },
    };
    state.uploadQueue.push(item);
    renderSidebarItem(qId);
  }

  refreshDeviceSelects();
  await runBatchAnalysis(state.uploadQueue.filter((item) => item.status === 'pending'));
  if (!state.activeItemId && state.uploadQueue.length > 0) selectItem(state.uploadQueue[0].id);
  checkBatchButton();
}

export async function batchEdit() {
  if (state.selectedIds.size === 0) return;
  openBatchModal('edit');
  document.getElementById('batch-status-msg').innerText = '編集データを準備中...';
  const targets = state.allRecords.filter((r) => state.selectedIds.has(r.id));
  state.uploadQueue = [];

  for (const rec of targets) {
    const qId = `edit_${rec.id}`;
    const item = {
      id: qId,
      file: null,
      imgUrl: rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '',
      status: 'existing',
      createdTime: rec.createdTime,
      originalId: rec.fileId || rec.id,
      originalParent: rec.parentId,
      devicePresetId: state.settings.currentPresetId,
      data: {
        title: rec.title,
        level: rec.level,
        difficultyRaw: rec.difficultyRaw,
        perfect: rec.perfect || 0,
        great: rec.great || 0,
        good: rec.good || 0,
        bad: rec.bad || 0,
        miss: rec.miss || 0,
        combo: rec.combo || 0,
        totalMiss: rec.totalMiss || 0,
        musicId: rec.musicId || null,
      },
    };
    state.uploadQueue.push(item);
    renderSidebarItem(qId);
  }
  refreshDeviceSelects();
  if (state.uploadQueue[0]) selectItem(state.uploadQueue[0].id);
  checkBatchButton();
}

export async function batchDelete() {
  if (state.selectedIds.size === 0) return;
  if (!confirm(`選択した ${state.selectedIds.size} 件を削除します。よろしいですか？`)) return;
  try {
    const targets = state.allRecords.filter((r) => state.selectedIds.has(r.id));
    await deleteDriveFiles(targets);
    state.selectedIds.clear();
    updateSelectionUI();
    showToast('削除完了', '選択したデータを削除しました。', 'success');
    await window.fetchDataFromDrive();
  } catch (error) {
    alert(`削除エラー: ${error.message}`);
  }
}

export function renderSidebarItem(id) {
  const item = state.uploadQueue.find((q) => q.id === id);
  if (!item) return;
  const div = document.createElement('div');
  div.className = 'sidebar-item';
  div.id = `sb-${id}`;
  div.onclick = () => selectItem(id);
  div.innerHTML = `
    <img src="${item.imgUrl}" class="sidebar-thumb" crossorigin="anonymous">
    <div class="sidebar-info">
      <div class="sidebar-title" id="sb-title-${id}">${escapeHtml(item.data.title || '名称未設定')}</div>
      <div class="sidebar-status">
        <span id="sb-status-${id}" class="upload-status ${item.status === 'existing' ? 'done' : item.status}">${item.status === 'existing' ? 'EXIST' : item.status}</span>
        <button class="btn-remove-side" onclick="removeBatchItem(event, '${id}')">
          <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
        </button>
      </div>
    </div>
  `;
  document.getElementById('batch-sidebar-list').appendChild(div);
}

export function selectItem(id) {
  state.activeItemId = id;
  const item = state.uploadQueue.find((q) => q.id === id);
  if (!item) return;
  document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
  document.getElementById(`sb-${id}`)?.classList.add('active');
  document.getElementById('batch-editor-container').style.display = 'flex';
  document.getElementById('batch-empty-msg').style.display = 'none';

  const imgEl = document.getElementById('batch-preview-img');
  imgEl.src = item.imgUrl;
  document.getElementById('up-title').value = item.data.title || '';
  document.getElementById('up-level').value = item.data.level || '';
  document.getElementById('up-diff').value = item.data.difficultyRaw || 'EXPERT';
  document.getElementById('up-perfect').value = item.data.perfect || 0;
  document.getElementById('up-great').value = item.data.great || 0;
  document.getElementById('up-good').value = item.data.good || 0;
  document.getElementById('up-bad').value = item.data.bad || 0;
  document.getElementById('up-miss-detail').value = item.data.miss || 0;
  document.getElementById('up-combo').value = item.data.combo || 0;
  document.getElementById('up-total-miss').innerText = item.data.totalMiss || 0;
  document.getElementById('up-device').value = item.devicePresetId || state.settings.currentPresetId;
  updatePreviewDeviceTag();
}

export function updateCurrentItem(field, value) {
  if (!state.activeItemId) return;
  const item = state.uploadQueue.find((q) => q.id === state.activeItemId);
  if (!item) return;

  if (['level', 'perfect', 'great', 'good', 'bad', 'miss', 'combo'].includes(field)) {
    item.data[field] = parseInt(value, 10) || 0;
  } else if (field === 'difficultyRaw') {
    item.data.difficultyRaw = String(value || 'EXPERT');
    if (item.data.musicId && item.data.difficultyRaw) {
      const newLevel = getLevelFromDb(item.data.musicId, item.data.difficultyRaw);
      if (newLevel) {
        item.data.level = newLevel;
        document.getElementById('up-level').value = newLevel;
      }
    }
  } else if (field === 'devicePresetId') {
    item.devicePresetId = String(value);
    state.currentUploadDeviceId = item.devicePresetId;
    updatePreviewDeviceTag();
  } else {
    item.data[field] = value;
  }

  item.data.totalMiss = (item.data.good || 0) + (item.data.bad || 0) + (item.data.miss || 0);
  document.getElementById('up-total-miss').innerText = item.data.totalMiss;
  document.getElementById(`sb-title-${state.activeItemId}`).innerText = item.data.title || '名称未設定';
  updateSidebarStatus(state.activeItemId);
  checkBatchButton();
}

function updatePreviewDeviceTag() {
  const tag = document.getElementById('preview-device-name');
  const preset = getPresetById(document.getElementById('up-device').value) || getCurrentPreset();
  if (tag) tag.innerText = preset ? `${preset.name}${preset.width && preset.height ? ` (${preset.width}×${preset.height})` : ''}` : '';
}

export function updateSidebarStatus(id) {
  const item = state.uploadQueue.find((q) => q.id === id);
  if (!item) return;
  const statusEl = document.getElementById(`sb-status-${id}`);
  if (!statusEl) return;
  statusEl.innerText = 'OK';
  statusEl.className = 'upload-status done';
}

export function removeBatchItem(e, id) {
  e.stopPropagation();
  state.uploadQueue = state.uploadQueue.filter((q) => q.id !== id);
  document.getElementById(`sb-${id}`)?.remove();
  if (state.activeItemId === id) {
    document.getElementById('batch-editor-container').style.display = 'none';
    document.getElementById('batch-empty-msg').style.display = 'block';
    state.activeItemId = null;
  }
  checkBatchButton();
}

export function checkBatchButton() {
  const btn = document.getElementById('btn-exec-batch');
  if (!btn) return;
  btn.disabled = state.uploadQueue.length === 0;
  const label = state.currentMode === 'upload' ? '全てアップロード' : '保存して反映';
  btn.innerText = state.uploadQueue.length > 0 ? `${label} (${state.uploadQueue.length}件)` : label;
}

function makeWorkerImageUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function runBatchAnalysis(itemsToAnalyze) {
  if (!itemsToAnalyze.length) return;
  const statusMsg = document.getElementById('batch-status-msg');
  if (statusMsg) statusMsg.innerText = '解析中... (しばらくお待ちください)';
  const worker = await createTesseractWorker();
  let processed = 0;

  for (const item of itemsToAnalyze) {
    const status = document.getElementById(`sb-status-${item.id}`);
    if (status) {
      status.innerText = '解析中';
      status.className = 'upload-status processing';
    }
    try {
      const img = await makeWorkerImageUrl(item.imgUrl);
      const preset = getPresetById(item.devicePresetId) || getCurrentPreset();
      const res = await analyzeLoadedImage(img, worker, preset);
      const matchedMusic = findBestMatchMusic(res.title);
      const finalTitle = matchedMusic ? matchedMusic.title : res.title.replace(/\r?\n/g, '').trim();
      const musicId = matchedMusic ? matchedMusic.id : null;
      const level = musicId ? (getLevelFromDb(musicId, res.difficultyRaw) || '') : (item.data.level || '');
      item.data = {
        title: finalTitle,
        level,
        difficultyRaw: res.difficultyRaw,
        perfect: res.perfect,
        great: res.great,
        good: res.good,
        bad: res.bad,
        miss: res.miss,
        combo: res.combo,
        totalMiss: res.totalMiss,
        musicId,
      };
      item.status = 'done';
      item.devicePresetId = preset?.id || item.devicePresetId;
      if (document.getElementById(`sb-title-${item.id}`)) {
        document.getElementById(`sb-title-${item.id}`).innerText = finalTitle || '名称未設定';
      }
    } catch (error) {
      console.error('Analysis Failed', error);
      item.status = 'error';
      if (status) {
        status.innerText = 'ERR';
        status.className = 'upload-status error';
      }
    }
    updateSidebarStatus(item.id);
    if (item.status === 'done' && state.activeItemId === item.id) selectItem(item.id);
    processed += 1;
    if (statusMsg) statusMsg.innerText = `解析中... ${processed}/${itemsToAnalyze.length}`;
  }
  await worker.terminate();
  if (statusMsg) statusMsg.innerText = '処理完了';
  checkBatchButton();
}

export async function reanalyzeCurrentItem() {
  if (!state.activeItemId) return;
  const item = state.uploadQueue.find((q) => q.id === state.activeItemId);
  if (item) await runBatchAnalysis([item]);
}

export async function analyzeAllInBatch() {
  if (!state.uploadQueue.length) return;
  await runBatchAnalysis(state.uploadQueue.filter((item) => item.status !== 'deleted'));
}

function findBestMatchMusic(text) {
  if (!state.dbMusics?.length) return null;
  const target = normalizeString(text);
  if (!target) return null;
  let best = null;
  let min = Infinity;
  for (const music of state.dbMusics) {
    const titleNorm = normalizeString(music.title);
    const dist = levenshtein(target, titleNorm);
    const score = dist / Math.max(target.length, titleNorm.length, 1);
    if (score < min) {
      min = score;
      best = music;
    }
  }
  return best;
}

function normalizeString(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .replace(/[\s\-_]/g, '');
}

function levenshtein(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 0; i < b.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < a.length; j++) {
      if (a[j] === b[i]) cur.push(prev[j]);
      else cur.push(1 + Math.min(prev[j], prev[j + 1], cur[cur.length - 1]));
    }
    prev = cur;
  }
  return prev[prev.length - 1];
}

function normalizeDiffKey(diffRaw) {
  return String(diffRaw || '').toLowerCase();
}

function getLevelFromDb(musicId, diffRaw) {
  if (!musicId || !state.dbDiffs?.length) return '';
  const key = normalizeDiffKey(diffRaw);
  const row = state.dbDiffs.find((d) => String(d.musicId) === String(musicId) && normalizeDiffKey(d.musicDifficulty || d.difficulty || d.name) === key);
  return row ? row.playLevel || row.level || '' : '';
}

export async function handleBatchExecution() {
  const btn = document.getElementById('btn-exec-batch');
  btn.disabled = true;
  btn.innerText = '処理中...';

  const beforeMap = new Map();
  for (const rec of state.allRecords) {
    const key = getRecordKey(rec);
    const current = beforeMap.get(key);
    if (!current || compareBestForView(rec, current) < 0) beforeMap.set(key, rec);
  }

  try {
    let touched = [];
    if (state.currentMode === 'upload') {
      const result = await executeUploads(state.uploadQueue);
      touched = result.created;
      showToast('アップロード完了', `${result.successCount}件を保存しました。`, 'success');
    } else {
      const result = await executeEdits(state.uploadQueue);
      touched = result.edited;
      showToast('保存完了', `${result.successCount}件を更新しました。`, 'success');
    }

    if (touched.length) {
      await refreshRecordsAfterMutation(beforeMap, touched, state.currentMode === 'upload' ? 'アップロード' : '編集');
    } else {
      await window.fetchDataFromDrive();
    }
    closeBatchModal();
  } catch (error) {
    console.error(error);
    alert(error?.message || String(error));
  } finally {
    btn.disabled = false;
    checkBatchButton();
  }
}

export function individualEdit(id) {
  const rec = state.allRecords.find((r) => r.id === id);
  if (!rec) return;
  state.selectedIds = new Set([id]);
  updateSelectionUI();
  batchEdit();
}

export async function individualDelete(id) {
  const rec = state.allRecords.find((r) => r.id === id);
  if (!rec) return;
  if (!confirm(`「${rec.title}」を削除します。よろしいですか？`)) return;
  await deleteDriveFiles([rec]);
  showToast('削除完了', '1件を削除しました。', 'success');
  await window.fetchDataFromDrive();
}

export function openSettingsModal() {
  document.getElementById('settings-modal').style.display = 'flex';
  renderSettingsModal();
}

export function closeSettingsModal() {
  document.getElementById('settings-modal').style.display = 'none';
}

export function renderSettingsModal() {
  const list = document.getElementById('preset-list');
  if (!list) return;
  list.innerHTML = '';
  for (const preset of getPresets()) {
    const item = document.createElement('div');
    item.className = `preset-item ${preset.id === state.settings.currentPresetId ? 'active' : ''}`;
    item.innerHTML = `<strong>${escapeHtml(preset.name)}</strong><div style="font-size:.8rem;color:#667">${preset.width && preset.height ? `${preset.width}×${preset.height}` : 'サイズ未登録'}</div>`;
    item.onclick = () => {
      setCurrentPresetId(preset.id);
      renderSettingsModal();
      populateSettingsForm();
      renderRegionEditor();
      refreshDeviceSelects();
    };
    list.appendChild(item);
  }
  populateSettingsForm();
  renderRegionEditor();
}

function populateSettingsForm() {
  const preset = getCurrentPreset();
  document.getElementById('preset-name').value = preset.name || '';
  document.getElementById('preset-width').value = preset.width || '';
  document.getElementById('preset-height').value = preset.height || '';
  document.getElementById('sample-file').value = '';
  const select = document.getElementById('settings-preset-select');
  if (select) {
    select.innerHTML = getPresets().map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    select.value = preset.id;
  }
}

export function syncPresetForm() {
  const preset = getCurrentPreset();
  if (!preset) return;
  setCurrentPresetId(preset.id);
  setPresetCanvasSize(preset.id, document.getElementById('preset-width').value, document.getElementById('preset-height').value);
  const current = getPresets().find((p) => p.id === preset.id);
  if (current) current.name = document.getElementById('preset-name').value || current.name;
  setPresetRegions(preset.id, {
    diff: readRect('diff'),
    title: readRect('title'),
    result: readRect('result'),
    combo: readRect('combo'),
  });
  saveSettings();
  renderSettingsModal();
  refreshDeviceSelects();
}

function readRect(name) {
  const x = document.getElementById(`rect-${name}-x`)?.value;
  const y = document.getElementById(`rect-${name}-y`)?.value;
  const w = document.getElementById(`rect-${name}-w`)?.value;
  const h = document.getElementById(`rect-${name}-h`)?.value;
  return { x: Number(x) / 100, y: Number(y) / 100, w: Number(w) / 100, h: Number(h) / 100 };
}

export function renderRegionEditor() {
  const preset = getCurrentPreset();
  const img = document.getElementById('settings-preview-img');
  const layer = document.getElementById('region-layer');
  if (!img || !layer) return;
  const sample = preset.sampleDataUrl || '';
  img.src = sample || img.dataset.fallback || '';
  layer.innerHTML = '';
  const rects = ['diff', 'title', 'result', 'combo'];
  for (const name of rects) {
    const rect = preset.regions[name];
    const box = document.createElement('div');
    box.className = 'region-box';
    box.dataset.name = name;
    box.style.borderColor = DIFF_COLORS[getDifficultyByRegion(name)] || '#5b8cff';
    box.style.color = DIFF_COLORS[getDifficultyByRegion(name)] || '#5b8cff';
    const syncBox = () => {
      const imgRect = img.getBoundingClientRect();
      const layerRect = layer.getBoundingClientRect();
      const left = rect.x * 100;
      const top = rect.y * 100;
      const width = rect.w * 100;
      const height = rect.h * 100;
      box.style.left = `${left}%`;
      box.style.top = `${top}%`;
      box.style.width = `${width}%`;
      box.style.height = `${height}%`;
      box.querySelector('.label').innerText = name.toUpperCase();
    };
    box.innerHTML = `<div class="label">${name.toUpperCase()}</div><div class="handle"></div>`;
    layer.appendChild(box);
    const refreshInputs = () => {
      document.getElementById(`rect-${name}-x`).value = Math.round(rect.x * 1000) / 10;
      document.getElementById(`rect-${name}-y`).value = Math.round(rect.y * 1000) / 10;
      document.getElementById(`rect-${name}-w`).value = Math.round(rect.w * 1000) / 10;
      document.getElementById(`rect-${name}-h`).value = Math.round(rect.h * 1000) / 10;
      syncBox();
    };
    refreshInputs();
    attachRegionDrag(box, rect, refreshInputs);
    const inputs = ['x', 'y', 'w', 'h'];
    for (const key of inputs) {
      const el = document.getElementById(`rect-${name}-${key}`);
      el.oninput = () => {
        rect[key] = Number(el.value) / 100;
        rect.x = clamp(rect.x, 0, 1);
        rect.y = clamp(rect.y, 0, 1);
        rect.w = clamp(rect.w, 0.01, 1);
        rect.h = clamp(rect.h, 0.01, 1);
        setPresetRegions(preset.id, { [name]: rect });
        syncBox();
      };
    }
  }
}

function attachRegionDrag(box, rect, refreshInputs) {
  let dragging = false;
  let resizing = false;
  let start = null;
  box.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const handle = e.target.closest('.handle');
    dragging = !handle;
    resizing = !!handle;
    start = { x: e.clientX, y: e.clientY, rect: { ...rect } };
    box.setPointerCapture?.(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!start) return;
    const layer = document.getElementById('region-layer');
    const bounds = layer.getBoundingClientRect();
    const dx = (e.clientX - start.x) / bounds.width;
    const dy = (e.clientY - start.y) / bounds.height;
    if (dragging) {
      rect.x = clamp(start.rect.x + dx, 0, 1 - rect.w);
      rect.y = clamp(start.rect.y + dy, 0, 1 - rect.h);
    } else if (resizing) {
      rect.w = clamp(start.rect.w + dx, 0.01, 1 - rect.x);
      rect.h = clamp(start.rect.h + dy, 0.01, 1 - rect.y);
    }
    refreshInputs();
  });
  window.addEventListener('pointerup', () => {
    if (!start) return;
    const preset = getCurrentPreset();
    setPresetRegions(preset.id, { [box.dataset.name]: rect });
    dragging = false;
    resizing = false;
    start = null;
  }, { once: true });
}

function getDifficultyByRegion(name) {
  return name === 'diff' ? 'EXPERT' : 'MASTER';
}

export async function handleSampleUpload(file) {
  const preset = getCurrentPreset();
  const dataUrl = await readFileAsDataUrl(file);
  const img = document.getElementById('settings-preview-img');
  img.src = dataUrl;
  const meta = await imageMetaFromDataUrl(dataUrl);
  preset.sampleDataUrl = dataUrl;
  setPresetCanvasSize(preset.id, meta.width, meta.height);
  const best = matchPresetForImage(meta.width, meta.height) || preset;
  setCurrentPresetId(best.id);
  renderSettingsModal();
  refreshDeviceSelects();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageMetaFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export function refreshDeviceSelects() {
  const select = document.getElementById('up-device');
  if (!select) return;
  select.innerHTML = getPresets().map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.width && p.height ? ` (${p.width}×${p.height})` : ''}</option>`).join('');
  select.value = state.currentUploadDeviceId || state.settings.currentPresetId || getPresets()[0]?.id || '';
}

export function initMainUI() {
  const bestOnly = document.getElementById('filter-best-only');
  if (bestOnly) bestOnly.checked = !!state.settings.bestOnly;
  refreshDeviceSelects();
  renderSettingsModal();
}

window.compareBestForView = compareBestForView;
window.updateView = updateView;
window.renderGrid = renderGrid;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.toggleSelectMode = toggleSelectMode;
window.toggleSelection = toggleSelection;
window.clearSelection = clearSelection;
window.openBatchModal = openBatchModal;
window.closeBatchModal = closeBatchModal;
window.handleFiles = handleFiles;
window.batchEdit = batchEdit;
window.batchDelete = batchDelete;
window.renderSidebarItem = renderSidebarItem;
window.selectItem = selectItem;
window.updateCurrentItem = updateCurrentItem;
window.updateSidebarStatus = updateSidebarStatus;
window.removeBatchItem = removeBatchItem;
window.checkBatchButton = checkBatchButton;
window.runBatchAnalysis = runBatchAnalysis;
window.reanalyzeCurrentItem = reanalyzeCurrentItem;
window.analyzeAllInBatch = analyzeAllInBatch;
window.handleBatchExecution = handleBatchExecution;
window.individualEdit = individualEdit;
window.individualDelete = individualDelete;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.renderSettingsModal = renderSettingsModal;
window.syncPresetForm = syncPresetForm;
window.handleSampleUpload = handleSampleUpload;
window.showToast = showToast;
window.setLoaderVisible = setLoaderVisible;
window.setProgress = setProgress;
window.initMainUI = initMainUI;
