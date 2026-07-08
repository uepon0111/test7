
(() => {
  const { config, util } = window.PRSK;
  const { clone, saveManifestCache, loadManifestCache } = window.PRSK.storage;

  const DISCOVERY_DOC = config.DISCOVERY_DOC;
  const SCOPES = config.SCOPES;

  let tokenClient = null;
  let gapiInited = false;
  let gisInited = false;

  async function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
  }

  async function initializeGapiClient() {
    await gapi.client.init({
      apiKey: config.API_KEY,
      discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;
    maybeReady();
  }

  function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: config.CLIENT_ID,
      scope: SCOPES,
      callback: '',
    });
    gisInited = true;
    maybeReady();
  }

  function maybeReady() {
    if (gapiInited && gisInited && window.PRSK?.app?.onApisReady) {
      window.PRSK.app.onApisReady();
    }
  }

  function handleAuthClick() {
    tokenClient.callback = async (resp) => {
      if (resp.error !== undefined) throw resp;
      await window.PRSK.app.onAuthChanged(true);
    };
    if (gapi.client.getToken() === null) tokenClient.requestAccessToken({ prompt: 'consent' });
    else tokenClient.requestAccessToken({ prompt: '' });
  }

  function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
      google.accounts.oauth2.revoke(token.access_token);
      gapi.client.setToken('');
    }
    window.PRSK.app.onAuthChanged(false);
  }

  async function authHeaders() {
    const token = gapi.client.getToken();
    if (!token?.access_token) throw new Error('Not authenticated');
    return { Authorization: `Bearer ${token.access_token}` };
  }

  async function driveFetch(url, opts = {}) {
    const headers = new Headers(await authHeaders());
    if (opts.headers) {
      const extra = new Headers(opts.headers);
      extra.forEach((v, k) => headers.set(k, v));
    }
    const res = await fetch(url, { ...opts, headers });
    return res;
  }

  async function listDriveFiles(query, fields = 'id,name') {
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

  async function getFolderByName(name, parentId) {
    const q = [
      `mimeType = 'application/vnd.google-apps.folder'`,
      `name = '${String(name).replace(/'/g, "\\'")}'`,
      parentId ? `'${parentId}' in parents` : null,
      'trashed = false',
    ].filter(Boolean).join(' and ');
    const res = await listDriveFiles(q, 'id,name,parents');
    return res[0] || null;
  }

  async function findOrCreateFolder(name, parentId = null) {
    const existing = await getFolderByName(name, parentId);
    if (existing) return existing;
    const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) metadata.parents = [parentId];
    const response = await gapi.client.drive.files.create({
      resource: metadata,
      fields: 'id,name,parents'
    });
    return response.result;
  }

  async function findFileByName(name, parentId = null) {
    const q = [
      `name = '${String(name).replace(/'/g, "\\'")}'`,
      parentId ? `'${parentId}' in parents` : null,
      'trashed = false',
    ].filter(Boolean).join(' and ');
    const files = await listDriveFiles(q, 'id,name,parents,mimeType');
    return files[0] || null;
  }

  async function getFileText(fileId) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (!res.ok) throw new Error(`Failed to read file: ${res.status}`);
    return await res.text();
  }

  async function uploadJsonFile(folderId, name, json) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({
      name,
      mimeType: 'application/json',
      parents: folderId ? [folderId] : undefined
    })], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), name);

    const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      body: form
    });
    if (!res.ok) throw new Error(`Manifest create failed: ${res.status}`);
    return await res.json();
  }

  async function updateJsonFile(fileId, json) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ mimeType: 'application/json' })], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), 'manifest.json');

    const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
      method: 'PATCH',
      body: form
    });
    if (!res.ok) throw new Error(`Manifest update failed: ${res.status}`);
    return await res.json();
  }

  async function updateFileName(fileId, newName) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    if (!res.ok) throw new Error(`Rename failed: ${res.status}`);
    return await res.json();
  }

  async function deleteFile(fileId) {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE'
    });
    if (!res.ok && res.status !== 204) throw new Error(`Delete failed: ${res.status}`);
  }

  async function createImageFile(folderId, name, file) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({
      name,
      parents: folderId ? [folderId] : undefined
    })], { type: 'application/json' }));
    form.append('file', file, file.name || name);

    const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      body: form
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return await res.json();
  }

  async function uploadOrReplaceManifest(records) {
    const appState = window.PRSK.app.state;
    const root = await findOrCreateFolder(config.ROOT_FOLDER);
    const manifest = await findFileByName(config.MANIFEST_FILE, root.id);
    const payload = records.map(r => ({
      id: r.id,
      fileId: r.fileId || r.id,
      title: r.title,
      level: r.level,
      difficultyRaw: r.difficultyRaw,
      perfect: Number(r.perfect || 0),
      great: Number(r.great || 0),
      missCount: Number(r.missCount ?? r.totalMiss ?? 0),
      totalMiss: Number(r.totalMiss ?? r.missCount ?? 0),
      combo: Number(r.combo || 0),
      deviceKey: r.deviceKey || 'default',
      thumbnail: r.thumbnail || '',
      addedAt: r.addedAt || Date.now(),
      source: r.source || 'new'
    }));
    saveManifestCache(payload);
    if (!manifest) {
      await uploadJsonFile(root.id, config.MANIFEST_FILE, payload);
      return;
    }
    await updateJsonFile(manifest.id, payload);
  }

  async function loadManifestRecords() {
    const root = await getFolderByName(config.ROOT_FOLDER, null);
    if (!root) return null;
    const manifest = await findFileByName(config.MANIFEST_FILE, root.id);
    if (!manifest) return null;
    const text = await getFileText(manifest.id);
    const parsed = JSON.parse(text || '[]');
    if (Array.isArray(parsed)) {
      saveManifestCache(parsed);
      return parsed;
    }
    if (parsed && Array.isArray(parsed.records)) {
      saveManifestCache(parsed.records);
      return parsed.records;
    }
    return null;
  }

  async function loadLegacyRecords() {
    const legacyRoot = await getFolderByName('プロセカリザルト', null);
    if (!legacyRoot) return null;
    const fcFolder = await getFolderByName('FC', legacyRoot.id);
    if (!fcFolder) return null;

    const folderQuery = `'${fcFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const songFolders = await listDriveFiles(folderQuery, 'id,name,parents,createdTime');
    if (!songFolders.length) return [];
    const folderMap = new Map();
    songFolders.forEach(folder => {
      const meta = util.parseLegacyFolderTitle(folder.name);
      if (meta) folderMap.set(folder.id, { ...meta, folderId: folder.id });
    });

    const fileQuery = `name contains 'FC' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
    const candidateFiles = await listDriveFiles(fileQuery, 'id,name,parents,thumbnailLink,createdTime');
    const records = [];
    candidateFiles.forEach(file => {
      if (!file.parents || !file.parents.length) return;
      const parentId = file.parents.find(p => folderMap.has(p));
      if (!parentId) return;
      const song = folderMap.get(parentId);
      const miss = Number((String(file.name).match(/^FC(?:-(\d+))?/) || [])[1] || 0);
      records.push({
        id: file.id,
        fileId: file.id,
        title: song.title,
        level: song.level,
        difficultyRaw: song.difficultyRaw,
        perfect: 0,
        great: 0,
        missCount: miss,
        totalMiss: miss,
        combo: 0,
        deviceKey: 'legacy',
        thumbnail: file.thumbnailLink || '',
        addedAt: file.createdTime || Date.now(),
        source: 'legacy',
        isFC: miss === 0
      });
    });
    return records;
  }

  async function loadRecords() {
    let records = await loadManifestRecords();
    if (records && records.length) {
      return records.map(r => ({
        ...r,
        fileId: r.fileId || r.id,
        missCount: Number(r.missCount ?? r.totalMiss ?? 0),
        totalMiss: Number(r.totalMiss ?? r.missCount ?? 0),
        perfect: Number(r.perfect || 0),
        great: Number(r.great || 0),
        combo: Number(r.combo || 0),
        deviceKey: r.deviceKey || 'default',
        isFC: Number(r.missCount ?? r.totalMiss ?? 0) === 0,
      }));
    }

    records = await loadLegacyRecords();
    if (records && records.length) {
      await uploadOrReplaceManifest(records);
      return records;
    }
    return [];
  }

  async function ensureNewRoot() {
    const root = await findOrCreateFolder(config.ROOT_FOLDER);
    await findOrCreateFolder(config.RESULTS_FOLDER, root.id);
    return root;
  }

  async function saveRecordFile(item, file) {
    const root = await ensureNewRoot();
    const resultsFolder = await findOrCreateFolder(config.RESULTS_FOLDER, root.id);
    const fileName = `${util.buildDriveFileName(item)}.png`;
    const created = await createImageFile(resultsFolder.id, fileName, file);
    return { ...created, name: fileName };
  }

  async function syncManifest(records) {
    const root = await ensureNewRoot();
    const manifest = await findFileByName(config.MANIFEST_FILE, root.id);
    const payload = records.map(r => ({
      id: r.id,
      fileId: r.fileId || r.id,
      title: r.title,
      level: r.level,
      difficultyRaw: r.difficultyRaw,
      perfect: Number(r.perfect || 0),
      great: Number(r.great || 0),
      missCount: Number(r.missCount ?? r.totalMiss ?? 0),
      totalMiss: Number(r.totalMiss ?? r.missCount ?? 0),
      combo: Number(r.combo || 0),
      deviceKey: r.deviceKey || 'default',
      thumbnail: r.thumbnail || '',
      addedAt: r.addedAt || Date.now(),
      source: r.source || 'new'
    }));
    saveManifestCache(payload);
    if (!manifest) {
      await uploadJsonFile(root.id, config.MANIFEST_FILE, payload);
    } else {
      await updateJsonFile(manifest.id, payload);
    }
  }

  async function refreshThumbnail(fileId) {
    try {
      const res = await gapi.client.drive.files.get({
        fileId,
        fields: 'thumbnailLink'
      });
      return res.result?.thumbnailLink || '';
    } catch {
      return '';
    }
  }

  window.PRSK.drive = {
    gapiLoaded,
    gisLoaded,
    handleAuthClick,
    handleSignoutClick,
    listDriveFiles,
    getFolderByName,
    findOrCreateFolder,
    findFileByName,
    getFileText,
    uploadJsonFile,
    updateJsonFile,
    updateFileName,
    deleteFile,
    createImageFile,
    uploadOrReplaceManifest,
    loadManifestRecords,
    loadLegacyRecords,
    loadRecords,
    saveRecordFile,
    syncManifest,
    refreshThumbnail,
    maybeReady,
  };
})();
