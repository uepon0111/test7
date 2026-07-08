
import { ROOT_FOLDER_NAME, DIFF_FROM_SHORT, DIFF_SHORT, DIFF_ORDER, DIFFICULTIES, state, slugify, safeDecodeURIComponent, formatShortDate, formatDateTime } from './state.js';
import { getCurrentPreset, getPresetById, matchPresetForImage, setCurrentPresetId, saveSettings } from './settings.js';
import { showToast, setLoaderVisible, setProgress } from './ui.js';

export const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
export const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZA';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive';

function currentToken() {
  return window.gapi?.client?.getToken?.() || null;
}

export function isLoggedIn() {
  return !!currentToken();
}

export function gapiLoaded() {
  window.gapi.load('client', initializeGapiClient);
}

export async function initializeGapiClient() {
  await window.gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: [DISCOVERY_DOC],
  });
  state.gapiInited = true;
}

export function gisLoaded() {
  state.tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: '',
  });
  state.gisInited = true;
}

export function handleAuthClick() {
  state.tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) throw resp;
    setAuthUI(true);
    await fetchDataFromDrive();
  };
  if (window.gapi.client.getToken() === null) state.tokenClient.requestAccessToken({ prompt: 'consent' });
  else state.tokenClient.requestAccessToken({ prompt: '' });
}

export function handleSignoutClick() {
  const token = window.gapi.client.getToken();
  if (token !== null) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken('');
    setAuthUI(false);
    state.allRecords = [];
    state.filteredRecords = [];
    state.selectedIds.clear();
    window.renderGrid([]);
    window.updateSelectionUI();
    const count = document.getElementById('result-count');
    if (count) count.innerText = 'ログアウトしました';
  }
}

export function setAuthUI(isLoggedIn) {
  const signout = document.getElementById('signout_button');
  const upload = document.getElementById('upload_button');
  const settings = document.getElementById('settings_button');
  const login = document.getElementById('authorize_button');
  const status = document.getElementById('auth-status');
  if (signout) signout.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (upload) upload.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (settings) settings.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (login) login.style.display = isLoggedIn ? 'none' : 'inline-flex';
  if (status) status.innerText = isLoggedIn ? 'ログイン済み' : '未ログイン';
}

export async function fetchAllDriveItems(query, fields) {
  let items = [];
  let pageToken = null;
  do {
    const response = await window.gapi.client.drive.files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken,
      supportsAllDrives: false,
    });
    if (response.result.files) items = items.concat(response.result.files);
    pageToken = response.result.nextPageToken;
  } while (pageToken);
  return items;
}

export async function getFolderByName(name, parentId = null) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${String(name).replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const response = await window.gapi.client.drive.files.list({
    q: query,
    fields: 'files(id, name, createdTime, modifiedTime)',
    pageSize: 10,
  });
  return (response.result.files && response.result.files.length > 0) ? response.result.files[0] : null;
}

export async function findOrCreateFolder(name, parentId = null) {
  const existing = await getFolderByName(name, parentId);
  if (existing) return existing;
  const resource = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) resource.parents = [parentId];
  const response = await window.gapi.client.drive.files.create({ resource, fields: 'id, name' });
  return response.result;
}

function legacyParseFolderTitle(folderName) {
  if (!folderName) return null;
  const match = String(folderName).match(/^(\d+)([A-Z]{1,8})\s+(.+)$/);
  if (!match) return null;
  const raw = match[2].toUpperCase();
  const map = {
    A: 'APPEND',
    M: 'MASTER',
    E: 'EXPERT',
    H: 'HARD',
    N: 'NORMAL',
    EASY: 'EASY',
    NORMAL: 'NORMAL',
    HARD: 'HARD',
    EXPERT: 'EXPERT',
    MASTER: 'MASTER',
    APPEND: 'APPEND',
  };
  const difficultyRaw = map[raw] || map[raw.replace(/\W/g, '')] || 'EXPERT';
  return { level: parseInt(match[1], 10) || 0, difficultyRaw, title: match[3] };
}

function parseLegacyMissCount(fileName) {
  if (!fileName) return null;
  if (/^FC$/i.test(fileName.trim())) return 0;
  const m = String(fileName).match(/^FC-(\d+)$/i);
  if (m) return parseInt(m[1], 10) || 0;
  return null;
}



function parseNewRecordName(fileName) {
  if (!fileName) return null;
  const base = String(fileName).replace(/\.[^.]+$/, '');
  const parts = base.split('__');
  if (parts.length < 4) return null;

  let offset = 0;
  if (/^\d{8}T\d{6}Z?$/.test(parts[0])) offset = 1;
  if (parts.length < offset + 4) return null;

  const title = safeDecodeURIComponent(parts[offset]);
  const difficultyRaw = String(parts[offset + 1] || '').toUpperCase();
  const level = parseInt(String(parts[offset + 2] || '').replace(/^L/i, ''), 10) || 0;
  const counts = String(parts[offset + 3] || '');
  const m = counts.match(/P(\d+)_G(\d+)_D(\d+)_B(\d+)_M(\d+)_C(\d+)_T(\d+)/i);
  if (!m) {
    return {
      title, difficultyRaw, level,
      perfect: 0, great: 0, good: 0, bad: 0, miss: 0, combo: 0, totalMiss: 0,
    };
  }
  const perfect = parseInt(m[1], 10) || 0;
  const great = parseInt(m[2], 10) || 0;
  const good = parseInt(m[3], 10) || 0;
  const bad = parseInt(m[4], 10) || 0;
  const miss = parseInt(m[5], 10) || 0;
  const combo = parseInt(m[6], 10) || 0;
  const totalMiss = parseInt(m[7], 10) || 0;
  return { title, difficultyRaw, level, perfect, great, good, bad, miss, combo, totalMiss };
}

export function buildNewFileName(record) {
  const stamp = new Date(record.createdTime || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 15);
  const title = encodeURIComponent(record.title || 'unknown');
  const difficultyRaw = record.difficultyRaw || 'EXPERT';
  const level = Number(record.level || 0);
  const perfect = Number(record.perfect || 0);
  const great = Number(record.great || 0);
  const good = Number(record.good || 0);
  const bad = Number(record.bad || 0);
  const miss = Number(record.miss || 0);
  const combo = Number(record.combo || 0);
  const totalMiss = Number(record.totalMiss ?? (good + bad + miss));
  return `${stamp}__${title}__${difficultyRaw}__L${level}__P${perfect}_G${great}_D${good}_B${bad}_M${miss}_C${combo}_T${totalMiss}.png`;
}

export function getRecordKey(record) {
  return `${String(record.title || '').toLowerCase()}|${record.difficultyRaw || ''}`;
}

function normalizeDriveRecord(base, extra = {}) {
  const record = {
    id: base.id,
    fileId: base.id,
    parentId: base.parentId || '',
    deviceId: base.deviceId || '',
    deviceName: base.deviceName || '',
    title: base.title || '',
    level: Number(base.level || 0),
    difficultyRaw: base.difficultyRaw || 'EXPERT',
    perfect: Number(base.perfect || 0),
    great: Number(base.great || 0),
    good: Number(base.good || 0),
    bad: Number(base.bad || 0),
    miss: Number(base.miss || 0),
    combo: Number(base.combo || 0),
    totalMiss: Number(base.totalMiss ?? ((base.good || 0) + (base.bad || 0) + (base.miss || 0))),
    thumbnail: base.thumbnail || null,
    createdTime: base.createdTime || base.modifiedTime || '',
    modifiedTime: base.modifiedTime || base.createdTime || '',
    fileName: base.fileName || '',
    isFC: Number(base.totalMiss ?? ((base.good || 0) + (base.bad || 0) + (base.miss || 0))) === 0,
    source: base.source || 'new',
    ...extra,
  };
  return record;
}

async function loadNewScheme(rootFolder) {
  const deviceFolders = await fetchAllDriveItems(
    `'${rootFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    'id,name,createdTime,modifiedTime'
  );
  const records = [];
  const deviceLikeFolders = deviceFolders.filter((f) => f.name !== 'FC');

  for (const folder of deviceLikeFolders) {
    const files = await fetchAllDriveItems(
      `'${folder.id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      'id,name,parents,thumbnailLink,createdTime,modifiedTime'
    );
    for (const file of files) {
      const parsed = parseNewRecordName(file.name);
      if (!parsed) continue;
      records.push(normalizeDriveRecord({
        id: file.id,
        parentId: folder.id,
        deviceId: folder.id,
        deviceName: folder.name,
        thumbnail: file.thumbnailLink || null,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        fileName: file.name,
        source: 'new',
        ...parsed,
      }));
    }
  }
  return records;
}


async function loadLegacyScheme(rootFolder) {
  const fcFolder = await getFolderByName('FC', rootFolder.id);
  if (!fcFolder) return [];
  const songFolders = await fetchAllDriveItems(
    `'${fcFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    'id,name,createdTime,modifiedTime'
  );
  const folderMap = new Map();
  songFolders.forEach((folder) => {
    const meta = legacyParseFolderTitle(folder.name);
    if (meta) folderMap.set(folder.id, { ...meta, folderId: folder.id, name: folder.name });
  });
  const records = [];
  for (const folder of songFolders) {
    const files = await fetchAllDriveItems(
      `'${folder.id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      'id,name,parents,thumbnailLink,createdTime,modifiedTime'
    );
    for (const file of files) {
      const missCount = parseLegacyMissCount(file.name);
      if (missCount === null) continue;
      const songInfo = folderMap.get(folder.id);
      if (!songInfo) continue;
      records.push(normalizeDriveRecord({
        id: file.id,
        parentId: folder.id,
        deviceId: fcFolder.id,
        deviceName: 'legacy',
        title: songInfo.title,
        level: songInfo.level,
        difficultyRaw: songInfo.difficultyRaw,
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        miss: missCount,
        combo: 0,
        totalMiss: missCount,
        thumbnail: file.thumbnailLink || null,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        fileName: file.name,
        source: 'legacy',
      }));
    }
  }
  return records;
}

export async function fetchDataFromDrive() {
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loader-text');
  const resultCount = document.getElementById('result-count');
  loader.style.display = 'flex';
  loaderText.innerText = 'フォルダを確認中...';
  resultCount.innerText = 'データ取得中...';

  try {
    const rootFolder = await getFolderByName(ROOT_FOLDER_NAME);
    if (!rootFolder) {
      state.allRecords = [];
      window.onDataLoaded?.();
      return;
    }

    loaderText.innerText = '保存データを取得中...';
    const [newRecords, legacyRecords] = await Promise.all([loadNewScheme(rootFolder), loadLegacyScheme(rootFolder)]);
    const records = [...newRecords, ...legacyRecords];
    records.sort((a, b) => (new Date(b.createdTime || b.modifiedTime || 0).getTime() - new Date(a.createdTime || a.modifiedTime || 0).getTime()));
    state.allRecords = records;
    state.bestMap = new Map();
    window.onDataLoaded?.();
  } catch (error) {
    console.error(error);
    loader.style.display = 'none';
    resultCount.innerText = '読み込みエラー';
    showToast('読み込みエラー', error?.message || String(error), 'error');
  }
}

function encodeDeviceFolderName(preset) {
  return preset?.name ? slugify(preset.name) || 'device' : 'device';
}

async function ensureUploadTarget(preset) {
  const rootFolder = await findOrCreateFolder(ROOT_FOLDER_NAME);
  const folderName = preset?.name || 'デフォルト';
  const deviceFolder = await findOrCreateFolder(folderName, rootFolder.id);
  return { rootFolder, deviceFolder };
}

export async function executeUploads(queue, onItemStatus) {
  const accessToken = window.gapi.client.getToken().access_token;
  let successCount = 0;
  const created = [];
  const currentPreset = getCurrentPreset();

  for (const item of [...queue]) {
    const preset = getPresetById(item.devicePresetId) || currentPreset;
    const { deviceFolder } = await ensureUploadTarget(preset);
    const sbStatus = document.getElementById(`sb-status-${item.id}`);
    if (sbStatus) {
      sbStatus.innerText = '送信中';
      sbStatus.className = 'upload-status processing';
    }
    try {
      if (!item.data.title) throw new Error('曲名が未設定です');
      const fileName = buildNewFileName({
        ...item.data,
        createdTime: item.createdTime || Date.now(),
      });
      const meta = { name: fileName, parents: [deviceFolder.id] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      form.append('file', item.file);

      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,createdTime,modifiedTime', {
        method: 'POST',
        headers: new Headers({ Authorization: `Bearer ${accessToken}` }),
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
      const createdFile = await response.json();
      created.push({ ...item.data, fileId: createdFile.id, title: item.data.title, difficultyRaw: item.data.difficultyRaw, createdTime: createdFile.createdTime, modifiedTime: createdFile.modifiedTime });
      successCount += 1;
      if (sbStatus) {
        sbStatus.innerText = '完了';
        sbStatus.className = 'upload-status done';
      }
      onItemStatus?.(item, 'done');
    } catch (error) {
      console.error(error);
      if (sbStatus) {
        sbStatus.innerText = '失敗';
        sbStatus.className = 'upload-status error';
      }
      onItemStatus?.(item, 'error', error);
    }
  }

  return { successCount, created };
}

export async function executeEdits(queue, onItemStatus) {
  let successCount = 0;
  const edited = [];
  for (const item of [...queue]) {
    const sbStatus = document.getElementById(`sb-status-${item.id}`);
    if (sbStatus) {
      sbStatus.innerText = '保存中';
      sbStatus.className = 'upload-status processing';
    }
    try {
      if (!item.data.title) throw new Error('曲名が未設定です');
      const preset = getPresetById(item.devicePresetId) || getCurrentPreset();
      const { deviceFolder } = await ensureUploadTarget(preset);
      const fileName = buildNewFileName({
        ...item.data,
        createdTime: item.createdTime || Date.now(),
      });
      const params = {
        fileId: item.originalId,
        resource: { name: fileName },
      };
      if (item.originalParent && item.originalParent !== deviceFolder.id) {
        params.addParents = deviceFolder.id;
        params.removeParents = item.originalParent;
      }
      const response = await window.gapi.client.drive.files.update({
        ...params,
        fields: 'id,name,parents,createdTime,modifiedTime',
      });
      edited.push({ ...item.data, fileId: response.result.id, title: item.data.title, createdTime: response.result.createdTime, modifiedTime: response.result.modifiedTime });
      successCount += 1;
      if (sbStatus) {
        sbStatus.innerText = '完了';
        sbStatus.className = 'upload-status done';
      }
      onItemStatus?.(item, 'done');
    } catch (error) {
      console.error(error);
      if (sbStatus) {
        sbStatus.innerText = '失敗';
        sbStatus.className = 'upload-status error';
      }
      onItemStatus?.(item, 'error', error);
    }
  }
  return { successCount, edited };
}

export async function deleteDriveFiles(records) {
  for (const rec of records) {
    if (!rec?.fileId) continue;
    await window.gapi.client.drive.files.delete({ fileId: rec.fileId });
  }
}

export function summarizeBestUpdates(beforeMap, afterRecords, touchedRecords) {
  const updates = [];
  const touchedKeys = new Set(touchedRecords.map((r) => getRecordKey(r)));
  const bestByKey = new Map();
  for (const rec of afterRecords) {
    const key = getRecordKey(rec);
    const current = bestByKey.get(key);
    if (!current || window.compareBestForView(rec, current) < 0) bestByKey.set(key, rec);
  }
  for (const rec of touchedRecords) {
    const key = getRecordKey(rec);
    const prev = beforeMap.get(key);
    const next = bestByKey.get(key);
    if (next && next.fileId === rec.fileId && (!prev || window.compareBestForView(next, prev) < 0)) {
      updates.push(next);
    }
  }
  return updates;
}

export async function refreshRecordsAfterMutation(beforeMap, touchedRecords, messagePrefix = '保存') {
  await fetchDataFromDrive();
  const updates = summarizeBestUpdates(beforeMap, state.allRecords, touchedRecords);
  if (updates.length) {
    const summary = updates.slice(0, 3).map((r) => `${r.title} / ${r.difficultyRaw} / ミス${r.totalMiss}`).join('<br>');
    showToast('自己ベスト更新', `${messagePrefix}したデータで自己ベストを更新しました。<br>${summary}`);
  }
}

window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;
window.handleAuthClick = handleAuthClick;
window.handleSignoutClick = handleSignoutClick;
window.setAuthUI = setAuthUI;
