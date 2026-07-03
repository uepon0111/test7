// js/settings.js
// 6.6: 機種登録・OCR範囲設定、Drive設定、データ管理

import { DB } from './db.js';
import { Drive } from './drive.js';
import { Notifications } from './notifications.js';
import { ZoneCalibrator } from './zone-calibrator.js';
import { openModal, closeModal } from './modals.js';
import { DEFAULT_OCR_ZONES } from './constants.js';
import { generateId, escapeHtml } from './utils.js';

let _profiles      = [];
let _activeId      = null;
let _calibrator    = null;
let _editProfileId = null;

export const Settings = {
  async init() {
    _profiles = await DB.getDeviceProfiles();
    _activeId = await DB.getSetting('activeProfileId');

    // 設定モーダル
    document.getElementById('btn-export').addEventListener('click', _exportData);
    document.getElementById('btn-import').addEventListener('click', () =>
      document.getElementById('import-file-input').click());
    document.getElementById('import-file-input').addEventListener('change', _importData);
    document.getElementById('btn-add-profile').addEventListener('click', _openCalibratorNew);

    // ゾーンキャリブレーターモーダル
    document.getElementById('calib-file-input').addEventListener('change', _calibLoadImage);
    document.getElementById('calib-upload-area').addEventListener('click', () =>
      document.getElementById('calib-file-input').click());
    document.getElementById('calib-upload-area').addEventListener('dragover', e => {
      e.preventDefault(); document.getElementById('calib-upload-area').classList.add('dz-over');
    });
    document.getElementById('calib-upload-area').addEventListener('dragleave', () =>
      document.getElementById('calib-upload-area').classList.remove('dz-over'));
    document.getElementById('calib-upload-area').addEventListener('drop', e => {
      e.preventDefault();
      document.getElementById('calib-upload-area').classList.remove('dz-over');
      if (e.dataTransfer.files[0]) _calibLoadFileObj(e.dataTransfer.files[0]);
    });

    document.querySelectorAll('[data-zone-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-zone-key]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (_calibrator) _calibrator.setActiveZone(btn.dataset.zoneKey);
      });
    });

    document.getElementById('btn-calib-reset-all').addEventListener('click', () => {
      if (_calibrator) _calibrator.resetAll();
    });

    document.getElementById('btn-calib-save').addEventListener('click', _saveProfile);
    window.addEventListener('resize', () => { if (_calibrator) _calibrator.resize(); });
  },

  open() {
    _renderProfileList();
    _renderDriveSection();
    openModal('settings');
  },

  getActiveProfile() {
    if (!_activeId) return null;
    return _profiles.find(p => p.id === _activeId) || null;
  },
};

// ---- Drive設定 ----
function _renderDriveSection() {
  const el = document.getElementById('drive-settings-body');
  if (Drive.authorized) {
    el.innerHTML = `
      <div class="settings-row">
        <span class="material-symbols-outlined" style="color:var(--success)">cloud_done</span>
        <span>Google Driveに接続中</span>
        <button id="btn-drive-disconnect" class="btn-sm btn-ghost danger-text">切断</button>
      </div>`;
    document.getElementById('btn-drive-disconnect').addEventListener('click', () => {
      Drive.signOut();
      _renderDriveSection();
      // ヘッダーのDrive状態も更新
      document.dispatchEvent(new CustomEvent('drive-changed', { detail: { authorized: false } }));
      Notifications.info('Driveから切断しました');
    });
  } else {
    el.innerHTML = `
      <div class="settings-row">
        <span class="material-symbols-outlined" style="color:var(--text-muted)">cloud_off</span>
        <span>未接続</span>
        <button id="btn-drive-connect2" class="btn-sm btn-primary">接続</button>
      </div>`;
    document.getElementById('btn-drive-connect2').addEventListener('click', async () => {
      try {
        await Drive.authorize();
        _renderDriveSection();
        document.dispatchEvent(new CustomEvent('drive-changed', { detail: { authorized: true } }));
        Notifications.success('Google Driveに接続しました');
      } catch (e) { Notifications.error('接続失敗: ' + e.message); }
    });
  }
}

// ---- デバイスプロファイル ----
function _renderProfileList() {
  const el = document.getElementById('profile-list');
  if (!_profiles.length) {
    el.innerHTML = `<p class="text-muted" style="font-size:13px;margin:8px 0;">プロファイルがありません。<br>「追加」ボタンから機種を登録してください。</p>`;
    return;
  }
  el.innerHTML = _profiles.map(p => `
    <div class="profile-item ${p.id === _activeId ? 'profile-active' : ''}" data-id="${p.id}">
      <span class="material-symbols-outlined">smartphone</span>
      <span class="profile-name">${escapeHtml(p.name)}</span>
      <div class="profile-actions">
        <button class="btn-sm btn-ghost btn-profile-select" data-id="${p.id}" title="使用">
          <span class="material-symbols-outlined">${p.id === _activeId ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
        </button>
        <button class="btn-sm btn-ghost btn-profile-edit" data-id="${p.id}" title="編集">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button class="btn-sm btn-ghost danger-text btn-profile-del" data-id="${p.id}" title="削除">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>`).join('');

  el.querySelectorAll('.btn-profile-select').forEach(btn => {
    btn.addEventListener('click', async () => {
      _activeId = btn.dataset.id;
      await DB.setSetting('activeProfileId', _activeId);
      _renderProfileList();
    });
  });
  el.querySelectorAll('.btn-profile-edit').forEach(btn => {
    btn.addEventListener('click', () => _openCalibratorEdit(btn.dataset.id));
  });
  el.querySelectorAll('.btn-profile-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('このプロファイルを削除しますか？')) return;
      await DB.deleteDeviceProfile(btn.dataset.id);
      _profiles = await DB.getDeviceProfiles();
      if (_activeId === btn.dataset.id) {
        _activeId = null;
        await DB.setSetting('activeProfileId', null);
      }
      _renderProfileList();
    });
  });
}

// ---- ゾーンキャリブレーター ----
function _openCalibratorNew() {
  _editProfileId = null;
  document.getElementById('calib-profile-name').value = '';
  document.getElementById('calib-editor').style.display = 'none';
  document.getElementById('calib-upload-area').style.display = '';
  document.getElementById('btn-calib-save').disabled = true;
  document.querySelectorAll('[data-zone-key]').forEach(b => b.classList.remove('active'));
  _calibrator = null;
  openModal('calibrator');
}

function _openCalibratorEdit(profileId) {
  _editProfileId = profileId;
  const profile = _profiles.find(p => p.id === profileId);
  if (!profile) return;
  document.getElementById('calib-profile-name').value = profile.name;
  document.getElementById('calib-editor').style.display = 'none';
  document.getElementById('calib-upload-area').style.display = '';
  document.getElementById('btn-calib-save').disabled = true;
  _calibrator = null;
  openModal('calibrator');
}

function _calibLoadImage(e) {
  if (!e.target.files[0]) return;
  _calibLoadFileObj(e.target.files[0]);
  e.target.value = '';
}

function _calibLoadFileObj(file) {
  const url = URL.createObjectURL(file);
  const img = document.getElementById('calib-img');
  img.onload = () => {
    URL.revokeObjectURL(url);
    document.getElementById('calib-upload-area').style.display = 'none';
    document.getElementById('calib-editor').style.display = '';

    const canvas = document.getElementById('calib-canvas');
    canvas.width  = img.clientWidth  || img.naturalWidth;
    canvas.height = img.clientHeight || img.naturalHeight;

    const profile = _editProfileId ? _profiles.find(p => p.id === _editProfileId) : null;
    _calibrator = new ZoneCalibrator(canvas, img);
    if (profile?.zones) _calibrator.setZones(profile.zones);
    else                 _calibrator.redraw();

    document.getElementById('btn-calib-save').disabled = false;
  };
  img.src = url;
}

async function _saveProfile() {
  const name = document.getElementById('calib-profile-name').value.trim();
  if (!name) { Notifications.error('プロファイル名を入力してください'); return; }
  if (!_calibrator) { Notifications.error('画像をアップロードしてください'); return; }

  const profile = {
    id:    _editProfileId || generateId(),
    name,
    zones: _calibrator.getZones(),
  };
  await DB.saveDeviceProfile(profile);
  _profiles = await DB.getDeviceProfiles();

  if (!_activeId) {
    _activeId = profile.id;
    await DB.setSetting('activeProfileId', _activeId);
  }

  closeModal('calibrator');
  _renderProfileList();
  Notifications.success('プロファイルを保存しました');
}

// ---- データ管理 ----
async function _exportData() {
  try {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `prsk-results-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Notifications.success('データをエクスポートしました');
  } catch (e) { Notifications.error('エクスポート失敗: ' + e.message); }
}

async function _importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!window.confirm(`${data.records?.length || 0}件のデータをインポートします（既存データと統合）。続けますか？`)) return;
    await DB.importAll(data);
    document.dispatchEvent(new CustomEvent('data-imported'));
    closeModal('settings');
    Notifications.success('データをインポートしました');
  } catch (e) { Notifications.error('インポート失敗: ' + e.message); }
}
