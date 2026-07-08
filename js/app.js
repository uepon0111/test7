import { appState, getActiveProfile, getProfileById, setActiveProfile, saveSettings, bestRecordsMap, bestKey, compareRecordScore, selectBestProfileForImage } from './state.js';
import { updateView, setLoadingState, showToast, toggleSelectMode, toggleSelection, clearSelection, openImageModal, closeImageModal, refreshSelectionUI, applySettingsToSortUI, toggleBestOnly, toggleSortDirection, setSortKey } from './render.js';
import { fetchDataFromDrive, uploadRecordItem, updateRecordItem, deleteDriveFile, ensureRootFolder } from './drive.js';
import { analyzeLoadedImage, analyzeWithProfile, autoProfileForSize } from './ocr.js';
import { openSettingsModal, closeSettingsModal, renderSettingsModal, wireSettingsEvents, syncSettingsInputs, selectSettingsRegion, onSampleImageSelected, saveSettingsFromModal, addProfileFromCurrent, duplicateCurrentProfile, deleteCurrentProfile } from './settings.js';
import { debounce, makeId } from './utils.js';

let pendingAuthRefresh = null;

function setAuthUI(signedIn) {
  const authorizeBtn = document.getElementById('authorize_button');
  const signoutBtn = document.getElementById('signout_button');
  const uploadBtn = document.getElementById('upload_button');
  const authStatus = document.getElementById('auth-status');

  if (signedIn) {
    if (authorizeBtn) authorizeBtn.style.display = 'none';
    if (signoutBtn) signoutBtn.style.display = 'inline-flex';
    if (uploadBtn) uploadBtn.style.display = 'inline-flex';
    if (authStatus) authStatus.textContent = 'ログイン済み';
  } else {
    if (authorizeBtn) authorizeBtn.style.display = 'inline-flex';
    if (signoutBtn) signoutBtn.style.display = 'none';
    if (uploadBtn) uploadBtn.style.display = 'none';
    if (authStatus) authStatus.textContent = '未ログイン';
  }
}

async function loadDb() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json')
    ]);
    appState.dbMusics = await musicsResp.json();
    appState.dbDiffs = await diffsResp.json();
  } catch (e) {
    console.error('DB Error', e);
    showToast('楽曲DBの読み込みに失敗しました', 'error');
  }
}

async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: [DISCOVERY_DOC]
  });
  appState.gapiReady = true;
  maybeInitAuth();
}

function initializeGIS() {
  appState.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: ''
  });
  appState.gisReady = true;
  maybeInitAuth();
}

function maybeInitAuth() {
  if (appState.gapiReady && appState.gisReady) {
    setAuthUI(false);
  }
}

function handleAuthClick() {
  if (!appState.tokenClient) return;
  appState.tokenClient.callback = async (resp) => {
    if (resp.error) {
      console.error(resp.error);
      showToast('Googleログインに失敗しました', 'error');
      return;
    }
    setAuthUI(true);
    await fetchDataFromDrive();
    renderSettingsModal();
    applySettingsToSortUI();
    updateView();
  };
  appState.tokenClient.requestAccessToken({ prompt: '' });
}

function handleSignoutClick() {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token, () => {
      gapi.client.setToken('');
      setAuthUI(false);
      appState.allRecords = [];
      appState.filteredRecords = [];
      document.getElementById('grid').innerHTML = '';
      document.getElementById('result-count').textContent = 'ログインしてください';
    });
  }
}

function wireSortControls() {
  const sortKey = document.getElementById('sort-key');
  if (sortKey) {
    sortKey.value = appState.settings.sortKey || 'level';
    sortKey.addEventListener('change', e => {
      appState.settings.sortKey = e.target.value;
      saveSettings();
      updateView();
    });
  }

  const sortDir = document.getElementById('sort-direction-button');
  if (sortDir) {
    sortDir.textContent = appState.settings.sortDirection === 'asc' ? '昇順' : '降順';
    sortDir.addEventListener('click', () => {
      appState.settings.sortDirection = appState.settings.sortDirection === 'asc' ? 'desc' : 'asc';
      saveSettings();
      sortDir.textContent = appState.settings.sortDirection === 'asc' ? '昇順' : '降順';
      updateView();
    });
  }

  const bestOnly = document.getElementById('best-only-button');
  if (bestOnly) {
    bestOnly.textContent = appState.settings.onlyBest ? 'ON' : 'OFF';
    bestOnly.classList.toggle('active', !!appState.settings.onlyBest);
    bestOnly.addEventListener('click', () => {
      appState.settings.onlyBest = !appState.settings.onlyBest;
      saveSettings();
      bestOnly.textContent = appState.settings.onlyBest ? 'ON' : 'OFF';
      bestOnly.classList.toggle('active', !!appState.settings.onlyBest);
      updateView();
    });
  }
}

function onRecordsUpdated() {
  applySettingsToSortUI();
  updateView();
}

function syncEditorProfileNames() {
  const selects = [document.getElementById('up-profile'), document.getElementById('settings-profile-select')].filter(Boolean);
  for (const select of selects) {
    const current = select.value;
    select.innerHTML = appState.settings.profiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (current && appState.settings.profiles.some(p => p.id === current)) select.value = current;
    else select.value = appState.settings.activeProfileId;
  }
}

function openBatchModal(mode) {
  appState.editor.mode = mode;
  appState.editor.queue = [];
  appState.editor.activeId = null;
  const modal = document.getElementById('batchModal');
  const title = document.getElementById('batch-modal-title');
  const uploadInitial = document.getElementById('upload-initial');
  const workspace = document.getElementById('batch-workspace');
  const status = document.getElementById('batch-status-msg');
  const execBtn = document.getElementById('btn-exec-batch');
  const list = document.getElementById('batch-sidebar-list');
  const empty = document.getElementById('batch-empty-msg');
  const container = document.getElementById('batch-editor-container');

  if (modal) modal.style.display = 'flex';
  if (list) list.innerHTML = '';
  if (empty) empty.style.display = 'block';
  if (container) container.style.display = 'none';
  if (status) status.textContent = '待機中...';
  if (execBtn) execBtn.disabled = true;
  if (mode === 'upload') {
    if (title) title.innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
    if (uploadInitial) uploadInitial.style.display = 'flex';
    if (workspace) workspace.style.display = 'none';
    if (execBtn) execBtn.textContent = '全てアップロード';
    const file = document.getElementById('up-file');
    if (file) file.value = '';
  } else {
    if (title) title.innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
    if (uploadInitial) uploadInitial.style.display = 'none';
    if (workspace) workspace.style.display = 'flex';
    if (execBtn) execBtn.textContent = '保存して反映';
  }
  syncEditorProfileNames();
}

function closeBatchModal() {
  const modal = document.getElementById('batchModal');
  if (modal) modal.style.display = 'none';
}

function renderSidebarItem(id) {
  const item = appState.editor.queue.find(q => q.id === id);
  if (!item) return;
  const div = document.createElement('div');
  div.className = 'sidebar-item';
  div.id = `sb-${id}`;
  div.onclick = () => selectItem(id);
  div.innerHTML = `
    <img src="${item.imgUrl}" class="sidebar-thumb" crossorigin="anonymous">
    <div class="sidebar-info">
      <div class="sidebar-title" id="sb-title-${id}">${item.data.title || '名称未設定'}</div>
      <div class="sidebar-status">
        <span id="sb-status-${id}" class="upload-status ${item.status === 'existing' ? 'done' : item.status}">${item.status === 'existing' ? 'EXIST' : item.status}</span>
        <button class="btn-remove-side" onclick="removeBatchItem(event, '${id}')">
          <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
        </button>
      </div>
    </div>
  `;
  const list = document.getElementById('batch-sidebar-list');
  if (list) list.appendChild(div);
}

function selectItem(id) {
  appState.editor.activeId = id;
  const item = appState.editor.queue.find(q => q.id === id);
  if (!item) return;

  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const sbEl = document.getElementById(`sb-${id}`);
  if (sbEl) sbEl.classList.add('active');

  const container = document.getElementById('batch-editor-container');
  const empty = document.getElementById('batch-empty-msg');
  if (container) container.style.display = 'flex';
  if (empty) empty.style.display = 'none';

  const imgEl = document.getElementById('batch-preview-img');
  if (imgEl) imgEl.src = item.imgUrl;

  document.getElementById('up-title').value = item.data.title || '';
  document.getElementById('up-level').value = item.data.level || '';
  document.getElementById('up-diff').value = item.data.diff || item.data.difficultyRaw || 'M';
  document.getElementById('up-profile').value = item.profileId || appState.settings.activeProfileId;
  document.getElementById('up-perfect').value = item.data.perfectCount ?? 0;
  document.getElementById('up-great').value = item.data.greatCount ?? 0;
  document.getElementById('up-good').value = item.data.goodCount ?? 0;
  document.getElementById('up-bad').value = item.data.badCount ?? 0;
  document.getElementById('up-miss-detail').value = item.data.missDetailCount ?? 0;
  document.getElementById('up-combo').value = item.data.comboCount ?? 0;
  document.getElementById('up-total-miss').textContent = String(item.data.totalMiss ?? 0);
}

function updateCurrentItem(field, value) {
  if (!appState.editor.activeId) return;
  const item = appState.editor.queue.find(q => q.id === appState.editor.activeId);
  if (!item) return;

  if (field === 'profileId') {
    item.profileId = value;
    item.profile = getProfileById(value);
    const prof = item.profile || getActiveProfile();
    if (window.showToastMessage) window.showToastMessage(`機種を ${prof?.name || value} に変更しました`, 'info');
  } else if (['level', 'perfectCount', 'greatCount', 'goodCount', 'badCount', 'missDetailCount', 'comboCount'].includes(field)) {
    item.data[field] = parseInt(value || '0', 10) || 0;
  } else if (field === 'title') {
    item.data[field] = value;
  } else if (field === 'diff') {
    item.data.diff = value;
    item.data.difficultyRaw = value;
    item.data.difficulty = value;
  }

  item.data.totalMiss = (parseInt(item.data.goodCount || 0, 10) || 0) + (parseInt(item.data.badCount || 0, 10) || 0) + (parseInt(item.data.missDetailCount || 0, 10) || 0);
  const total = document.getElementById('up-total-miss');
  if (total) total.textContent = String(item.data.totalMiss);
  const titleEl = document.getElementById(`sb-title-${item.id}`);
  if (titleEl) titleEl.textContent = item.data.title || '名称未設定';
  checkBatchButton();
}

function removeBatchItem(event, id) {
  event.stopPropagation();
  appState.editor.queue = appState.editor.queue.filter(q => q.id !== id);
  const el = document.getElementById(`sb-${id}`);
  if (el) el.remove();
  if (appState.editor.activeId === id) {
    appState.editor.activeId = null;
    const container = document.getElementById('batch-editor-container');
    const empty = document.getElementById('batch-empty-msg');
    if (container) container.style.display = 'none';
    if (empty) empty.style.display = 'block';
  }
  checkBatchButton();
}

function checkBatchButton() {
  const btn = document.getElementById('btn-exec-batch');
  if (btn) btn.disabled = appState.editor.queue.length === 0;
  const status = document.getElementById('batch-status-msg');
  if (status) status.textContent = appState.editor.queue.length ? `${appState.editor.queue.length}件待機中` : '待機中...';
}

async function getImageSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

async function handleFiles(files) {
  if (!files || files.length === 0) return;
  document.getElementById('upload-initial').style.display = 'none';
  document.getElementById('batch-workspace').style.display = 'flex';
  const status = document.getElementById('batch-status-msg');
  if (status) status.textContent = '画像を処理中...';

  const items = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const imgUrl = URL.createObjectURL(file);
    let profile = getActiveProfile();
    try {
      const size = await getImageSize(imgUrl);
      profile = selectBestProfileForImage(size.width, size.height) || profile;
    } catch {}
    const id = `new_${Date.now()}_${i}`;
    const item = {
      id,
      file,
      imgUrl,
      status: 'pending',
      profileId: profile?.id || appState.settings.activeProfileId,
      profile,
      data: {
        title: '',
        level: '',
        diff: 'M',
        difficultyRaw: 'M',
        difficulty: 'MASTER',
        perfectCount: 0,
        greatCount: 0,
        goodCount: 0,
        badCount: 0,
        missDetailCount: 0,
        totalMiss: 0,
        comboCount: 0,
        musicId: null
      },
      originalId: null,
      originalParent: null
    };
    appState.editor.queue.push(item);
    renderSidebarItem(id);
    items.push(item);
  }

  syncEditorProfileNames();
  if (items.length > 0) {
    const analyzed = await runBatchAnalysis(items.filter(it => it.status === 'pending'));
    if (!appState.editor.activeId && appState.editor.queue.length > 0) selectItem(appState.editor.queue[0].id);
  }
  checkBatchButton();
}

async function batchEdit() {
  if (appState.selectedIds.size === 0) return;
  openBatchModal('edit');
  const selected = appState.allRecords.filter(r => appState.selectedIds.has(r.id));
  const status = document.getElementById('batch-status-msg');
  if (status) status.textContent = '編集データを準備中...';

  for (const rec of selected) {
    const qId = `edit_${rec.id}`;
    const highResUrl = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    appState.editor.queue.push({
      id: qId,
      file: null,
      imgUrl: highResUrl,
      status: 'existing',
      profileId: rec.profileId || appState.settings.activeProfileId,
      profile: getProfileById(rec.profileId) || getActiveProfile(),
      data: {
        title: rec.title,
        level: rec.level,
        diff: rec.difficultyRaw,
        difficultyRaw: rec.difficultyRaw,
        difficulty: rec.difficulty,
        perfectCount: rec.perfectCount || 0,
        greatCount: rec.greatCount || 0,
        goodCount: rec.goodCount || 0,
        badCount: rec.badCount || 0,
        missDetailCount: rec.missDetailCount || 0,
        totalMiss: rec.totalMiss || rec.missCount || 0,
        comboCount: rec.comboCount || 0,
        musicId: null
      },
      originalId: rec.id,
      originalParent: rec.parentId
    });
    renderSidebarItem(qId);
  }
  if (appState.editor.queue.length > 0) selectItem(appState.editor.queue[0].id);
  if (status) status.textContent = '編集準備完了';
  checkBatchButton();
}

async function runBatchAnalysis(targets) {
  if (!targets || targets.length === 0) return [];
  const status = document.getElementById('batch-status-msg');
  const out = [];
  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    if (status) status.textContent = `解析中... (${i + 1}/${targets.length})`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = item.imgUrl;
    await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    const profile = item.profile || getProfileById(item.profileId) || getActiveProfile();
    const result = await analyzeLoadedImage(img, profile);
    if (result) {
      Object.assign(item.data, result);
      item.profileId = profile?.id || item.profileId;
      item.profile = profile;
      item.status = 'done';
      const statusEl = document.getElementById(`sb-status-${item.id}`);
      if (statusEl) {
        statusEl.textContent = item.status === 'existing' ? 'EXIST' : 'done';
        statusEl.className = `upload-status ${item.status === 'existing' ? 'done' : 'done'}`;
      }
      const titleEl = document.getElementById(`sb-title-${item.id}`);
      if (titleEl) titleEl.textContent = item.data.title || '名称未設定';
      if (appState.editor.activeId === item.id) selectItem(item.id);
    } else {
      item.status = 'error';
      const statusEl = document.getElementById(`sb-status-${item.id}`);
      if (statusEl) {
        statusEl.textContent = 'error';
        statusEl.className = 'upload-status error';
      }
    }
    out.push(item);
  }
  if (status) status.textContent = '解析完了';
  return out;
}

async function reanalyzeCurrentItem() {
  const item = appState.editor.queue.find(q => q.id === appState.editor.activeId);
  if (!item) return;
  item.status = 'pending';
  const statusEl = document.getElementById(`sb-status-${item.id}`);
  if (statusEl) { statusEl.textContent = '解析中'; statusEl.className = 'upload-status processing'; }
  await runBatchAnalysis([item]);
  checkBatchButton();
}

async function analyzeAllInBatch() {
  if (appState.editor.queue.length === 0) return;
  await runBatchAnalysis(appState.editor.queue);
  checkBatchButton();
}

async function executeUploads(previousBest) {
  let successCount = 0;
  for (const item of [...appState.editor.queue]) {
    const sbStatus = document.getElementById(`sb-status-${item.id}`);
    if (sbStatus) { sbStatus.textContent = '送信中'; sbStatus.className = 'upload-status processing'; }
    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const result = await uploadRecordItem(item);
      const best = previousBest.get(bestKey(item.data));
      if (!best || compareRecordScore(item.data, best) < 0) {
        showToast(`自己ベスト更新: ${item.data.title}`, 'success');
      }
      appState.editor.queue = appState.editor.queue.filter(q => q.id !== item.id);
      const row = document.getElementById(`sb-${item.id}`);
      if (row) row.remove();
      successCount++;
    } catch (e) {
      console.error(e);
      if (sbStatus) { sbStatus.textContent = '失敗'; sbStatus.className = 'upload-status error'; }
    }
  }
  return successCount;
}

async function executeEdits(previousBest) {
  let successCount = 0;
  for (const item of [...appState.editor.queue]) {
    const sbStatus = document.getElementById(`sb-status-${item.id}`);
    if (sbStatus) { sbStatus.textContent = '保存中'; sbStatus.className = 'upload-status processing'; }
    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const result = await updateRecordItem(item);
      const best = previousBest.get(bestKey(item.data));
      if (!best || compareRecordScore(item.data, best) < 0) {
        showToast(`自己ベスト更新: ${item.data.title}`, 'success');
      }
      appState.editor.queue = appState.editor.queue.filter(q => q.id !== item.id);
      const row = document.getElementById(`sb-${item.id}`);
      if (row) row.remove();
      successCount++;
    } catch (e) {
      console.error(e);
      if (sbStatus) { sbStatus.textContent = '失敗'; sbStatus.className = 'upload-status error'; }
    }
  }
  return successCount;
}

async function finishExecution(count, actionName) {
  if (appState.editor.queue.length === 0) {
    showToast(`${actionName}完了 (${count}件)`, 'success');
    closeBatchModal();
    appState.selectedIds.clear();
    refreshSelectionUI();
    await fetchDataFromDrive();
  } else {
    showToast(`${count}件 ${actionName}成功。エラー分を確認してください。`, 'error');
    checkBatchButton();
  }
}

async function handleBatchExecution() {
  const btn = document.getElementById('btn-exec-batch');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '処理中...';
  }
  const previousBest = bestRecordsMap(appState.allRecords);
  let count = 0;
  if (appState.editor.mode === 'upload') count = await executeUploads(previousBest);
  else count = await executeEdits(previousBest);
  await finishExecution(count, appState.editor.mode === 'upload' ? 'アップロード' : '更新');
  if (btn) {
    btn.disabled = appState.editor.queue.length === 0;
    btn.textContent = appState.editor.mode === 'upload' ? '全てアップロード' : '保存して反映';
  }
}

async function individualEdit(id) {
  appState.selectedIds.clear();
  appState.selectedIds.add(id);
  await batchEdit();
}

async function individualDelete(id) {
  if (!confirm('このリザルトを削除しますか？')) return;
  setLoadingState(true, '削除中...', 0);
  try {
    await deleteDriveFile(id);
    showToast('削除しました', 'success');
    await fetchDataFromDrive();
  } catch (e) {
    console.error(e);
    showToast(`エラー: ${e.message}`, 'error');
  } finally {
    setLoadingState(false);
  }
}

async function batchDelete() {
  if (!confirm(`選択した ${appState.selectedIds.size} 件を削除しますか？`)) return;
  setLoadingState(true, '削除中...', 0);
  try {
    for (const id of appState.selectedIds) await deleteDriveFile(id);
    showToast('削除しました', 'success');
    appState.selectedIds.clear();
    refreshSelectionUI();
    await fetchDataFromDrive();
  } catch (e) {
    console.error(e);
    showToast(`削除エラー: ${e.message}`, 'error');
  } finally {
    setLoadingState(false);
  }
}

async function boot() {
  await loadDb();
  wireSettingsEvents();
  wireSortControls();
  setAuthUI(false);
  applySettingsToSortUI();
  syncEditorProfileNames();

  const fileInput = document.getElementById('up-file');
  const dropZone = document.getElementById('drop-zone');
  if (fileInput) fileInput.addEventListener('change', e => handleFiles(e.target.files));
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', e => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    });
  }

  document.getElementById('filter-fc')?.addEventListener('change', updateView);
  document.getElementById('filter-diff')?.addEventListener('change', updateView);
  document.getElementById('filter-title')?.addEventListener('input', debounce(updateView, 120));
  document.getElementById('filter-level')?.addEventListener('input', debounce(updateView, 120));
  document.getElementById('filter-miss-min')?.addEventListener('input', debounce(updateView, 120));
  document.getElementById('filter-miss-max')?.addEventListener('input', debounce(updateView, 120));
  window.addEventListener('resize', () => {
    const preview = document.getElementById('settings-preview-img');
    if (preview && document.getElementById('settingsModal')?.style.display === 'flex') {
      renderSettingsModal();
    }
  });

  window.onRecordsUpdated = onRecordsUpdated;
  window.setLoadingState = setLoadingState;
  window.saveAppSettings = saveSettings;
  window.showToastMessage = showToast;
  window.syncEditorProfileNames = syncEditorProfileNames;

  if (window.gapi && window.google) {
    // handled by script callbacks
  }
}

document.addEventListener('DOMContentLoaded', boot);

const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive';

window.__gapiLoadedHandler = async function() {
  gapi.load('client', initializeGapiClient);
};
window.__gisLoadedHandler = function() {
  initializeGIS();
};
if (window.__gapiLoadedPending && window.__gapiLoadedHandler) window.__gapiLoadedHandler();
if (window.__gisLoadedPending && window.__gisLoadedHandler) window.__gisLoadedHandler();

window.handleAuthClick = handleAuthClick;
window.handleSignoutClick = handleSignoutClick;
window.updateView = updateView;
window.toggleSelectMode = toggleSelectMode;
window.toggleSelection = toggleSelection;
window.clearSelection = clearSelection;
window.openBatchModal = openBatchModal;
window.closeBatchModal = closeBatchModal;
window.handleBatchExecution = handleBatchExecution;
window.renderSidebarItem = renderSidebarItem;
window.selectItem = selectItem;
window.updateCurrentItem = updateCurrentItem;
window.removeBatchItem = removeBatchItem;
window.batchEdit = batchEdit;
window.analyzeAllInBatch = analyzeAllInBatch;
window.reanalyzeCurrentItem = reanalyzeCurrentItem;
window.individualEdit = individualEdit;
window.individualDelete = individualDelete;
window.batchDelete = batchDelete;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.toggleBestOnly = toggleBestOnly;
window.toggleSortDirection = toggleSortDirection;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.selectSettingsRegion = selectSettingsRegion;
window.saveSettingsFromModal = saveSettingsFromModal;
window.addProfileFromCurrent = addProfileFromCurrent;
window.duplicateCurrentProfile = duplicateCurrentProfile;
window.deleteCurrentProfile = deleteCurrentProfile;
window.updateSelectionUI = refreshSelectionUI;
