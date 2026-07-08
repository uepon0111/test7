
import { ROOT_FOLDER_NAME, FC_FOLDER_NAME, API_KEY, CLIENT_ID, DISCOVERY_DOC, SCOPES } from './config.js';

const folderCache = new Map();

function cacheKey(name, parentId) {
  return `${parentId || 'root'}::${name}`;
}

function requireGapi() {
  if (!window.gapi) throw new Error('Google API client is not loaded');
  return window.gapi;
}

function getToken() {
  return requireGapi().client.getToken?.()?.access_token || null;
}

export async function initDriveClient() {
  const gapi = requireGapi();
  await gapi.client.init({
    apiKey: API_KEY,
    discoveryDocs: [DISCOVERY_DOC],
  });
}

export function createTokenClient(callback) {
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services is not loaded');
  }
  return window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback,
  });
}

export function revokeCurrentToken() {
  const gapi = requireGapi();
  const token = gapi.client.getToken?.();
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
  }
}

export async function fetchAllDriveItems(query, fields, onProgress) {
  const gapi = requireGapi();
  const items = [];
  let pageToken = null;
  do {
    const res = await gapi.client.drive.files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken,
    });
    const files = res.result.files || [];
    items.push(...files);
    pageToken = res.result.nextPageToken || null;
    if (onProgress) onProgress(items.length);
  } while (pageToken);
  return items;
}

export async function getFolderByName(name, parentId = null) {
  const key = cacheKey(name, parentId);
  if (folderCache.has(key)) return folderCache.get(key);

  const queryParts = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
  ];
  if (parentId) queryParts.unshift(`'${parentId}' in parents`);
  const query = queryParts.join(' and ');

  const gapi = requireGapi();
  const res = await gapi.client.drive.files.list({
    q: query,
    fields: 'files(id,name,parents,createdTime,modifiedTime)',
    pageSize: 10,
  });
  const folder = res.result.files?.[0] || null;
  folderCache.set(key, folder);
  return folder;
}

export async function findOrCreateFolder(name, parentId = null) {
  const existing = await getFolderByName(name, parentId);
  if (existing) return existing;

  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) metadata.parents = [parentId];

  const gapi = requireGapi();
  const res = await gapi.client.drive.files.create({
    resource: metadata,
    fields: 'id,name,parents,createdTime,modifiedTime',
  });
  const folder = res.result;
  folderCache.set(cacheKey(name, parentId), folder);
  return folder;
}

export async function downloadFileBlob(fileId) {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return await res.blob();
}

export async function uploadFileToDrive({ blob, filename, parentId, appProperties }) {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const metadata = {
    name: filename,
    parents: [parentId],
  };
  if (appProperties) metadata.appProperties = appProperties;

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob, filename);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,appProperties,createdTime,modifiedTime,thumbnailLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return await res.json();
}

export async function updateFileOnDrive(fileId, { name, addParentId = null, removeParentId = null, appProperties = null }) {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const qs = new URLSearchParams({
    fields: 'id,name,parents,appProperties,createdTime,modifiedTime,thumbnailLink',
  });
  if (addParentId) qs.set('addParents', addParentId);
  if (removeParentId) qs.set('removeParents', removeParentId);

  const body = {};
  if (name !== undefined && name !== null) body.name = name;
  if (appProperties) body.appProperties = appProperties;

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${qs.toString()}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`update failed: ${res.status}`);
  return await res.json();
}

export async function deleteFileOnDrive(fileId) {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`delete failed: ${res.status}`);
}

export async function loadProjectRootFolders() {
  const root = await getFolderByName(ROOT_FOLDER_NAME);
  if (!root) return { root: null, fc: null, songFolders: [], folderMap: new Map() };
  const fc = await getFolderByName(FC_FOLDER_NAME, root.id);
  if (!fc) return { root, fc: null, songFolders: [], folderMap: new Map() };
  const songFolders = await fetchAllDriveItems(
    `'${fc.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    'id,name,parents,createdTime,modifiedTime'
  );
  return { root, fc, songFolders, folderMap: new Map() };
}
