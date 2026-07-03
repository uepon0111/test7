// js/drive.js

import {
  CLIENT_ID, API_KEY, DISCOVERY_DOC, SCOPES,
  DRIVE_ROOT_NAME, DRIVE_IMG_FOLDER, DRIVE_META_FILE,
} from './constants.js';

let _gapiReady = false;
let _gisReady  = false;
let _tokenClient = null;
let _rootId  = null;
let _imgId   = null;
let _metaId  = null;

export const Drive = {
  authorized: false,

  // ---- 初期化 ----
  async waitReady() {
    return new Promise(res => {
      const check = () => (_gapiReady && _gisReady) ? res() : setTimeout(check, 80);
      check();
    });
  },

  onGapiLoad() {
    window.gapi.load('client', async () => {
      await window.gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
      _gapiReady = true;
    });
  },

  onGisLoad() {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES, callback: '',
    });
    _gisReady = true;
  },

  // ---- 認証 ----
  authorize() {
    return new Promise(async (res, rej) => {
      await this.waitReady();
      _tokenClient.callback = r => {
        if (r.error) { rej(new Error(r.error)); return; }
        this.authorized = true;
        res();
      };
      const token = window.gapi.client.getToken();
      _tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
    });
  },

  signOut() {
    const t = window.gapi.client.getToken();
    if (t) {
      window.google.accounts.oauth2.revoke(t.access_token);
      window.gapi.client.setToken('');
    }
    this.authorized = false;
    _rootId = _imgId = _metaId = null;
  },

  // ---- フォルダ管理 ----
  async _findFolder(name, parentId) {
    let q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;
    const r = await window.gapi.client.drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
    return r.result.files?.[0]?.id || null;
  },

  async _mkFolder(name, parentId) {
    const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) meta.parents = [parentId];
    const r = await window.gapi.client.drive.files.create({ resource: meta, fields: 'id' });
    return r.result.id;
  },

  async _ensureFolders() {
    if (_rootId && _imgId) return;
    _rootId = (await this._findFolder(DRIVE_ROOT_NAME, null)) ||
              (await this._mkFolder(DRIVE_ROOT_NAME, null));
    _imgId  = (await this._findFolder(DRIVE_IMG_FOLDER, _rootId)) ||
              (await this._mkFolder(DRIVE_IMG_FOLDER, _rootId));
  },

  // ---- 画像アップロード ----
  async uploadImage(blob, recordId) {
    await this._ensureFolders();
    const token = window.gapi.client.getToken().access_token;
    const jpeg  = await this._toJpeg(blob);
    const meta  = { name: `${recordId}.jpg`, parents: [_imgId] };
    const form  = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', jpeg);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!r.ok) throw new Error('Drive upload failed: ' + r.statusText);
    return (await r.json()).id;
  },

  async deleteFile(fileId) {
    if (!fileId || !this.authorized) return;
    try {
      await window.gapi.client.drive.files.delete({ fileId });
    } catch (e) {
      console.warn('[Drive] delete failed:', e);
    }
  },

  // ---- メタデータJSON管理 ----
  async saveMetadata(records, trashItems) {
    if (!this.authorized) return;
    await this._ensureFolders();
    const token = window.gapi.client.getToken().access_token;
    const strip = r => { const { thumbBlob, ...rest } = r; return rest; };
    const body  = JSON.stringify({
      version: 2, savedAt: new Date().toISOString(),
      records:  (records   || []).map(strip),
      trash:    (trashItems|| []).map(strip),
    });
    const blob  = new Blob([body], { type: 'application/json' });

    if (_metaId) {
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${_metaId}?uploadType=media`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: blob,
      });
    } else {
      const meta = { name: DRIVE_META_FILE, parents: [_rootId] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      form.append('file', blob);
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      _metaId = (await r.json()).id;
    }
  },

  async loadMetadata() {
    if (!this.authorized) return null;
    await this._ensureFolders();
    const q = `name='${DRIVE_META_FILE}' and '${_rootId}' in parents and trashed=false`;
    const list = await window.gapi.client.drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
    const file = list.result.files?.[0];
    if (!file) return null;
    _metaId = file.id;
    const r = await window.gapi.client.drive.files.get({ fileId: file.id, alt: 'media' });
    try {
      const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.result);
      return JSON.parse(text);
    } catch { return null; }
  },

  /** Drive上の画像サムネイルURL */
  getThumbUrl(driveFileId, size = 400) {
    return `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w${size}`;
  },

  async _toJpeg(blob) {
    if (blob.type === 'image/jpeg') return blob;
    return new Promise(res => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        c.toBlob(res, 'image/jpeg', 0.9);
      };
      img.src = url;
    });
  },
};
