import {
  DRIVE_FC_FOLDER_NAME,
  DRIVE_ROOT_FOLDER_NAME,
  DIFFICULTY_ALIASES,
  DIFFICULTY_META,
  difficultyDbKeyOf,
  difficultyLabelOf,
  normalizeDifficultyCode,
  makeId,
} from './config.js';
import { cloneRegionsForProfile } from './profiles.js';

let folderCache = new Map();

function cacheKey(name, parentId) {
  return `${parentId || 'root'}::${name}`;
}

export function clearDriveFolderCache() {
  folderCache = new Map();
}

export async function fetchAllDriveItems(query, fields, onProgress) {
  let items = [];
  let pageToken = null;
  let page = 0;

  do {
    const response = await gapi.client.drive.files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken,
    });
    const result = response.result?.files || [];
    items = items.concat(result);
    pageToken = response.result?.nextPageToken || null;
    page += 1;
    if (typeof onProgress === 'function') onProgress({ page, count: items.length, done: !pageToken });
  } while (pageToken);

  return items;
}

export async function getFolderByName(name, parentId = null) {
  const key = cacheKey(name, parentId);
  if (folderCache.has(key)) return folderCache.get(key);

  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeQuery(name)}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;

  const response = await gapi.client.drive.files.list({
    q: query,
    fields: 'files(id, name, parents, createdTime)',
    pageSize: 1,
  });

  const folder = response.result?.files?.[0] || null;
  if (folder) folderCache.set(key, folder);
  return folder;
}

export async function ensureFolder(name, parentId = null) {
  const existing = await getFolderByName(name, parentId);
  if (existing) return existing;

  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) metadata.parents = [parentId];

  const response = await gapi.client.drive.files.create({
    resource: metadata,
    fields: 'id, name, parents, createdTime',
  });

  const folder = response.result;
  folderCache.set(cacheKey(name, parentId), folder);
  return folder;
}

export async function ensureFolderPath(parts, rootParentId = null) {
  let parentId = rootParentId;
  let current = null;
  for (const part of parts) {
    current = await ensureFolder(part, parentId);
    parentId = current.id;
  }
  return current;
}

export async function findRootFolders() {
  const rootFolder = await getFolderByName(DRIVE_ROOT_FOLDER_NAME);
  if (!rootFolder) return { rootFolder: null, fcFolder: null };
  const fcFolder = await getFolderByName(DRIVE_FC_FOLDER_NAME, rootFolder.id);
  return { rootFolder, fcFolder };
}

export async function ensureRootFolders() {
  const rootFolder = await ensureFolder(DRIVE_ROOT_FOLDER_NAME);
  const fcFolder = await ensureFolder(DRIVE_FC_FOLDER_NAME, rootFolder.id);
  return { rootFolder, fcFolder };
}

export function parseFolderTitle(folderName) {
  if (!folderName) return null;
  const trimmed = folderName.trim();
  const match = trimmed.match(/^(\d+)\s*([A-Z]+|EASY|NORMAL|HARD|EXPERT|MASTER|APPEND)\s+(.+)$/i);
  if (!match) return null;

  const level = parseInt(match[1], 10);
  const raw = normalizeDifficultyCode(match[2]);
  return {
    level,
    rawDiff: raw,
    difficulty: difficultyLabelOf(raw),
    title: match[3].trim(),
  };
}

export function parseDriveCounts(file) {
  const props = file?.appProperties || {};
  const byName = parseScoreFromName(file?.name || '');
  const missCount = parseIntSafe(props.missCount, byName);
  return {
    perfect: parseIntSafe(props.perfect, null),
    great: parseIntSafe(props.great, null),
    good: parseIntSafe(props.good, null),
    bad: parseIntSafe(props.bad, null),
    miss: parseIntSafe(props.miss, null),
    combo: parseIntSafe(props.combo, null),
    missCount,
  };
}

export function buildRecordFromDriveFile(file, folderMeta, parentId) {
  const counts = parseDriveCounts(file);
  const missCount = Number.isFinite(counts.missCount) ? counts.missCount : 0;
  const appProps = file.appProperties || {};

  return {
    id: file.id,
    parentId,
    title: folderMeta.title,
    titleNorm: folderMeta.title.toLowerCase(),
    level: folderMeta.level,
    difficulty: difficultyLabelOf(folderMeta.rawDiff),
    difficultyRaw: normalizeDifficultyCode(folderMeta.rawDiff),
    diffRank: DIFFICULTY_META[normalizeDifficultyCode(folderMeta.rawDiff)]?.rank ?? 99,
    missCount,
    isFC: missCount === 0,
    perfect: counts.perfect,
    great: counts.great,
    good: counts.good,
    bad: counts.bad,
    miss: counts.miss,
    combo: counts.combo,
    createdTime: file.createdTime || appProps.createdTime || '',
    thumbnail: file.thumbnailLink || null,
    appProperties: appProps,
    profileId: appProps.profileId || '',
    profileName: appProps.profileName || '',
    machineWidth: parseIntSafe(appProps.machineWidth, null),
    machineHeight: parseIntSafe(appProps.machineHeight, null),
    sourceName: file.name || '',
  };
}

export async function fetchResultRecords({ onStage, onProgress } = {}) {
  const { rootFolder, fcFolder } = await findRootFolders();
  const folderQuery = `'${fcFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  
  onStage?.('楽曲フォルダを取得中...');
  if (!rootFolder || !fcFolder) return { records: [], rootFolder, fcFolder };
  const songFolders = await fetchAllDriveItems(folderQuery, 'id, name, createdTime', onProgress);
  const folderMap = new Map();

  for (const folder of songFolders) {
    const meta = parseFolderTitle(folder.name);
    if (meta) folderMap.set(folder.id, { ...meta, folderId: folder.id });
  }

  if (folderMap.size === 0) {
    return { records: [], rootFolder, fcFolder };
  }

  onStage?.('リザルト画像を取得中...');
  const fileQuery = `name contains 'FC' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
  const candidateFiles = await fetchAllDriveItems(fileQuery, 'id, name, parents, thumbnailLink, createdTime, appProperties', onProgress);

  const records = [];
  for (const file of candidateFiles) {
    const parents = file.parents || [];
    const parentId = parents.find((p) => folderMap.has(p));
    if (!parentId) continue;

    const songInfo = folderMap.get(parentId);
    records.push(buildRecordFromDriveFile(file, songInfo, parentId));
  }

  return { records, rootFolder, fcFolder };
}

export function formatSongFolderName(level, difficulty, title) {
  const diff = normalizeDifficultyCode(difficulty);
  return `${level} ${diff} ${title}`;
}

export function fileNameFromCounts({ missCount }) {
  const miss = Number(missCount) || 0;
  return miss === 0 ? 'FC' : `FC-${miss}`;
}

export function serializeResultProperties(item, machine = {}) {
  const props = {
    perfect: String(Number(item.perfect ?? item.data?.perfect ?? 0) || 0),
    great: String(Number(item.great ?? item.data?.great ?? 0) || 0),
    good: String(Number(item.good ?? item.data?.good ?? 0) || 0),
    bad: String(Number(item.bad ?? item.data?.bad ?? 0) || 0),
    miss: String(Number(item.miss ?? item.data?.missDetail ?? item.data?.miss ?? 0) || 0),
    combo: String(Number(item.combo ?? item.data?.combo ?? 0) || 0),
    missCount: String(Number(item.missCount ?? item.data?.missCount ?? 0) || 0),
    profileId: String(machine.id || item.profileId || ''),
    profileName: String(machine.name || item.profileName || ''),
    machineWidth: String(machine.width || item.machineWidth || ''),
    machineHeight: String(machine.height || item.machineHeight || ''),
    createdTime: String(new Date().toISOString()),
  };
  return props;
}

export async function createResultFile({ folderId, fileBlob, fileName, appProperties, accessToken }) {
  const meta = {
    name: fileName,
    parents: [folderId],
    appProperties,
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', fileBlob);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: new Headers({ Authorization: `Bearer ${accessToken}` }),
    body: form,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function updateResultFile({ fileId, name, appProperties, parentId, currentParentId, accessToken }) {
  const resource = { name, appProperties };
  const params = { fileId, resource };
  if (parentId && currentParentId && parentId !== currentParentId) {
    params.addParents = parentId;
    params.removeParents = currentParentId;
  }
  const response = await gapi.client.drive.files.update(params);
  return response.result;
}

export async function deleteDriveFile(fileId) {
  return gapi.client.drive.files.delete({ fileId });
}

export function escapeQuery(value) {
  return String(value).replace(/'/g, "\\'");
}

export function parseScoreFromName(fileName) {
  const match = String(fileName).match(/^FC(?:-(\d+))?/i);
  if (!match) return null;
  return match[1] === undefined ? 0 : parseInt(match[1], 10);
}

function parseIntSafe(value, fallback) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

export function buildSongGroupKey(title, difficultyRaw) {
  return `${String(title || '').toLowerCase()}__${normalizeDifficultyCode(difficultyRaw)}`;
}

export function compareRecordsForBest(a, b) {
  const aMiss = numberOrInf(a?.missCount);
  const bMiss = numberOrInf(b?.missCount);
  if (aMiss !== bMiss) return aMiss - bMiss;

  const aCombo = numberOrNegInf(a?.combo);
  const bCombo = numberOrNegInf(b?.combo);
  if (aCombo !== bCombo) return bCombo - aCombo;

  const aPerfect = numberOrNegInf(a?.perfect);
  const bPerfect = numberOrNegInf(b?.perfect);
  if (aPerfect !== bPerfect) return bPerfect - aPerfect;

  const aGreat = numberOrInf(a?.great);
  const bGreat = numberOrInf(b?.great);
  if (aGreat !== bGreat) return aGreat - bGreat;

  const aTime = Date.parse(a?.createdTime || '') || 0;
  const bTime = Date.parse(b?.createdTime || '') || 0;
  return bTime - aTime;
}

function numberOrInf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function numberOrNegInf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}
