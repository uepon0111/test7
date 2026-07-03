// js/app.js

import { DB }                        from './db.js';
import { Drive }                     from './drive.js';
import { MusicDB }                   from './music-db.js';
import { Notifications }             from './notifications.js';
import { VirtualScroll }             from './virtual-scroll.js';
import { renderCard }                from './card.js';
import { applyFiltersAndSort, checkSelfBest } from './filter-sort.js';
import { closeModal, openDetailModal, openEditModal, initEditModal,
         initUploadModal, openUploadModal } from './modals.js';
import { TrashView }                 from './trash-view.js';
import { Settings }                  from './settings.js';
import { debounce }                  from './utils.js';
import { MODES }                     from './constants.js';

// ========== アプリ状態 ==========
const state = {
  records:  [],
  filtered: [],
  mode:     'ap',
  bestOnly: false,
  sort: { by: 'level', dir: 'desc' },
  filters: {
    search: '', difficulty: 'all', level: '',
    status: 'all', missMin: '', missMax: '',
  },
  view: 'list',
};

let vs = null; // VirtualScroll インスタンス

// ========== レイアウト計算 ==========
function getCols() {
  const w = window.innerWidth;
  if (w < 768)  return 1;
  if (w < 1200) return 2;
  return 3;
}
function getItemH(cols) { return cols === 1 ? 90 : 244; }

function updateLayout() {
  const cols = getCols();
  const h    = getItemH(cols);
  document.body.classList.toggle('is-mobile', cols === 1);
  if (vs) vs.setLayout(h, cols);
}

// ========== カードレンダラー ==========
function mkCard(record) {
  return renderCard(
    record, state.mode, getCols(),
    r => openDetailModal(r),
    r => openEditModal(r, onRecordEdited),
    r => doMoveToTrash(r),
  );
}

// ========== ビュー更新 ==========
function updateView() {
  const filtered = applyFiltersAndSort(state.records, state);
  state.filtered = filtered;

  if (vs) vs.setItems(filtered);

  // 件数表示
  document.getElementById('record-count').textContent =
    `${filtered.length}件 / 全${state.records.length}件`;

  // 空状態
  const isEmpty = filtered.length === 0;
  document.getElementById('vs-empty').style.display = isEmpty ? '' : 'none';

  // フィルターリセットボタン表示
  const hasF = state.filters.search || state.filters.difficulty !== 'all'
    || state.filters.level || state.filters.status !== 'all'
    || state.filters.missMin || state.filters.missMax;
  document.getElementById('btn-clear-filters').style.display = hasF ? '' : 'none';
}

// ========== トラッシュバッジ ==========
async function refreshTrashBadge() {
  const items = await DB.getTrashItems();
  const badge = document.getElementById('trash-badge');
  badge.textContent = items.length || '';
  badge.style.display = items.length ? '' : 'none';
}

// ========== ビュー切替 ==========
async function switchView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('view-list').style.display  = view === 'list'  ? 'flex' : 'none';
  document.getElementById('view-trash').style.display = view === 'trash' ? 'flex' : 'none';
  document.getElementById('vs-fab').style.display = view === 'list' && getCols() === 1 ? '' : 'none';

  if (view === 'trash') renderTrashView();
}

async function renderTrashView() {
  const items = await DB.getTrashItems();
  TrashView.render(
    items,
    async id => {
      const rec = await DB.restoreFromTrash(id);
      state.records.push(rec);
      updateView();
      renderTrashView();
      refreshTrashBadge();
      syncDrive();
      Notifications.success('リストに戻しました');
    },
    async id => {
      if (!confirm('完全に削除しますか？この操作は取り消せません。')) return;
      const item = await DB.permanentDeleteFromTrash(id);
      if (item?.driveFileId && Drive.authorized)
        Drive.deleteFile(item.driveFileId).catch(console.warn);
      renderTrashView();
      refreshTrashBadge();
      syncDrive();
      Notifications.success('完全削除しました');
    },
  );
}

// ========== レコード操作 ==========
async function doMoveToTrash(record) {
  if (!confirm(`「${record.title}」をゴミ箱に移動しますか？`)) return;
  await DB.moveToTrash(record.id);
  state.records = state.records.filter(r => r.id !== record.id);
  updateView();
  refreshTrashBadge();
  syncDrive();
  Notifications.info('ゴミ箱に移動しました');
}

function onRecordEdited(updated) {
  const i = state.records.findIndex(r => r.id === updated.id);
  if (i >= 0) state.records[i] = updated;
  else state.records.push(updated);
  updateView();
  syncDrive();
}

function onUploadComplete(saved) {
  for (const rec of saved) {
    // 2.19: 自己ベスト更新チェック
    const impr = checkSelfBest(rec, state.records);
    if (impr) {
      const modeInfo = MODES[impr[0].mode];
      const lines = impr.map(i => `${MODES[i.mode].label}: ${i.oldMiss} → ${i.newMiss}`);
      Notifications.record(
        `新記録！ ${rec.title} [${rec.difficulty.toUpperCase()}]<br>${lines.join(' / ')}`,
        8000,
      );
    }
    state.records.push(rec);
  }
  updateView();
  refreshTrashBadge();
  syncDrive();
}

// Drive バックグラウンド同期
async function syncDrive() {
  if (!Drive.authorized) return;
  try {
    const [rs, ts] = await Promise.all([DB.getAllRecords(), DB.getTrashItems()]);
    await Drive.saveMetadata(rs, ts);
  } catch (e) { console.warn('[Drive sync]', e); }
}

// ========== Drive UI 更新 ==========
function updateDriveUI() {
  const btn    = document.getElementById('btn-drive-login');
  const status = document.getElementById('drive-status-icon');
  if (Drive.authorized) {
    btn.innerHTML   = `<span class="material-symbols-outlined">logout</span><span class="btn-label">切断</span>`;
    status.innerHTML = `<span class="material-symbols-outlined" title="Drive接続済み" style="color:var(--success)">cloud_done</span>`;
    btn.onclick = () => {
      Drive.signOut();
      updateDriveUI();
      Notifications.info('Driveから切断しました');
    };
  } else {
    btn.innerHTML   = `<span class="material-symbols-outlined">login</span><span class="btn-label">Drive連携</span>`;
    status.innerHTML = `<span class="material-symbols-outlined" title="Drive未接続" style="color:var(--text-muted)">cloud_off</span>`;
    btn.onclick = driveLogin;
  }
}

async function driveLogin() {
  try {
    await Drive.authorize();
    updateDriveUI();
    const meta = await Drive.loadMetadata();
    if (meta?.records?.length) {
      await DB.importAll(meta);
      state.records = await DB.getAllRecords();
      updateView();
      Notifications.success('Driveからデータを読み込みました');
    } else {
      await syncDrive();
      Notifications.success('Google Driveに接続しました');
    }
  } catch (e) { Notifications.error('Drive接続失敗: ' + e.message); }
}

// ========== コントロールバインド ==========
function bindControls() {
  // モードタブ
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      updateView();
    });
  });

  // 自己ベストのみ
  const bestBtn = document.getElementById('btn-best-only');
  bestBtn.addEventListener('click', () => {
    state.bestOnly = !state.bestOnly;
    bestBtn.classList.toggle('active', state.bestOnly);
    updateView();
  });

  // ソート
  document.getElementById('sort-select').addEventListener('change', e => {
    const parts = e.target.value.split('_');
    state.sort = { by: parts[0], dir: parts[1] };
    updateView();
  });

  // 検索
  const searchEl = document.getElementById('search-input');
  searchEl.addEventListener('input', debounce(e => {
    state.filters.search = e.target.value;
    document.getElementById('btn-clear-search').style.display = e.target.value ? '' : 'none';
    updateView();
  }, 200));
  document.getElementById('btn-clear-search').addEventListener('click', () => {
    searchEl.value = '';
    state.filters.search = '';
    document.getElementById('btn-clear-search').style.display = 'none';
    updateView();
  });

  // 難易度フィルターチップ
  document.querySelectorAll('[data-filter="diff"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter="diff"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.difficulty = btn.dataset.val;
      updateView();
    });
  });

  // 状態フィルター
  document.getElementById('filter-status').addEventListener('change', e => {
    state.filters.status = e.target.value;
    updateView();
  });

  // レベルフィルター
  document.getElementById('filter-level').addEventListener('input', debounce(e => {
    state.filters.level = e.target.value;
    updateView();
  }, 300));

  // ミス範囲
  document.getElementById('filter-miss-min').addEventListener('input', debounce(e => {
    state.filters.missMin = e.target.value;
    updateView();
  }, 300));
  document.getElementById('filter-miss-max').addEventListener('input', debounce(e => {
    state.filters.missMax = e.target.value;
    updateView();
  }, 300));

  // フィルターリセット
  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    state.filters = { search: '', difficulty: 'all', level: '', status: 'all', missMin: '', missMax: '' };
    searchEl.value = '';
    document.getElementById('filter-status').value  = 'all';
    document.getElementById('filter-level').value   = '';
    document.getElementById('filter-miss-min').value = '';
    document.getElementById('filter-miss-max').value = '';
    document.querySelectorAll('[data-filter="diff"]').forEach((b,i) => b.classList.toggle('active', i===0));
    document.getElementById('btn-clear-search').style.display = 'none';
    updateView();
  });

  // アップロードボタン（複数）
  ['btn-upload-header', 'btn-upload-sidebar', 'vs-fab'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => {
      const profile = Settings.getActiveProfile();
      openUploadModal(profile?.zones || null);
    });
  });

  // 設定ボタン
  document.getElementById('btn-settings').addEventListener('click', () => Settings.open());

  // Drive連携ボタン
  document.getElementById('btn-drive-login').onclick = driveLogin;

  // ナビ切替
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // ゴミ箱 全削除
  document.getElementById('btn-empty-trash').addEventListener('click', async () => {
    const items = await DB.getTrashItems();
    if (!items.length) return;
    if (!confirm(`ゴミ箱内の ${items.length}件 を完全削除しますか？`)) return;
    for (const item of items) {
      await DB.permanentDeleteFromTrash(item.id);
      if (item.driveFileId && Drive.authorized) Drive.deleteFile(item.driveFileId).catch(console.warn);
    }
    renderTrashView();
    refreshTrashBadge();
    syncDrive();
    Notifications.success('全て完全削除しました');
  });

  // モーダル閉じるボタン
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  // バックドロップクリックで閉じる
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', () => {
      const modal = bd.closest('.modal');
      if (modal) closeModal(modal.id.replace('modal-', ''));
    });
  });

  // 詳細モーダル：キーボード終了
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal.modal-open').forEach(m =>
      closeModal(m.id.replace('modal-', '')));
  });
}

// ========== 初期化 ==========
async function init() {
  // 楽曲DB 読み込み
  await MusicDB.init();

  // 通知
  Notifications.init();

  // 仮想スクロール
  const vsContainer = document.getElementById('vs-container');
  const cols = getCols();
  vs = new VirtualScroll(vsContainer, mkCard, {
    itemHeight: getItemH(cols),
    columns:    cols,
    gap:        8,
  });

  // ゴミ箱ビュー
  TrashView.init(
    document.getElementById('trash-list'),
    document.getElementById('trash-empty'),
  );

  // 設定
  await Settings.init();

  // モーダル初期化
  initEditModal(onRecordEdited);
  initUploadModal(onUploadComplete);

  // レコード読み込み
  state.records = await DB.getAllRecords();
  updateView();
  await refreshTrashBadge();

  // 初期レイアウト
  updateLayout();

  // Drive イベント
  window.addEventListener('gapi-loaded', () => Drive.onGapiLoad());
  window.addEventListener('gis-loaded',  () => Drive.onGisLoad());
  document.addEventListener('drive-changed', () => updateDriveUI());
  document.addEventListener('data-imported', async () => {
    state.records = await DB.getAllRecords();
    updateView();
    await refreshTrashBadge();
  });

  // コントロール
  bindControls();

  // リサイズ
  window.addEventListener('resize', debounce(updateLayout, 150));

  // 期限切れゴミ箱を自動削除（2.15）
  const expired = await DB.purgeExpiredTrash();
  for (const item of expired) {
    if (item.driveFileId && Drive.authorized) Drive.deleteFile(item.driveFileId).catch(console.warn);
  }
  if (expired.length) {
    refreshTrashBadge();
    syncDrive();
  }

  // FAB: モバイルのみ表示
  document.getElementById('vs-fab').style.display = cols === 1 ? '' : 'none';
  document.getElementById('btn-upload-sidebar').style.display = cols > 1 ? '' : 'none';
}

document.addEventListener('DOMContentLoaded', init);
