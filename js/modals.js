// js/modals.js

import { DIFFICULTIES, MODES, DEFAULT_OCR_ZONES } from './constants.js';
import { computeMissFields, createThumbnail, generateId, escapeHtml } from './utils.js';
import { DB } from './db.js';
import { Drive } from './drive.js';
import { MusicDB } from './music-db.js';
import { analyzeImage, drawZoneOverlays } from './ocr.js';
import { Notifications } from './notifications.js';
import { ZoneCalibrator } from './zone-calibrator.js';

// ===========================
// モーダル共通開閉
// ===========================
export function openModal(id) {
  const el = document.getElementById(`modal-${id}`);
  if (!el) return;
  el.classList.add('modal-open');
  document.body.classList.add('modal-active');
}

export function closeModal(id) {
  const el = document.getElementById(`modal-${id}`);
  if (!el) return;
  el.classList.remove('modal-open');
  if (!document.querySelector('.modal.modal-open')) {
    document.body.classList.remove('modal-active');
  }
}

// ===========================
// 詳細表示モーダル
// ===========================
export function openDetailModal(record) {
  const img = document.getElementById('detail-img');
  if (record.thumbBlob) {
    const url = URL.createObjectURL(record.thumbBlob);
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
  } else if (record.driveFileId) {
    img.src = `https://drive.google.com/thumbnail?id=${record.driveFileId}&sz=w1600`;
  } else {
    img.src = '';
  }
  document.getElementById('detail-title').textContent = record.title;
  openModal('detail');
}

// ===========================
// 編集モーダル
// ===========================
let _editId = null;

export function openEditModal(record, onSaved) {
  _editId = record.id;
  _editSavedCb = onSaved;

  // プレビュー
  const prevImg = document.getElementById('edit-prev-img');
  if (record.thumbBlob) {
    const u = URL.createObjectURL(record.thumbBlob);
    prevImg.onload = () => URL.revokeObjectURL(u);
    prevImg.src = u;
    prevImg.style.display = '';
  } else if (record.driveFileId) {
    prevImg.src = `https://drive.google.com/thumbnail?id=${record.driveFileId}&sz=w400`;
    prevImg.style.display = '';
  } else {
    prevImg.style.display = 'none';
  }

  // フォーム
  _fillEditForm(record);
  _updateEditMiss();
  openModal('edit');
}

let _editSavedCb = null;

function _fillEditForm(rec) {
  document.getElementById('edit-title').value      = rec.title || '';
  document.getElementById('edit-difficulty').value = rec.difficulty || 'master';
  document.getElementById('edit-level').value      = rec.level || '';
  document.getElementById('edit-perfect').value    = rec.perfect || 0;
  document.getElementById('edit-great').value      = rec.great   || 0;
  document.getElementById('edit-good').value       = rec.good    || 0;
  document.getElementById('edit-bad').value        = rec.bad     || 0;
  document.getElementById('edit-miss').value       = rec.miss    || 0;
  document.getElementById('edit-combo').value      = rec.combo   || 0;
}

function _editFormToData() {
  return {
    title:      document.getElementById('edit-title').value.trim(),
    difficulty: document.getElementById('edit-difficulty').value,
    level:      Number(document.getElementById('edit-level').value) || null,
    perfect:    Number(document.getElementById('edit-perfect').value) || 0,
    great:      Number(document.getElementById('edit-great').value)   || 0,
    good:       Number(document.getElementById('edit-good').value)    || 0,
    bad:        Number(document.getElementById('edit-bad').value)     || 0,
    miss:       Number(document.getElementById('edit-miss').value)    || 0,
    combo:      Number(document.getElementById('edit-combo').value)   || 0,
  };
}

function _updateEditMiss() {
  const d = _editFormToData();
  const r = computeMissFields(d);
  document.getElementById('edit-miss-ap').textContent      = r.missAP;
  document.getElementById('edit-miss-contest').textContent = r.missContest;
  document.getElementById('edit-miss-fc').textContent      = r.missFC;
  _colorMiss('edit-miss-ap',      r.missAP);
  _colorMiss('edit-miss-contest', r.missContest);
  _colorMiss('edit-miss-fc',      r.missFC);
}

export function initEditModal(onSaved) {
  ['perfect','great','good','bad','miss'].forEach(f => {
    document.getElementById(`edit-${f}`).addEventListener('input', _updateEditMiss);
  });
  document.getElementById('btn-edit-save').addEventListener('click', async () => {
    if (!_editId) return;
    const data = _editFormToData();
    if (!data.title) { Notifications.error('曲名を入力してください'); return; }
    try {
      const rec = await DB.updateRecord(_editId, data);
      // Drive同期（非同期）
      if (Drive.authorized) {
        DB.getAllRecords().then(rs => DB.getTrashItems().then(ts => Drive.saveMetadata(rs, ts))).catch(console.warn);
      }
      closeModal('edit');
      Notifications.success('編集を保存しました');
      if (_editSavedCb) _editSavedCb(rec);
    } catch (e) {
      Notifications.error('保存に失敗しました: ' + e.message);
    }
  });
}

// ===========================
// アップロードモーダル
// ===========================
const UPLOAD_STATES = {};  // id → { file, blob, ocrData, status, autoMode }
let _uploadMode = 'auto';  // 'auto' | 'manual'
let _activeUploadId = null;
let _ocrZones = null;      // null = DEFAULT_OCR_ZONES を使用
let _onUploadComplete = null;

export function initUploadModal(onComplete) {
  _onUploadComplete = onComplete;

  // ドロップゾーン
  const dz = document.getElementById('up-dropzone');
  const fi = document.getElementById('up-file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dz-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dz-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dz-over');
    if (e.dataTransfer.files.length) _handleFiles(e.dataTransfer.files);
  });
  fi.addEventListener('change', e => { if (e.target.files.length) _handleFiles(e.target.files); fi.value = ''; });

  // モード切替
  document.querySelectorAll('.up-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.up-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _uploadMode = btn.dataset.mode;
    });
  });

  // 一括解析
  document.getElementById('btn-analyze-all').addEventListener('click', async () => {
    const pending = Object.values(UPLOAD_STATES).filter(s => s.status === 'pending');
    for (const st of pending) await _runOCR(st.id);
  });

  // 再解析
  document.getElementById('btn-reanalyze').addEventListener('click', async () => {
    if (_activeUploadId) await _runOCR(_activeUploadId, true);
  });

  // 判定内訳変更時
  ['perfect','great','good','bad','miss'].forEach(f => {
    document.getElementById(`up-${f}`).addEventListener('input', () => {
      _updateUpMiss();
      if (_activeUploadId && UPLOAD_STATES[_activeUploadId]) {
        UPLOAD_STATES[_activeUploadId].ocrData = _upFormToData();
      }
    });
  });

  // 曲名変更時：サジェスト
  const titleInput = document.getElementById('up-title');
  titleInput.addEventListener('input', () => {
    _showSuggestions(titleInput.value);
    if (_activeUploadId) UPLOAD_STATES[_activeUploadId].ocrData = _upFormToData();
  });

  // 実行ボタン
  document.getElementById('btn-upload-submit').addEventListener('click', _executeUpload);
}

export function openUploadModal(zones) {
  _ocrZones = zones || null;
  Object.keys(UPLOAD_STATES).forEach(k => delete UPLOAD_STATES[k]);
  _activeUploadId = null;
  document.getElementById('up-file-list').innerHTML = '';
  document.getElementById('up-workspace').style.display = 'none';
  document.getElementById('up-dropzone').style.display  = '';
  document.getElementById('btn-upload-submit').disabled = true;
  _clearUpForm();
  openModal('upload');
}

async function _handleFiles(files) {
  document.getElementById('up-dropzone').style.display  = 'none';
  document.getElementById('up-workspace').style.display = '';

  for (const file of files) {
    const id = generateId();
    const blob = file;
    UPLOAD_STATES[id] = { id, file: blob, status: 'pending', ocrData: null };
    _addSidebarItem(id, file.name);
  }

  _updateSubmitBtn();

  if (_uploadMode === 'auto') {
    const pending = Object.keys(UPLOAD_STATES).filter(id => UPLOAD_STATES[id].status === 'pending');
    for (const id of pending) await _runOCR(id);
  }

  if (!_activeUploadId) _selectItem(Object.keys(UPLOAD_STATES)[0]);
}

function _addSidebarItem(id, name) {
  const li = document.createElement('div');
  li.className = 'up-sidebar-item';
  li.id = `up-sb-${id}`;
  li.innerHTML = `
    <div class="up-sb-thumb" id="up-sbt-${id}">
      <span class="material-symbols-outlined">image</span>
    </div>
    <div class="up-sb-info">
      <div class="up-sb-name">${escapeHtml(name.replace(/\.[^.]+$/, ''))}</div>
      <div class="up-sb-title" id="up-sbt-title-${id}">-</div>
      <span class="up-status up-status-pending" id="up-status-${id}">待機中</span>
    </div>
    <button class="icon-btn-sm" id="up-rm-${id}" title="削除">
      <span class="material-symbols-outlined">close</span>
    </button>`;
  li.addEventListener('click', e => { if (!e.target.closest('button')) _selectItem(id); });
  document.getElementById(`up-rm-${id}`).addEventListener('click', e => {
    e.stopPropagation();
    delete UPLOAD_STATES[id];
    li.remove();
    if (_activeUploadId === id) {
      _activeUploadId = null;
      document.getElementById('up-editor').style.display = 'none';
    }
    _updateSubmitBtn();
  });
  document.getElementById('up-file-list').appendChild(li);

  // サムネイルプレビュー
  const url = URL.createObjectURL(UPLOAD_STATES[id].file);
  const img = document.createElement('img');
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:4px;';
  document.getElementById(`up-sbt-${id}`).replaceWith(img);
  img.id = `up-sbt-${id}`;
}

function _selectItem(id) {
  if (!UPLOAD_STATES[id]) return;
  _activeUploadId = id;
  document.querySelectorAll('.up-sidebar-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`up-sb-${id}`)?.classList.add('active');
  document.getElementById('up-editor').style.display = 'flex';

  const st = UPLOAD_STATES[id];
  const url = URL.createObjectURL(st.file);
  const prevImg = document.getElementById('up-preview-img');
  prevImg.onload = () => {
    URL.revokeObjectURL(url);
    _redrawOverlay(prevImg, id);
  };
  prevImg.src = url;

  if (st.ocrData) _fillUpForm(st.ocrData);
  else _clearUpForm();
  _updateUpMiss();
}

function _redrawOverlay(imgEl, id) {
  const canvas = document.getElementById('up-overlay');
  canvas.width  = imgEl.clientWidth  || imgEl.naturalWidth;
  canvas.height = imgEl.clientHeight || imgEl.naturalHeight;
  const zones = _ocrZones || DEFAULT_OCR_ZONES;
  drawZoneOverlays(canvas, imgEl.naturalWidth, imgEl.naturalHeight, zones);
}

async function _runOCR(id, force = false) {
  const st = UPLOAD_STATES[id];
  if (!st || (st.status === 'done' && !force)) return;

  _setStatus(id, 'analyzing', '解析中');
  try {
    const url = URL.createObjectURL(st.file);
    const img = await _loadImg(url);
    URL.revokeObjectURL(url);
    const result = await analyzeImage(img, _ocrZones);
    st.ocrData = result;
    st.status  = 'done';
    _setStatus(id, 'done', '完了');
    document.getElementById(`up-sbt-title-${id}`).textContent = result.title || '-';

    // OCR矛盾チェック（2.20）
    if (result.inconsistency) {
      Notifications.warning(`【${result.title}】${result.inconsistency}`, 8000);
    }

    if (_activeUploadId === id) _fillUpForm(result);
  } catch (e) {
    st.status = 'error';
    _setStatus(id, 'error', 'エラー');
    console.error('[OCR]', e);
  }
  _updateSubmitBtn();
}

function _loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function _setStatus(id, cls, text) {
  const el = document.getElementById(`up-status-${id}`);
  if (!el) return;
  el.className = `up-status up-status-${cls}`;
  el.textContent = text;
}

function _fillUpForm(data) {
  document.getElementById('up-title').value      = data.title      || '';
  document.getElementById('up-difficulty').value = data.difficulty || 'master';
  document.getElementById('up-level').value      = data.level      || '';
  document.getElementById('up-perfect').value    = data.perfect    || 0;
  document.getElementById('up-great').value      = data.great      || 0;
  document.getElementById('up-good').value       = data.good       || 0;
  document.getElementById('up-bad').value        = data.bad        || 0;
  document.getElementById('up-miss').value       = data.miss       || 0;
  document.getElementById('up-combo').value      = data.combo      || 0;

  // ノーツ数検証表示
  const valEl = document.getElementById('up-notes-validation');
  if (data.inconsistency) {
    valEl.textContent = `⚠ ${data.inconsistency}（手動で修正してください）`;
    valEl.className = 'notes-validation warn';
  } else if (data.totalNotes) {
    valEl.textContent = `総ノーツ数 ${data.computedTotal} / ${data.totalNotes} ✓`;
    valEl.className = 'notes-validation ok';
  } else {
    valEl.textContent = '';
    valEl.className = 'notes-validation';
  }
  _updateUpMiss();
}

function _clearUpForm() {
  ['title','difficulty','level','perfect','great','good','bad','miss','combo'].forEach(f => {
    const el = document.getElementById(`up-${f}`);
    if (!el) return;
    el.value = f === 'difficulty' ? 'master' : (f === 'level' ? '' : '0');
  });
  document.getElementById('up-title').value = '';
  document.getElementById('up-notes-validation').textContent = '';
  _updateUpMiss();
}

function _upFormToData() {
  return {
    title:      document.getElementById('up-title').value.trim(),
    difficulty: document.getElementById('up-difficulty').value,
    level:      Number(document.getElementById('up-level').value)   || null,
    perfect:    Number(document.getElementById('up-perfect').value) || 0,
    great:      Number(document.getElementById('up-great').value)   || 0,
    good:       Number(document.getElementById('up-good').value)    || 0,
    bad:        Number(document.getElementById('up-bad').value)     || 0,
    miss:       Number(document.getElementById('up-miss').value)    || 0,
    combo:      Number(document.getElementById('up-combo').value)   || 0,
  };
}

function _updateUpMiss() {
  const d = _upFormToData();
  const r = computeMissFields(d);
  document.getElementById('up-miss-ap').textContent      = r.missAP;
  document.getElementById('up-miss-contest').textContent = r.missContest;
  document.getElementById('up-miss-fc').textContent      = r.missFC;
  _colorMiss('up-miss-ap',      r.missAP);
  _colorMiss('up-miss-contest', r.missContest);
  _colorMiss('up-miss-fc',      r.missFC);

  if (_activeUploadId && UPLOAD_STATES[_activeUploadId]) {
    UPLOAD_STATES[_activeUploadId].ocrData = { ...UPLOAD_STATES[_activeUploadId].ocrData, ...d };
  }
}

function _updateSubmitBtn() {
  const count = Object.keys(UPLOAD_STATES).length;
  const btn   = document.getElementById('btn-upload-submit');
  btn.disabled = count === 0;
  btn.textContent = count ? `${count}件を登録` : '登録';
}

async function _executeUpload() {
  // 現在の編集中フォームを保存
  if (_activeUploadId && UPLOAD_STATES[_activeUploadId]) {
    UPLOAD_STATES[_activeUploadId].ocrData = _upFormToData();
  }

  const items = Object.values(UPLOAD_STATES);
  if (!items.length) return;
  const btn = document.getElementById('btn-upload-submit');
  btn.disabled = true;
  btn.textContent = '登録中...';

  const saved = [];
  for (const st of items) {
    const data = st.ocrData || {};
    if (!data.title) {
      Notifications.warning(`タイトル未入力のためスキップしました`);
      continue;
    }
    try {
      const thumb = await createThumbnail(st.file, 400);
      const rec = await DB.addRecord({ ...data, thumbBlob: thumb, musicId: data.musicId || null });

      // Drive同期
      let driveFileId = null;
      if (Drive.authorized) {
        try { driveFileId = await Drive.uploadImage(st.file, rec.id); } catch {}
        if (driveFileId) await DB.updateRecord(rec.id, { driveFileId });
      }
      saved.push(rec);
      _setStatus(st.id, 'uploaded', '完了');
    } catch (e) {
      Notifications.error(`登録失敗: ${e.message}`);
    }
  }

  if (saved.length) {
    // Drive メタデータ同期
    if (Drive.authorized) {
      const rs = await DB.getAllRecords();
      const ts = await DB.getTrashItems();
      Drive.saveMetadata(rs, ts).catch(console.warn);
    }
    closeModal('upload');
    Notifications.success(`${saved.length}件を登録しました`);
    if (_onUploadComplete) _onUploadComplete(saved);
  } else {
    btn.disabled = false;
    btn.textContent = '登録';
  }
}

// サジェスト
function _showSuggestions(query) {
  const box = document.getElementById('up-suggestions');
  if (!query || query.length < 1) { box.style.display = 'none'; return; }
  const list = MusicDB.search(query);
  if (!list.length) { box.style.display = 'none'; return; }
  box.innerHTML = list.map(m =>
    `<div class="suggest-item" data-title="${escapeHtml(m.title)}" data-id="${m.id}">${escapeHtml(m.title)}</div>`
  ).join('');
  box.style.display = '';
  box.querySelectorAll('.suggest-item').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('up-title').value = el.dataset.title;
      box.style.display = 'none';
      if (_activeUploadId && UPLOAD_STATES[_activeUploadId]) {
        UPLOAD_STATES[_activeUploadId].ocrData = {
          ...UPLOAD_STATES[_activeUploadId].ocrData,
          title: el.dataset.title,
          musicId: Number(el.dataset.id),
        };
        document.getElementById(`up-sbt-title-${_activeUploadId}`).textContent = el.dataset.title;
      }
    });
  });
}

function _colorMiss(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.color = val === 0 ? 'var(--fc-color)' : '';
  el.style.fontWeight = val === 0 ? '700' : '';
}
