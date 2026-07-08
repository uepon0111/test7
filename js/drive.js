import { appState, getActiveProfile, getDifficultyLabel, getDifficultyCode, getDifficultyOrder, selectBestProfileForImage, bestKey, compareRecordScore, normalizeProfile, normalizeRegion, DIFFICULTY_COLORS } from './state.js';
import { escapeHtml, normalizeString, formatDate, clamp } from './utils.js';

const ROOT_FOLDER_CANDIDATES = ['PRSK_RESULTS', 'プロセカリザルト'];
const APP_NAMESPACE = 'prsk-result-viewer';
const ROOT_CACHE = new Map();
let folderMapCache = new Map();

function fileFolderQuery() {
  return `trashed = false`;
}

function isFolder(item) {
  return item?.mimeType === 'application/vnd.google-apps.folder';
}

function sanitizeDriveName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'untitled';
}

function getFileSummaryName(stats) {
  const miss = Number(stats.totalMiss ?? stats.missCount ?? 0);
  const perfect = Number(stats.perfectCount ?? 0);
  const great = Number(stats.greatCount ?? 0);
  const combo = Number(stats.comboCount ?? 0);
  return `P${perfect}_G${great}_C${combo}_M${miss}`;
}

function buildMachineFolderName(profile) {
  return `MACHINE_${sanitizeDriveName(profile?.name || 'default')}`;
}

function buildSongFolderName(record) {
  const diffLabel = getDifficultyLabel(record.difficultyRaw);
  return `Lv${record.level} ${diffLabel} - ${sanitizeDriveName(record.title)}`;
}

export async function fetchAllDriveItems(query, fields) {
  let items = [];
  let pageToken = null;
  do {
    const response = await gapi.client.drive.files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken
    });
    if (response.result.files) items = items.concat(response.result.files);
    pageToken = response.result.nextPageToken;
  } while (pageToken);
  return items;
}

export async function getFolderByName(name, parentId = null) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const response = await gapi.client.drive.files.list({
    q: query,
    fields: 'files(id, name, parents, appProperties, createdTime)',
    pageSize: 1
  });
  return (response.result.files && response.result.files.length > 0) ? response.result.files[0] : null;
}

export async function findOrCreateFolder(name, parentId = null, appProperties = null) {
  const key = `${parentId || 'root'}|${name}`;
  if (ROOT_CACHE.has(key)) return ROOT_CACHE.get(key);
  const existing = await getFolderByName(name, parentId);
  if (existing) {
    ROOT_CACHE.set(key, existing);
    return existing;
  }
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentId) metadata.parents = [parentId];
  if (appProperties) metadata.appProperties = appProperties;
  const response = await gapi.client.drive.files.create({
    resource: metadata,
    fields: 'id, name, parents, appProperties, createdTime'
  });
  ROOT_CACHE.set(key, response.result);
  return response.result;
}

export async function ensureRootFolder() {
  const wanted = appState.settings.rootFolderName || 'PRSK_RESULTS';
  for (const name of [wanted, ...ROOT_FOLDER_CANDIDATES]) {
    const existing = await getFolderByName(name);
    if (existing) return existing;
  }
  return await findOrCreateFolder(wanted, null, { app: APP_NAMESPACE, role: 'root' });
}

function parseFolderTitle(folderName) {
  if (!folderName) return null;

  let m = folderName.match(/^Lv(\d+)\s+([A-Z]+)\s+-\s+(.+)$/);
  if (m) {
    return {
      level: parseInt(m[1], 10),
      difficultyRaw: getDifficultyCode(m[2]),
      title: m[3].trim()
    };
  }

  m = folderName.match(/^(\d+)([ANEHM])\s+(.+)$/i);
  if (m) {
    const diffMap = { A: 'A', N: 'N', E: 'E2', H: 'H', M: 'M' };
    const code = diffMap[m[2].toUpperCase()] || getDifficultyCode(m[2]);
    return {
      level: parseInt(m[1], 10),
      difficultyRaw: code,
      title: m[3].trim()
    };
  }

  m = folderName.match(/^(\d+)\s+([A-Z]+)\s+(.+)$/);
  if (m) {
    return {
      level: parseInt(m[1], 10),
      difficultyRaw: getDifficultyCode(m[2]),
      title: m[3].trim()
    };
  }

  return null;
}

function parseStatFromName(name) {
  const out = {};
  if (!name) return out;
  let m = String(name).match(/P(\d+)_G(\d+)_C(\d+)_M(\d+)/i);
  if (m) {
    out.perfectCount = parseInt(m[1], 10);
    out.greatCount = parseInt(m[2], 10);
    out.comboCount = parseInt(m[3], 10);
    out.totalMiss = parseInt(m[4], 10);
    return out;
  }
  m = String(name).match(/^FC(?:-(\d+))?/i);
  if (m) {
    out.totalMiss = m[1] === undefined ? 0 : parseInt(m[1], 10);
  }
  return out;
}

function parseAppProperties(props = {}) {
  const out = {};
  const entries = Object.entries(props);
  const getNum = key => {
    const v = props[key];
    return v === undefined || v === null || v === '' ? undefined : Number(v);
  };
  if ('title' in props) out.title = props.title;
  if ('level' in props) out.level = Number(props.level);
  if ('difficultyRaw' in props) out.difficultyRaw = getDifficultyCode(props.difficultyRaw);
  if ('difficulty' in props) out.difficultyRaw = getDifficultyCode(props.difficulty);
  if ('perfectCount' in props) out.perfectCount = getNum('perfectCount');
  if ('greatCount' in props) out.greatCount = getNum('greatCount');
  if ('goodCount' in props) out.goodCount = getNum('goodCount');
  if ('badCount' in props) out.badCount = getNum('badCount');
  if ('missDetailCount' in props) out.missDetailCount = getNum('missDetailCount');
  if ('comboCount' in props) out.comboCount = getNum('comboCount');
  if ('totalMiss' in props) out.totalMiss = getNum('totalMiss');
  if ('machineId' in props) out.machineId = props.machineId;
  if ('profileId' in props) out.profileId = props.profileId;
  if ('uploadedAt' in props) out.uploadedAt = props.uploadedAt;
  return out;
}

function isDescendant(folderId, rootId, foldersById) {
  let current = folderId;
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === rootId) return true;
    visited.add(current);
    const folder = foldersById.get(current);
    current = folder?.parents?.[0] || null;
  }
  return false;
}

function resolveSongFolder(folderId, foldersById, rootId) {
  let current = folderId;
  let visited = new Set();
  while (current && !visited.has(current)) {
    const folder = foldersById.get(current);
    if (!folder) return null;
    const parsed = parseFolderTitle(folder.name);
    if (parsed) return { folder, parsed };
    visited.add(current);
    if (folder.parents && folder.parents.length > 0) {
      const parentId = folder.parents[0];
      if (parentId === rootId) return null;
      current = parentId;
    } else {
      return null;
    }
  }
  return null;
}

export function buildRecordFromFile(file, foldersById, rootId) {
  const parentId = file.parents?.[0] || null;
  if (!parentId || !isDescendant(parentId, rootId, foldersById)) return null;
  const songFolderInfo = resolveSongFolder(parentId, foldersById, rootId);
  if (!songFolderInfo) return null;

  const folderParsed = songFolderInfo.parsed;
  const props = parseAppProperties(file.appProperties || {});
  const nameStats = parseStatFromName(file.name);
  const record = {
    id: file.id,
    parentId,
    title: props.title || folderParsed.title || file.name,
    level: Number(props.level ?? folderParsed.level ?? 0),
    difficultyRaw: getDifficultyCode(props.difficultyRaw || folderParsed.difficultyRaw || 'M'),
    thumbnail: file.thumbnailLink || null,
    createdTime: file.createdTime || file.modifiedTime || null,
    modifiedTime: file.modifiedTime || null,
    uploadedAt: props.uploadedAt || file.createdTime || file.modifiedTime || null,
    machineId: props.machineId || props.profileId || null,
    profileId: props.profileId || props.machineId || null,
    perfectCount: Number(props.perfectCount ?? 0),
    greatCount: Number(props.greatCount ?? 0),
    goodCount: Number(props.goodCount ?? 0),
    badCount: Number(props.badCount ?? 0),
    missDetailCount: Number(props.missDetailCount ?? 0),
    comboCount: Number(props.comboCount ?? 0),
    totalMiss: Number(props.totalMiss ?? nameStats.totalMiss ?? 0)
  };

  if (!props.totalMiss && nameStats.totalMiss !== undefined) {
    record.totalMiss = Number(nameStats.totalMiss);
  }
  if (!props.perfectCount && nameStats.perfectCount !== undefined) record.perfectCount = Number(nameStats.perfectCount);
  if (!props.greatCount && nameStats.greatCount !== undefined) record.greatCount = Number(nameStats.greatCount);
  if (!props.comboCount && nameStats.comboCount !== undefined) record.comboCount = Number(nameStats.comboCount);
  if (!props.totalMiss && nameStats.totalMiss !== undefined) record.totalMiss = Number(nameStats.totalMiss);

  record.isFC = record.totalMiss === 0;
  record.difficulty = getDifficultyLabel(record.difficultyRaw);
  record.difficultyOrder = getDifficultyOrder(record.difficultyRaw);
  record.scoreKey = `${normalizeString(record.title)}|${record.level}|${record.difficultyRaw}`;
  return record;
}

export async function fetchDataFromDrive() {
  const loaderText = 'Google Drive から読み込み中...';
  if (window.setLoadingState) window.setLoadingState(true, loaderText, 0);
  try {
    const [folders, files] = await Promise.all([
      fetchAllDriveItems(fileFolderQuery() + ` and mimeType = 'application/vnd.google-apps.folder'`, 'id,name,parents,appProperties,createdTime,modifiedTime'),
      fetchAllDriveItems(fileFolderQuery() + ` and mimeType != 'application/vnd.google-apps.folder'`, 'id,name,parents,thumbnailLink,createdTime,modifiedTime,appProperties')
    ]);

    folderMapCache = new Map();
    for (const folder of folders) folderMapCache.set(folder.id, folder);

    const root = folders.find(f => ROOT_FOLDER_CANDIDATES.includes(f.name) || f.name === appState.settings.rootFolderName);
    if (!root) {
      appState.allRecords = [];
      if (window.setLoadingState) window.setLoadingState(false);
      if (window.onRecordsUpdated) window.onRecordsUpdated();
      return [];
    }

    const records = [];
    let processed = 0;
    for (const file of files) {
      const rec = buildRecordFromFile(file, folderMapCache, root.id);
      if (rec) records.push(rec);
      processed++;
      if (processed % 80 === 0 && window.setLoadingState) {
        window.setLoadingState(true, loaderText, processed / Math.max(files.length, 1));
      }
    }

    records.sort((a, b) => compareRecordScore(a, b));
    appState.allRecords = records;
    if (window.setLoadingState) window.setLoadingState(false);
    if (window.onRecordsUpdated) window.onRecordsUpdated();
    return records;
  } catch (e) {
    console.error(e);
    if (window.setLoadingState) window.setLoadingState(false, '読み込み失敗');
    throw e;
  }
}

function buildDriveProperties(record, profileId) {
  return {
    app: APP_NAMESPACE,
    title: record.title || '',
    level: String(record.level ?? ''),
    difficultyRaw: String(record.difficultyRaw ?? ''),
    perfectCount: String(record.perfectCount ?? 0),
    greatCount: String(record.greatCount ?? 0),
    goodCount: String(record.goodCount ?? 0),
    badCount: String(record.badCount ?? 0),
    missDetailCount: String(record.missDetailCount ?? 0),
    comboCount: String(record.comboCount ?? 0),
    totalMiss: String(record.totalMiss ?? 0),
    machineId: String(profileId || record.profileId || ''),
    profileId: String(profileId || record.profileId || ''),
    uploadedAt: String(record.uploadedAt || new Date().toISOString())
  };
}

async function ensureMachineAndSongFolders(rootFolder, profile, record) {
  const machineFolderName = buildMachineFolderName(profile);
  const machineFolder = await findOrCreateFolder(machineFolderName, rootFolder.id, {
    app: APP_NAMESPACE,
    role: 'machine',
    profileId: profile.id,
    profileName: profile.name
  });
  const songFolderName = buildSongFolderName(record);
  const songFolder = await findOrCreateFolder(songFolderName, machineFolder.id, {
    app: APP_NAMESPACE,
    role: 'song',
    profileId: profile.id,
    title: record.title,
    level: String(record.level ?? ''),
    difficultyRaw: String(record.difficultyRaw ?? '')
  });
  return { machineFolder, songFolder };
}

export async function uploadRecordItem(item) {
  const rootFolder = await ensureRootFolder();
  const profile = item.profile || getActiveProfile();
  const record = item.data;
  const { songFolder } = await ensureMachineAndSongFolders(rootFolder, profile, record);
  const fileName = getFileSummaryName(record);
  const meta = {
    name: fileName,
    parents: [songFolder.id],
    appProperties: buildDriveProperties(record, profile.id)
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', item.file);

  const token = gapi.client.getToken()?.access_token;
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,thumbnailLink,createdTime,modifiedTime,appProperties', {
    method: 'POST',
    headers: new Headers({ 'Authorization': 'Bearer ' + token }),
    body: form
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}

export async function updateRecordItem(item) {
  const rootFolder = await ensureRootFolder();
  const profile = item.profile || getActiveProfile();
  const record = item.data;
  const { machineFolder, songFolder } = await ensureMachineAndSongFolders(rootFolder, profile, record);
  const params = {
    fileId: item.originalId,
    resource: {
      name: getFileSummaryName(record),
      appProperties: buildDriveProperties(record, profile.id)
    }
  };
  if (songFolder.id !== item.originalParent) {
    params.addParents = songFolder.id;
    params.removeParents = item.originalParent;
  }
  const response = await gapi.client.drive.files.update(params);
  return response.result;
}

export async function deleteDriveFile(fileId) {
  await gapi.client.drive.files.delete({ fileId });
}

export async function deleteDriveFiles(ids) {
  for (const id of ids) await deleteDriveFile(id);
}

export function getAllParsedRecords() {
  return appState.allRecords.slice();
}

export function setCurrentFolderCache(map) {
  folderMapCache = map;
}

export function getCurrentFolderCache() {
  return folderMapCache;
}
