import { DIFFICULTY_META, DIFFICULTY_ORDER, SORT_DIRECTION_LABEL, SORT_OPTIONS } from './config.js';
import { state, saveSettings, updateSettings } from './state.js';
import { analyzeImageFromElement } from './ocr.js';
import {
  applyFilters,
  buildMetaKey,
  compareScore,
  computeBestMap,
  difficultyColor,
  difficultyShort,
  isSelfBest,
  normalizeDifficulty,
} from './records.js';
import {
  asNumber,
  clamp,
  escapeHtml,
  formatDateTime,
  setLoading,
  setText,
  showToast,
  sleep,
  uid,
} from './utils.js';
import { deleteRecord, fetchDataFromDrive, setLoggedInState, uploadNewRecord, updateExistingRecord } from './drive.js';

function $id(id) {
  return document.getElementById(id);
}

function getSettings() {
  return state.settings;
}

function getCropInputs(regionKey) {
  return {
    x: $id(`crop-${regionKey}-x`),
    y: $id(`crop-${regionKey}-y`),
    w: $id(`crop-${regionKey}-w`),
    h: $id(`crop-${regionKey}-h`),
  };
}

function regionRectCss(region) {
  return {
    left: `${(region.x * 100).toFixed(2)}%`,
    top: `${(region.y * 100).toFixed(2)}%`,
    width: `${(region.w * 100).toFixed(2)}%`,
    height: `${(region.h * 100).toFixed(2)}%`,
  };
}

function getCropRegionSettings() {
  const settings = getSettings();
  return settings.cropRegions;
}

function updateCropPreview() {
  const image = $id('settings-preview-image');
  const stage = $id('settings-preview-stage');
  if (!image || !stage || !image.src) return;

  const regions = getCropRegionSettings();
  for (const key of ['diff', 'title', 'result', 'combo']) {
    const overlay = $id(`overlay-${key}`);
    if (!overlay) continue;
    const rect = regionRectCss(regions[key]);
    overlay.style.left = rect.left;
    overlay.style.top = rect.top;
    overlay.style.width = rect.width;
    overlay.style.height = rect.height;
  }
}

function syncCropInputsFromSettings() {
  const regions = getCropRegionSettings();
  for (const key of ['diff', 'title', 'result', 'combo']) {
    const region = regions[key];
    const inputs = getCropInputs(key);
    if (!region || !inputs.x) continue;
    inputs.x.value = region.x;
    inputs.y.value = region.y;
    inputs.w.value = region.w;
    inputs.h.value = region.h;
  }
  updateCropPreview();
}

function readCropInputsIntoSettings() {
  const next = { ...getSettings(), cropRegions: { ...getCropRegionSettings() } };
  for (const key of ['diff', 'title', 'result', 'combo']) {
    const inputs = getCropInputs(key);
    next.cropRegions[key] = {
      x: clamp(inputs.x.value, 0, 1),
      y: clamp(inputs.y.value, 0, 1),
      w: clamp(inputs.w.value, 0.01, 1),
      h: clamp(inputs.h.value, 0.01, 1),
    };
  }
  updateSettings({ cropRegions: next.cropRegions });
  saveSettings(state.settings);
  updateSettingsUi();
  updateCropPreview();
}

function updateSettingsUi() {
  const settings = getSettings();
  const sortKey = $id('sort-order');
  if (sortKey) sortKey.value = settings.sort.key;
  const sortDirection = $id('sort-direction');
  if (sortDirection) {
    sortDirection.dataset.value = settings.sort.direction;
    sortDirection.innerHTML = `<span class="material-symbols-outlined">swap_vert</span> ${SORT_DIRECTION_LABEL[settings.sort.direction]}`;
  }

  const fc = $id('filter-fc');
  const missMin = $id('filter-miss-min');
  const missMax = $id('filter-miss-max');
  const diff = $id('filter-diff');
  const title = $id('filter-title');
  const level = $id('filter-level');
  const bestOnly = $id('btn-best-only');

  if (fc) fc.value = settings.filters.fc;
  if (missMin) missMin.value = settings.filters.missMin;
  if (missMax) missMax.value = settings.filters.missMax;
  if (diff) diff.value = settings.filters.diff;
  if (title) title.value = settings.filters.title;
  if (level) level.value = settings.filters.level;
  if (bestOnly) bestOnly.classList.toggle('active', Boolean(settings.filters.selfBestOnly));

  syncCropInputsFromSettings();
  updateSortDirectionButton();
  updateBestOnlyButton();
}

function updateSortDirectionButton() {
  const button = $id('sort-direction');
  if (!button) return;
  const direction = getSettings().sort.direction;
  button.classList.toggle('active', direction === 'asc');
}

function updateBestOnlyButton() {
  const button = $id('btn-best-only');
  if (!button) return;
  button.classList.toggle('active', Boolean(getSettings().filters.selfBestOnly));
  button.innerHTML = Boolean(getSettings().filters.selfBestOnly)
    ? '<span class="material-symbols-outlined">verified</span> 自己ベストのみ'
    : '<span class="material-symbols-outlined">verified</span> 自己ベストのみ';
}

export function initializeUi() {
  wireControls();
  wireBatchModal();
  wireSettingsModal();
  updateSettingsUi();
  refreshView();
}

function wireControls() {
  const sortOrder = $id('sort-order');
  const sortDirection = $id('sort-direction');
  const fc = $id('filter-fc');
  const missMin = $id('filter-miss-min');
  const missMax = $id('filter-miss-max');
  const diff = $id('filter-diff');
  const title = $id('filter-title');
  const level = $id('filter-level');
  const bestOnly = $id('btn-best-only');

  if (sortOrder) sortOrder.addEventListener('change', () => {
    updateSettings({ sort: { ...getSettings().sort, key: sortOrder.value } });
    refreshView();
  });

  if (sortDirection) sortDirection.addEventListener('click', () => {
    const next = getSettings().sort.direction === 'asc' ? 'desc' : 'asc';
    updateSettings({ sort: { ...getSettings().sort, direction: next } });
    updateSortDirectionButton();
    refreshView();
  });

  const bindFilter = () => {
    updateSettings({
      filters: {
        ...getSettings().filters,
        fc: fc?.value ?? 'all',
        missMin: missMin?.value ?? '',
        missMax: missMax?.value ?? '',
        diff: diff?.value ?? 'all',
        title: title?.value ?? '',
        level: level?.value ?? '',
      },
    });
    refreshView();
  };

  if (fc) fc.addEventListener('change', bindFilter);
  if (missMin) missMin.addEventListener('input', bindFilter);
  if (missMax) missMax.addEventListener('input', bindFilter);
  if (diff) diff.addEventListener('change', bindFilter);
  if (title) title.addEventListener('input', bindFilter);
  if (level) level.addEventListener('input', bindFilter);

  if (bestOnly) bestOnly.addEventListener('click', () => {
    updateSettings({ filters: { ...getSettings().filters, selfBestOnly: !getSettings().filters.selfBestOnly } });
    updateBestOnlyButton();
    refreshView();
  });

  const openSettings = $id('btn-open-settings');
  if (openSettings) openSettings.addEventListener('click', openSettingsModal);

}

function wireBatchModal() {
  const dropZone = $id('drop-zone');
  const fileInput = $id('up-file');

  if (dropZone) {
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragover');
      if (event.dataTransfer.files.length > 0) handleFiles(event.dataTransfer.files);
    });
    dropZone.addEventListener('click', () => fileInput?.click());
  }

  if (fileInput) fileInput.addEventListener('change', (event) => handleFiles(event.target.files));
}

function wireSettingsModal() {
  const sampleInput = $id('settings-sample-file');
  if (sampleInput) sampleInput.addEventListener('change', handleSampleImageUpload);

  for (const key of ['diff', 'title', 'result', 'combo']) {
    for (const prop of ['x', 'y', 'w', 'h']) {
      const input = $id(`crop-${key}-${prop}`);
      if (!input) continue;
      input.addEventListener('input', () => {
        readCropInputsIntoSettings();
      });
    }
  }

  const sampleAnalyze = $id('btn-sample-analyze');
  if (sampleAnalyze) sampleAnalyze.addEventListener('click', analyzeSampleImage);
  const resetButton = $id('btn-reset-crops');
  if (resetButton) resetButton.addEventListener('click', resetCropSettings);
}

export function openSettingsModal() {
  const modal = $id('settingsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  syncCropInputsFromSettings();
  updateCropPreview();
}

export function closeSettingsModal() {
  const modal = $id('settingsModal');
  if (!modal) return;
  modal.style.display = 'none';
}

function resetCropSettings() {
  updateSettings({
    cropRegions: {
      diff: { x: 0.20, y: 0.07, w: 0.10, h: 0.04 },
      title: { x: 0.19, y: 0.01, w: 0.32, h: 0.05 },
      result: { x: 0.10, y: 0.55, w: 0.20, h: 0.28 },
      combo: { x: 0.58, y: 0.36, w: 0.28, h: 0.16 },
    },
  });
  saveSettings(state.settings);
  syncCropInputsFromSettings();
  showToast('読み取り範囲を初期値に戻しました', 'info');
}

async function handleSampleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (state.sampleImageUrl) URL.revokeObjectURL(state.sampleImageUrl);
  state.sampleImageUrl = URL.createObjectURL(file);
  state.sampleFileName = file.name;

  const previewImage = $id('settings-preview-image');
  const note = $id('sample-preview-note');
  if (previewImage) previewImage.src = state.sampleImageUrl;
  if (note) note.textContent = `サンプル: ${file.name}`;
  updateCropPreview();
}

async function analyzeSampleImage() {
  const previewImage = $id('settings-preview-image');
  const resultBox = $id('settings-analysis-result');
  if (!previewImage?.src) {
    showToast('サンプル画像を選択してください', 'error');
    return;
  }

  try {
    resultBox.textContent = '解析中...';
    const analysis = await analyzeImageFromElement(previewImage, getSettings().cropRegions);
    resultBox.textContent = JSON.stringify(analysis, null, 2);
  } catch (error) {
    console.error(error);
    resultBox.textContent = '解析に失敗しました';
  }
}

export function openImageModal(src) {
  if (!src) return;
  const modal = $id('imageModal');
  const img = $id('modalImg');
  if (modal && img) {
    img.src = src;
    modal.style.display = 'flex';
  }
}

export function closeImageModal() {
  const modal = $id('imageModal');
  if (modal) modal.style.display = 'none';
}

export function openBatchModal(mode) {
  state.currentMode = mode;
  const modal = $id('batchModal');
  if (!modal) return;
  modal.style.display = 'flex';
  state.editorQueue = [];
  state.activeItemId = null;
  const sidebar = $id('batch-sidebar-list');
  const workspace = $id('batch-workspace');
  const emptyMsg = $id('batch-empty-msg');
  const uploadInitial = $id('upload-initial');
  const status = $id('batch-status-msg');
  const execButton = $id('btn-exec-batch');
  const fileInput = $id('up-file');

  if (sidebar) sidebar.innerHTML = '';
  if (workspace) workspace.style.display = mode === 'upload' ? 'none' : 'flex';
  if (emptyMsg) emptyMsg.style.display = 'block';
  if (uploadInitial) uploadInitial.style.display = mode === 'upload' ? 'flex' : 'none';
  if (status) status.textContent = mode === 'upload' ? '画像を選択してください' : '編集対象を準備中...';
  if (execButton) {
    execButton.disabled = true;
    execButton.textContent = mode === 'upload' ? '全てアップロード' : '保存して反映';
  }
  if (fileInput) fileInput.value = '';
  updateBatchStatusCounter();
}

export function closeBatchModal() {
  const modal = $id('batchModal');
  if (modal) modal.style.display = 'none';
}

function createQueueItemFromFile(file, index) {
  return {
    id: `new_${Date.now()}_${index}_${uid('batch')}`,
    file,
    imgUrl: URL.createObjectURL(file),
    status: 'pending',
    data: {
      title: '',
      level: '',
      diff: 'EXPERT',
      stats: {
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        miss: 0,
        combo: 0,
      },
      missCount: 0,
      musicId: null,
    },
    originalId: null,
    originalParent: null,
    createdTime: null,
  };
}

export async function handleFiles(files) {
  if (!files || files.length === 0) return;
  const uploadInitial = $id('upload-initial');
  const workspace = $id('batch-workspace');
  const status = $id('batch-status-msg');
  if (uploadInitial) uploadInitial.style.display = 'none';
  if (workspace) workspace.style.display = 'flex';
  if (status) status.textContent = '画像を処理中...';

  const newItems = [];
  for (let i = 0; i < files.length; i += 1) {
    const item = createQueueItemFromFile(files[i], i);
    state.editorQueue.push(item);
    newItems.push(item);
    renderSidebarItem(item);
  }

  if (newItems.length > 0) {
    await runBatchAnalysis(newItems.filter((item) => item.status === 'pending'));
    if (!state.activeItemId) selectItem(newItems[0].id);
  }
  checkBatchButton();
}

export async function batchEdit() {
  if (state.selectedIds.size === 0) {
    showToast('対象を選択してください', 'error');
    return;
  }

  openBatchModal('edit');
  const targets = state.records.filter((record) => state.selectedIds.has(record.id));
  const status = $id('batch-status-msg');
  if (status) status.textContent = '編集データを準備中...';

  for (const record of targets) {
    const qItem = {
      id: `edit_${record.id}`,
      file: null,
      imgUrl: record.thumbnail ? record.thumbnail.replace('=s220', '=w1600') : '',
      status: 'existing',
      data: {
        title: record.title,
        level: record.level,
        diff: normalizeDifficulty(record.difficultyRaw),
        stats: {
          perfect: record.perfectCount ?? 0,
          great: record.greatCount ?? 0,
          good: record.goodCount ?? 0,
          bad: record.badCount ?? 0,
          miss: record.missDetailCount ?? 0,
          combo: record.comboCount ?? 0,
        },
        missCount: record.missCount ?? 0,
        musicId: record.musicId ?? null,
      },
      originalId: record.id,
      originalParent: record.parentId,
      createdTime: record.createdTime || null,
    };
    state.editorQueue.push(qItem);
    renderSidebarItem(qItem);
  }

  if (state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
  if (status) status.textContent = '編集準備完了';
  checkBatchButton();
}

function updateBatchStatusCounter() {
  const count = $id('selected-count');
  if (count) count.textContent = state.selectedIds.size;
  const bar = $id('batch-actions');
  if (bar) bar.style.display = state.selectedIds.size > 0 ? 'flex' : 'none';
}

export function toggleSelectMode() {
  state.isSelectMode = !state.isSelectMode;
  const button = $id('btn-select-mode');
  if (button) button.classList.toggle('active', state.isSelectMode);

  if (!state.isSelectMode) {
    state.selectedIds.clear();
    updateBatchStatusCounter();
  }
  refreshView();
}

export function toggleSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);

  const card = $id(`card-${id}`);
  if (card) card.classList.toggle('selected', state.selectedIds.has(id));
  updateBatchStatusCounter();
}

export function clearSelection() {
  state.selectedIds.clear();
  updateBatchStatusCounter();
  refreshView();
}

export function individualEdit(id) {
  state.selectedIds.clear();
  state.selectedIds.add(id);
  batchEdit();
}

export async function individualDelete(id) {
  if (!confirm('このリザルトを削除しますか？')) return;
  setLoading(true, '削除中...');
  try {
    await deleteRecord(id);
    showToast('削除しました', 'success');
    await fetchDataFromDrive();
  } catch (error) {
    console.error(error);
    showToast(error?.message || '削除に失敗しました', 'error');
  } finally {
    setLoading(false);
  }
}

export async function batchDelete() {
  if (state.selectedIds.size === 0) return;
  if (!confirm(`選択した ${state.selectedIds.size} 件を削除しますか？`)) return;

  setLoading(true, '削除中...');
  try {
    for (const id of state.selectedIds) {
      await deleteRecord(id);
    }
    state.selectedIds.clear();
    updateBatchStatusCounter();
    showToast('削除しました', 'success');
    await fetchDataFromDrive();
  } catch (error) {
    console.error(error);
    showToast(error?.message || '削除に失敗しました', 'error');
  } finally {
    setLoading(false);
  }
}

export function renderSidebarItem(item) {
  const list = $id('batch-sidebar-list');
  if (!list) return;
  const card = document.createElement('div');
  card.className = 'sidebar-item';
  card.id = `sb-${item.id}`;
  card.addEventListener('click', () => selectItem(item.id));

  card.innerHTML = `
    <img src="${item.imgUrl}" alt="" class="sidebar-thumb">
    <div class="sidebar-meta">
      <div class="sidebar-title">${escapeHtml(item.data.title || '未解析')}</div>
      <div class="sidebar-subtitle">${escapeHtml(item.data.level || '-')} / ${escapeHtml(item.data.diff || '-')}</div>
      <div class="sidebar-subtitle">
        <span id="sb-status-${item.id}" class="upload-status ${item.status === 'existing' ? 'ready' : 'pending'}">${item.status === 'existing' ? '既存' : '待機中'}</span>
      </div>
    </div>
    <button class="sidebar-remove" title="削除">×</button>
  `;

  const removeButton = card.querySelector('.sidebar-remove');
  removeButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    removeBatchItem(item.id);
  });

  list.appendChild(card);
}

function removeBatchItem(id) {
  const index = state.editorQueue.findIndex((item) => item.id === id);
  if (index === -1) return;
  const item = state.editorQueue[index];
  if (item?.imgUrl?.startsWith('blob:')) URL.revokeObjectURL(item.imgUrl);
  state.editorQueue.splice(index, 1);
  const node = $id(`sb-${id}`);
  node?.remove();
  if (state.activeItemId === id) {
    state.activeItemId = null;
    const preview = $id('batch-editor-container');
    const empty = $id('batch-empty-msg');
    if (preview) preview.style.display = 'none';
    if (empty) empty.style.display = 'block';
  }
  checkBatchButton();
}

export function selectItem(id) {
  state.activeItemId = id;
  const item = state.editorQueue.find((entry) => entry.id === id);
  if (!item) return;

  for (const queueItem of state.editorQueue) {
    const sidebar = $id(`sb-${queueItem.id}`);
    sidebar?.classList.toggle('active', queueItem.id === id);
  }

  const previewContainer = $id('batch-editor-container');
  const emptyMsg = $id('batch-empty-msg');
  const previewImg = $id('batch-preview-img');

  if (previewContainer) previewContainer.style.display = 'flex';
  if (emptyMsg) emptyMsg.style.display = 'none';
  if (previewImg) previewImg.src = item.imgUrl || '';

  $id('up-title').value = item.data.title ?? '';
  $id('up-level').value = item.data.level ?? '';
  $id('up-diff').value = normalizeDifficulty(item.data.diff ?? 'EXPERT');
  $id('up-perfect').value = item.data.stats.perfect ?? 0;
  $id('up-great').value = item.data.stats.great ?? 0;
  $id('up-good').value = item.data.stats.good ?? 0;
  $id('up-bad').value = item.data.stats.bad ?? 0;
  $id('up-miss-detail').value = item.data.stats.miss ?? 0;
  $id('up-combo').value = item.data.stats.combo ?? 0;
  updateTotalCounters(item);
  updateSidebarStatus(item.id);
}

export function updateCurrentItem(field, value) {
  if (!state.activeItemId) return;
  const item = state.editorQueue.find((entry) => entry.id === state.activeItemId);
  if (!item) return;

  if (field === 'title' || field === 'level' || field === 'diff' || field === 'musicId') {
    item.data[field] = value;
  } else if (field in item.data.stats) {
    item.data.stats[field] = asNumber(value, 0);
    item.data.missCount = asNumber(item.data.stats.good, 0) + asNumber(item.data.stats.bad, 0) + asNumber(item.data.stats.miss, 0);
  } else if (field === 'missCount') {
    item.data.missCount = asNumber(value, 0);
  }
  updateTotalCounters(item);
  updateSidebarStatus(item.id);
  checkBatchButton();
}

function updateTotalCounters(item) {
  const totalMiss = asNumber(item.data.stats.good, 0) + asNumber(item.data.stats.bad, 0) + asNumber(item.data.stats.miss, 0);
  item.data.missCount = totalMiss;
  const totalMissText = $id('up-total-miss');
  if (totalMissText) totalMissText.textContent = String(totalMiss);
  const comboText = $id('up-combo-value');
  if (comboText) comboText.textContent = String(asNumber(item.data.stats.combo, 0));
}

function updateSidebarStatus(id) {
  const item = state.editorQueue.find((entry) => entry.id === id);
  const status = $id(`sb-status-${id}`);
  if (!item || !status) return;
  if (item.status === 'existing') {
    status.textContent = '既存';
    status.className = 'upload-status ready';
    return;
  }
  if (item.status === 'error') {
    status.textContent = '失敗';
    status.className = 'upload-status error';
    return;
  }
  if (item.status === 'analyzing') {
    status.textContent = '解析中';
    status.className = 'upload-status processing';
    return;
  }
  if (item.status === 'ready') {
    status.textContent = '準備完了';
    status.className = 'upload-status ready';
    return;
  }
  status.textContent = '待機中';
  status.className = 'upload-status pending';
}

function checkBatchButton() {
  const button = $id('btn-exec-batch');
  if (!button) return;
  button.disabled = state.editorQueue.length === 0;
}

export async function runBatchAnalysis(itemsToAnalyze) {
  if (!itemsToAnalyze || itemsToAnalyze.length === 0) return;
  for (const item of itemsToAnalyze) {
    item.status = 'analyzing';
    updateSidebarStatus(item.id);
    if ($id('batch-status-msg')) {
      $id('batch-status-msg').textContent = `解析中... (${state.editorQueue.indexOf(item) + 1}/${state.editorQueue.length})`;
    }

    try {
      const image = await loadImage(item.imgUrl);
      const analysis = await analyzeImageFromElement(image, getSettings().cropRegions);
      if (analysis) {
        item.data.title = analysis.title || item.data.title;
        item.data.level = analysis.level || item.data.level;
        item.data.diff = analysis.difficulty || item.data.diff;
        item.data.musicId = analysis.musicId || item.data.musicId;
        item.data.stats = {
          perfect: analysis.metrics.perfect,
          great: analysis.metrics.great,
          good: analysis.metrics.good,
          bad: analysis.metrics.bad,
          miss: analysis.metrics.miss,
          combo: analysis.metrics.combo,
        };
        item.data.missCount = analysis.totalMiss;
      }
      item.status = 'ready';
      fillActiveFormIfMatches(item.id);
      updateSidebarStatus(item.id);
    } catch (error) {
      console.error(error);
      item.status = 'error';
      updateSidebarStatus(item.id);
    }
  }

  if (state.activeItemId) {
    const current = state.editorQueue.find((entry) => entry.id === state.activeItemId);
    if (current) selectItem(current.id);
  }
  checkBatchButton();
}

function fillActiveFormIfMatches(id) {
  if (state.activeItemId !== id) return;
  const item = state.editorQueue.find((entry) => entry.id === id);
  if (!item) return;
  $id('up-title').value = item.data.title ?? '';
  $id('up-level').value = item.data.level ?? '';
  $id('up-diff').value = normalizeDifficulty(item.data.diff ?? 'EXPERT');
  $id('up-perfect').value = item.data.stats.perfect ?? 0;
  $id('up-great').value = item.data.stats.great ?? 0;
  $id('up-good').value = item.data.stats.good ?? 0;
  $id('up-bad').value = item.data.stats.bad ?? 0;
  $id('up-miss-detail').value = item.data.stats.miss ?? 0;
  $id('up-combo').value = item.data.stats.combo ?? 0;
  updateTotalCounters(item);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function reanalyzeCurrentItem() {
  if (!state.activeItemId) return;
  const item = state.editorQueue.find((entry) => entry.id === state.activeItemId);
  if (!item) return;
  item.status = 'pending';
  await runBatchAnalysis([item]);
}

export async function analyzeAllInBatch() {
  if (state.editorQueue.length === 0) return;
  const pending = state.editorQueue.filter((item) => item.status !== 'existing');
  await runBatchAnalysis(pending);
}

export async function handleBatchExecution() {
  const button = $id('btn-exec-batch');
  if (button) {
    button.disabled = true;
    button.textContent = '処理中...';
  }

  try {
    if (state.currentMode === 'upload') {
      await executeUploads();
    } else {
      await executeEdits();
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = state.currentMode === 'upload' ? '全てアップロード' : '保存して反映';
    }
  }
}

async function executeUploads() {
  const tempRecords = [...state.records];
  let successCount = 0;
  for (const item of state.editorQueue) {
    const status = $id(`sb-status-${item.id}`);
    if (status) {
      status.textContent = '送信中';
      status.className = 'upload-status processing';
    }

    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const candidate = {
        title: item.data.title,
        level: item.data.level,
        difficultyRaw: normalizeDifficulty(item.data.diff),
        missCount: item.data.missCount,
        perfectCount: item.data.stats.perfect,
        greatCount: item.data.stats.great,
        comboCount: item.data.stats.combo,
      };
      const currentBest = tempRecords.filter((record) => buildMetaKey(record) === buildMetaKey(candidate)).sort(compareScore)[0] || null;
      const bestUpdate = !currentBest || compareScore(candidate, currentBest) < 0;

      const record = await uploadNewRecord(item, tempRecords);
      successCount += 1;

      if (bestUpdate) {
        showToast(`自己ベスト更新: ${record.title} / ${record.difficulty} / FC-${record.missCount}`, 'success', 5000);
      }

      const node = $id(`sb-${item.id}`);
      node?.remove();
    } catch (error) {
      console.error(error);
      item.status = 'error';
      if (status) {
        status.textContent = '失敗';
        status.className = 'upload-status error';
      }
    }
  }

  if (successCount > 0) {
    showToast(`アップロード完了: ${successCount} 件`, 'success');
  }
  state.editorQueue = [];
  state.activeItemId = null;
  state.selectedIds.clear();
  closeBatchModal();
  await fetchDataFromDrive();
}

async function executeEdits() {
  const tempRecords = state.records.filter((record) => !state.selectedIds.has(record.id)).map((record) => ({ ...record }));
  let successCount = 0;

  for (const item of state.editorQueue) {
    const status = $id(`sb-status-${item.id}`);
    if (status) {
      status.textContent = '保存中';
      status.className = 'upload-status processing';
    }

    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const candidate = {
        title: item.data.title,
        level: item.data.level,
        difficultyRaw: normalizeDifficulty(item.data.diff),
        missCount: item.data.missCount,
        perfectCount: item.data.stats.perfect,
        greatCount: item.data.stats.great,
        comboCount: item.data.stats.combo,
      };
      const currentBest = tempRecords.filter((record) => buildMetaKey(record) === buildMetaKey(candidate)).sort(compareScore)[0] || null;
      const bestUpdate = !currentBest || compareScore(candidate, currentBest) < 0;

      const record = await updateExistingRecord(item, tempRecords);
      successCount += 1;

      if (bestUpdate) {
        showToast(`自己ベスト更新: ${record.title} / ${record.difficulty} / FC-${record.missCount}`, 'success', 5000);
      }
    } catch (error) {
      console.error(error);
      if (status) {
        status.textContent = '失敗';
        status.className = 'upload-status error';
      }
    }
  }

  if (successCount > 0) {
    showToast(`保存完了: ${successCount} 件`, 'success');
  }
  state.editorQueue = [];
  state.activeItemId = null;
  state.selectedIds.clear();
  closeBatchModal();
  await fetchDataFromDrive();
}

export function refreshView() {
  state.bestMap = computeBestMap(state.records);
  state.filteredRecords = applyFilters(state.records, state.settings, state.bestMap);
  renderGrid(state.filteredRecords);
  updateBatchStatusCounter();
  syncFilterUi();
}

function syncFilterUi() {
  const settings = state.settings;
  const count = $id('result-count');
  if (count) {
    const total = state.records.length;
    const visible = state.filteredRecords.length;
    count.textContent = total ? `表示: ${visible} 件 / 全 ${total} 件` : 'データなし';
  }

  updateSettingsUi();
}

export function renderGrid(records) {
  const grid = $id('grid');
  if (!grid) return;
  grid.innerHTML = '';
  const count = $id('result-count');
  if (count) {
    const total = state.records.length;
    const visible = records.length;
    count.textContent = total ? `表示: ${visible} 件 / 全 ${total} 件` : 'データなし';
  }

  if (!records || records.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
    return;
  }

  for (const record of records) {
    const thumbnail = record.thumbnail ? record.thumbnail.replace('=s220', '=w600') : '';
    const largeImage = record.thumbnail ? record.thumbnail.replace('=s220', '=w1600') : '';
    const difficulty = normalizeDifficulty(record.difficultyRaw);
    const isBest = isSelfBest(record, state.bestMap);
    const bestBadge = isBest ? '<div class="best-badge"><span class="material-symbols-outlined">workspace_premium</span> BEST</div>' : '';
    const comboLabel = Number.isFinite(record.comboCount) ? record.comboCount : 0;
    const metricsLine = `
      <div class="metrics-line">
        P ${Number(record.perfectCount ?? 0)} / G ${Number(record.greatCount ?? 0)} / C ${comboLabel}
      </div>
    `;
    const missDisplay = record.isFC
      ? '<span class="miss-val zero">FC-0</span>'
      : `FC -<span class="miss-val">${Number(record.missCount ?? 0)}</span>`;
    const cardClasses = [
      'card',
      record.isFC ? 'is-fc' : '',
      state.selectedIds.has(record.id) ? 'selected' : '',
      state.isSelectMode ? 'select-mode-active' : '',
      isBest ? 'is-best' : '',
    ].filter(Boolean).join(' ');

    const clickAction = state.isSelectMode
      ? `toggleSelection('${record.id}')`
      : `openImageModal('${largeImage}')`;

    const overlayActions = state.isSelectMode
      ? ''
      : `
        <div class="card-overlay-actions">
          <div class="btn-overlay" onclick="event.stopPropagation(); individualEdit('${record.id}')" title="編集">
            <span class="material-symbols-outlined">edit</span>
          </div>
          <div class="btn-overlay del" onclick="event.stopPropagation(); individualDelete('${record.id}')" title="削除">
            <span class="material-symbols-outlined">delete</span>
          </div>
        </div>
      `;

    grid.insertAdjacentHTML('beforeend', `
      <div class="${cardClasses}" id="card-${record.id}" onclick="${clickAction}">
        <div class="card-img-container">
          ${bestBadge}
          ${overlayActions}
          <div class="img-loader-spinner"></div>
          ${thumbnail ? `<img src="${thumbnail}" class="card-img" loading="lazy" onload="this.style.opacity=1; this.previousElementSibling.style.display='none';">` : '<span style="color:#aaa;">NO IMAGE</span>'}
        </div>
        <div class="card-body">
          <div class="song-meta">
            <span class="tag lvl">Lv.${escapeHtml(record.level)}</span>
            <span class="tag diff-${difficulty}">${escapeHtml(difficulty)}</span>
          </div>
          <div class="song-title">${escapeHtml(record.title)}</div>
          <div class="score-info">
            <span style="display:flex;align-items:center;gap:2px;">
              <span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result
            </span>
            ${missDisplay}
          </div>
          ${metricsLine}
          <div class="record-date">${escapeHtml(formatDateTime(record.createdTime))}</div>
        </div>
      </div>
    `);
  }
}

export function updateSelectionUiAfterRefresh() {
  for (const id of state.selectedIds) {
    const card = $id(`card-${id}`);
    card?.classList.add('selected');
  }
  updateBatchStatusCounter();
}

export function applyGlobalWindowBindings() {
  window.handleAuthClick = handleAuthClick;
  window.handleSignoutClick = handleSignoutClick;
  window.openBatchModal = openBatchModal;
  window.closeBatchModal = closeBatchModal;
  window.handleFiles = handleFiles;
  window.batchEdit = batchEdit;
  window.toggleSelectMode = toggleSelectMode;
  window.toggleSelection = toggleSelection;
  window.clearSelection = clearSelection;
  window.individualEdit = individualEdit;
  window.individualDelete = individualDelete;
  window.batchDelete = batchDelete;
  window.openImageModal = openImageModal;
  window.closeImageModal = closeImageModal;
  window.reanalyzeCurrentItem = reanalyzeCurrentItem;
  window.analyzeAllInBatch = analyzeAllInBatch;
  window.handleBatchExecution = handleBatchExecution;
  window.updateCurrentItem = updateCurrentItem;
  window.closeSettingsModal = closeSettingsModal;
  window.openSettingsModal = openSettingsModal;
  window.toggleBestOnly = () => {
    updateSettings({ filters: { ...getSettings().filters, selfBestOnly: !getSettings().filters.selfBestOnly } });
    updateBestOnlyButton();
    refreshView();
  };
  window.refreshView = refreshView;
  window.updateView = refreshView;
}

export function setInitialAuthUi() {
  setLoggedInState(false);
}
