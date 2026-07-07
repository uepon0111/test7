
import { APP_NAME, DEFAULT_SETTINGS, DEFAULT_DEVICE_PROFILES, DIFFICULTIES, DIFFICULTY_ORDER, DIFFICULTY_SHORT_TO_KEY, DIFFICULTY_LABELS, DIFFICULTY_COLORS, ROOT_FOLDER_NAME, STORAGE_KEYS } from './config.js';
import { loadJSON, saveJSON, mergeSettings, deepClone, uid, nowIso } from './storage.js';
import { loadRecordsFromDrive, deleteDriveFile, updateFileMetadata, uploadResultFile, ensureUploadFolder, findFolderByName } from './drive.js';
import { analyzeImageWithProfile, selectBestProfile, readImageSize, getLevelFromDb, getDifficultyOrder } from './ocr.js';
import { escapeHtml, renderGrid, renderProfileOptions, renderProfileList, renderRegionTabs, showToast, createToastContainerIfNeeded, applyProfileValues, readRegionValues } from './ui.js';

const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive';

const state = {
  tokenClient: null,
  gapiInited: false,
  gisInited: false,
  loggedIn: false,
  loading: false,
  allRecords: [],
  filteredRecords: [],
  selectedIds: new Set(),
  isSelectMode: false,
  dbMusics: [],
  dbDiffs: [],
  settings: mergeSettings(DEFAULT_SETTINGS, loadJSON(STORAGE_KEYS.settings, null)),
  uploadQueue: [],
  activeUploadId: null,
  currentUploadMode: 'upload',
  activeProfileEditId: null,
  sampleImageUrl: '',
  sampleImageSize: { width: 0, height: 0 },
  activeRegion: 'title',
  currentEditingProfileId: null,
  currentUserBestMap: new Map(),
  lastBestNotifications: [],
};

function saveSettings() {
  saveJSON(STORAGE_KEYS.settings, state.settings);
}

function getProfiles() {
  return state.settings.profiles || [];
}

function setProfiles(profiles) {
  state.settings.profiles = profiles;
  if (!profiles.find((p) => p.id === state.settings.selectedProfileId)) {
    state.settings.selectedProfileId = profiles[0]?.id || '';
  }
  saveSettings();
}

function getActiveProfile() {
  return getProfiles().find((p) => p.id === state.settings.selectedProfileId) || getProfiles()[0] || null;
}

function setActiveProfileId(profileId) {
  state.settings.selectedProfileId = profileId;
  saveSettings();
  syncUploadProfileSelect();
}

function makeDefaultProfileClone() {
  const base = deepClone(DEFAULT_DEVICE_PROFILES[0]);
  base.id = uid('profile');
  base.name = `新しい機種 ${new Date().toLocaleString('ja-JP', { hour12: false }).replace(/[/:]/g, '-')}`;
  base.builtIn = false;
  return base;
}

function ensureToasts() {
  createToastContainerIfNeeded();
}

async function loadDb() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json'),
    ]);
    state.dbMusics = await musicsResp.json();
    state.dbDiffs = await diffsResp.json();
  } catch (e) {
    console.error('DB Error', e);
    showToast('楽曲DBの取得に失敗しました', 'warn');
  }
}

function syncTopControls() {
  const sortSelect = document.getElementById('sort-order');
  const dirBtn = document.getElementById('sort-direction');
  const bestToggle = document.getElementById('filter-best-only');
  if (sortSelect) sortSelect.value = state.settings.sortKey;
  if (dirBtn) {
    dirBtn.dataset.direction = state.settings.sortDirection;
    dirBtn.innerText = state.settings.sortDirection === 'asc' ? '昇順' : '降順';
  }
  if (bestToggle) bestToggle.checked = !!state.settings.showBestOnly;
}

function setAuthUI(loggedIn) {
  state.loggedIn = loggedIn;
  document.getElementById('auth-status').innerText = loggedIn ? 'ログイン済み' : '未ログイン';
  document.getElementById('authorize_button').style.display = loggedIn ? 'none' : 'inline-flex';
  document.getElementById('signout_button').style.display = loggedIn ? 'inline-flex' : 'none';
  document.getElementById('upload_button').style.display = loggedIn ? 'inline-flex' : 'none';
}

function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}
async function initializeGapiClient() {
  await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
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

function ensureAuthReady() {
  return state.gapiInited && state.gisInited;
}

function handleAuthClick() {
  if (!ensureAuthReady()) {
    showToast('認証の読み込み中です', 'warn');
    return;
  }
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
    state.allRecords = [];
    state.filteredRecords = [];
    renderView();
  }
}

function getCurrentToken() {
  const token = gapi.client.getToken();
  return token?.access_token || '';
}

async function fetchDataFromDrive() {
  const loader = document.getElementById('loader');
  loader.style.display = 'flex';
  document.getElementById('loader-text').innerText = 'データを取得中...';
  document.getElementById('result-count').innerText = 'データ取得中...';

  try {
    state.allRecords = await loadRecordsFromDrive();
    annotateRecords();
    updateBestMap();
    updateView();
    showToast(`読み込み完了: ${state.allRecords.length} 件`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Drive の読み込みに失敗しました', 'error');
  } finally {
    loader.style.display = 'none';
  }
}

function normalizeBestKey(rec) {
  if (rec.bestKey) return rec.bestKey;
  const musicKey = rec.musicId ? `music:${rec.musicId}` : `title:${String(rec.title || '').toLowerCase()}`;
  return `${musicKey}|${rec.difficultyKey || ''}`;
}

function compareBest(a, b) {
  const ma = a.totalMiss ?? a.missCount ?? 999999;
  const mb = b.totalMiss ?? b.missCount ?? 999999;
  if (ma !== mb) return ma - mb;
  const ca = a.combo ?? -1;
  const cb = b.combo ?? -1;
  if (ca !== cb) return cb - ca;
  const pa = a.perfect ?? -1;
  const pb = b.perfect ?? -1;
  if (pa !== pb) return pb - pa;
  return String(b.addedAt || b.createdTime || '').localeCompare(String(a.addedAt || a.createdTime || ''));
}

function updateBestMap() {
  const map = new Map();
  for (const rec of state.allRecords) {
    const key = normalizeBestKey(rec);
    const current = map.get(key);
    if (!current || compareBest(rec, current) < 0) {
      map.set(key, rec);
    }
  }
  state.currentUserBestMap = map;
  for (const rec of state.allRecords) {
    const best = map.get(normalizeBestKey(rec));
    rec.isPersonalBest = !!best && best.id === rec.id;
  }
}

function annotateRecords() {
  for (const rec of state.allRecords) {
    rec.addedAt = rec.addedAt || rec.createdTime || '';
    rec.difficultyKey = String(rec.difficultyKey || 'expert').toLowerCase();
    rec.difficultyLabel = DIFFICULTY_LABELS[rec.difficultyKey] || rec.difficultyLabel || rec.difficultyKey.toUpperCase();
    if (rec.totalMiss == null) rec.totalMiss = rec.missCount ?? 0;
    if (rec.isFC == null) rec.isFC = Number(rec.totalMiss) === 0;
    if (rec.combo == null) rec.combo = null;
  }
}

function sortRecords(records) {
  const dir = state.settings.sortDirection === 'asc' ? 1 : -1;
  const compareTitle = (a, b) => a.title.localeCompare(b.title, 'ja');
  const compareDate = (a, b) => String(a.addedAt || a.createdTime || '').localeCompare(String(b.addedAt || b.createdTime || ''));
  const compareDiff = (a, b) => (getDifficultyOrder(a.difficultyKey) - getDifficultyOrder(b.difficultyKey));
  const compareLevel = (a, b) => (Number(a.level ?? 9999) - Number(b.level ?? 9999));
  const compareMiss = (a, b) => (Number(a.totalMiss ?? 9999) - Number(b.totalMiss ?? 9999));

  const tie = (a, b) => compareDiff(a, b) || compareTitle(a, b) || compareMiss(a, b) || compareDate(a, b);

  const list = [...records];
  list.sort((a, b) => {
    let primary = 0;
    switch (state.settings.sortKey) {
      case 'title':
        primary = compareTitle(a, b);
        return primary * dir || compareDiff(a, b) || compareMiss(a, b) || compareDate(a, b);
      case 'level':
        primary = compareLevel(a, b);
        return primary * dir || compareDiff(a, b) || compareTitle(a, b) || compareMiss(a, b) || compareDate(a, b);
      case 'miss':
        primary = compareMiss(a, b);
        return primary * dir || compareLevel(a, b) || compareDiff(a, b) || compareTitle(a, b) || compareDate(a, b);
      case 'date':
      default:
        primary = compareDate(a, b);
        return primary * dir;
    }
  });
  return list;
}

function filterRecords(records) {
  let list = [...records];
  if (state.settings.showBestOnly) {
    const bestMap = new Map();
    for (const rec of list) {
      const key = normalizeBestKey(rec);
      const cur = bestMap.get(key);
      if (!cur || compareBest(rec, cur) < 0) bestMap.set(key, rec);
    }
    list = [...bestMap.values()];
  }
  const fc = document.getElementById('filter-fc').value;
  const diff = document.getElementById('filter-diff').value;
  const title = document.getElementById('filter-title').value.trim().toLowerCase();
  const level = document.getElementById('filter-level').value;
  const missMin = document.getElementById('filter-miss-min').value;
  const missMax = document.getElementById('filter-miss-max').value;

  list = list.filter((r) => {
    if (fc === 'fc' && !r.isFC) return false;
    if (fc === 'unfc' && r.isFC) return false;
    if (diff !== 'all' && r.difficultyKey !== diff) return false;
    if (title && !String(r.title || '').toLowerCase().includes(title)) return false;
    if (level && String(r.level ?? '') !== String(level)) return false;
    const miss = Number(r.totalMiss ?? 0);
    if (missMin !== '' && miss < Number(missMin)) return false;
    if (missMax !== '' && miss > Number(missMax)) return false;
    return true;
  });

  return sortRecords(list);
}

function updateView() {
  if (!state.allRecords) return;
  state.filteredRecords = filterRecords(state.allRecords);
  renderGrid(state.filteredRecords, state);
  updateSelectedCount();
  updateBestToggleLabel();
  document.getElementById('loader').style.display = 'none';
}

function updateBestToggleLabel() {
  const el = document.getElementById('best-toggle-label');
  if (el) el.textContent = state.settings.showBestOnly ? '自己ベストのみ表示中' : '自己ベストのみ';
}

function updateSelectedCount() {
  document.getElementById('selected-count').innerText = String(state.selectedIds.size);
  const batchBar = document.getElementById('batch-actions');
  batchBar.style.display = state.isSelectMode ? 'flex' : 'none';
  const btn = document.getElementById('btn-select-mode');
  btn.classList.toggle('active', state.isSelectMode);
  btn.innerHTML = `<span class="material-symbols-outlined">check_box</span> ${state.isSelectMode ? '選択モード中' : '選択モード'}`;
}

function toggleSelectMode() {
  state.isSelectMode = !state.isSelectMode;
  if (!state.isSelectMode) state.selectedIds.clear();
  updateSelectedCount();
  updateView();
}

function toggleSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  updateSelectedCount();
  updateView();
}

function clearSelection() {
  state.selectedIds.clear();
  state.isSelectMode = false;
  updateSelectedCount();
  updateView();
}

function openImageModal(src) {
  const modal = document.getElementById('imageModal');
  document.getElementById('modalImg').src = src;
  modal.style.display = 'flex';
}
function closeImageModal() {
  document.getElementById('imageModal').style.display = 'none';
  document.getElementById('modalImg').src = '';
}

function openSettingsModal() {
  renderSettingsModal();
  document.getElementById('settingsModal').style.display = 'flex';
}
function closeSettingsModal() {
  document.getElementById('settingsModal').style.display = 'none';
}

function renderSettingsModal() {
  const profileList = document.getElementById('settings-profile-list');
  renderProfileList(profileList, getProfiles(), state.currentEditingProfileId || state.settings.selectedProfileId);
  const profile = getProfiles().find((p) => p.id === (state.currentEditingProfileId || state.settings.selectedProfileId)) || getProfiles()[0];
  if (profile) {
    document.getElementById('settings-profile-name').value = profile.name || '';
    document.getElementById('settings-profile-width').value = profile.width || '';
    document.getElementById('settings-profile-height').value = profile.height || '';
    renderRegionTabs(document.getElementById('settings-region-tabs'), Object.keys(profile.regions || {}), state.activeRegion);
    const img = document.getElementById('settings-preview-img');
    if (state.sampleImageUrl) {
      img.onload = () => updateCropOverlay(profile);
      img.src = state.sampleImageUrl;
    } else {
      img.onload = null;
      updateCropOverlay(profile);
    }
    syncRegionFields(profile);
  }
}

function syncRegionFields(profile) {
  const region = profile.regions[state.activeRegion];
  if (!region) return;
  const form = document.getElementById('settings-form');
  form.querySelector('[name="region-x"]').value = roundPercent(region.x);
  form.querySelector('[name="region-y"]').value = roundPercent(region.y);
  form.querySelector('[name="region-w"]').value = roundPercent(region.w);
  form.querySelector('[name="region-h"]').value = roundPercent(region.h);
}

function roundPercent(v) {
  return Math.round(v * 10000) / 100;
}

function getSelectedSettingsProfile() {
  return getProfiles().find((p) => p.id === (state.currentEditingProfileId || state.settings.selectedProfileId)) || getProfiles()[0];
}

function computeContainedRect(container, imageWidth, imageHeight) {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (!cw || !ch || !imageWidth || !imageHeight) return { left: 0, top: 0, width: cw, height: ch };
  const scale = Math.min(cw / imageWidth, ch / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    left: (cw - width) / 2,
    top: (ch - height) / 2,
    width,
    height,
  };
}

function updateCropOverlay(profile) {
  const img = document.getElementById('settings-preview-img');
  const preview = document.getElementById('settings-preview-stage');
  const existing = document.getElementById('crop-overlay');
  if (existing) existing.remove();
  if (!img || !img.naturalWidth || !profile || !preview) return;
  const r = profile.regions[state.activeRegion];
  if (!r) return;
  const overlay = document.createElement('div');
  overlay.id = 'crop-overlay';
  overlay.className = 'crop-overlay';
  overlay.innerHTML = '<div class="handle"></div>';
  preview.appendChild(overlay);

  const rect = computeContainedRect(preview, img.naturalWidth, img.naturalHeight);
  const render = () => {
    overlay.style.left = `${rect.left + r.x * rect.width}px`;
    overlay.style.top = `${rect.top + r.y * rect.height}px`;
    overlay.style.width = `${r.w * rect.width}px`;
    overlay.style.height = `${r.h * rect.height}px`;
  };
  render();

  let dragMode = null;
  let startX = 0, startY = 0;
  let start = null;
  const onMove = (ev) => {
    if (!dragMode || !start) return;
    const dx = (ev.clientX - startX) / rect.width;
    const dy = (ev.clientY - startY) / rect.height;
    const profile = getSelectedSettingsProfile();
    if (!profile) return;
    const region = profile.regions[state.activeRegion];
    if (!region) return;
    if (dragMode === 'move') {
      region.x = clamp(start.x + dx, 0, 1 - region.w);
      region.y = clamp(start.y + dy, 0, 1 - region.h);
    } else if (dragMode === 'resize') {
      region.w = clamp(start.w + dx, 0.01, 1 - region.x);
      region.h = clamp(start.h + dy, 0.01, 1 - region.y);
    }
    syncRegionFields(profile);
    updateCropOverlay(profile);
  };
  const onUp = () => {
    dragMode = null;
    start = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  overlay.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    dragMode = ev.target.classList.contains('handle') ? 'resize' : 'move';
    startX = ev.clientX;
    startY = ev.clientY;
    start = { x: r.x, y: r.y, w: r.w, h: r.h };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function saveCurrentProfileEdits() {
  const profile = getSelectedSettingsProfile();
  if (!profile) return;
  profile.name = document.getElementById('settings-profile-name').value.trim() || profile.name;
  profile.width = Number(document.getElementById('settings-profile-width').value) || profile.width;
  profile.height = Number(document.getElementById('settings-profile-height').value) || profile.height;
  profile.regions = profile.regions || {};
  profile.regions[state.activeRegion] = {
    ...profile.regions[state.activeRegion],
    ...readRegionValues(document.getElementById('settings-form')),
  };
  const profiles = getProfiles().map((p) => p.id === profile.id ? profile : p);
  setProfiles(profiles);
  state.currentEditingProfileId = profile.id;
  renderSettingsModal();
  showToast('範囲を保存しました', 'success');
}

function createProfileFromSample() {
  const base = makeProfileFromSample();
  const profiles = [...getProfiles(), base];
  setProfiles(profiles);
  state.currentEditingProfileId = base.id;
  state.settings.selectedProfileId = base.id;
  saveSettings();
  renderSettingsModal();
  syncUploadProfileSelect();
  showToast('新しい機種を作成しました', 'success');
}

function makeProfileFromSample() {
  const img = document.getElementById('settings-preview-img');
  const width = state.sampleImageSize.width || img.naturalWidth || 1170;
  const height = state.sampleImageSize.height || img.naturalHeight || 2532;
  const base = makeDefaultProfileClone();
  base.width = width;
  base.height = height;
  base.name = document.getElementById('settings-profile-name').value.trim() || base.name;
  base.regions = deepClone(getSelectedSettingsProfile()?.regions || DEFAULT_DEVICE_PROFILES[0].regions);
  return base;
}

function deleteCurrentProfile() {
  const profile = getSelectedSettingsProfile();
  if (!profile || profile.builtIn) {
    showToast('built-in 機種は削除できません', 'warn');
    return;
  }
  if (!confirm(`「${profile.name}」を削除しますか？`)) return;
  const profiles = getProfiles().filter((p) => p.id !== profile.id);
  setProfiles(profiles);
  state.currentEditingProfileId = profiles[0]?.id || '';
  state.settings.selectedProfileId = state.currentEditingProfileId;
  saveSettings();
  renderSettingsModal();
  syncUploadProfileSelect();
}

function syncUploadProfileSelect() {
  const select = document.getElementById('up-device');
  if (!select) return;
  renderProfileOptions(select, getProfiles(), state.settings.selectedProfileId);
}

function attachSettingsEvents() {
  document.getElementById('settings-profile-list').addEventListener('click', (ev) => {
    const item = ev.target.closest('.profile-item');
    if (!item) return;
    state.currentEditingProfileId = item.dataset.profileId;
    state.settings.selectedProfileId = item.dataset.profileId;
    saveSettings();
    renderSettingsModal();
    syncUploadProfileSelect();
  });
  document.getElementById('settings-region-tabs').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.region-tab');
    if (!btn) return;
    state.activeRegion = btn.dataset.region;
    renderSettingsModal();
  });
  document.getElementById('settings-sample-file').addEventListener('change', handleSettingsSampleFile);
  document.getElementById('btn-new-profile').addEventListener('click', createProfileFromSample);
  document.getElementById('btn-delete-profile').addEventListener('click', deleteCurrentProfile);
  document.getElementById('settings-form').addEventListener('input', () => {
    const profile = getSelectedSettingsProfile();
    if (!profile) return;
    profile.regions[state.activeRegion] = {
      ...profile.regions[state.activeRegion],
      ...readRegionValues(document.getElementById('settings-form')),
    };
    updateCropOverlay(profile);
  });
}

async function handleSettingsSampleFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const { width, height, imageUrl } = await readImageSize(file);
  state.sampleImageSize = { width, height };
  state.sampleImageUrl = imageUrl;
  const matched = selectBestProfile(width, height, getProfiles());
  state.currentEditingProfileId = matched?.id || getProfiles()[0]?.id || '';
  state.settings.selectedProfileId = state.currentEditingProfileId;
  saveSettings();
  renderSettingsModal();
  syncUploadProfileSelect();
  showToast(`画像サイズ ${width}×${height} に合わせて機種を選びました`, 'info');
}

function openBatchModal(mode) {
  state.currentUploadMode = mode;
  for (const item of state.uploadQueue) {
    if (item.imgUrl && item.imgUrl.startsWith('blob:')) URL.revokeObjectURL(item.imgUrl);
  }
  state.uploadQueue = [];
  state.activeUploadId = null;
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
    document.getElementById('btn-exec-batch').innerText = '全てアップロード';
    document.getElementById('btn-upload-files').value = '';
    syncUploadProfileSelect();
  } else {
    document.getElementById('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
    document.getElementById('upload-initial').style.display = 'none';
    document.getElementById('batch-workspace').style.display = 'flex';
    document.getElementById('btn-exec-batch').innerText = '保存して反映';
  }
}

function closeBatchModal() {
  for (const item of state.uploadQueue) {
    if (item.imgUrl && item.imgUrl.startsWith('blob:')) URL.revokeObjectURL(item.imgUrl);
  }
  document.getElementById('batchModal').style.display = 'none';
}

function closeSettingsSample() {
  state.sampleImageUrl = '';
  state.sampleImageSize = { width: 0, height: 0 };
}

async function handleFiles(files) {
  if (!files.length) return;
  openBatchModal('upload');
  document.getElementById('upload-initial').style.display = 'none';
  document.getElementById('batch-workspace').style.display = 'flex';
  document.getElementById('batch-status-msg').innerText = '画像を処理中...';
  const profiles = getProfiles();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const id = uid('upload');
    const { width, height, imageUrl } = await readImageSize(file);
    const autoProfile = selectBestProfile(width, height, profiles);
    const item = {
      id,
      file,
      imgUrl: imageUrl,
      width,
      height,
      profileId: autoProfile?.id || profiles[0]?.id || '',
      status: 'pending',
      data: {
        title: '',
        level: '',
        difficultyKey: 'expert',
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        miss: 0,
        totalMiss: 0,
        combo: 0,
        musicId: null,
      },
      originalId: null,
    };
    state.uploadQueue.push(item);
    renderSidebarItem(item);
  }
  renderUploadProfileSelectForActive();
  await runBatchAnalysis(state.uploadQueue.filter((x) => x.status === 'pending'));
  if (state.uploadQueue.length) selectUploadItem(state.uploadQueue[0].id);
  checkBatchButton();
}

function renderSidebarItem(item) {
  const div = document.createElement('div');
  div.className = 'sidebar-item';
  div.id = `sb-${item.id}`;
  div.onclick = () => selectUploadItem(item.id);
  div.innerHTML = `
    <img src="${item.imgUrl}" class="sidebar-thumb" crossorigin="anonymous">
    <div class="sidebar-info">
      <div class="sidebar-title" id="sb-title-${item.id}">${escapeHtml(item.data.title || '名称未設定')}</div>
      <div class="sidebar-status">
        <span class="device-pill">${escapeHtml(getProfiles().find((p) => p.id === item.profileId)?.name || '自動')}</span>
        <span id="sb-status-${item.id}" class="upload-status ${item.status === 'existing' ? 'done' : item.status}">${item.status === 'existing' ? 'EXIST' : item.status}</span>
        <button class="btn-remove-side" onclick="removeBatchItem(event, '${item.id}')">
          <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
        </button>
      </div>
    </div>
  `;
  document.getElementById('batch-sidebar-list').appendChild(div);
}

function selectUploadItem(id) {
  state.activeUploadId = id;
  const item = state.uploadQueue.find((x) => x.id === id);
  if (!item) return;
  document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
  document.getElementById(`sb-${id}`)?.classList.add('active');
  document.getElementById('batch-editor-container').style.display = 'flex';
  document.getElementById('batch-empty-msg').style.display = 'none';
  document.getElementById('batch-preview-img').src = item.imgUrl;
  document.getElementById('up-title').value = item.data.title || '';
  document.getElementById('up-level').value = item.data.level || '';
  document.getElementById('up-diff').value = item.data.difficultyKey || 'expert';
  document.getElementById('up-perfect').value = item.data.perfect ?? 0;
  document.getElementById('up-great').value = item.data.great ?? 0;
  document.getElementById('up-good').value = item.data.good ?? 0;
  document.getElementById('up-bad').value = item.data.bad ?? 0;
  document.getElementById('up-miss').value = item.data.miss ?? 0;
  document.getElementById('up-combo').value = item.data.combo ?? 0;
  document.getElementById('up-total-miss').innerText = item.data.totalMiss ?? 0;
  const select = document.getElementById('up-device');
  if (select) select.value = item.profileId || state.settings.selectedProfileId;
}

function updateCurrentItem(field, value) {
  const item = state.uploadQueue.find((x) => x.id === state.activeUploadId);
  if (!item) return;
  if (['level', 'perfect', 'great', 'good', 'bad', 'miss', 'combo'].includes(field)) item.data[field] = Number(value) || 0;
  else if (field === 'difficultyKey') item.data[field] = value;
  else item.data[field] = value;
  if (['good', 'bad', 'miss'].includes(field)) item.data.totalMiss = (Number(item.data.good) || 0) + (Number(item.data.bad) || 0) + (Number(item.data.miss) || 0);
  document.getElementById('up-total-miss').innerText = item.data.totalMiss ?? 0;
  const titleEl = document.getElementById(`sb-title-${item.id}`);
  if (titleEl) titleEl.innerText = item.data.title || '名称未設定';
  const statusEl = document.getElementById(`sb-status-${item.id}`);
  if (statusEl) {
    statusEl.innerText = 'OK';
    statusEl.className = 'upload-status done';
  }
  checkBatchButton();
}

async function runBatchAnalysis(items) {
  if (!items.length) return;
  const worker = await Tesseract.createWorker(['jpn', 'eng']);
  document.getElementById('batch-status-msg').innerText = '解析中...';
  for (const item of items) {
    const el = document.getElementById(`sb-status-${item.id}`);
    if (el) { el.innerText = '解析中'; el.className = 'upload-status processing'; }
    const img = new Image();
    img.src = item.imgUrl;
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      const profile = getProfiles().find((p) => p.id === item.profileId) || getActiveProfile();
      const res = await analyzeImageWithProfile(img, worker, profile, state.dbMusics, state.dbDiffs);
      item.data = {
        title: res.title || '',
        level: res.level || '',
        difficultyKey: res.difficultyKey || 'expert',
        perfect: res.perfect || 0,
        great: res.great || 0,
        good: res.good || 0,
        bad: res.bad || 0,
        miss: res.miss || 0,
        totalMiss: res.totalMiss || 0,
        combo: res.combo || 0,
        musicId: res.musicId || null,
      };
      item.status = 'done';
      updateCurrentItem('title', item.data.title);
      if (state.activeUploadId === item.id) selectUploadItem(item.id);
      if (el) { el.innerText = 'OK'; el.className = 'upload-status done'; }
    } catch (e) {
      console.error('Analysis failed', e);
      item.status = 'error';
      if (el) { el.innerText = 'ERR'; el.className = 'upload-status error'; }
    }
  }
  await worker.terminate();
  document.getElementById('batch-status-msg').innerText = '処理完了';
  checkBatchButton();
}

function reanalyzeCurrentItem() {
  const item = state.uploadQueue.find((x) => x.id === state.activeUploadId);
  if (!item) return;
  item.status = 'pending';
  runBatchAnalysis([item]);
}

function analyzeAllInBatch() {
  const pending = state.uploadQueue.filter((x) => x.status === 'pending' || x.status === 'error' || x.status === 'existing' || x.status === 'done');
  if (!pending.length) return;
  runBatchAnalysis(pending);
}

function renderUploadProfileSelectForActive() {
  const select = document.getElementById('up-device');
  if (!select) return;
  renderProfileOptions(select, getProfiles(), state.uploadQueue.find((x) => x.id === state.activeUploadId)?.profileId || state.settings.selectedProfileId);
}

function changeUploadDevice(profileId) {
  const item = state.uploadQueue.find((x) => x.id === state.activeUploadId);
  if (!item) return;
  item.profileId = profileId;
  renderUploadProfileSelectForActive();
  showToast('機種を変更しました。再解析します', 'info');
  reanalyzeCurrentItem();
}

async function handleBatchExecution() {
  const btn = document.getElementById('btn-exec-batch');
  btn.disabled = true;
  btn.innerText = '処理中...';
  try {
    if (state.currentUploadMode === 'upload') await executeUploads();
    else await executeEdits();
  } finally {
    btn.disabled = false;
    checkBatchButton();
  }
}

function checkBatchButton() {
  const btn = document.getElementById('btn-exec-batch');
  if (!btn) return;
  btn.disabled = state.uploadQueue.length === 0;
  const label = state.currentUploadMode === 'upload' ? '全てアップロード' : '保存して反映';
  btn.innerText = state.uploadQueue.length ? `${label} (${state.uploadQueue.length}件)` : label;
}

function buildMetaFromItem(item) {
  return {
    title: item.data.title,
    level: item.data.level,
    difficultyKey: item.data.difficultyKey,
    perfect: item.data.perfect,
    great: item.data.great,
    good: item.data.good,
    bad: item.data.bad,
    miss: item.data.miss,
    totalMiss: item.data.totalMiss,
    combo: item.data.combo,
    musicId: item.data.musicId,
    deviceId: item.profileId,
    deviceName: getProfiles().find((p) => p.id === item.profileId)?.name || '',
    createdAt: nowIso(),
    bestKey: normalizeBestKey({
      title: item.data.title,
      level: item.data.level,
      difficultyKey: item.data.difficultyKey,
      musicId: item.data.musicId,
    }),
  };
}

async function executeUploads() {
  let successCount = 0;
  const token = getCurrentToken();
  for (const item of [...state.uploadQueue]) {
    const statusEl = document.getElementById(`sb-status-${item.id}`);
    if (statusEl) { statusEl.innerText = '送信中'; statusEl.className = 'upload-status processing'; }
    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const meta = buildMetaFromItem(item);
      const key = normalizeBestKey(meta);
      const beforeBest = state.currentUserBestMap.get(key);
      const uploaded = await uploadResultFile(token, getProfiles().find((p) => p.id === item.profileId) || getActiveProfile(), meta, item.file);
      item.uploadedFileId = uploaded.id;
      item.status = 'done';
      state.uploadQueue = state.uploadQueue.filter((x) => x.id !== item.id);
      document.getElementById(`sb-${item.id}`)?.remove();
      successCount++;
      const newRec = {
        id: uploaded.id,
        title: meta.title,
        level: meta.level,
        difficultyKey: meta.difficultyKey,
        perfect: meta.perfect,
        great: meta.great,
        good: meta.good,
        bad: meta.bad,
        missCount: meta.totalMiss,
        totalMiss: meta.totalMiss,
        combo: meta.combo,
        addedAt: uploaded.createdTime || meta.createdAt,
      };
      const isPB = !beforeBest || compareBest(newRec, beforeBest) < 0;
      if (isPB) {
        showToast(`自己ベスト更新: ${meta.title} ${meta.difficultyKey.toUpperCase()}`, 'success');
        state.lastBestNotifications.push(newRec.id);
        state.currentUserBestMap.set(key, newRec);
      }
    } catch (e) {
      console.error(e);
      if (statusEl) { statusEl.innerText = '失敗'; statusEl.className = 'upload-status error'; }
      showToast(`アップロード失敗: ${e.message}`, 'error');
    }
  }
  await fetchDataFromDrive();
  if (state.uploadQueue.length === 0) closeBatchModal();
  if (successCount > 0) showToast(`${successCount} 件アップロードしました`, 'success');
}

async function executeEdits() {
  let successCount = 0;
  const token = getCurrentToken();
  for (const item of [...state.uploadQueue]) {
    const statusEl = document.getElementById(`sb-status-${item.id}`);
    if (statusEl) { statusEl.innerText = '保存中'; statusEl.className = 'upload-status processing'; }
    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const meta = buildMetaFromItem(item);
      if (item.originalId) {
        await updateFileMetadata(item.originalId, meta);
      } else {
        const profile = getProfiles().find((p) => p.id === item.profileId) || getActiveProfile();
        await uploadResultFile(token, profile, meta, item.file);
      }
      successCount++;
      state.uploadQueue = state.uploadQueue.filter((x) => x.id !== item.id);
      document.getElementById(`sb-${item.id}`)?.remove();
    } catch (e) {
      console.error(e);
      if (statusEl) { statusEl.innerText = '失敗'; statusEl.className = 'upload-status error'; }
      showToast(`保存失敗: ${e.message}`, 'error');
    }
  }
  await fetchDataFromDrive();
  if (successCount > 0) showToast(`${successCount} 件保存しました`, 'success');
  if (state.uploadQueue.length === 0) closeBatchModal();
}

function renderUploadPreview() {
  const select = document.getElementById('up-device');
  renderProfileOptions(select, getProfiles(), state.uploadQueue.find((x) => x.id === state.activeUploadId)?.profileId || state.settings.selectedProfileId);
}

function batchEdit() {
  if (!state.selectedIds.size) return;
  openBatchModal('edit');
  state.uploadQueue = [];
  const targets = state.allRecords.filter((r) => state.selectedIds.has(r.id));
  document.getElementById('batch-status-msg').innerText = '編集データを準備中...';
  for (const rec of targets) {
    const qId = `edit_${rec.id}`;
    const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    const item = {
      id: qId,
      file: null,
      imgUrl: thumb,
      profileId: state.settings.selectedProfileId,
      status: 'existing',
      data: {
        title: rec.title || '',
        level: rec.level || '',
        difficultyKey: rec.difficultyKey || 'expert',
        perfect: rec.perfect ?? 0,
        great: rec.great ?? 0,
        good: rec.good ?? 0,
        bad: rec.bad ?? 0,
        miss: rec.missCount ?? rec.totalMiss ?? 0,
        totalMiss: rec.totalMiss ?? rec.missCount ?? 0,
        combo: rec.combo ?? 0,
        musicId: rec.musicId || null,
      },
      originalId: rec.id,
    };
    state.uploadQueue.push(item);
    renderSidebarItem(item);
  }
  if (state.uploadQueue.length) selectUploadItem(state.uploadQueue[0].id);
  checkBatchButton();
  document.getElementById('batch-status-msg').innerText = '編集準備完了';
}

function individualEdit(id) {
  state.selectedIds.clear();
  state.selectedIds.add(id);
  batchEdit();
}

async function individualDelete(id) {
  if (!confirm('このリザルトを削除しますか？')) return;
  document.getElementById('loader').style.display = 'flex';
  try {
    await deleteDriveFile(id);
    showToast('削除しました', 'success');
    await fetchDataFromDrive();
  } catch (e) {
    console.error(e);
    showToast(`削除エラー: ${e.message}`, 'error');
    await fetchDataFromDrive();
  }
}

async function batchDelete() {
  if (!state.selectedIds.size) return;
  if (!confirm(`選択した ${state.selectedIds.size} 件を削除しますか？`)) return;
  document.getElementById('loader').style.display = 'flex';
  try {
    for (const id of state.selectedIds) {
      await deleteDriveFile(id);
    }
    showToast('削除しました', 'success');
    state.selectedIds.clear();
    updateSelectedCount();
    await fetchDataFromDrive();
  } catch (e) {
    console.error(e);
    showToast(`削除エラー: ${e.message}`, 'error');
    await fetchDataFromDrive();
  }
}

function removeBatchItem(ev, id) {
  ev.stopPropagation();
  const item = state.uploadQueue.find((x) => x.id === id);
  if (item?.imgUrl && item.imgUrl.startsWith('blob:')) URL.revokeObjectURL(item.imgUrl);
  state.uploadQueue = state.uploadQueue.filter((x) => x.id !== id);
  document.getElementById(`sb-${id}`)?.remove();
  if (state.activeUploadId === id) {
    state.activeUploadId = null;
    document.getElementById('batch-editor-container').style.display = 'none';
    document.getElementById('batch-empty-msg').style.display = 'block';
  }
  checkBatchButton();
}

function openSettingsFromButton() {
  openSettingsModal();
}

function updateSortKey(key) {
  state.settings.sortKey = key;
  saveSettings();
  updateView();
}

function toggleSortDirection() {
  state.settings.sortDirection = state.settings.sortDirection === 'asc' ? 'desc' : 'asc';
  saveSettings();
  syncTopControls();
  updateView();
}

function setShowBestOnly(flag) {
  state.settings.showBestOnly = !!flag;
  saveSettings();
  updateView();
}

function renderView() {
  syncTopControls();
  updateView();
}

function initControls() {
  document.getElementById('sort-order').addEventListener('change', (e) => updateSortKey(e.target.value));
  document.getElementById('sort-direction').addEventListener('click', toggleSortDirection);
  document.getElementById('filter-best-only').addEventListener('change', (e) => setShowBestOnly(e.target.checked));
  document.getElementById('filter-fc').addEventListener('change', updateView);
  document.getElementById('filter-diff').addEventListener('change', updateView);
  document.getElementById('filter-title').addEventListener('input', updateView);
  document.getElementById('filter-level').addEventListener('input', updateView);
  document.getElementById('filter-miss-min').addEventListener('input', updateView);
  document.getElementById('filter-miss-max').addEventListener('input', updateView);
  document.getElementById('settings_button').addEventListener('click', openSettingsFromButton);
  document.getElementById('authorize_button').addEventListener('click', handleAuthClick);
  document.getElementById('signout_button').addEventListener('click', handleSignoutClick);
  document.getElementById('upload_button').addEventListener('click', () => openBatchModal('upload'));
  document.getElementById('btn-select-mode').addEventListener('click', toggleSelectMode);
  document.getElementById('btn-settings-close').addEventListener('click', closeSettingsModal);
  document.getElementById('btn-settings-save-close').addEventListener('click', () => { saveCurrentProfileEdits(); closeSettingsModal(); });
  document.getElementById('btn-close-batch').addEventListener('click', closeBatchModal);
  document.getElementById('btn-exec-batch').addEventListener('click', handleBatchExecution);
  document.getElementById('btn-upload-files').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    await handleFiles(files);
  });
  document.getElementById('drop-zone').addEventListener('dragover', (e) => { e.preventDefault(); });
  document.getElementById('drop-zone').addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
    await handleFiles(files);
  });
  document.getElementById('up-device').addEventListener('change', (e) => changeUploadDevice(e.target.value));
  document.getElementById('up-title').addEventListener('input', (e) => updateCurrentItem('title', e.target.value));
  document.getElementById('up-level').addEventListener('input', (e) => updateCurrentItem('level', e.target.value));
  document.getElementById('up-diff').addEventListener('change', (e) => updateCurrentItem('difficultyKey', e.target.value));
  document.getElementById('up-perfect').addEventListener('input', (e) => updateCurrentItem('perfect', e.target.value));
  document.getElementById('up-great').addEventListener('input', (e) => updateCurrentItem('great', e.target.value));
  document.getElementById('up-good').addEventListener('input', (e) => updateCurrentItem('good', e.target.value));
  document.getElementById('up-bad').addEventListener('input', (e) => updateCurrentItem('bad', e.target.value));
  document.getElementById('up-miss').addEventListener('input', (e) => updateCurrentItem('miss', e.target.value));
  document.getElementById('up-combo').addEventListener('input', (e) => updateCurrentItem('combo', e.target.value));
  document.getElementById('btn-reanalyze').addEventListener('click', reanalyzeCurrentItem);
  document.getElementById('btn-clear-selection').addEventListener('click', clearSelection);
  document.getElementById('btn-batch-delete').addEventListener('click', batchDelete);
  document.getElementById('btn-batch-edit').addEventListener('click', batchEdit);

  document.getElementById('settings-form').querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      const profile = getSelectedSettingsProfile();
      if (!profile) return;
      profile.regions[state.activeRegion] = {
        ...profile.regions[state.activeRegion],
        ...readRegionValues(document.getElementById('settings-form')),
      };
      updateCropOverlay(profile);
    });
  });
}

function initWindowExports() {
  window.gapiLoaded = gapiLoaded;
  window.gisLoaded = gisLoaded;
  window.handleAuthClick = handleAuthClick;
  window.handleSignoutClick = handleSignoutClick;
  window.openBatchModal = openBatchModal;
  window.closeBatchModal = closeBatchModal;
  window.handleBatchExecution = handleBatchExecution;
  window.toggleSelectMode = toggleSelectMode;
  window.clearSelection = clearSelection;
  window.batchDelete = batchDelete;
  window.batchEdit = batchEdit;
  window.individualEdit = individualEdit;
  window.individualDelete = individualDelete;
  window.removeBatchItem = removeBatchItem;
  window.openImageModal = openImageModal;
  window.closeImageModal = closeImageModal;
  window.reanalyzeCurrentItem = reanalyzeCurrentItem;
  window.analyzeAllInBatch = analyzeAllInBatch;
  window.updateCurrentItem = updateCurrentItem;
  window.toggleSelection = toggleSelection;
  window.showSettings = openSettingsModal;
}

function loadSettingsToUI() {
  syncTopControls();
  renderProfileOptions(document.getElementById('up-device'), getProfiles(), state.settings.selectedProfileId);
  updateBestToggleLabel();
}

async function init() {
  ensureToasts();
  initWindowExports();
  initControls();
  attachSettingsEvents();
  loadSettingsToUI();
  await loadDb();
  setAuthUI(false);
  document.getElementById('loader').style.display = 'none';
  updateView();
}

window.addEventListener('DOMContentLoaded', init);

function openBatchModalWrapper(mode) {
  openBatchModal(mode);
}

function closeBatchModalWrapper() {
  closeBatchModal();
}

export { openBatchModal };
