import {
  CLIENT_ID,
  API_KEY,
  DISCOVERY_DOC,
  SCOPES,
  DIFFICULTY_META,
  DIFFICULTY_ORDER,
  DEFAULT_PREFS,
  DEFAULT_REGIONS,
  difficultyColorOf,
  difficultyDbKeyOf,
  difficultyLabelOf,
  difficultyRankOf,
  normalizeDifficultyCode,
  makeId,
} from './config.js';
import {
  loadPreferences,
  savePreferences,
  loadProfiles,
  saveProfiles,
  saveLastProfileId,
  loadLastProfileId,
} from './storage.js';
import {
  detectProfileByDimensions,
  ensureProfileDefaults,
  cloneRegionsForProfile,
  createProfileFromSample,
  regionToPixels,
  pixelsToRegion,
  regionKeys,
  ensureRegion,
} from './profiles.js';
import {
  preloadMusicDatabase,
  analyzeLoadedImage,
  getDbState,
  getLevelFromDb,
} from './ocr.js';
import {
  clearDriveFolderCache,
  fetchResultRecords,
  findRootFolders,
  ensureRootFolders,
  ensureFolder,
  formatSongFolderName,
  fileNameFromCounts,
  serializeResultProperties,
  createResultFile,
  updateResultFile,
  deleteDriveFile,
  buildSongGroupKey,
  compareRecordsForBest,
} from './drive.js';

const state = {
  tokenClient: null,
  gapiInited: false,
  gisInited: false,
  allRecords: [],
  filteredRecords: [],
  selectedIds: new Set(),
  isSelectMode: false,
  editorQueue: [],
  activeItemId: null,
  currentMode: 'upload',
  viewSeq: 0,
  viewBusy: false,
  batchWorker: null,
  profiles: [],
  prefs: loadPreferences(),
  batchPreviewReady: false,
  settings: {
    activeProfileId: '',
    sampleUrl: '',
    sampleWidth: 0,
    sampleHeight: 0,
    activeRegionKey: 'diff',
    currentProfileDraft: null,
    dragState: null,
  },
};

const els = {};
const debounceTimers = new Map();

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  const ids = [
    'auth-status','authorize_button','signout_button','upload_button','btn-select-mode',
    'result-count','loader','loader-text','grid','sort-order','sort-dir-toggle','filter-fc',
    'filter-miss-min','filter-miss-max','filter-diff','filter-level','filter-title','filter-show-best',
    'view-progress-wrap','view-progress-bar','view-progress-text',
    'batchModal','batch-modal-title','upload-initial','drop-zone','up-file','batch-workspace',
    'batch-sidebar-list','batch-editor-container','batch-empty-msg','batch-status-msg','btn-exec-batch',
    'batch-preview-img','up-title','up-level','up-diff','up-machine','up-perfect','up-great',
    'up-good','up-bad','up-miss-detail','up-combo','up-total-miss','imageModal','modalImg',
    'batch-actions','selected-count',
    'settingsModal','settings-profile-list','settings-profile-select','settings-profile-name',
    'settings-profile-width','settings-profile-height','settings-profile-counts','settings-sample-file',
    'settings-preview-wrap','settings-preview-img','settings-region-overlay','settings-region-key',
    'settings-region-x','settings-region-y','settings-region-w','settings-region-h','settings-profile-status',
    'settings-sample-info','settings-save-profile','settings-delete-profile','settings-new-profile',
    'toast-container',
  ];
  for (const id of ids) {
    els[id] = $(id);
  }
  els.loaderText = els['loader-text'];
  els.modalImg = els['modalImg'];
  els.imageModal = els['imageModal'];
  els.batchModal = els['batchModal'];
  els.upMachine = els['up-machine'];
  els.upPerfect = els['up-perfect'];
  els.upGreat = els['up-great'];
  els.upGood = els['up-good'];
  els.upBad = els['up-bad'];
  els.upMissDetail = els['up-miss-detail'];
  els.upCombo = els['up-combo'];
  els.settingsModal = els['settingsModal'];
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExternalApis() {
  while (!(window.gapi && window.google && window.google.accounts && window.google.accounts.oauth2)) {
    await sleep(50);
  }
}

async function waitForDriveClientInit() {
  while (!state.gapiInited || !state.gisInited) {
    await sleep(50);
  }
}

function escapeHtml(t) {
  return t ? t.toString().replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])) : '';
}

function formatDateLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function showLoader(text = '読み込み中...') {
  els.loader.style.display = 'flex';
  els.loaderText.textContent = text;
}

function hideLoader() {
  els.loader.style.display = 'none';
}

function showToast(message, type = 'info', timeout = 3600) {
  if (!els['toast-container']) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els['toast-container'].appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  window.setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    window.setTimeout(() => toast.remove(), timeout + 400);
  }, timeout);
}

function setViewProgress(visible, value = 0, text = '') {
  if (!els['view-progress-wrap']) return;
  els['view-progress-wrap'].style.display = visible ? 'block' : 'none';
  if (els['view-progress-bar']) els['view-progress-bar'].style.width = `${Math.max(0, Math.min(100, value))}%`;
  if (els['view-progress-text']) els['view-progress-text'].textContent = text;
}

function setBatchStatus(text) {
  if (els['batch-status-msg']) els['batch-status-msg'].textContent = text;
}

function initPrefsToUI() {
  const p = state.prefs;
  if (els['sort-order']) els['sort-order'].value = p.sortField;
  if (els['sort-dir-toggle']) els['sort-dir-toggle'].dataset.dir = p.sortDir;
  updateSortDirButton();
  if (els['filter-fc']) els['filter-fc'].value = p.filters.fc;
  if (els['filter-miss-min']) els['filter-miss-min'].value = p.filters.missMin;
  if (els['filter-miss-max']) els['filter-miss-max'].value = p.filters.missMax;
  if (els['filter-diff']) els['filter-diff'].value = p.filters.diff;
  if (els['filter-level']) els['filter-level'].value = p.filters.level;
  if (els['filter-title']) els['filter-title'].value = p.filters.title;
  if (els['filter-show-best']) els['filter-show-best'].checked = !!p.showBestOnly;
}

function syncPrefsFromUI() {
  state.prefs.sortField = els['sort-order'].value;
  state.prefs.sortDir = els['sort-dir-toggle'].dataset.dir || 'desc';
  state.prefs.filters.fc = els['filter-fc'].value;
  state.prefs.filters.missMin = els['filter-miss-min'].value;
  state.prefs.filters.missMax = els['filter-miss-max'].value;
  state.prefs.filters.diff = els['filter-diff'].value;
  state.prefs.filters.level = els['filter-level'].value;
  state.prefs.filters.title = els['filter-title'].value;
  state.prefs.showBestOnly = !!els['filter-show-best'].checked;
  savePreferences(state.prefs);
}

function updateSortDirButton() {
  if (!els['sort-dir-toggle']) return;
  const dir = els['sort-dir-toggle'].dataset.dir || 'desc';
  els['sort-dir-toggle'].textContent = dir === 'asc' ? '昇順' : '降順';
}

function toggleSortDirection() {
  const current = els['sort-dir-toggle'].dataset.dir || 'desc';
  els['sort-dir-toggle'].dataset.dir = current === 'asc' ? 'desc' : 'asc';
  updateSortDirButton();
  syncPrefsFromUI();
  updateView();
}

function getProfileById(profileId) {
  return state.profiles.find((p) => p.id === profileId) || state.profiles[0] || null;
}

function ensureProfilesExist() {
  if (state.profiles.length === 0) {
    const defaultProfile = ensureProfileDefaults(createProfileFromSample(0, 0, '標準'));
    state.profiles = [defaultProfile];
    saveProfiles(state.profiles);
  }
  if (!state.prefs.activeProfileId || !getProfileById(state.prefs.activeProfileId)) {
    state.prefs.activeProfileId = state.profiles[0].id;
    saveLastProfileId(state.prefs.activeProfileId);
  }
}

function renderProfileSelectors() {
  const optionsHtml = state.profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.width && p.height ? ` (${p.width}×${p.height})` : ''}</option>`).join('');
  if (els.upMachine) {
    els.upMachine.innerHTML = optionsHtml;
  }
  if (els['settings-profile-select']) {
    els['settings-profile-select'].innerHTML = optionsHtml;
  }
  if (els['settings-profile-list']) {
    els['settings-profile-list'].innerHTML = state.profiles.map((p) => `
      <button type="button" class="profile-item ${p.id === state.settings.activeProfileId ? 'active' : ''}" data-profile-id="${p.id}">
        <div class="profile-item-title">${escapeHtml(p.name)}</div>
        <div class="profile-item-meta">${p.width && p.height ? `${p.width}×${p.height}` : 'サイズ未設定'}</div>
      </button>
    `).join('');
    els['settings-profile-list'].querySelectorAll('.profile-item').forEach((btn) => {
      btn.addEventListener('click', () => selectSettingsProfile(btn.dataset.profileId));
    });
  }
  if (els.upMachine && state.prefs.activeProfileId) {
    els.upMachine.value = state.prefs.activeProfileId;
  }
  if (els['settings-profile-select'] && state.settings.activeProfileId) {
    els['settings-profile-select'].value = state.settings.activeProfileId;
  }
}

function markProfileSelection(profileId) {
  state.prefs.activeProfileId = profileId;
  savePreferences(state.prefs);
  saveLastProfileId(profileId);
  if (els.upMachine) els.upMachine.value = profileId;
  if (els['settings-profile-select']) els['settings-profile-select'].value = profileId;
  renderProfileSelectors();
}

function applySelectionModeUI() {
  if (state.isSelectMode) els['btn-select-mode'].classList.add('active');
  else els['btn-select-mode'].classList.remove('active');
}

function getFilterState() {
  return {
    fc: els['filter-fc'].value,
    missMin: els['filter-miss-min'].value,
    missMax: els['filter-miss-max'].value,
    diff: els['filter-diff'].value,
    level: els['filter-level'].value,
    title: els['filter-title'].value.trim().toLowerCase(),
    showBestOnly: !!els['filter-show-best'].checked,
  };
}

function compareByTitle(a, b, direction = 'asc') {
  const res = a.title.localeCompare(b.title, 'ja');
  return direction === 'asc' ? res : -res;
}

function compareByLevel(a, b, direction = 'asc') {
  const res = (a.level || 0) - (b.level || 0);
  return direction === 'asc' ? res : -res;
}

function compareByMiss(a, b, direction = 'asc') {
  const res = (a.missCount ?? 0) - (b.missCount ?? 0);
  return direction === 'asc' ? res : -res;
}

function compareByDate(a, b, direction = 'desc') {
  const at = Date.parse(a.createdTime || '') || 0;
  const bt = Date.parse(b.createdTime || '') || 0;
  const res = at - bt;
  return direction === 'asc' ? res : -res;
}

function compareByDifficulty(a, b) {
  return difficultyRankOf(a.difficultyRaw) - difficultyRankOf(b.difficultyRaw);
}

function sortRecords(list) {
  const base = els['sort-order'].value;
  const dir = els['sort-dir-toggle'].dataset.dir || 'desc';
  const out = list.slice();

  out.sort((a, b) => {
    if (base === 'title') {
      return compareByTitle(a, b, dir)
        || compareByDifficulty(a, b)
        || compareByMiss(a, b, 'asc')
        || compareByDate(a, b, 'desc');
    }
    if (base === 'level') {
      return compareByLevel(a, b, dir)
        || compareByDifficulty(a, b)
        || compareByTitle(a, b, 'asc')
        || compareByMiss(a, b, 'asc')
        || compareByDate(a, b, 'desc');
    }
    if (base === 'miss') {
      return compareByMiss(a, b, dir)
        || compareByLevel(a, b, 'desc')
        || compareByDifficulty(a, b)
        || compareByTitle(a, b, 'asc')
        || compareByDate(a, b, 'desc');
    }
    return compareByDate(a, b, dir)
      || compareByTitle(a, b, 'asc');
  });

  return out;
}

function isStrictlyBetter(newRecord, bestRecord) {
  if (!bestRecord) return true;
  const newMiss = Number.isFinite(Number(newRecord.missCount)) ? Number(newRecord.missCount) : Infinity;
  const bestMiss = Number.isFinite(Number(bestRecord.missCount)) ? Number(bestRecord.missCount) : Infinity;
  if (newMiss < bestMiss) return true;
  if (newMiss > bestMiss) return false;

  const newCombo = Number.isFinite(Number(newRecord.combo)) ? Number(newRecord.combo) : -Infinity;
  const bestCombo = Number.isFinite(Number(bestRecord.combo)) ? Number(bestRecord.combo) : -Infinity;
  if (newCombo > bestCombo) return true;
  if (newCombo < bestCombo) return false;

  const newPerfect = Number.isFinite(Number(newRecord.perfect)) ? Number(newRecord.perfect) : -Infinity;
  const bestPerfect = Number.isFinite(Number(bestRecord.perfect)) ? Number(bestRecord.perfect) : -Infinity;
  if (newPerfect > bestPerfect) return true;
  if (newPerfect < bestPerfect) return false;

  const newGreat = Number.isFinite(Number(newRecord.great)) ? Number(newRecord.great) : Infinity;
  const bestGreat = Number.isFinite(Number(bestRecord.great)) ? Number(bestRecord.great) : Infinity;
  if (newGreat < bestGreat) return true;
  if (newGreat > bestGreat) return false;

  return false;
}

function markBestRecords(records) {
  const bestMap = new Map();
  for (const record of records) {
    const key = buildSongGroupKey(record.title, record.difficultyRaw);
    const current = bestMap.get(key);
    if (!current || compareRecordsForBest(record, current) < 0) {
      bestMap.set(key, record);
    }
  }

  for (const record of records) {
    const key = buildSongGroupKey(record.title, record.difficultyRaw);
    record.groupKey = key;
    record.isBest = bestMap.get(key)?.id === record.id;
  }
  return records;
}

function filterRecords(records) {
  const filter = getFilterState();
  const filtered = [];
  const total = records.length;

  for (let i = 0; i < total; i++) {
    const r = records[i];
    if (filter.showBestOnly && !r.isBest) continue;
    if (filter.fc === 'fc' && !r.isFC) continue;
    if (filter.fc === 'unfc' && r.isFC) continue;

    if (!r.isFC) {
      const missMin = filter.missMin !== '' ? parseInt(filter.missMin, 10) : null;
      const missMax = filter.missMax !== '' ? parseInt(filter.missMax, 10) : null;
      if (missMin !== null && r.missCount < missMin) continue;
      if (missMax !== null && r.missCount > missMax) continue;
    } else {
      if (filter.missMin !== '' && parseInt(filter.missMin, 10) > 0) continue;
    }

    if (filter.diff !== 'all' && normalizeDifficultyCode(r.difficultyRaw) !== normalizeDifficultyCode(filter.diff)) continue;
    if (filter.level && String(r.level) !== String(filter.level)) continue;
    if (filter.title && !String(r.title || '').toLowerCase().includes(filter.title)) continue;
    filtered.push(r);
  }

  return filtered;
}

async function updateView() {
  const seq = ++state.viewSeq;
  syncPrefsFromUI();
  setViewProgress(true, 5, '絞り込み・並び替え中...');
  state.viewBusy = true;

  const source = state.allRecords || [];
  const filtered = [];
  const filter = getFilterState();

  const chunk = Math.max(20, Math.floor(source.length / 20) || 50);
  for (let i = 0; i < source.length; i++) {
    if (seq !== state.viewSeq) return;
    const r = source[i];
    if (filter.showBestOnly && !r.isBest) continue;
    if (filter.fc === 'fc' && !r.isFC) continue;
    if (filter.fc === 'unfc' && r.isFC) continue;

    if (!r.isFC) {
      const missMin = filter.missMin !== '' ? parseInt(filter.missMin, 10) : null;
      const missMax = filter.missMax !== '' ? parseInt(filter.missMax, 10) : null;
      if (missMin !== null && r.missCount < missMin) continue;
      if (missMax !== null && r.missCount > missMax) continue;
    } else {
      if (filter.missMin !== '' && parseInt(filter.missMin, 10) > 0) continue;
    }

    if (filter.diff !== 'all' && normalizeDifficultyCode(r.difficultyRaw) !== normalizeDifficultyCode(filter.diff)) continue;
    if (filter.level && String(r.level) !== String(filter.level)) continue;
    if (filter.title && !String(r.title || '').toLowerCase().includes(filter.title)) continue;
    filtered.push(r);

    if (i % chunk === 0) {
      const pct = 10 + Math.round((i / Math.max(source.length, 1)) * 55);
      setViewProgress(true, pct, `絞り込み中... ${i}/${source.length}`);
      await nextFrame();
    }
  }

  const sorted = sortRecords(filtered);
  setViewProgress(true, 80, '並び替え中...');
  await nextFrame();
  state.filteredRecords = sorted;
  renderGrid(sorted);
  setViewProgress(true, 100, `表示完了 ${sorted.length} 件`);
  await sleep(120);
  setViewProgress(false, 0, '');
  state.viewBusy = false;
}

function renderGrid(records) {
  if (!els.grid) return;
  els['result-count'].textContent = `表示: ${records.length} 件`;
  els.grid.innerHTML = '';

  if (records.length === 0) {
    els.grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
    return;
  }

  const frag = document.createDocumentFragment();

  for (const rec of records) {
    const card = document.createElement('div');
    card.className = `card ${rec.isFC ? 'is-fc' : ''} ${state.selectedIds.has(rec.id) ? 'selected' : ''} ${state.isSelectMode ? 'select-mode-active' : ''}`;
    card.id = `card-${rec.id}`;

    const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w600') : '';
    const large = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    const missDisplay = rec.isFC ? `<span class="miss-val zero">FC-0</span>` : `FC -<span class="miss-val">${rec.missCount}</span>`;
    const badge = rec.isFC ? `<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>` : '';
    const diffColor = difficultyColorOf(rec.difficultyRaw);
    const smallCounts = [
      rec.perfect !== null && rec.perfect !== undefined ? `P:${rec.perfect}` : '',
      rec.great !== null && rec.great !== undefined ? `G:${rec.great}` : '',
      rec.combo !== null && rec.combo !== undefined ? `C:${rec.combo}` : '',
    ].filter(Boolean).join(' / ');

    card.onclick = () => {
      if (state.isSelectMode) toggleSelection(rec.id);
      else openImageModal(large);
    };

    const overlayActions = state.isSelectMode ? '' : `
      <div class="card-overlay-actions">
        <div class="btn-overlay" onclick="event.stopPropagation(); individualEdit('${rec.id}')" title="編集"><span class="material-symbols-outlined">edit</span></div>
        <div class="btn-overlay del" onclick="event.stopPropagation(); individualDelete('${rec.id}')" title="削除"><span class="material-symbols-outlined">delete</span></div>
      </div>
    `;

    card.innerHTML = `
      <div class="card-img-container">
        ${badge}
        ${overlayActions}
        <div class="img-loader-spinner"></div>
        ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" onload="this.style.opacity=1; this.previousElementSibling.style.display='none';">` : '<span style="color:#aaa;">NO IMAGE</span>'}
      </div>
      <div class="card-body">
        <div class="song-meta">
          <span class="tag lvl">Lv.${escapeHtml(rec.level)}</span>
          <span class="tag diff-${escapeHtml(normalizeDifficultyCode(rec.difficultyRaw))}" style="background:${diffColor}22; color:${diffColor}; border-color:${diffColor}44;">${escapeHtml(rec.difficulty)}</span>
        </div>
        <div class="song-title">${escapeHtml(rec.title)}</div>
        <div class="score-info">
          <span style="display:flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result</span>
          ${missDisplay}
        </div>
        ${smallCounts ? `<div class="score-details">${escapeHtml(smallCounts)}</div>` : ''}
        ${rec.createdTime ? `<div class="record-date">${escapeHtml(formatDateLabel(rec.createdTime))}</div>` : ''}
        ${rec.isBest ? `<div class="best-badge">自己ベスト</div>` : ''}
      </div>
    `;
    frag.appendChild(card);
  }

  els.grid.appendChild(frag);
}

function openImageModal(src) {
  if (!src) return;
  els.modalImg.src = src;
  els.imageModal.style.display = 'flex';
}

function closeImageModal() {
  els.imageModal.style.display = 'none';
  els.modalImg.src = '';
}

function setAuthUI(isLoggedIn) {
  els.signout_button.style.display = isLoggedIn ? 'inline-flex' : 'none';
  els.upload_button.style.display = isLoggedIn ? 'inline-flex' : 'none';
  els.authorize_button.style.display = isLoggedIn ? 'none' : 'inline-flex';
  els['auth-status'].textContent = isLoggedIn ? 'ログイン済み' : '未ログイン';
}

function gapiLoaded() {
  if (!window.gapi) return;
  window.gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: [DISCOVERY_DOC],
  });
  state.gapiInited = true;
}

function gisLoaded() {
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: '',
  });
  state.gisInited = true;
}

function handleAuthClick() {
  state.tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) throw resp;
    setAuthUI(true);
    await fetchDataFromDrive();
  };
  if (gapi.client.getToken() === null) state.tokenClient.requestAccessToken({ prompt: 'consent' });
  else state.tokenClient.requestAccessToken({ prompt: '' });
}

function handleSignoutClick() {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
    setAuthUI(false);
    els['result-count'].textContent = 'ログアウトしました';
    els.grid.innerHTML = '';
    state.allRecords = [];
    state.filteredRecords = [];
    state.selectedIds.clear();
    updateSelectionUI();
  }
}

async function fetchDataFromDrive() {
  showLoader('データ取得中...');
  els['result-count'].textContent = 'データ取得中...';
  try {
    clearDriveFolderCache();
    const { records } = await fetchResultRecords({
      onStage: (text) => { els.loaderText.textContent = text; },
      onProgress: ({ count, done }) => {
        els.loaderText.textContent = done ? `取得完了 ${count} 件` : `取得中... ${count} 件`;
      },
    });
    state.allRecords = markBestRecords(records || []);
    await updateView();
  } catch (error) {
    console.error(error);
    showToast(`取得エラー: ${error.message}`, 'error', 5000);
    els['result-count'].textContent = '取得失敗';
  } finally {
    hideLoader();
  }
}

function getCurrentProfile() {
  return getProfileById(state.prefs.activeProfileId);
}

function getBestRecordForGroup(groupKey) {
  const list = state.allRecords.filter((r) => buildSongGroupKey(r.title, r.difficultyRaw) === groupKey);
  return list.sort((a, b) => compareRecordsForBest(a, b))[0] || null;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;
  els['upload-initial'].style.display = 'none';
  els['batch-workspace'].style.display = 'flex';
  setBatchStatus('画像を処理中...');
  state.currentMode = 'upload';

  const jobs = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const meta = await loadImageMeta(file);
    const detectedProfile = detectProfileByDimensions(meta.width, meta.height, state.profiles) || getCurrentProfile() || state.profiles[0];
    jobs.push({
      id: `new_${Date.now()}_${i}`,
      file,
      imgUrl: URL.createObjectURL(file),
      status: 'pending',
      data: {
        title: '',
        level: '',
        diff: 'EXPERT',
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        missDetail: 0,
        combo: 0,
        missCount: 0,
        musicId: null,
      },
      originalId: null,
      originalParent: null,
      profileId: detectedProfile?.id || state.prefs.activeProfileId,
      imageWidth: meta.width,
      imageHeight: meta.height,
    });
  }

  for (const job of jobs) {
    state.editorQueue.push(job);
    renderSidebarItem(job.id);
  }

  checkBatchButton();
  await runBatchAnalysis(state.editorQueue.filter((item) => item.status === 'pending'));
  if (!state.activeItemId && state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
}

async function loadImageMeta(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, url };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderSidebarItem(id) {
  const item = state.editorQueue.find((q) => q.id === id);
  if (!item) return;

  const div = document.createElement('div');
  div.className = 'sidebar-item';
  div.id = `sb-${id}`;
  div.onclick = () => selectItem(id);
  const profile = getProfileById(item.profileId);
  const statusClass = item.status === 'existing' ? 'done' : item.status;

  div.innerHTML = `
    <img src="${item.imgUrl}" class="sidebar-thumb" crossorigin="anonymous">
    <div class="sidebar-info">
      <div class="sidebar-title" id="sb-title-${id}">${escapeHtml(item.data.title || '名称未設定')}</div>
      <div class="sidebar-meta">${escapeHtml(profile?.name || '')}</div>
      <div class="sidebar-status">
        <span id="sb-status-${id}" class="upload-status ${statusClass}">${item.status === 'existing' ? 'EXIST' : item.status}</span>
        <button class="btn-remove-side" onclick="removeBatchItem(event, '${id}')">
          <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
        </button>
      </div>
    </div>
  `;
  els['batch-sidebar-list'].appendChild(div);
}

function updateSidebarStatus(id) {
  const item = state.editorQueue.find((q) => q.id === id);
  if (!item) return;
  const statusEl = $(`sb-status-${id}`);
  if (!statusEl) return;
  const text = item.status === 'error' ? 'ERR' : item.status === 'processing' ? '解析中' : item.status === 'existing' ? 'EXIST' : 'OK';
  statusEl.textContent = text;
  statusEl.className = `upload-status ${item.status === 'error' ? 'error' : item.status === 'processing' ? 'processing' : 'done'}`;
}

function checkBatchButton() {
  const btn = els['btn-exec-batch'];
  btn.disabled = state.editorQueue.length === 0;
  const label = state.currentMode === 'upload' ? '全てアップロード' : '保存して反映';
  btn.textContent = state.editorQueue.length > 0 ? `${label} (${state.editorQueue.length}件)` : label;
}

function selectItem(id) {
  state.activeItemId = id;
  const item = state.editorQueue.find((q) => q.id === id);
  if (!item) return;

  document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
  const sbEl = $(`sb-${id}`);
  if (sbEl) sbEl.classList.add('active');

  els['batch-editor-container'].style.display = 'flex';
  els['batch-empty-msg'].style.display = 'none';

  els['batch-preview-img'].src = item.imgUrl;
  els['up-title'].value = item.data.title || '';
  els['up-level'].value = item.data.level || '';
  els['up-diff'].value = normalizeDifficultyCode(item.data.diff || 'EXPERT');
  if (els.upMachine) els.upMachine.value = item.profileId || state.prefs.activeProfileId || state.profiles[0].id;

  els['up-perfect'].value = item.data.perfect ?? 0;
  els['up-great'].value = item.data.great ?? 0;
  els['up-good'].value = item.data.good ?? 0;
  els['up-bad'].value = item.data.bad ?? 0;
  els['up-miss-detail'].value = item.data.missDetail ?? 0;
  els['up-combo'].value = item.data.combo ?? 0;
  els['up-total-miss'].textContent = item.data.good + item.data.bad + item.data.missDetail;
}


function updateCurrentItem(field, value) {
  if (!state.activeItemId) return;
  const item = state.editorQueue.find((q) => q.id === state.activeItemId);
  if (!item) return;

  const numericFields = ['perfect', 'great', 'good', 'bad', 'missDetail', 'combo', 'level'];
  if (numericFields.includes(field)) {
    item.data[field] = parseInt(value, 10) || 0;
  } else {
    item.data[field] = value;
  }

  if (field === 'diff' && item.data.musicId) {
    const newLvl = getLevelFromDb(item.data.musicId, difficultyDbKeyOf(normalizeDifficultyCode(value)));
    if (newLvl) {
      item.data.level = newLvl;
      els['up-level'].value = newLvl;
    }
  }

  if (['good', 'bad', 'missDetail'].includes(field)) {
    item.data.missCount = (item.data.good || 0) + (item.data.bad || 0) + (item.data.missDetail || 0);
    els['up-total-miss'].textContent = item.data.missCount;
  }

  if (field === 'title') {
    $(`sb-title-${state.activeItemId}`).textContent = value || '名称未設定';
  }

  if (field === 'profileId') {
    item.profileId = value;
  }

  item.status = 'done';
  updateSidebarStatus(state.activeItemId);
}

async function runBatchAnalysis(itemsToAnalyze) {
  if (!itemsToAnalyze || itemsToAnalyze.length === 0) return;
  setBatchStatus('解析中... (しばらくお待ちください)');
  const worker = await getBatchWorker();

  for (const item of itemsToAnalyze) {
    const statusEl = $(`sb-status-${item.id}`);
    if (statusEl) {
      statusEl.textContent = '解析中';
      statusEl.className = 'upload-status processing';
    }
    item.status = 'processing';

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = item.imgUrl;

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const profile = getProfileById(item.profileId) || state.profiles[0];
      const res = await analyzeLoadedImage(img, worker, profile);
      if (res) {
        item.data.title = res.title;
        item.data.level = res.level;
        item.data.diff = res.diff;
        item.data.perfect = res.perfect;
        item.data.great = res.great;
        item.data.good = res.good;
        item.data.bad = res.bad;
        item.data.missDetail = res.miss;
        item.data.miss = res.miss;
        item.data.missCount = res.missCount;
        item.data.combo = res.combo ?? 0;
        item.data.musicId = res.musicId;
        item.status = 'done';
        updateSidebarStatus(item.id);
        if (state.activeItemId === item.id) selectItem(item.id);
      } else {
        item.status = 'error';
      }
    } catch (error) {
      console.error('Analysis failed', error);
      item.status = 'error';
    }

    updateSidebarStatus(item.id);
    if (item.status === 'done') {
      $(`sb-title-${item.id}`).textContent = item.data.title || '名称未設定';
    } else {
      const statEl = $(`sb-status-${item.id}`);
      if (statEl) {
        statEl.textContent = 'ERR';
        statEl.className = 'upload-status error';
      }
    }
  }

  setBatchStatus('処理完了');
}

async function getBatchWorker() {
  if (state.batchWorker) return state.batchWorker;
  state.batchWorker = await Tesseract.createWorker(['jpn', 'eng']);
  return state.batchWorker;
}

async function reanalyzeCurrentItem() {
  if (!state.activeItemId) return;
  const item = state.editorQueue.find((q) => q.id === state.activeItemId);
  if (item) await runBatchAnalysis([item]);
}

async function analyzeAllInBatch() {
  if (state.editorQueue.length === 0) return;
  await runBatchAnalysis(state.editorQueue);
}

function removeBatchItem(e, id) {
  e.stopPropagation();
  const idx = state.editorQueue.findIndex((q) => q.id === id);
  if (idx >= 0) {
    const item = state.editorQueue[idx];
    if (item.imgUrl && item.imgUrl.startsWith('blob:')) URL.revokeObjectURL(item.imgUrl);
    state.editorQueue.splice(idx, 1);
  }
  const el = $(`sb-${id}`);
  if (el) el.remove();
  if (state.activeItemId === id) {
    els['batch-editor-container'].style.display = 'none';
    els['batch-empty-msg'].style.display = 'block';
    state.activeItemId = null;
  }
  checkBatchButton();
}

async function handleBatchExecution() {
  const btn = els['btn-exec-batch'];
  btn.disabled = true;
  btn.textContent = '処理中...';
  try {
    if (state.currentMode === 'upload') await executeUploads();
    else await executeEdits();
  } finally {
    checkBatchButton();
  }
}

async function executeUploads() {
  let successCount = 0;
  const accessToken = gapi.client.getToken().access_token;
  const { rootFolder, fcFolder } = await ensureRootFolders();
  if (!rootFolder || !fcFolder) throw new Error('保存先フォルダが見つかりません');

  for (const item of [...state.editorQueue]) {
    const sbStatus = $(`sb-status-${item.id}`);
    if (sbStatus) {
      sbStatus.textContent = '送信中';
      sbStatus.className = 'upload-status processing';
    }

    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const profile = getProfileById(item.profileId) || state.profiles[0];
      const folderName = formatSongFolderName(item.data.level, item.data.diff, item.data.title);
      const songFolder = await ensureFolder(folderName, fcFolder.id);
      const fileName = fileNameFromCounts({ missCount: item.data.missCount ?? item.data.good + item.data.bad + item.data.missDetail });

      const appProperties = serializeResultProperties(item, profile);
      const newRecordPreview = {
        title: item.data.title,
        difficultyRaw: normalizeDifficultyCode(item.data.diff),
        missCount: item.data.missCount ?? (item.data.good + item.data.bad + item.data.missDetail),
        combo: item.data.combo,
        perfect: item.data.perfect,
        great: item.data.great,
        createdTime: new Date().toISOString(),
      };
      const previousBest = getBestRecordForGroup(buildSongGroupKey(item.data.title, item.data.diff));
      const uploadResult = await createResultFile({
        folderId: songFolder.id,
        fileBlob: item.file,
        fileName,
        appProperties,
        accessToken,
      });

      if (isStrictlyBetter(newRecordPreview, previousBest)) {
        showToast(`自己ベスト更新: ${item.data.title}`, 'success');
      }

      state.editorQueue = state.editorQueue.filter((q) => q.id !== item.id);
      const sb = $(`sb-${item.id}`);
      if (sb) sb.remove();
      if (item.imgUrl && item.imgUrl.startsWith('blob:')) URL.revokeObjectURL(item.imgUrl);
      successCount++;
    } catch (error) {
      console.error(error);
      if (sbStatus) {
        sbStatus.textContent = '失敗';
        sbStatus.className = 'upload-status error';
      }
    }
  }

  await finishExecution(successCount, 'アップロード');
}

async function executeEdits() {
  let successCount = 0;
  const accessToken = gapi.client.getToken().access_token;
  const { rootFolder, fcFolder } = await ensureRootFolders();
  if (!rootFolder || !fcFolder) throw new Error('保存先フォルダが見つかりません');

  for (const item of [...state.editorQueue]) {
    const sbStatus = $(`sb-status-${item.id}`);
    if (sbStatus) {
      sbStatus.textContent = '保存中';
      sbStatus.className = 'upload-status processing';
    }

    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const profile = getProfileById(item.profileId) || state.profiles[0];
      const newFolderName = formatSongFolderName(item.data.level, item.data.diff, item.data.title);
      const newFileName = fileNameFromCounts({ missCount: item.data.missCount ?? (item.data.good + item.data.bad + item.data.missDetail) });
      const targetFolder = await ensureFolder(newFolderName, fcFolder.id);
      const updated = await updateResultFile({
        fileId: item.originalId,
        name: newFileName,
        appProperties: serializeResultProperties(item, profile),
        parentId: targetFolder.id,
        currentParentId: item.originalParent,
        accessToken,
      });

      state.editorQueue = state.editorQueue.filter((q) => q.id !== item.id);
      const sb = $(`sb-${item.id}`);
      if (sb) sb.remove();
      successCount++;
    } catch (error) {
      console.error(error);
      if (sbStatus) {
        sbStatus.textContent = '失敗';
        sbStatus.className = 'upload-status error';
      }
    }
  }

  await finishExecution(successCount, '更新');
}

async function finishExecution(count, actionName) {
  if (state.batchWorker) {
    await state.batchWorker.terminate();
    state.batchWorker = null;
  }
  if (state.editorQueue.length === 0) {
    alert(`${actionName}完了 (${count}件)`);
    closeBatchModal();
    state.selectedIds.clear();
    updateSelectionUI();
    await fetchDataFromDrive();
  } else {
    alert(`${count}件 ${actionName}成功。エラー分を確認してください。`);
    checkBatchButton();
  }
}

function openBatchModal(mode) {
  state.currentMode = mode;
  const modal = els.batchModal;
  modal.style.display = 'flex';
  state.editorQueue = [];
  state.activeItemId = null;
  els['batch-sidebar-list'].innerHTML = '';
  els['batch-editor-container'].style.display = 'none';
  els['batch-empty-msg'].style.display = 'block';
  setBatchStatus('待機中...');
  els['btn-exec-batch'].disabled = true;

  if (mode === 'upload') {
    els['batch-modal-title'].innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
    els['upload-initial'].style.display = 'flex';
    els['batch-workspace'].style.display = 'none';
    els['up-file'].value = '';
    els['btn-exec-batch'].textContent = '全てアップロード';
  } else {
    els['batch-modal-title'].innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
    els['upload-initial'].style.display = 'none';
    els['batch-workspace'].style.display = 'flex';
    els['btn-exec-batch'].textContent = '保存して反映';
  }
}

function closeBatchModal() {
  els.batchModal.style.display = 'none';
  state.editorQueue.forEach((item) => {
    if (item.imgUrl && item.imgUrl.startsWith('blob:')) URL.revokeObjectURL(item.imgUrl);
  });
  state.editorQueue = [];
  state.activeItemId = null;
  if (state.batchWorker) {
    state.batchWorker.terminate();
    state.batchWorker = null;
  }
}

async function batchEdit() {
  if (state.selectedIds.size === 0) return;
  openBatchModal('edit');

  const targets = state.allRecords.filter((r) => state.selectedIds.has(r.id));
  setBatchStatus('編集データを準備中...');

  for (const rec of targets) {
    const qId = `edit_${rec.id}`;
    const highResUrl = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    state.editorQueue.push({
      id: qId,
      file: null,
      imgUrl: highResUrl,
      status: 'existing',
      data: {
        title: rec.title,
        level: rec.level,
        diff: normalizeDifficultyCode(rec.difficultyRaw),
        perfect: rec.perfect ?? 0,
        great: rec.great ?? 0,
        good: rec.good ?? 0,
        bad: rec.bad ?? 0,
        missDetail: rec.miss ?? 0,
        miss: rec.miss ?? 0,
        combo: rec.combo ?? 0,
        missCount: rec.missCount ?? 0,
        musicId: null,
      },
      originalId: rec.id,
      originalParent: rec.parentId,
      profileId: rec.profileId || state.prefs.activeProfileId,
    });
    renderSidebarItem(qId);
  }

  checkBatchButton();
  if (state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
}

function individualEdit(id) {
  state.selectedIds.clear();
  state.selectedIds.add(id);
  batchEdit();
}

async function individualDelete(id) {
  if (!confirm('このリザルトを削除しますか？')) return;
  showLoader('削除中...');
  els.grid.innerHTML = '';
  try {
    await deleteDriveFile(id);
    showToast('削除しました', 'success');
    await fetchDataFromDrive();
  } catch (error) {
    alert(`エラー: ${error.message}`);
    await fetchDataFromDrive();
  } finally {
    hideLoader();
  }
}

async function batchDelete() {
  if (!confirm(`選択した ${state.selectedIds.size} 件を削除しますか？`)) return;
  showLoader('削除中...');
  els.grid.innerHTML = '';
  try {
    for (const id of state.selectedIds) {
      await deleteDriveFile(id);
    }
    showToast('削除しました', 'success');
    state.selectedIds.clear();
    updateSelectionUI();
    await fetchDataFromDrive();
  } catch (error) {
    alert(`削除エラー: ${error.message}`);
    await fetchDataFromDrive();
  } finally {
    hideLoader();
  }
}

function toggleSelectMode() {
  state.isSelectMode = !state.isSelectMode;
  applySelectionModeUI();
  if (!state.isSelectMode) {
    state.selectedIds.clear();
    updateSelectionUI();
  }
  renderGrid(state.filteredRecords);
}

function toggleSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);

  const card = $(`card-${id}`);
  if (card) {
    if (state.selectedIds.has(id)) card.classList.add('selected');
    else card.classList.remove('selected');
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  els['selected-count'].textContent = String(state.selectedIds.size);
  els['batch-actions'].style.display = state.selectedIds.size > 0 ? 'flex' : 'none';
}

function clearSelection() {
  state.selectedIds.clear();
  updateSelectionUI();
  renderGrid(state.filteredRecords);
}

async function openSettingsModal() {
  els.settingsModal.style.display = 'flex';
  state.settings.activeProfileId = state.prefs.activeProfileId || state.profiles[0]?.id || '';
  renderSettingsUI();
}

function closeSettingsModal() {
  els.settingsModal.style.display = 'none';
  state.settings.dragState = null;
}

function renderSettingsUI() {
  renderProfileSelectors();
  const profile = getProfileById(state.settings.activeProfileId) || state.profiles[0];
  if (!profile) return;
  els['settings-profile-select'].value = profile.id;
  els['settings-profile-name'].value = profile.name || '';
  els['settings-profile-width'].value = profile.width || '';
  els['settings-profile-height'].value = profile.height || '';
  state.settings.currentProfileDraft = ensureProfileDefaults(profile);
  renderRegionEditor();
  refreshSettingsStatus();
}

function refreshSettingsStatus() {
  const profile = state.settings.currentProfileDraft;
  if (!profile) return;
  els['settings-profile-status'].textContent = `${profile.name} / ${profile.width || '?'}×${profile.height || '?'}`;
  els['settings-sample-info'].textContent = state.settings.sampleWidth && state.settings.sampleHeight
    ? `サンプル画像: ${state.settings.sampleWidth}×${state.settings.sampleHeight}`
    : 'サンプル画像未設定';
}

function selectSettingsProfile(profileId) {
  state.settings.activeProfileId = profileId;
  state.settings.currentProfileDraft = ensureProfileDefaults(getProfileById(profileId));
  renderSettingsUI();
}

async function handleSettingsSampleFile(file) {
  if (!file) return;
  const meta = await loadImageMeta(file);
  state.settings.sampleWidth = meta.width;
  state.settings.sampleHeight = meta.height;
  state.settings.sampleUrl = URL.createObjectURL(file);
  els['settings-preview-img'].src = state.settings.sampleUrl;
  els['settings-preview-img'].style.display = 'block';
  state.settings.currentProfileDraft.width = meta.width;
  state.settings.currentProfileDraft.height = meta.height;
  const detected = detectProfileByDimensions(meta.width, meta.height, state.profiles);
  if (detected) {
    state.settings.activeProfileId = detected.id;
    state.settings.currentProfileDraft = ensureProfileDefaults(detected);
  } else {
    state.settings.currentProfileDraft = ensureProfileDefaults(state.settings.currentProfileDraft);
  }
  renderSettingsUI();
}

function renderRegionEditor() {
  const profile = state.settings.currentProfileDraft;
  if (!profile) return;

  els['settings-region-overlay'].innerHTML = '';
  const img = els['settings-preview-img'];
  if (state.settings.sampleUrl) {
    img.src = state.settings.sampleUrl;
    img.style.display = 'block';
  }

  // Render active region boxes only when image is ready.
  if (!img.naturalWidth || !img.naturalHeight) {
    const pending = document.createElement('div');
    pending.className = 'settings-preview-empty';
    pending.textContent = 'サンプル画像を読み込むと範囲を調整できます';
    els['settings-region-overlay'].appendChild(pending);
    return;
  }

  const rect = img.getBoundingClientRect();
  const scaleX = rect.width / img.naturalWidth;
  const scaleY = rect.height / img.naturalHeight;

  for (const key of regionKeys()) {
    const region = profile.regions[key];
    const box = document.createElement('div');
    box.className = `region-box ${key === state.settings.activeRegionKey ? 'active' : ''}`;
    box.dataset.key = key;
    const px = regionToPixels(region, img.naturalWidth, img.naturalHeight);
    box.style.left = `${px.x * scaleX}px`;
    box.style.top = `${px.y * scaleY}px`;
    box.style.width = `${px.w * scaleX}px`;
    box.style.height = `${px.h * scaleY}px`;
    box.style.borderColor = difficultyColorOf(key === 'diff' ? 'EXPERT' : 'MASTER');
    box.innerHTML = `<span class="region-label">${key.toUpperCase()}</span><span class="region-handle"></span>`;
    box.addEventListener('pointerdown', (e) => startRegionDrag(e, key));
    els['settings-region-overlay'].appendChild(box);
  }
  syncRegionInputs();
}

function syncRegionInputs() {
  const profile = state.settings.currentProfileDraft;
  if (!profile) return;
  const region = profile.regions[state.settings.activeRegionKey];
  const img = els['settings-preview-img'];
  if (!img || !img.naturalWidth || !img.naturalHeight) return;
  const px = regionToPixels(region, img.naturalWidth, img.naturalHeight);
  els['settings-region-x'].value = px.x;
  els['settings-region-y'].value = px.y;
  els['settings-region-w'].value = px.w;
  els['settings-region-h'].value = px.h;
  els['settings-region-key'].value = state.settings.activeRegionKey;
}

function applyRegionInputChanges() {
  const profile = state.settings.currentProfileDraft;
  const img = els['settings-preview-img'];
  if (!profile || !img.naturalWidth || !img.naturalHeight) return;
  const regionPx = {
    x: parseInt(els['settings-region-x'].value, 10) || 0,
    y: parseInt(els['settings-region-y'].value, 10) || 0,
    w: parseInt(els['settings-region-w'].value, 10) || 1,
    h: parseInt(els['settings-region-h'].value, 10) || 1,
  };
  profile.regions[state.settings.activeRegionKey] = ensureRegion(pixelsToRegion(regionPx, img.naturalWidth, img.naturalHeight));
  renderRegionEditor();
}

function switchSettingsRegion(key) {
  state.settings.activeRegionKey = key;
  renderRegionEditor();
}

function startRegionDrag(e, key) {
  e.preventDefault();
  e.stopPropagation();
  const box = e.currentTarget;
  const img = els['settings-preview-img'];
  if (!img.naturalWidth || !img.naturalHeight) return;

  const rect = img.getBoundingClientRect();
  const region = state.settings.currentProfileDraft.regions[key];
  const start = {
    key,
    mode: e.target.classList.contains('region-handle') ? 'resize' : 'move',
    pointerX: e.clientX,
    pointerY: e.clientY,
    imageRect: rect,
    original: { ...regionToPixels(region, img.naturalWidth, img.naturalHeight) },
  };
  state.settings.dragState = start;

  const onMove = (ev) => {
    if (!state.settings.dragState) return;
    const drag = state.settings.dragState;
    const dx = (ev.clientX - drag.pointerX) / (rect.width / img.naturalWidth);
    const dy = (ev.clientY - drag.pointerY) / (rect.height / img.naturalHeight);
    const current = { ...drag.original };
    if (drag.mode === 'move') {
      current.x = Math.max(0, Math.min(current.x + dx, img.naturalWidth - current.w));
      current.y = Math.max(0, Math.min(current.y + dy, img.naturalHeight - current.h));
    } else {
      current.w = Math.max(20, Math.min(current.w + dx, img.naturalWidth - current.x));
      current.h = Math.max(20, Math.min(current.h + dy, img.naturalHeight - current.y));
    }
    state.settings.currentProfileDraft.regions[key] = ensureRegion(pixelsToRegion(current, img.naturalWidth, img.naturalHeight));
    renderRegionEditor();
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    state.settings.dragState = null;
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function updateSettingsProfileName() {
  state.settings.currentProfileDraft.name = els['settings-profile-name'].value || '未設定';
  state.settings.currentProfileDraft.width = parseInt(els['settings-profile-width'].value, 10) || state.settings.currentProfileDraft.width || 0;
  state.settings.currentProfileDraft.height = parseInt(els['settings-profile-height'].value, 10) || state.settings.currentProfileDraft.height || 0;
  refreshSettingsStatus();
}

function newSettingsProfile() {
  const sampleW = state.settings.sampleWidth || 0;
  const sampleH = state.settings.sampleHeight || 0;
  state.settings.currentProfileDraft = createProfileFromSample(sampleW, sampleH, `新しい機種 ${sampleW || '?'}×${sampleH || '?'}`);
  state.settings.activeProfileId = state.settings.currentProfileDraft.id;
  renderSettingsUI();
}

function saveSettingsProfile() {
  const draft = state.settings.currentProfileDraft;
  if (!draft) return;
  draft.name = els['settings-profile-name'].value || draft.name;
  draft.width = parseInt(els['settings-profile-width'].value, 10) || draft.width || 0;
  draft.height = parseInt(els['settings-profile-height'].value, 10) || draft.height || 0;

  const normalized = ensureProfileDefaults(draft);
  const idx = state.profiles.findIndex((p) => p.id === normalized.id);
  if (idx >= 0) state.profiles[idx] = normalized;
  else state.profiles.push(normalized);
  saveProfiles(state.profiles);
  markProfileSelection(normalized.id);
  state.settings.activeProfileId = normalized.id;
  state.settings.currentProfileDraft = ensureProfileDefaults(normalized);
  renderProfileSelectors();
  renderSettingsUI();
  showToast('機種設定を保存しました', 'success');
}

function deleteSettingsProfile() {
  const id = state.settings.activeProfileId;
  if (!id) return;
  if (!confirm('この機種設定を削除しますか？')) return;
  state.profiles = state.profiles.filter((p) => p.id !== id);
  if (state.profiles.length === 0) {
    state.profiles = [ensureProfileDefaults(createProfileFromSample(0, 0, '標準'))];
  }
  saveProfiles(state.profiles);
  const next = state.profiles[0];
  state.settings.activeProfileId = next.id;
  state.settings.currentProfileDraft = ensureProfileDefaults(next);
  markProfileSelection(next.id);
  renderProfileSelectors();
  renderSettingsUI();
  showToast('機種設定を削除しました', 'success');
}

function onSettingsProfileSelectChange() {
  selectSettingsProfile(els['settings-profile-select'].value);
}

function onMachineSelectChange() {
  if (!state.activeItemId) return;
  const item = state.editorQueue.find((q) => q.id === state.activeItemId);
  if (!item) return;
  item.profileId = els.upMachine.value;
}

function bindEvents() {
  els.authorize_button.addEventListener('click', handleAuthClick);
  els.signout_button.addEventListener('click', handleSignoutClick);
  els.upload_button.addEventListener('click', () => openBatchModal('upload'));
  els['btn-select-mode'].addEventListener('click', toggleSelectMode);
  els['sort-order'].addEventListener('change', () => { syncPrefsFromUI(); updateView(); });
  els['sort-dir-toggle'].addEventListener('click', toggleSortDirection);
  els['filter-fc'].addEventListener('change', updateView);
  els['filter-miss-min'].addEventListener('input', debounceUpdateView);
  els['filter-miss-max'].addEventListener('input', debounceUpdateView);
  els['filter-diff'].addEventListener('change', updateView);
  els['filter-level'].addEventListener('input', debounceUpdateView);
  els['filter-title'].addEventListener('input', debounceUpdateView);
  els['filter-show-best'].addEventListener('change', updateView);

  els['up-file'].addEventListener('change', (e) => handleFiles(e.target.files));
  els['drop-zone'].addEventListener('dragover', (e) => { e.preventDefault(); els['drop-zone'].classList.add('dragover'); });
  els['drop-zone'].addEventListener('dragleave', (e) => { e.preventDefault(); els['drop-zone'].classList.remove('dragover'); });
  els['drop-zone'].addEventListener('drop', (e) => { e.preventDefault(); els['drop-zone'].classList.remove('dragover'); if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files); });

  els['btn-exec-batch'].addEventListener('click', handleBatchExecution);

  els['settings-profile-select'].addEventListener('change', onSettingsProfileSelectChange);
  els['settings-sample-file'].addEventListener('change', (e) => handleSettingsSampleFile(e.target.files?.[0]));
  els['settings-region-key'].addEventListener('change', (e) => switchSettingsRegion(e.target.value));
  ['settings-region-x','settings-region-y','settings-region-w','settings-region-h'].forEach((id) => {
    els[id].addEventListener('input', debounceApplyRegionInputs);
  });
  els['settings-profile-name'].addEventListener('input', updateSettingsProfileName);
  els['settings-profile-width'].addEventListener('input', updateSettingsProfileName);
  els['settings-profile-height'].addEventListener('input', updateSettingsProfileName);
  els['settings-new-profile'].addEventListener('click', newSettingsProfile);
  els['settings-save-profile'].addEventListener('click', saveSettingsProfile);
  els['settings-delete-profile'].addEventListener('click', deleteSettingsProfile);
  els['settings-preview-img'].addEventListener('load', () => renderRegionEditor());
  els['up-machine'].addEventListener('change', onMachineSelectChange);

  window.addEventListener('resize', () => {
    if (els.settingsModal.style.display === 'flex') renderRegionEditor();
  });
}

function debounceApplyRegionInputs() {
  const key = 'settings-region';
  clearTimeout(debounceTimers.get(key));
  debounceTimers.set(key, setTimeout(() => applyRegionInputChanges(), 120));
}

function debounceUpdateView() {
  clearTimeout(debounceTimers.get('view'));
  debounceTimers.set('view', setTimeout(() => updateView(), 120));
}

async function init() {
  cacheElements();
  state.profiles = loadProfiles();
  ensureProfilesExist();
  state.prefs.activeProfileId = state.prefs.activeProfileId || loadLastProfileId() || state.profiles[0].id;
  if (!getProfileById(state.prefs.activeProfileId)) {
    state.prefs.activeProfileId = state.profiles[0].id;
  }
  saveLastProfileId(state.prefs.activeProfileId);
  initPrefsToUI();
  renderProfileSelectors();
  bindEvents();
  applySelectionModeUI();
  updateSelectionUI();
  setAuthUI(false);

  await waitForExternalApis();
  gapiLoaded();
  gisLoaded();
  await waitForDriveClientInit();

  await preloadMusicDatabase();
  if (state.prefs.activeProfileId) markProfileSelection(state.prefs.activeProfileId);
  updateSortDirButton();
  await updateView();
}

window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;
window.handleAuthClick = handleAuthClick;
window.handleSignoutClick = handleSignoutClick;
window.openBatchModal = openBatchModal;
window.closeBatchModal = closeBatchModal;
window.analyzeAllInBatch = analyzeAllInBatch;
window.reanalyzeCurrentItem = reanalyzeCurrentItem;
window.handleBatchExecution = handleBatchExecution;
window.toggleSelectMode = toggleSelectMode;
window.toggleSelection = toggleSelection;
window.clearSelection = clearSelection;
window.batchDelete = batchDelete;
window.batchEdit = batchEdit;
window.individualEdit = individualEdit;
window.individualDelete = individualDelete;
window.removeBatchItem = removeBatchItem;
window.selectItem = selectItem;
window.updateCurrentItem = updateCurrentItem;
window.closeImageModal = closeImageModal;
window.openImageModal = openImageModal;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.toggleSortDirection = toggleSortDirection;

document.addEventListener('DOMContentLoaded', init);
