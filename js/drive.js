import { ROOT_FOLDER_NAME, RESULT_SUBFOLDER_NAME, buildSongFolderName, normalizeDifficultyToken, getDifficultyOrderKey } from "./config.js";
import { state } from "./state.js";

const apiKey = "AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0";
const clientId = "966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com";
const discoveryDoc = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
const scopes = "https://www.googleapis.com/auth/drive";

function getGoogleAuthStatus() {
  return Boolean(window.gapi && window.google);
}

export async function initializeGapiClient() {
  if (!getGoogleAuthStatus()) return;

  await new Promise((resolve) => window.gapi.load("client", resolve));
  await window.gapi.client.init({
    apiKey,
    discoveryDocs: [discoveryDoc],
  });

  state.gapiClientReady = true;
  state.tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: scopes,
    callback: async () => {},
  });
}

export function setAuthUI(isSignedIn) {
  const status = document.getElementById("auth-status");
  const signInBtn = document.getElementById("authorize_button");
  const signOutBtn = document.getElementById("signout_button");
  const uploadBtn = document.getElementById("upload_button");

  if (isSignedIn) {
    status.textContent = "ログイン済み";
    signInBtn.style.display = "none";
    signOutBtn.style.display = "inline-flex";
    uploadBtn.style.display = "inline-flex";
  } else {
    status.textContent = "未ログイン";
    signInBtn.style.display = "inline-flex";
    signOutBtn.style.display = "none";
    uploadBtn.style.display = "none";
  }
}

export function handleAuthClick() {
  if (!state.tokenClient) return;
  state.tokenClient.callback = async () => {
    try {
      setAuthUI(true);
      await fetchDataFromDrive();
    } catch (e) {
      console.error(e);
    }
  };
  state.tokenClient.requestAccessToken({ prompt: "" });
}

export function handleSignoutClick() {
  const token = window.gapi?.client?.getToken?.();
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken("");
  }
  setAuthUI(false);
  state.allRecords = [];
  state.filteredRecords = [];
  const loader = document.getElementById("loader");
  loader.style.display = "flex";
  document.getElementById("loader-text").textContent = "データを読み込み中...";
  document.getElementById("result-count").textContent = "ログインしてください";
  document.getElementById("grid").innerHTML = "";
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
    });
    if (response.result.files) items = items.concat(response.result.files);
    pageToken = response.result.nextPageToken;
  } while (pageToken);
  return items;
}

export async function getFolderByName(name, parentId = null) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${String(name).replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const response = await window.gapi.client.drive.files.list({ q: query, fields: "files(id, name, createdTime, modifiedTime)", pageSize: 10 });
  return response.result.files?.[0] || null;
}

export async function findOrCreateFolder(name, parentId = null) {
  const cacheKey = `${parentId || "root"}::${name}`;
  if (state.driveCache.folderLookup.has(cacheKey)) return state.driveCache.folderLookup.get(cacheKey);

  const existing = await getFolderByName(name, parentId);
  if (existing) {
    state.driveCache.folderLookup.set(cacheKey, existing);
    return existing;
  }

  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) metadata.parents = [parentId];

  const response = await window.gapi.client.drive.files.create({
    resource: metadata,
    fields: "id, name",
  });

  state.driveCache.folderLookup.set(cacheKey, response.result);
  return response.result;
}

function parseFolderTitle(folderName) {
  const m = String(folderName).match(/^(\d+)\s*([A-Z]+)\s+(.+)$/i);
  if (!m) return null;
  const level = parseInt(m[1], 10);
  const diffKey = normalizeDifficultyToken(m[2]);
  const title = m[3].trim();
  if (!diffKey || !title) return null;
  return { level, difficultyRaw: diffKey, difficulty: diffKey, title };
}

function parseCountFromFileName(fileName) {
  const m = String(fileName).match(/^FC(?:-(\d+))?$/i);
  return m ? (m[1] === undefined ? 0 : parseInt(m[1], 10)) : null;
}

function parseAppProperties(props = {}) {
  const num = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    perfect: num(props.perfect),
    great: num(props.great),
    good: num(props.good),
    bad: num(props.bad),
    missDetail: num(props.missDetail),
    combo: num(props.combo),
    totalMiss: num(props.totalMiss),
  };
}

function normalizeKey(title, diffKey) {
  return `${String(title || "").trim().toLowerCase()}|${diffKey}`;
}

function folderCacheKey(level, title, diffKey) {
  return `${String(level || "").trim()}|${String(title || "").trim().toLowerCase()}|${diffKey}`;
}

export function getRecordKey(record) {
  return normalizeKey(record.title, record.difficultyRaw);
}

export function getBestMissForKey(records, recordKey, excludeId = null) {
  let best = Infinity;
  for (const rec of records || []) {
    if (excludeId && rec.id === excludeId) continue;
    if (getRecordKey(rec) !== recordKey) continue;
    const miss = Number.isFinite(rec.totalMiss) ? rec.totalMiss : 999999;
    if (miss < best) best = miss;
  }
  return best;
}

function buildRecordFromDriveFile(file, folderMap) {
  if (!file.parents || file.parents.length === 0) return null;
  const parentId = file.parents.find((p) => folderMap.has(p));
  if (!parentId) return null;

  const songInfo = folderMap.get(parentId);
  const app = parseAppProperties(file.appProperties || {});
  const missCount = app.totalMiss > 0 || String(file.name).startsWith("FC-") || file.name === "FC" ? (app.totalMiss || parseCountFromFileName(file.name) || 0) : 0;

  const record = {
    id: file.id,
    parentId,
    title: songInfo.title,
    level: songInfo.level,
    difficulty: songInfo.difficulty,
    difficultyRaw: songInfo.difficultyRaw,
    totalMiss: missCount,
    isFC: missCount === 0,
    thumbnail: file.thumbnailLink || null,
    addedTime: file.createdTime ? Date.parse(file.createdTime) : 0,
    modifiedTime: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
    perfect: app.perfect,
    great: app.great,
    good: app.good,
    bad: app.bad,
    missDetail: app.missDetail,
    combo: app.combo,
    musicId: file.appProperties?.musicId || null,
  };
  if (!record.perfect && !record.great && !record.good && !record.bad && !record.missDetail && !record.combo && record.totalMiss > 0) {
    // Legacy files: keep the miss count, leave breakdown at zero.
  }
  record.songKey = getRecordKey(record);
  record.difficultyOrder = getDifficultyOrderKey(record.difficultyRaw);
  return record;
}

export function recomputeBestFlags(records) {
  const bestBySong = new Map();
  for (const rec of records) {
    const key = rec.songKey || getRecordKey(rec);
    const current = bestBySong.get(key);
    const miss = Number.isFinite(rec.totalMiss) ? rec.totalMiss : 999999;
    if (!current || miss < current.totalMiss || (miss === current.totalMiss && (rec.addedTime || 0) > (current.addedTime || 0))) {
      bestBySong.set(key, { totalMiss: miss });
    }
  }

  for (const rec of records) {
    const best = bestBySong.get(rec.songKey || getRecordKey(rec));
    rec.isBest = best ? rec.totalMiss === best.totalMiss : false;
  }
  return bestBySong;
}

export async function fetchDataFromDrive() {
  const loader = document.getElementById("loader");
  loader.style.display = "flex";
  document.getElementById("loader-text").textContent = "データ取得中...";
  document.getElementById("result-count").textContent = "データ取得中...";

  try {
    const rootFolder = await getFolderByName(ROOT_FOLDER_NAME);
    if (!rootFolder) {
      state.allRecords = [];
      state.filteredRecords = [];
      state.driveCache.rootFolder = null;
      state.driveCache.fcFolder = null;
      state.driveCache.songFolderByKey.clear();
      document.getElementById("loader-text").textContent = "データがありません";
      document.getElementById("grid").innerHTML = "";
      document.getElementById("result-count").textContent = "データなし";
      loader.style.display = "none";
      return;
    }

    const fcFolder = await getFolderByName(RESULT_SUBFOLDER_NAME, rootFolder.id);
    if (!fcFolder) {
      state.allRecords = [];
      state.filteredRecords = [];
      state.driveCache.rootFolder = rootFolder;
      state.driveCache.fcFolder = null;
      state.driveCache.songFolderByKey.clear();
      document.getElementById("grid").innerHTML = "";
      document.getElementById("result-count").textContent = "データなし";
      loader.style.display = "none";
      return;
    }

    state.driveCache.rootFolder = rootFolder;
    state.driveCache.fcFolder = fcFolder;

    document.getElementById("loader-text").textContent = "楽曲情報を取得中...";
    const folderQuery = `'${fcFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const songFolders = await fetchAllDriveItems(folderQuery, "id, name, createdTime, modifiedTime");

    const folderMap = new Map();
    state.driveCache.songFolderByKey.clear();
    songFolders.forEach((folder) => {
      const metadata = parseFolderTitle(folder.name);
      if (!metadata) return;
      folderMap.set(folder.id, { ...metadata, folderId: folder.id, rawName: folder.name });
      state.driveCache.songFolderByKey.set(folderCacheKey(metadata.level, metadata.title, metadata.difficultyRaw), folder);
    });

    document.getElementById("loader-text").textContent = "リザルト画像を処理中...";
    const fileQuery = `name contains 'FC' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
    const candidateFiles = await fetchAllDriveItems(fileQuery, "id, name, parents, thumbnailLink, createdTime, modifiedTime, appProperties, description");

    const records = [];
    candidateFiles.forEach((file) => {
      const record = buildRecordFromDriveFile(file, folderMap);
      if (record) records.push(record);
    });

    recomputeBestFlags(records);
    state.allRecords = records;
    state.filteredRecords = records.slice();
    document.getElementById("loader").style.display = "none";
  } catch (e) {
    console.error(e);
    loader.style.display = "none";
    document.getElementById("result-count").textContent = "読み込み失敗";
  }
}

function buildMultipartForm(metadata, file) {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);
  return form;
}

function buildFileMetadata(item, parentId) {
  const appProperties = {
    title: item.data.title || "",
    level: String(item.data.level || ""),
    diff: item.data.diff,
    perfect: String(item.data.perfect || 0),
    great: String(item.data.great || 0),
    good: String(item.data.good || 0),
    bad: String(item.data.bad || 0),
    missDetail: String(item.data.missDetail || 0),
    combo: String(item.data.combo || 0),
    totalMiss: String(item.data.totalMiss || 0),
    musicId: item.data.musicId || "",
  };

  return {
    name: item.data.totalMiss === 0 ? "FC" : `FC-${item.data.totalMiss}`,
    parents: [parentId],
    appProperties,
  };
}

export async function ensureSongFolderForItem(item) {
  const rootFolder = state.driveCache.rootFolder || await findOrCreateFolder(ROOT_FOLDER_NAME);
  const fcFolder = state.driveCache.fcFolder || await findOrCreateFolder(RESULT_SUBFOLDER_NAME, rootFolder.id);
  state.driveCache.rootFolder = rootFolder;
  state.driveCache.fcFolder = fcFolder;

  const folderName = buildSongFolderName(item.data.level, item.data.diff, item.data.title);
  const key = folderCacheKey(item.data.level, item.data.title, item.data.diff);
  const cached = state.driveCache.songFolderByKey.get(key);
  if (cached && cached.name === folderName) return cached;

  const folder = await findOrCreateFolder(folderName, fcFolder.id);
  state.driveCache.songFolderByKey.set(key, folder);
  return folder;
}

export async function uploadQueueItem(item) {
  const accessToken = window.gapi?.client?.getToken?.()?.access_token;
  if (!accessToken) throw new Error("未ログインです");

  const songFolder = await ensureSongFolderForItem(item);
  const metadata = buildFileMetadata(item, songFolder.id);
  const form = buildMultipartForm(metadata, item.file);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: new Headers({ Authorization: "Bearer " + accessToken }),
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json().catch(() => ({}));
}

export async function updateQueueItem(item) {
  await ensureSongFolderForItem(item);
  const folder = await ensureSongFolderForItem(item);

  const params = {
    fileId: item.originalId,
    resource: {
      name: item.data.totalMiss === 0 ? "FC" : `FC-${item.data.totalMiss}`,
      appProperties: {
        title: item.data.title || "",
        level: String(item.data.level || ""),
        diff: item.data.diff,
        perfect: String(item.data.perfect || 0),
        great: String(item.data.great || 0),
        good: String(item.data.good || 0),
        bad: String(item.data.bad || 0),
        missDetail: String(item.data.missDetail || 0),
        combo: String(item.data.combo || 0),
        totalMiss: String(item.data.totalMiss || 0),
        musicId: item.data.musicId || "",
      },
    },
  };

  if (folder.id !== item.originalParent) {
    params.addParents = folder.id;
    params.removeParents = item.originalParent;
  }
  return await window.gapi.client.drive.files.update(params);
}

export async function deleteDriveFile(fileId) {
  return await window.gapi.client.drive.files.delete({ fileId });
}
