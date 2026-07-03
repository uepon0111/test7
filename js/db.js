// js/db.js

import { generateId, computeMissFields } from './utils.js';
import { TRASH_EXPIRY_DAYS } from './constants.js';

const DB_NAME    = 'prsk-result-viewer-v2';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror   = () => reject(req.error);
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onupgradeneeded = e => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('musicId',    'musicId',    { unique: false });
        s.createIndex('difficulty', 'difficulty', { unique: false });
        s.createIndex('level',      'level',      { unique: false });
        s.createIndex('addedAt',    'addedAt',    { unique: false });
      }
      if (!db.objectStoreNames.contains('trash')) {
        const t = db.createObjectStore('trash', { keyPath: 'id' });
        t.createIndex('deletedAt', 'deletedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('deviceProfiles')) {
        db.createObjectStore('deviceProfiles', { keyPath: 'id' });
      }
    };
  });
}

function req2p(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

export const DB = {
  // ====== Records ======
  async getAllRecords() {
    const db = await openDB();
    return req2p(db.transaction('records','readonly').objectStore('records').getAll()) || [];
  },

  async getRecord(id) {
    const db = await openDB();
    return req2p(db.transaction('records','readonly').objectStore('records').get(id)) || null;
  },

  async addRecord(data) {
    const db = await openDB();
    const id  = data.id || generateId();
    const now = new Date().toISOString();
    const rec = computeMissFields({ ...data, id, addedAt: data.addedAt || now, updatedAt: now });
    await req2p(db.transaction('records','readwrite').objectStore('records').add(rec));
    return rec;
  },

  async updateRecord(id, patch) {
    const db  = await openDB();
    const old = await this.getRecord(id);
    if (!old) throw new Error('Record not found: ' + id);
    const now = new Date().toISOString();
    const rec = computeMissFields({ ...old, ...patch, id, updatedAt: now });
    await req2p(db.transaction('records','readwrite').objectStore('records').put(rec));
    return rec;
  },

  async moveToTrash(id) {
    const db  = await openDB();
    const rec = await this.getRecord(id);
    if (!rec) throw new Error('Record not found: ' + id);
    const trashed = { ...rec, deletedAt: new Date().toISOString() };
    // サムネイルをゴミ箱に持ち込まない（容量節約）
    delete trashed.thumbBlob;
    return new Promise((res, rej) => {
      const tx = db.transaction(['records','trash'],'readwrite');
      tx.onerror = () => rej(tx.error);
      tx.oncomplete = () => res(rec);
      tx.objectStore('trash').add(trashed);
      tx.objectStore('records').delete(id);
    });
  },

  // ====== Trash ======
  async getTrashItems() {
    const db = await openDB();
    return req2p(db.transaction('trash','readonly').objectStore('trash').getAll()) || [];
  },

  async getTrashItem(id) {
    const db = await openDB();
    return req2p(db.transaction('trash','readonly').objectStore('trash').get(id)) || null;
  },

  async restoreFromTrash(id) {
    const db   = await openDB();
    const item = await this.getTrashItem(id);
    if (!item) throw new Error('Trash item not found: ' + id);
    const { deletedAt, ...rec } = item;
    rec.updatedAt = new Date().toISOString();
    return new Promise((res, rej) => {
      const tx = db.transaction(['records','trash'],'readwrite');
      tx.onerror = () => rej(tx.error);
      tx.oncomplete = () => res(rec);
      tx.objectStore('records').add(rec);
      tx.objectStore('trash').delete(id);
    });
  },

  async permanentDeleteFromTrash(id) {
    const db   = await openDB();
    const item = await this.getTrashItem(id);
    if (!item) return null;
    await req2p(db.transaction('trash','readwrite').objectStore('trash').delete(id));
    return item;
  },

  /** 3日超のゴミ箱アイテムを自動削除し、Drive削除が必要なものを返す */
  async purgeExpiredTrash() {
    const items   = await this.getTrashItems();
    const limitMs = TRASH_EXPIRY_DAYS * 86400000;
    const expired = items.filter(i => Date.now() - new Date(i.deletedAt).getTime() > limitMs);
    const purged  = [];
    for (const i of expired) {
      const d = await this.permanentDeleteFromTrash(i.id);
      if (d) purged.push(d);
    }
    return purged;
  },

  // ====== Settings ======
  async getSetting(key) {
    const db = await openDB();
    const r  = await req2p(db.transaction('settings','readonly').objectStore('settings').get(key));
    return r ? r.value : null;
  },

  async setSetting(key, value) {
    const db = await openDB();
    await req2p(db.transaction('settings','readwrite').objectStore('settings').put({ key, value }));
  },

  // ====== Device Profiles ======
  async getDeviceProfiles() {
    const db = await openDB();
    return req2p(db.transaction('deviceProfiles','readonly').objectStore('deviceProfiles').getAll()) || [];
  },

  async saveDeviceProfile(profile) {
    const db = await openDB();
    const id = profile.id || generateId();
    const p  = { ...profile, id };
    await req2p(db.transaction('deviceProfiles','readwrite').objectStore('deviceProfiles').put(p));
    return id;
  },

  async deleteDeviceProfile(id) {
    const db = await openDB();
    await req2p(db.transaction('deviceProfiles','readwrite').objectStore('deviceProfiles').delete(id));
  },

  // ====== Export / Import ======
  async exportAll() {
    const [records, trash, profiles] = await Promise.all([
      this.getAllRecords(),
      this.getTrashItems(),
      this.getDeviceProfiles(),
    ]);
    // thumbBlobはエクスポートしない
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      records:  records.map(({ thumbBlob, ...r }) => r),
      trash:    trash.map(({ thumbBlob, ...r }) => r),
      deviceProfiles: profiles,
    };
  },

  async importAll(data) {
    if (!data || data.version !== 2) throw new Error('不正なデータ形式です');
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(['records','trash','deviceProfiles'],'readwrite');
      tx.onerror = () => rej(tx.error);
      tx.oncomplete = () => res();
      const rs = tx.objectStore('records');
      const ts = tx.objectStore('trash');
      const ps = tx.objectStore('deviceProfiles');
      (data.records || []).forEach(r => rs.put(computeMissFields(r)));
      (data.trash   || []).forEach(r => ts.put(r));
      (data.deviceProfiles || []).forEach(p => ps.put(p));
    });
  },
};
