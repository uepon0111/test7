
import { DEVICE_CONTAINER_NAME, DRIVE_SCHEMA, ROOT_FOLDER_NAME } from './config.js';

const folderCache = new Map();

function normalizeName(name) {
  return String(name || '').replace(/'/g, "\\'");
}

async function listAll(query, fields) {
  const items = [];
  let pageToken = null;
  do {
    const resp = await gapi.client.drive.files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken,
    });
    if (resp.result.files) items.push(...resp.result.files);
    pageToken = resp.result.nextPageToken || null;
  } while (pageToken);
  return items;
}

export async function findFolderByName(name, parentId = null) {
  const cacheKey = `${parentId || 'root'}::${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);

  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${normalizeName(name)}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const resp = await gapi.client.drive.files.list({ q: query, fields: 'files(id, name)', pageSize: 1 });
  const folder = resp.result.files?.[0] || null;
  folderCache.set(cacheKey, folder);
  return folder;
}

export async function ensureFolder(name, parentId = null) {
  const existing = await findFolderByName(name, parentId);
  if (existing) return existing;
  const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) metadata.parents = [parentId];
  const resp = await gapi.client.drive.files.create({ resource: metadata, fields: 'id, name' });
  const folder = resp.result;
  folderCache.set(`${parentId || 'root'}::${name}`, folder);
  return folder;
}

export function makeResultFileName(meta) {
  const date = (meta.createdAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
  const parts = [
    date,
    meta.title || '無題',
    meta.level ? `Lv${meta.level}` : '',
    meta.difficultyKey ? meta.difficultyKey.toUpperCase() : '',
    `M${meta.totalMiss ?? meta.miss ?? 0}`,
    `P${meta.perfect ?? 0}`,
    `G${meta.great ?? 0}`,
    `C${meta.combo ?? 0}`,
  ].filter(Boolean);
  return `${parts.join(' __ ')}.png`;
}

function buildAppProperties(meta) {
  const props = {
    schema: DRIVE_SCHEMA,
    deviceId: meta.deviceId || '',
    deviceName: meta.deviceName || '',
    title: meta.title || '',
    level: String(meta.level ?? ''),
    difficulty: meta.difficultyKey || '',
    perfect: String(meta.perfect ?? 0),
    great: String(meta.great ?? 0),
    good: String(meta.good ?? 0),
    bad: String(meta.bad ?? 0),
    miss: String(meta.miss ?? 0),
    combo: String(meta.combo ?? 0),
    totalMiss: String(meta.totalMiss ?? meta.miss ?? 0),
    musicId: meta.musicId || '',
    bestKey: meta.bestKey || '',
    createdAt: meta.createdAt || new Date().toISOString(),
  };
  return props;
}

async function uploadMultipart(token, metadata, fileBlob) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', fileBlob);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,appProperties,createdTime,thumbnailLink', {
    method: 'POST',
    headers: new Headers({ Authorization: `Bearer ${token}` }),
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${res.status} ${txt}`);
  }
  return await res.json();
}

export async function updateFileMetadata(fileId, meta) {
  const resource = {
    name: makeResultFileName(meta),
    appProperties: buildAppProperties(meta),
    description: JSON.stringify({
      schema: DRIVE_SCHEMA,
      title: meta.title || '',
      difficulty: meta.difficultyKey || '',
      totalMiss: meta.totalMiss ?? meta.miss ?? 0,
      perfect: meta.perfect ?? 0,
      great: meta.great ?? 0,
      good: meta.good ?? 0,
      bad: meta.bad ?? 0,
      miss: meta.miss ?? 0,
      combo: meta.combo ?? 0,
    }),
  };
  const resp = await gapi.client.drive.files.update({
    fileId,
    resource,
    fields: 'id, name, parents, appProperties, createdTime, thumbnailLink',
  });
  return resp.result;
}

export async function deleteDriveFile(fileId) {
  await gapi.client.drive.files.delete({ fileId });
}

export async function ensureUploadFolder(profile) {
  const root = await ensureFolder(ROOT_FOLDER_NAME, null);
  const devices = await ensureFolder(DEVICE_CONTAINER_NAME, root.id);
  const folderName = `${profile.name}__${profile.id}`;
  const deviceFolder = await ensureFolder(folderName, devices.id);
  return { root, devices, deviceFolder };
}

export async function uploadResultFile(token, profile, meta, fileBlob) {
  const { deviceFolder } = await ensureUploadFolder(profile);
  const resource = {
    name: makeResultFileName(meta),
    parents: [deviceFolder.id],
    appProperties: buildAppProperties(meta),
    description: JSON.stringify({
      schema: DRIVE_SCHEMA,
      title: meta.title || '',
      difficulty: meta.difficultyKey || '',
      totalMiss: meta.totalMiss ?? meta.miss ?? 0,
      perfect: meta.perfect ?? 0,
      great: meta.great ?? 0,
      good: meta.good ?? 0,
      bad: meta.bad ?? 0,
      miss: meta.miss ?? 0,
      combo: meta.combo ?? 0,
      deviceId: profile.id,
      deviceName: profile.name,
    }),
  };
  return await uploadMultipart(token, resource, fileBlob);
}

export function parseV2File(file) {
  const p = file.appProperties || {};
  const num = (v) => v === '' || v == null ? 0 : Number(v) || 0;
  const title = p.title || file.name || '';
  const diff = (p.difficulty || '').toLowerCase();
  const miss = num(p.totalMiss ?? p.miss);
  const perfect = num(p.perfect);
  const great = num(p.great);
  const good = num(p.good);
  const bad = num(p.bad);
  const combo = num(p.combo);
  return {
    id: file.id,
    parentId: file.parents?.[0] || null,
    createdTime: file.createdTime || p.createdAt || null,
    addedAt: file.createdTime || p.createdAt || null,
    title,
    level: p.level ? Number(p.level) : null,
    difficultyKey: diff || 'expert',
    difficultyLabel: (diff || 'expert').toUpperCase(),
    missCount: miss,
    totalMiss: miss,
    perfect,
    great,
    good,
    bad,
    combo,
    isFC: miss === 0,
    thumbnail: file.thumbnailLink || null,
    deviceId: p.deviceId || '',
    deviceName: p.deviceName || '',
    musicId: p.musicId || '',
    bestKey: p.bestKey || '',
    schema: 'v2',
    source: 'drive-v2',
    fileName: file.name || '',
  };
}

function parseOldFolderTitle(folderName) {
  const m = String(folderName || '').match(/^(\d+)([ENHXMA])\s+(.+)$/i);
  if (!m) return null;
  const code = m[2].toUpperCase();
  const diffMap = { E: 'easy', N: 'normal', H: 'hard', X: 'expert', M: 'master', A: 'append' };
  const key = diffMap[code];
  return {
    level: Number(m[1]),
    difficultyKey: key,
    difficultyLabel: key ? key.toUpperCase() : code,
    title: m[3],
  };
}

function parseOldScore(fileName) {
  const m = String(fileName || '').match(/^FC(?:-(\d+))?/i);
  if (!m) return null;
  return m[1] ? Number(m[1]) : 0;
}

export async function loadRecordsFromDrive() {
  const root = await findFolderByName(ROOT_FOLDER_NAME);
  if (!root) return [];

  const records = [];
  const deviceContainer = await findFolderByName(DEVICE_CONTAINER_NAME, root.id);
  if (deviceContainer) {
    const deviceFolders = await listAll(`'${deviceContainer.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, 'id, name');
    const fileLists = await Promise.all(deviceFolders.map(async (folder) => {
      const files = await listAll(`'${folder.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`, 'id, name, parents, createdTime, thumbnailLink, appProperties, description');
      return files.map((file) => {
        const parsed = parseV2File(file);
        parsed.deviceFolderId = folder.id;
        parsed.deviceFolderName = folder.name;
        return parsed;
      });
    }));
    records.push(...fileLists.flat());
  }

  const legacyFC = await findFolderByName('FC', root.id);
  if (legacyFC) {
    const songFolders = await listAll(`'${legacyFC.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, 'id, name');
    const songFolderMap = new Map();
    for (const folder of songFolders) {
      const meta = parseOldFolderTitle(folder.name);
      if (meta) songFolderMap.set(folder.id, { ...meta, folderId: folder.id });
    }
    const files = await listAll(`name contains 'FC' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`, 'id, name, parents, thumbnailLink, createdTime');
    for (const file of files) {
      if (!file.parents?.length) continue;
      const parentId = file.parents.find((p) => songFolderMap.has(p));
      if (!parentId) continue;
      const song = songFolderMap.get(parentId);
      const missCount = parseOldScore(file.name);
      if (missCount == null) continue;
      records.push({
        id: file.id,
        parentId,
        createdTime: file.createdTime || null,
        addedAt: file.createdTime || null,
        title: song.title,
        level: song.level,
        difficultyKey: song.difficultyKey,
        difficultyLabel: song.difficultyLabel,
        missCount,
        totalMiss: missCount,
        perfect: null,
        great: null,
        good: null,
        bad: null,
        combo: null,
        isFC: missCount === 0,
        thumbnail: file.thumbnailLink || null,
        deviceId: '',
        deviceName: 'legacy',
        schema: 'legacy',
        source: 'drive-legacy',
        fileName: file.name || '',
      });
    }
  }

  return records.sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
}

export async function listDriveFiles(query, fields) {
  return await listAll(query, fields);
}
