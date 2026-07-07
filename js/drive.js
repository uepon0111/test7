import { APP_CONFIG } from './config.js';
import { state, resetRuntimeState } from './state.js';
import {
  buildFolderName,
  buildMetaKey,
  compareScore,
  computeBestMap,
  normalizeDifficulty,
  parseDriveDescription,
  parseFolderTitle,
  parseScoreFromFileName,
  serializeDriveDescription,
} from './records.js';
import { setLoading, showToast } from './utils.js';

let tokenClient = null;

function driveClient() {
  if (!window.gapi?.client?.drive) {
    throw new Error('Google Drive API is not ready');
  }
  return window.gapi.client.drive;
}

export function setGoogleApisReady() {
  state.gapiReady = true;
}

export function setGoogleIdentityReady() {
  state.gisReady = true;
}

export async function initializeGoogleClient() {
  await window.gapi.client.init({
    apiKey: APP_CONFIG.apiKey,
    discoveryDocs: [APP_CONFIG.discoveryDoc],
  });
  setGoogleApisReady();
}

export function initializeIdentityClient() {
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: APP_CONFIG.clientId,
    scope: APP_CONFIG.scopes,
    callback: '',
  });
  setGoogleIdentityReady();
}

export function hasToken() {
  return Boolean(window.gapi?.client?.getToken?.());
}

function updateAuthUi(isLoggedIn) {
  const signoutButton = document.getElementById('signout_button');
  const uploadButton = document.getElementById('upload_button');
  const authorizeButton = document.getElementById('authorize_button');
  const authStatus = document.getElementById('auth-status');

  if (signoutButton) signoutButton.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (uploadButton) uploadButton.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (authorizeButton) authorizeButton.style.display = isLoggedIn ? 'none' : 'inline-flex';
  if (authStatus) authStatus.textContent = isLoggedIn ? 'ログイン済み' : '未ログイン';
  state.isAuthenticated = isLoggedIn;
}

export async function handleAuthClick() {
  if (!tokenClient) {
    showToast('Google認証の初期化を待っています', 'error');
    return;
  }

  tokenClient.callback = async (resp) => {
    if (resp?.error) {
      console.error(resp);
      showToast('ログインに失敗しました', 'error');
      return;
    }
    updateAuthUi(true);
    await fetchDataFromDrive();
  };

  if (window.gapi.client.getToken() === null) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    tokenClient.requestAccessToken({ prompt: '' });
  }
}

export function handleSignoutClick() {
  const token = window.gapi.client.getToken();
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken('');
  }
  resetRuntimeState();
  updateAuthUi(false);
  const grid = document.getElementById('grid');
  if (grid) grid.innerHTML = '';
  const resultCount = document.getElementById('result-count');
  if (resultCount) resultCount.textContent = 'ログアウトしました';
}

function normalizeCreatedTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRecordMetaFromDrive(file) {
  const meta = parseDriveDescription(file.description);
  if (!meta) return null;
  return meta;
}

function buildRecordFromFile(file, folderInfo) {
  const descriptionMeta = parseRecordMetaFromDrive(file);
  const fallbackMiss = parseScoreFromFileName(file.name);

  const stats = descriptionMeta?.stats || descriptionMeta?.metrics || {};
  const missCount = Number.isFinite(descriptionMeta?.missCount)
    ? descriptionMeta.missCount
    : Number.isFinite(stats.missCount)
      ? stats.missCount
      : Number.isFinite(fallbackMiss)
        ? fallbackMiss
        : Number.isFinite(stats.bad) || Number.isFinite(stats.good)
          ? Number(stats.good || 0) + Number(stats.bad || 0) + Number(stats.miss || 0)
          : 0;

  const perfectCount = Number.isFinite(stats.perfect) ? stats.perfect : 0;
  const greatCount = Number.isFinite(stats.great) ? stats.great : 0;
  const goodCount = Number.isFinite(stats.good) ? stats.good : 0;
  const badCount = Number.isFinite(stats.bad) ? stats.bad : 0;
  const missDetailCount = Number.isFinite(stats.miss) ? stats.miss : 0;
  const comboCount = Number.isFinite(stats.combo) ? stats.combo : 0;

  return {
    id: file.id,
    parentId: folderInfo.folderId,
    title: folderInfo.title,
    level: folderInfo.level,
    difficulty: folderInfo.difficulty,
    difficultyRaw: folderInfo.difficultyRaw,
    missCount,
    perfectCount,
    greatCount,
    goodCount,
    badCount,
    missDetailCount,
    comboCount,
    isFC: missCount === 0,
    thumbnail: file.thumbnailLink || null,
    createdTime: normalizeCreatedTime(file.createdTime || descriptionMeta?.createdTime || file.modifiedTime),
    description: file.description || '',
    musicId: descriptionMeta?.musicId ?? null,
    metaVersion: descriptionMeta?.version ?? 1,
    songKey: buildMetaKey(folderInfo),
  };
}

async function fetchAllDriveItems(query, fields) {
  let items = [];
  let pageToken = null;
  do {
    const response = await driveClient().files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken,
    });
    if (response.result.files) items = items.concat(response.result.files);
    pageToken = response.result.nextPageToken;
  } while (pageToken);
  return items;
}

async function getFolderByName(name, parentId = null) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\'")}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const response = await driveClient().files.list({
    q: query,
    fields: 'files(id, name, parents)',
    pageSize: 1,
  });
  return response.result.files?.[0] || null;
}

export async function findOrCreateFolder(name, parentId = null) {
  const cacheKey = `${parentId || 'root'}::${name}`;
  if (state.driveCache.songFolders.has(cacheKey)) {
    return state.driveCache.songFolders.get(cacheKey);
  }

  const existing = await getFolderByName(name, parentId);
  if (existing) {
    state.driveCache.songFolders.set(cacheKey, existing);
    return existing;
  }

  const resource = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) resource.parents = [parentId];

  const response = await driveClient().files.create({
    resource,
    fields: 'id, name, parents',
  });

  const folder = response.result;
  state.driveCache.songFolders.set(cacheKey, folder);
  return folder;
}

async function ensureBaseFolders() {
  if (state.driveCache.rootFolder && state.driveCache.fcFolder) {
    return state.driveCache;
  }

  const rootFolder = await getFolderByName(APP_CONFIG.rootFolderName);
  if (!rootFolder) {
    throw new Error(`ルートフォルダ「${APP_CONFIG.rootFolderName}」が見つかりません`);
  }

  const fcFolder = await getFolderByName(APP_CONFIG.fcFolderName, rootFolder.id);
  if (!fcFolder) {
    throw new Error(`フォルダ「${APP_CONFIG.fcFolderName}」が見つかりません`);
  }

  state.driveCache.rootFolder = rootFolder;
  state.driveCache.fcFolder = fcFolder;
  return state.driveCache;
}

export async function fetchDataFromDrive() {
  const loaderMessage = document.getElementById('loader-text');
  setLoading(true, 'データ取得中...');
  if (loaderMessage) loaderMessage.textContent = 'データ取得中...';

  try {
    await ensureBaseFolders();
    const { fcFolder } = state.driveCache;

    if (loaderMessage) loaderMessage.textContent = '楽曲情報を取得中...';
    const songFolders = await fetchAllDriveItems(
      `'${fcFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      'id, name',
    );

    const folderMap = new Map();
    for (const folder of songFolders) {
      const metadata = parseFolderTitle(folder.name);
      if (metadata) folderMap.set(folder.id, { ...metadata, folderId: folder.id });
    }

    if (songFolders.length === 0) {
      state.records = [];
      state.bestMap = new Map();
      updateAfterLoad();
      return;
    }

    if (loaderMessage) loaderMessage.textContent = 'リザルト画像を処理中...';
    const candidateFiles = await fetchAllDriveItems(
      `mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      'id, name, parents, thumbnailLink, description, createdTime, modifiedTime',
    );

    const records = [];
    for (const file of candidateFiles) {
      const parentId = Array.isArray(file.parents) ? file.parents.find((candidate) => folderMap.has(candidate)) : null;
      if (!parentId) continue;
      const folderInfo = folderMap.get(parentId);
      records.push(buildRecordFromFile(file, folderInfo));
    }

    state.records = records;
    state.bestMap = computeBestMap(records);
    updateAfterLoad();
  } catch (error) {
    console.error(error);
    showToast(error?.message || 'データ取得に失敗しました', 'error');
    updateAfterLoad(true);
  }
}

function updateAfterLoad(forceEmpty = false) {
  setLoading(false);
  const resultCount = document.getElementById('result-count');
  if (forceEmpty && resultCount) {
    resultCount.textContent = 'データの読み込みに失敗しました';
  }
  import('./ui.js').then(({ refreshView }) => refreshView());
}

export async function uploadNewRecord(item, tempRecords) {
  const { rootFolder, fcFolder } = await ensureBaseFolders();
  const folderName = buildFolderName(item.data.level, item.data.diff, item.data.title);
  const songFolder = await findOrCreateFolder(folderName, fcFolder.id);
  const fileName = item.data.missCount === 0 ? 'FC' : `FC-${item.data.missCount}`;
  const metadata = {
    version: 1,
    createdTime: new Date().toISOString(),
    title: item.data.title,
    level: item.data.level,
    difficulty: normalizeDifficulty(item.data.diff),
    musicId: item.data.musicId || null,
    missCount: Number(item.data.missCount || 0),
    stats: item.data.stats || {},
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    name: fileName,
    parents: [songFolder.id],
    description: serializeDriveDescription(metadata),
  })], { type: 'application/json' }));
  form.append('file', item.file);

  const token = window.gapi.client.getToken()?.access_token;
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: new Headers({ Authorization: `Bearer ${token}` }),
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  const created = await response.json();
  const record = {
    id: created.id,
    parentId: songFolder.id,
    title: item.data.title,
    level: item.data.level,
    difficulty: normalizeDifficulty(item.data.diff),
    difficultyRaw: normalizeDifficulty(item.data.diff),
    missCount: Number(item.data.missCount || 0),
    perfectCount: Number(item.data.stats?.perfect || 0),
    greatCount: Number(item.data.stats?.great || 0),
    goodCount: Number(item.data.stats?.good || 0),
    badCount: Number(item.data.stats?.bad || 0),
    missDetailCount: Number(item.data.stats?.miss || 0),
    comboCount: Number(item.data.stats?.combo || 0),
    isFC: Number(item.data.missCount || 0) === 0,
    thumbnail: created.thumbnailLink || null,
    createdTime: metadata.createdTime,
    description: metadata,
    musicId: item.data.musicId || null,
    songKey: buildMetaKey({
      title: item.data.title,
      level: item.data.level,
      difficultyRaw: normalizeDifficulty(item.data.diff),
    }),
  };

  return record;
}

export async function updateExistingRecord(item, tempRecords) {
  const { fcFolder } = await ensureBaseFolders();
  const folderName = buildFolderName(item.data.level, item.data.diff, item.data.title);
  const targetFolder = await findOrCreateFolder(folderName, fcFolder.id);
  const fileName = item.data.missCount === 0 ? 'FC' : `FC-${item.data.missCount}`;
  const metadata = {
    version: 1,
    updatedTime: new Date().toISOString(),
    title: item.data.title,
    level: item.data.level,
    difficulty: normalizeDifficulty(item.data.diff),
    musicId: item.data.musicId || null,
    missCount: Number(item.data.missCount || 0),
    stats: item.data.stats || {},
  };

  const params = {
    fileId: item.originalId,
    resource: {
      name: fileName,
      description: serializeDriveDescription(metadata),
    },
  };

  if (item.originalParent && targetFolder.id !== item.originalParent) {
    params.addParents = targetFolder.id;
    params.removeParents = item.originalParent;
  }

  const response = await driveClient().files.update(params);
  const updated = response.result || {};
  const record = {
    id: item.originalId,
    parentId: targetFolder.id,
    title: item.data.title,
    level: item.data.level,
    difficulty: normalizeDifficulty(item.data.diff),
    difficultyRaw: normalizeDifficulty(item.data.diff),
    missCount: Number(item.data.missCount || 0),
    perfectCount: Number(item.data.stats?.perfect || 0),
    greatCount: Number(item.data.stats?.great || 0),
    goodCount: Number(item.data.stats?.good || 0),
    badCount: Number(item.data.stats?.bad || 0),
    missDetailCount: Number(item.data.stats?.miss || 0),
    comboCount: Number(item.data.stats?.combo || 0),
    isFC: Number(item.data.missCount || 0) === 0,
    thumbnail: updated.thumbnailLink || item.imgUrl || null,
    createdTime: updated.createdTime || item.createdTime || null,
    description: metadata,
    musicId: item.data.musicId || null,
    songKey: buildMetaKey({
      title: item.data.title,
      level: item.data.level,
      difficultyRaw: normalizeDifficulty(item.data.diff),
    }),
  };

  return record;
}

export async function deleteRecord(fileId) {
  await driveClient().files.delete({ fileId });
}

export async function ensureDriveReady() {
  await ensureBaseFolders();
  return state.driveCache;
}

export async function setLoggedInState(isLoggedIn) {
  const authStatus = document.getElementById('auth-status');
  const signoutButton = document.getElementById('signout_button');
  const uploadButton = document.getElementById('upload_button');
  const authorizeButton = document.getElementById('authorize_button');
  if (authStatus) authStatus.textContent = isLoggedIn ? 'ログイン済み' : '未ログイン';
  if (signoutButton) signoutButton.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (uploadButton) uploadButton.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (authorizeButton) authorizeButton.style.display = isLoggedIn ? 'none' : 'inline-flex';
  state.isAuthenticated = isLoggedIn;
}
