
import { APP_NAME, DIFFICULTIES, DIFFICULTY_ORDER, SORT_OPTIONS } from './config.js';
import {
  loadSettings,
  saveSettings,
  loadUIState,
  saveUIState,
  upsertProfile,
  deleteProfile,
  cloneProfile,
  makeProfileId,
} from './storage.js';
import {
  initDriveClient,
  createTokenClient,
  revokeCurrentToken,
  fetchAllDriveItems,
  getFolderByName,
  findOrCreateFolder,
  downloadFileBlob,
  uploadFileToDrive,
  updateFileOnDrive,
  deleteFileOnDrive,
  loadProjectRootFolders,
} from './drive.js';
import {
  analyzeScreenshot,
  detectProfileFromImageSize,
  getImageSize,
  loadImageFromFile,
} from './ocr.js';

const state = {
  settings: loadSettings(),
  ui: loadUIState(),
  loggedIn: false,
  gapiReady: false,
  gisReady: false,
  tokenClient: null,
  db: { musics: [], diffs: [] },
  allRecords: [],
  filteredRecords: [],
  bestMap: new Map(),
  selectedIds: new Set(),
  selectMode: false,
  renderSeq: 0,
  loadSeq: 0,
  batch: {
    mode: null,
    items: [],
    currentIndex: -1,
    busy: false,
  },
  settingsEditor: {
    profileId: null,
    imageUrl: '',
    imageSize: null,
    regionKey: 'difficulty',
  },
};

function el(id) {
  return document.getElementById(id);
}

function $(selector, root = document) {
  return root.querySelector(selector);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toast(message, kind = 'info') {
  const area = el('toast-area');
  if (!area) return;
  const node = document.createElement('div');
  node.className = `toast ${kind === 'success' ? 'success' : kind === 'warn' ? 'warn' : ''}`;
  node.textContent = message;
  area.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(-8px)';
    node.style.transition = 'all 0.25s ease';
    setTimeout(() => node.remove(), 300);
  }, 2500);
}

function setLoaderVisible(visible, label = '', progress = null) {
  const loader = el('loader');
  if (!loader) return;
  loader.style.display = visible ? 'flex' : 'none';
  if (label) el('loader-text').textContent = label;
  const bar = el('loader-progress-bar');
  const labelEl = el('loader-progress-label');
  if (bar && labelEl) {
    if (progress == null || Number.isNaN(progress)) {
      bar.style.width = '100%';
      labelEl.textContent = label || '';
    } else {
      bar.style.width = `${Math.max(0, Math.min(100, progress * 100)).toFixed(1)}%`;
      labelEl.textContent = `${label || ''} ${Math.round(progress * 100)}%`;
    }
  }
}

function setViewProgress(label, progress = 0, indeterminate = false) {
  const bar = el('view-progress-bar');
  const labelEl = el('view-progress-label');
  if (!bar || !labelEl) return;
  labelEl.textContent = label || '';
  bar.style.width = indeterminate ? '60%' : `${Math.max(0, Math.min(100, progress * 100)).toFixed(1)}%`;
}

function saveUiState() {
  saveUIState({
    sortOrder: state.ui.sortOrder,
    filterFc: state.ui.filterFc,
    filterMissMin: state.ui.filterMissMin,
    filterMissMax: state.ui.filterMissMax,
    filterDiff: state.ui.filterDiff,
    filterTitle: state.ui.filterTitle,
    filterLevel: state.ui.filterLevel,
    bestOnly: state.ui.bestOnly,
    selectMode: state.selectMode,
  });
}

function loadDbFallbacks() {
  return {
    musics: [],
    diffs: [],
  };
}

async function loadDatabase() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json'),
    ]);
    state.db.musics = await musicsResp.json();
    state.db.diffs = await diffsResp.json();
  } catch (err) {
    console.error(err);
    state.db = loadDbFallbacks();
    toast('楽曲DBの取得に失敗しました。', 'warn');
  }
}

function normalizeString(text) {
  return String(text || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\r\n\t]+/g, '')
    .replace(/[【】\[\]（）()\-_.･·•]/g, '');
}

function levenshtein(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 0; i < b.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < a.length; j++) {
      cur.push(
        a[j] === b[i]
          ? prev[j]
          : 1 + Math.min(prev[j], prev[j + 1], cur[cur.length - 1])
      );
    }
    prev = cur;
  }
  return prev[prev.length - 1];
}

function findBestMatchMusic(ocrText) {
  const target = normalizeString(ocrText);
  if (!target || !state.db.musics.length) return null;
  let best = null;
  let bestScore = Infinity;
  for (const music of state.db.musics) {
    const title = normalizeString(music.title || music.name || '');
    if (!title) continue;
    const score = levenshtein(target, title) / Math.max(1, Math.max(target.length, title.length));
    if (score < bestScore) {
      bestScore = score;
      best = music;
    }
  }
  return best;
}

function getLevelFromDb(musicId, difficulty) {
  if (!musicId || !difficulty) return '';
  const row = state.db.diffs.find((d) => String(d.musicId) === String(musicId) && String(d.musicDifficulty).toUpperCase() === String(difficulty).toUpperCase());
  return row?.playLevel ?? '';
}

function diffSortValue(diff) {
  return DIFFICULTY_ORDER[String(diff || '').toUpperCase()] ?? 99;
}

function parseFolderTitle(folderName) {
  if (!folderName) return null;
  const patterns = [
    /^(\d+)\s+([A-Z]+)\s+(.+)$/,
    /^(\d+)([A-Z]+)\s+(.+)$/,
    /^(\d+)\s+(.+?)\s+\[(EASY|NORMAL|HARD|EXPERT|MASTER|APPEND)\]$/,
  ];
  for (const re of patterns) {
    const m = folderName.match(re);
    if (!m) continue;
    const level = parseInt(m[1], 10);
    const raw = String(m[2] || '').toUpperCase();
    let title = String(m[3] || '').trim();
    const difficulty = ({
      A: 'APPEND',
      M: 'MASTER',
      E: 'EXPERT',
      H: 'HARD',
      N: 'NORMAL',
      L: 'EASY',
      EZ: 'EASY',
      APPEND: 'APPEND',
      MASTER: 'MASTER',
      EXPERT: 'EXPERT',
      HARD: 'HARD',
      NORMAL: 'NORMAL',
      EASY: 'EASY',
    })[raw] || raw;
    if (!difficulty) continue;
    if (title.endsWith(']')) title = title.replace(/\s+\[[^\]]+\]\s*$/, '').trim();
    return { level, rawDiff: raw, difficulty, title };
  }
  return null;
}

function parseMissFromFileName(fileName) {
  const match = String(fileName || '').match(/^FC(?:-(\d+))?/i);
  if (!match) return null;
  return match[1] == null ? 0 : parseInt(match[1], 10);
}

function buildRecordKey(record) {
  return [record.title || '', record.level || '', record.difficulty || ''].join('|');
}

function compareBest(a, b) {
  const missA = Number.isFinite(Number(a.missCount)) ? Number(a.missCount) : 999999;
  const missB = Number.isFinite(Number(b.missCount)) ? Number(b.missCount) : 999999;
  if (missA !== missB) return missA - missB;

  const comboA = Number.isFinite(Number(a.combo)) ? Number(a.combo) : -1;
  const comboB = Number.isFinite(Number(b.combo)) ? Number(b.combo) : -1;
  if (comboA !== comboB) return comboB - comboA;

  const perfectA = Number.isFinite(Number(a.perfect)) ? Number(a.perfect) : -1;
  const perfectB = Number.isFinite(Number(b.perfect)) ? Number(b.perfect) : -1;
  if (perfectA !== perfectB) return perfectB - perfectA;

  const greatA = Number.isFinite(Number(a.great)) ? Number(a.great) : 999999;
  const greatB = Number.isFinite(Number(b.great)) ? Number(b.great) : 999999;
  if (greatA !== greatB) return greatA - greatB;

  return new Date(a.addedAt || 0) - new Date(b.addedAt || 0);
}

function recomputeBestFlags(records) {
  const bestMap = new Map();
  for (const rec of records) {
    const key = buildRecordKey(rec);
    const current = bestMap.get(key);
    if (!current || compareBest(rec, current) < 0) {
      bestMap.set(key, rec);
    }
  }
  for (const rec of records) {
    rec.isBest = bestMap.get(buildRecordKey(rec))?.id === rec.id;
  }
  state.bestMap = bestMap;
  return records;
}

function parseAppProperties(file) {
  const p = file.appProperties || {};
  return {
    title: p.title || '',
    level: p.level || '',
    difficulty: p.difficulty || '',
    missCount: p.missCount !== undefined ? Number(p.missCount) : null,
    perfect: p.perfect !== undefined ? Number(p.perfect) : 0,
    great: p.great !== undefined ? Number(p.great) : 0,
    good: p.good !== undefined ? Number(p.good) : 0,
    bad: p.bad !== undefined ? Number(p.bad) : 0,
    miss: p.miss !== undefined ? Number(p.miss) : 0,
    combo: p.combo !== undefined && p.combo !== '' ? Number(p.combo) : null,
    profileId: p.profileId || '',
  };
}

function buildAppProperties(meta) {
  return {
    prskApp: '1',
    title: String(meta.title || ''),
    level: String(meta.level || ''),
    difficulty: String(meta.difficulty || ''),
    missCount: String(meta.missCount ?? 0),
    perfect: String(meta.perfect ?? 0),
    great: String(meta.great ?? 0),
    good: String(meta.good ?? 0),
    bad: String(meta.bad ?? 0),
    miss: String(meta.miss ?? 0),
    combo: meta.combo === null || meta.combo === undefined ? '' : String(meta.combo),
    profileId: String(meta.profileId || ''),
  };
}

function buildFileName(meta) {
  const missCount = Number(meta.missCount) || 0;
  return missCount === 0 ? 'FC' : `FC-${missCount}`;
}

function deriveRecord(file, folderMap) {
  const parentId = (file.parents || []).find((pid) => folderMap.has(pid)) || null;
  const folder = parentId ? folderMap.get(parentId) : null;
  const props = parseAppProperties(file);
  const title = props.title || folder?.title || file.name || '';
  const difficulty = props.difficulty || folder?.difficulty || 'EXPERT';
  const level = props.level ? Number(props.level) : folder?.level ?? '';
  const missCount = props.missCount !== null && !Number.isNaN(props.missCount)
    ? props.missCount
    : parseMissFromFileName(file.name) ?? 0;

  return {
    id: file.id,
    fileId: file.id,
    folderId: parentId,
    parentId,
    title,
    level,
    difficulty,
    difficultyRaw: difficulty,
    missCount,
    perfect: props.perfect,
    great: props.great,
    good: props.good,
    bad: props.bad,
    miss: props.miss,
    combo: props.combo,
    profileId: props.profileId,
    addedAt: file.createdTime || file.modifiedTime || nowIso(),
    modifiedAt: file.modifiedTime || file.createdTime || nowIso(),
    thumbnail: file.thumbnailLink || '',
    fileName: file.name,
    appProperties: file.appProperties || {},
    isFC: Number(missCount) === 0,
    musicId: null,
    isBest: false,
  };
}

async function loadAllRecords() {
  const { root, fc, songFolders } = await loadProjectRootFolders();
  if (!root || !fc) return [];

  const folderMap = new Map();
  for (const folder of songFolders) {
    const parsed = parseFolderTitle(folder.name);
    if (parsed) folderMap.set(folder.id, { ...parsed, folderId: folder.id });
  }

  const files = await fetchAllDriveItems(
    `name contains 'FC' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
    'id,name,parents,thumbnailLink,createdTime,modifiedTime,appProperties'
  );

  const records = [];
  for (const file of files) {
    const parentId = (file.parents || []).find((pid) => folderMap.has(pid));
    if (!parentId) continue;
    const rec = deriveRecord(file, folderMap);
    records.push(rec);
  }
  recomputeBestFlags(records);
  return records;
}

function getCurrentProfile() {
  return state.settings.profiles[state.settings.selectedProfileId] || state.settings.profiles.default;
}

function renderProfileSelects() {
  const profiles = Object.values(state.settings.profiles).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ja'));
  const options = profiles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join('');
  for (const id of ['profile-select', 'batch-profile-select', 'settings-profile-select']) {
    const select = el(id);
    if (!select) continue;
    select.innerHTML = options;
    select.value = state.settings.selectedProfileId;
  }
  const profile = getCurrentProfile();
  const hint = el('current-profile-hint');
  if (hint && profile) hint.textContent = `${profile.name || profile.id} / ${Math.round(profile.width || 0)}×${Math.round(profile.height || 0)}`;
  const batchBadge = el('batch-profile-badge');
  if (batchBadge && profile) batchBadge.textContent = `選択中: ${profile.name || profile.id}`;
}

function updateProfileHint() {
  const profile = getCurrentProfile();
  const hint = el('current-profile-hint');
  if (hint && profile) {
    hint.textContent = `${profile.name || profile.id} / ${Math.round(profile.width || 0)}×${Math.round(profile.height || 0)} / ${(profile.ratio || 0).toFixed(4)}`;
  }
}

function updateStatusBar() {
  const count = el('result-count');
  if (!count) return;
  count.textContent = `表示: ${state.filteredRecords.length} 件 / 全 ${state.allRecords.length} 件`;
}

function collectFilters() {
  return {
    fc: el('filter-fc')?.value || state.ui.filterFc || 'all',
    missMin: el('filter-miss-min')?.value || '',
    missMax: el('filter-miss-max')?.value || '',
    diff: el('filter-diff')?.value || 'all',
    level: el('filter-level')?.value || '',
    title: el('filter-title')?.value || '',
    bestOnly: Boolean(el('filter-best-only')?.checked),
    sortOrder: el('sort-order')?.value || state.ui.sortOrder || 'level_desc',
  };
}

function saveFiltersToState() {
  const f = collectFilters();
  state.ui.filterFc = f.fc;
  state.ui.filterMissMin = f.missMin;
  state.ui.filterMissMax = f.missMax;
  state.ui.filterDiff = f.diff;
  state.ui.filterTitle = f.title;
  state.ui.filterLevel = f.level;
  state.ui.bestOnly = f.bestOnly;
  state.ui.sortOrder = f.sortOrder;
  saveUiState();
}

function passesFilters(record, filters) {
  if (filters.fc === 'fc' && !record.isFC) return false;
  if (filters.fc === 'unfc' && record.isFC) return false;
  if (filters.bestOnly && !record.isBest) return false;
  if (!record.isFC) {
    if (filters.missMin !== '' && Number(record.missCount) < Number(filters.missMin)) return false;
    if (filters.missMax !== '' && Number(record.missCount) > Number(filters.missMax)) return false;
  } else if (filters.missMin !== '' && Number(filters.missMin) > 0) {
    return false;
  }
  if (filters.diff !== 'all' && String(record.difficultyRaw) !== String(filters.diff)) return false;
  if (filters.level !== '' && String(record.level) !== String(filters.level)) return false;
  if (filters.title && !String(record.title).toLowerCase().includes(String(filters.title).trim().toLowerCase())) return false;
  return true;
}

function sortFilteredRecords(records, sortOrder) {
  const opt = SORT_OPTIONS[sortOrder] || SORT_OPTIONS.level_desc;
  const dir = opt.direction || -1;
  const key = opt.key;

  return [...records].sort((a, b) => {
    const nameCmp = String(a.title || '').localeCompare(String(b.title || ''), 'ja');
    const levelCmp = (Number(a.level) || 0) - (Number(b.level) || 0);
    const diffCmp = diffSortValue(a.difficulty) - diffSortValue(b.difficulty);
    const missCmp = (Number(a.missCount) || 0) - (Number(b.missCount) || 0);
    const dateCmp = new Date(a.addedAt || 0) - new Date(b.addedAt || 0);

    if (key === 'name') return dir * nameCmp || diffCmp || missCmp || dateCmp;
    if (key === 'level') return dir * levelCmp || diffCmp || nameCmp || missCmp || dateCmp;
    if (key === 'miss') return dir * missCmp || levelCmp || diffCmp || nameCmp || dateCmp;
    if (key === 'date') return dir * dateCmp || nameCmp;
    return levelCmp || diffCmp || nameCmp || missCmp || dateCmp;
  });
}

function createCard(record) {
  const card = document.createElement('div');
  card.className = `card ${record.isFC ? 'is-fc' : ''} ${record.isBest ? 'best-record' : ''}`;
  card.id = `card-${record.id}`;
  card.dataset.id = record.id;

  const thumb = record.thumbnail ? record.thumbnail.replace('=s220', '=w600') : '';
  const large = record.thumbnail ? record.thumbnail.replace('=s220', '=w1600') : '';
  const resultLine = `
    <div class="score-info">
      <span style="display:flex;align-items:center;gap:2px;">
        <span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span>
        Result
      </span>
      <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        <span>${record.isFC ? '<span class="miss-val zero">FC-0</span>' : `FC -<span class="miss-val">${escapeHtml(record.missCount)}</span>`}</span>
        <span style="font-size:0.78rem;color:#666;">P:${escapeHtml(record.perfect ?? '-')} G:${escapeHtml(record.great ?? '-')} C:${escapeHtml(record.combo ?? '-')}</span>
      </span>
    </div>
  `;

  const bestBadge = record.isBest ? `<div class="best-badge"><span class="material-symbols-outlined" style="font-size:1rem;">star</span> BEST</div>` : '';
  const fcBadge = record.isFC ? `<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>` : '';

  const overlayActions = state.selectMode ? '' : `
    <div class="card-overlay-actions">
      <div class="btn-overlay" onclick="event.stopPropagation(); individualEdit('${record.id}')" title="編集"><span class="material-symbols-outlined">edit</span></div>
      <div class="btn-overlay del" onclick="event.stopPropagation(); individualDelete('${record.id}')" title="削除"><span class="material-symbols-outlined">delete</span></div>
    </div>
  `;

  const titleInfo = `
    <div class="song-meta">
      <span class="tag lvl">Lv.${escapeHtml(record.level)}</span>
      <span class="tag diff-${escapeHtml(record.difficultyRaw)}">${escapeHtml(record.difficulty)}</span>
    </div>
    <div class="song-title">${escapeHtml(record.title)}</div>
  `;

  card.innerHTML = `
    <div class="card-img-container">
      ${bestBadge}
      ${fcBadge}
      ${overlayActions}
      <div class="img-loader-spinner"></div>
      ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" onload="this.style.opacity=1;this.previousElementSibling.style.display='none';" onclick="event.stopPropagation(); ${state.selectMode ? `toggleSelection('${record.id}')` : `openImageModal('${large}')`}">` : '<span style="color:#aaa;">NO IMAGE</span>'}
    </div>
    <div class="card-body">
      ${titleInfo}
      ${resultLine}
    </div>
  `;

  if (state.selectMode) {
    card.classList.add('select-mode-active');
    if (state.selectedIds.has(record.id)) card.classList.add('selected');
    card.onclick = () => toggleSelection(record.id);
  } else {
    card.onclick = () => openImageModal(large);
  }
  return card;
}

async function renderGrid(records) {
  const token = ++state.renderSeq;
  const grid = el('grid');
  if (!grid) return;
  grid.innerHTML = '';
  updateStatusBar();

  if (records.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#666;">データなし</div>';
    setViewProgress('', 0);
    return;
  }

  const chunkSize = 50;
  for (let i = 0; i < records.length; i += chunkSize) {
    if (token !== state.renderSeq) return;
    const slice = records.slice(i, i + chunkSize);
    const frag = document.createDocumentFragment();
    for (const rec of slice) frag.appendChild(createCard(rec));
    grid.appendChild(frag);
    setViewProgress('描画中', (i + slice.length) / records.length);
    await nextFrame();
  }
  setViewProgress('', 1);
}

async function updateView() {
  saveFiltersToState();
  const filters = collectFilters();
  const list = [];
  const total = state.allRecords.length || 1;
  let processed = 0;

  setViewProgress('絞り込み中', 0, true);
  for (const record of state.allRecords) {
    if (passesFilters(record, filters)) list.push(record);
    processed += 1;
    if (processed % 100 === 0) {
      setViewProgress(`絞り込み中 ${processed}/${state.allRecords.length}`, processed / total);
      await nextFrame();
    }
  }

  setViewProgress('並び替え中', 0.8, true);
  const sorted = sortFilteredRecords(list, filters.sortOrder);
  state.filteredRecords = sorted;
  await renderGrid(sorted);
}

function setAuthUi(loggedIn) {
  el('authorize_button').style.display = loggedIn ? 'none' : 'inline-flex';
  el('signout_button').style.display = loggedIn ? 'inline-flex' : 'none';
  el('upload_button').style.display = loggedIn ? 'inline-flex' : 'none';
  el('settings_button').style.display = loggedIn ? 'inline-flex' : 'none';
  el('btn-select-mode').style.display = loggedIn ? 'inline-flex' : 'none';
  el('auth-status').textContent = loggedIn ? 'ログイン済み' : '未ログイン';
}

async function fetchDataFromDrive() {
  const token = ++state.loadSeq;
  setLoaderVisible(true, 'データ取得中...', 0.05);
  try {
    const records = await loadAllRecordsWithProgress((label, progress) => {
      if (token !== state.loadSeq) return;
      setLoaderVisible(true, label, progress);
    });
    state.allRecords = records;
    recomputeBestFlags(state.allRecords);
    await updateView();
    setLoaderVisible(false);
    toast(`${state.allRecords.length} 件を読み込みました`, 'success');
  } catch (err) {
    console.error(err);
    setLoaderVisible(false);
    toast('Drive の読み込みに失敗しました。', 'warn');
  }
}

async function loadAllRecordsWithProgress(progressCb) {
  progressCb('フォルダを検索中', 0.1);
  const root = await getFolderByName('プロセカリザルト');
  if (!root) return [];
  const fc = await getFolderByName('FC', root.id);
  if (!fc) return [];

  progressCb('曲フォルダを取得中', 0.25);
  const songFolders = await fetchAllDriveItems(
    `'${fc.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    'id,name,parents,createdTime,modifiedTime'
  );

  const folderMap = new Map();
  songFolders.forEach((folder) => {
    const parsed = parseFolderTitle(folder.name);
    if (parsed) folderMap.set(folder.id, { ...parsed, folderId: folder.id });
  });

  progressCb('画像を取得中', 0.45);
  const files = await fetchAllDriveItems(
    `name contains 'FC' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
    'id,name,parents,thumbnailLink,createdTime,modifiedTime,appProperties'
  );

  const records = [];
  let i = 0;
  for (const file of files) {
    i += 1;
    const parentId = (file.parents || []).find((pid) => folderMap.has(pid));
    if (!parentId) continue;
    const parentInfo = folderMap.get(parentId);
    const props = parseAppProperties(file);
    const missCount = props.missCount !== null && !Number.isNaN(props.missCount)
      ? props.missCount
      : parseMissFromFileName(file.name) ?? 0;
    const title = props.title || parentInfo.title || file.name;
    const difficulty = props.difficulty || parentInfo.difficulty;
    const level = props.level ? Number(props.level) : parentInfo.level;
    records.push({
      id: file.id,
      fileId: file.id,
      folderId: parentId,
      parentId,
      title,
      level,
      difficulty,
      difficultyRaw: difficulty,
      missCount,
      perfect: props.perfect,
      great: props.great,
      good: props.good,
      bad: props.bad,
      miss: props.miss,
      combo: props.combo,
      profileId: props.profileId,
      addedAt: file.createdTime || file.modifiedTime || nowIso(),
      modifiedAt: file.modifiedTime || file.createdTime || nowIso(),
      thumbnail: file.thumbnailLink || '',
      fileName: file.name,
      appProperties: file.appProperties || {},
      isFC: Number(missCount) === 0,
      musicId: null,
      isBest: false,
    });
    if (i % 100 === 0) progressCb(`解析中 ${i}/${files.length}`, 0.45 + (i / Math.max(files.length, 1)) * 0.45);
  }

  recomputeBestFlags(records);
  return records;
}

function getActiveBatchProfile() {
  return state.settings.profiles[state.settings.selectedProfileId] || state.settings.profiles.default;
}

async function openBatchModal(mode) {
  state.batch.mode = mode;
  state.batch.items = [];
  state.batch.currentIndex = -1;
  el('batchModal').style.display = 'flex';

  renderProfileSelects();
  updateProfileHint();

  if (mode === 'upload') {
    el('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
    el('upload-initial').style.display = 'flex';
    el('batch-workspace').style.display = 'none';
    el('btn-exec-batch').textContent = '全てアップロード';
    el('up-file').value = '';
    el('batch-status-msg').textContent = '画像を選択してください';
    el('batch-sidebar-list').innerHTML = '';
  } else {
    el('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析';
    el('upload-initial').style.display = 'none';
    el('batch-workspace').style.display = 'flex';
    el('btn-exec-batch').textContent = '保存して反映';
    el('batch-status-msg').textContent = '選択項目を読み込み中...';
    await prepareBatchEditItems();
  }
}

function closeBatchModal() {
  el('batchModal').style.display = 'none';
  state.batch.items = [];
  state.batch.currentIndex = -1;
  state.batch.busy = false;
}

function closeImageModal() {
  el('imageModal').style.display = 'none';
}

function openImageModal(src) {
  el('modalImg').src = src;
  el('imageModal').style.display = 'flex';
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;

  el('upload-initial').style.display = 'none';
  el('batch-workspace').style.display = 'flex';
  el('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
  el('btn-exec-batch').textContent = '全てアップロード';
  el('batch-status-msg').textContent = '読み込み中...';

  const currentProfile = getActiveBatchProfile();
  for (const file of files) {
    const size = await getImageSize(file);
    const matched = detectProfileFromImageSize(state.settings.profiles, size.width, size.height);
    const profile = matched || currentProfile;
    const item = {
      id: uid('item'),
      mode: 'upload',
      file,
      previewUrl: URL.createObjectURL(file),
      sourceBlob: file,
      sourceRecord: null,
      size,
      profileId: profile?.id || currentProfile.id,
      data: {
        title: '',
        level: '',
        difficulty: 'EXPERT',
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        miss: 0,
        combo: null,
        missCount: 0,
      },
      status: '待機中',
    };
    state.batch.items.push(item);
  }
  renderBatchSidebar();
  selectBatchItem(state.batch.items[0]?.id || null);
  const first = state.batch.items[0];
  if (first) {
    state.settings.selectedProfileId = first.profileId;
    saveSettings(state.settings);
    renderProfileSelects();
    updateProfileHint();
  }
  state.batch.mode = 'upload';
  el('batch-empty-msg').style.display = 'none';
  el('batch-editor-container').style.display = 'flex';
  await analyzeAllInBatch();
}

async function prepareBatchEditItems() {
  const selected = state.allRecords.filter((r) => state.selectedIds.has(r.id));
  if (!selected.length) {
    el('batch-sidebar-list').innerHTML = '';
    el('batch-empty-msg').style.display = 'block';
    el('batch-empty-msg').textContent = '選択された項目がありません';
    el('btn-exec-batch').disabled = true;
    return;
  }
  const items = [];
  for (const record of selected) {
    let blob = null;
    try {
      blob = await downloadFileBlob(record.fileId);
    } catch (e) {
      console.warn(e);
    }
    const previewUrl = record.thumbnail ? record.thumbnail.replace('=s220', '=w1200') : (blob ? URL.createObjectURL(blob) : '');
    items.push({
      id: uid('edit'),
      mode: 'edit',
      file: blob,
      previewUrl,
      sourceBlob: blob,
      sourceRecord: record,
      profileId: record.profileId || state.settings.selectedProfileId,
      data: {
        title: record.title,
        level: record.level,
        difficulty: record.difficulty || 'EXPERT',
        perfect: record.perfect ?? 0,
        great: record.great ?? 0,
        good: record.good ?? 0,
        bad: record.bad ?? 0,
        miss: record.miss ?? 0,
        combo: record.combo ?? null,
        missCount: record.missCount ?? 0,
      },
      status: '待機中',
    });
  }
  state.batch.items = items;
  renderBatchSidebar();
  selectBatchItem(items[0].id);
  el('batch-empty-msg').style.display = 'none';
  el('batch-editor-container').style.display = 'flex';
  el('btn-exec-batch').disabled = false;
  await analyzeAllInBatch();
}

function renderBatchSidebar() {
  const list = el('batch-sidebar-list');
  list.innerHTML = '';
  for (const item of state.batch.items) {
    const row = document.createElement('div');
    row.className = `sidebar-item ${state.batch.currentIndex >= 0 && state.batch.items[state.batch.currentIndex]?.id === item.id ? 'active' : ''}`;
    row.id = `sb-${item.id}`;
    row.innerHTML = `
      <img src="${item.previewUrl}" alt="" loading="lazy">
      <div class="sidebar-item-body">
        <div id="sb-title-${item.id}" class="sidebar-item-title">${escapeHtml(item.data.title || '未解析')}</div>
        <div class="small-muted">${escapeHtml(item.profileId || '')}</div>
        <div id="sb-status-${item.id}" class="upload-status">${escapeHtml(item.status)}</div>
      </div>
    `;
    row.onclick = () => selectBatchItem(item.id);
    list.appendChild(row);
  }
}

function findBatchItem(id) {
  return state.batch.items.find((item) => item.id === id) || null;
}

function selectBatchItem(id) {
  const idx = state.batch.items.findIndex((item) => item.id === id);
  if (idx < 0) return;
  state.batch.currentIndex = idx;
  const item = state.batch.items[idx];
  el('batch-preview-img').src = item.previewUrl;
  el('up-title').value = item.data.title || '';
  el('up-level').value = item.data.level || '';
  el('up-diff').value = item.data.difficulty || 'EXPERT';
  el('up-perfect').value = item.data.perfect ?? 0;
  el('up-great').value = item.data.great ?? 0;
  el('up-good').value = item.data.good ?? 0;
  el('up-bad').value = item.data.bad ?? 0;
  el('up-miss-detail').value = item.data.miss ?? 0;
  el('up-combo').value = item.data.combo ?? '';
  updateTotalMiss();
  [...document.querySelectorAll('.sidebar-item')].forEach((node) => node.classList.remove('active'));
  const active = el(`sb-${id}`);
  if (active) active.classList.add('active');
  renderPreviewProfileBadge(item);
}

function renderPreviewProfileBadge(item) {
  const badge = el('batch-preview-profile-badge') || el('batch-profile-badge');
  if (!badge) return;
  const profile = item?.profileId && state.settings.profiles[item.profileId]
    ? state.settings.profiles[item.profileId]
    : getCurrentProfile();
  badge.textContent = profile ? `機種: ${profile.name || profile.id}` : '';
}

function updateCurrentItem(field, value) {
  const item = state.batch.items[state.batch.currentIndex];
  if (!item) return;
  if (field === 'combo') {
    item.data.combo = value === '' ? null : Number(value);
  } else if (field === 'level') {
    item.data.level = value;
  } else if (field === 'difficulty') {
    item.data.difficulty = value;
  } else {
    item.data[field] = Number(value);
  }
  if (field === 'title') {
    const titleNode = el(`sb-title-${item.id}`);
    if (titleNode) titleNode.textContent = value || '未解析';
  }
  item.data.missCount = Number(item.data.good || 0) + Number(item.data.bad || 0) + Number(item.data.miss || 0);
  updateTotalMiss();
  const statusNode = el(`sb-status-${item.id}`);
  if (statusNode) statusNode.textContent = '編集中';
}

function updateTotalMiss() {
  const total = Number(el('up-good')?.value || 0) + Number(el('up-bad')?.value || 0) + Number(el('up-miss-detail')?.value || 0);
  el('up-total-miss').textContent = String(total);
  const item = state.batch.items[state.batch.currentIndex];
  if (item) item.data.missCount = total;
}

async function analyzeBatchItem(item) {
  if (!item) return;
  const profile = state.settings.profiles[item.profileId] || getCurrentProfile();
  if (!profile) throw new Error('profile not found');

  let blob = item.sourceBlob;
  if (!blob && item.sourceRecord?.fileId) {
    blob = await downloadFileBlob(item.sourceRecord.fileId);
  }
  if (!blob) throw new Error('blob not available');

  const analysis = await analyzeScreenshot(blob, profile);
  const matched = findBestMatchMusic(analysis.titleText);
  const title = matched?.title || analysis.titleText || item.data.title || '';
  const musicId = matched?.id || null;
  const levelFromDb = getLevelFromDb(musicId, analysis.diff);
  const level = levelFromDb || item.data.level || '';
  const missCount = Number(analysis.counts.good || 0) + Number(analysis.counts.bad || 0) + Number(analysis.counts.miss || 0);

  item.data = {
    ...item.data,
    title,
    level,
    difficulty: analysis.diff,
    perfect: analysis.counts.perfect || 0,
    great: analysis.counts.great || 0,
    good: analysis.counts.good || 0,
    bad: analysis.counts.bad || 0,
    miss: analysis.counts.miss || 0,
    combo: analysis.combo,
    missCount,
  };

  if (matched) item.musicId = musicId;
  item.profileId = profile.id;

  if (state.batch.currentIndex >= 0 && state.batch.items[state.batch.currentIndex]?.id === item.id) {
    el('up-title').value = item.data.title || '';
    el('up-level').value = item.data.level || '';
    el('up-diff').value = item.data.difficulty || 'EXPERT';
    el('up-perfect').value = item.data.perfect || 0;
    el('up-great').value = item.data.great || 0;
    el('up-good').value = item.data.good || 0;
    el('up-bad').value = item.data.bad || 0;
    el('up-miss-detail').value = item.data.miss || 0;
    el('up-combo').value = item.data.combo ?? '';
    updateTotalMiss();
  }

  const titleNode = el(`sb-title-${item.id}`);
  if (titleNode) titleNode.textContent = item.data.title || '未解析';
  const statusNode = el(`sb-status-${item.id}`);
  if (statusNode) statusNode.textContent = '解析済み';
}

async function analyzeAllInBatch() {
  if (!state.batch.items.length) return;
  state.batch.busy = true;
  el('btn-exec-batch').disabled = true;
  for (let i = 0; i < state.batch.items.length; i++) {
    const item = state.batch.items[i];
    const status = el(`sb-status-${item.id}`);
    if (status) status.textContent = '解析中';
    try {
      await analyzeBatchItem(item);
      if (status) status.textContent = '解析済み';
    } catch (err) {
      console.error(err);
      if (status) status.textContent = '失敗';
    }
    setLoaderVisible(true, `解析中 ${i + 1}/${state.batch.items.length}`, (i + 1) / state.batch.items.length);
    await nextFrame();
  }
  setLoaderVisible(false);
  state.batch.busy = false;
  el('btn-exec-batch').disabled = false;
}

async function reanalyzeCurrentItem() {
  const item = state.batch.items[state.batch.currentIndex];
  if (!item) return;
  try {
    await analyzeBatchItem(item);
    toast('再解析しました', 'success');
  } catch (err) {
    console.error(err);
    toast('再解析に失敗しました', 'warn');
  }
}

function updateBatchStatus(text) {
  const status = el('batch-status-msg');
  if (status) status.textContent = text;
}

async function handleBatchExecution() {
  if (!state.batch.items.length) return;
  if (state.batch.busy) return;
  state.batch.busy = true;
  el('btn-exec-batch').disabled = true;

  const results = [];
  let success = 0;
  let bestUpdated = 0;

  for (let i = 0; i < state.batch.items.length; i++) {
    const item = state.batch.items[i];
    const status = el(`sb-status-${item.id}`);
    if (status) status.textContent = state.batch.mode === 'upload' ? '送信中' : '保存中';

    try {
      const meta = {
        title: item.data.title,
        level: item.data.level,
        difficulty: item.data.difficulty || 'EXPERT',
        perfect: Number(item.data.perfect || 0),
        great: Number(item.data.great || 0),
        good: Number(item.data.good || 0),
        bad: Number(item.data.bad || 0),
        miss: Number(item.data.miss || 0),
        combo: item.data.combo === '' ? null : item.data.combo,
        missCount: Number(item.data.missCount || 0),
        profileId: item.profileId || state.settings.selectedProfileId,
      };

      if (!meta.title || meta.level === '') throw new Error('必須項目不足');
      const missCount = Number(meta.missCount || 0);
      const fileName = buildFileName(meta);
      const appProperties = buildAppProperties(meta);
      const targetFolderName = `${meta.level} ${meta.difficulty} ${meta.title}`;
      const root = await findOrCreateFolder('プロセカリザルト');
      const fc = await findOrCreateFolder('FC', root.id);
      const songFolder = await findOrCreateFolder(targetFolderName, fc.id);

      let saved;
      if (state.batch.mode === 'upload') {
        saved = await uploadFileToDrive({
          blob: item.sourceBlob || item.file,
          filename: fileName,
          parentId: songFolder.id,
          appProperties,
        });
      } else {
        const source = item.sourceRecord;
        const addParentId = source.folderId !== songFolder.id ? songFolder.id : null;
        const removeParentId = source.folderId !== songFolder.id ? source.folderId : null;
        saved = await updateFileOnDrive(source.fileId, {
          name: fileName,
          addParentId,
          removeParentId,
          appProperties,
        });
      }

      success += 1;
      if (state.batch.mode === 'upload') {
        const newRecord = {
          id: saved.id,
          fileId: saved.id,
          folderId: songFolder.id,
          parentId: songFolder.id,
          title: meta.title,
          level: meta.level,
          difficulty: meta.difficulty,
          difficultyRaw: meta.difficulty,
          missCount,
          perfect: meta.perfect,
          great: meta.great,
          good: meta.good,
          bad: meta.bad,
          miss: meta.miss,
          combo: meta.combo,
          profileId: meta.profileId,
          addedAt: saved.createdTime || nowIso(),
          modifiedAt: saved.modifiedTime || nowIso(),
          thumbnail: saved.thumbnailLink || '',
          fileName,
          appProperties,
          isFC: missCount === 0,
          musicId: item.musicId || null,
          isBest: false,
        };
        state.allRecords.push(newRecord);
        recomputeBestFlags(state.allRecords);
        const bestNow = state.bestMap.get(buildRecordKey(newRecord));
        if (bestNow && bestNow.id === newRecord.id) {
          bestUpdated += 1;
          toast(`自己ベスト更新: ${meta.title}`, 'success');
        }
      } else {
        const record = state.allRecords.find((r) => r.id === item.sourceRecord.id);
        if (record) {
          record.title = meta.title;
          record.level = meta.level;
          record.difficulty = meta.difficulty;
          record.difficultyRaw = meta.difficulty;
          record.missCount = missCount;
          record.perfect = meta.perfect;
          record.great = meta.great;
          record.good = meta.good;
          record.bad = meta.bad;
          record.miss = meta.miss;
          record.combo = meta.combo;
          record.profileId = meta.profileId;
          record.isFC = missCount === 0;
          record.modifiedAt = nowIso();
        }
        recomputeBestFlags(state.allRecords);
      }

      if (status) status.textContent = '完了';
      if (state.batch.mode === 'edit' && item.sourceRecord) {
        const idx = state.allRecords.findIndex((r) => r.id === item.sourceRecord.id);
        if (idx >= 0) results.push(state.allRecords[idx]);
      }
    } catch (err) {
      console.error(err);
      if (status) status.textContent = '失敗';
    }
    await nextFrame();
  }

  await updateView();
  updateBatchStatus(`完了: ${success} 件${bestUpdated ? ` / 自己ベスト更新: ${bestUpdated} 件` : ''}`);
  toast(state.batch.mode === 'upload' ? `アップロード完了: ${success} 件` : `保存完了: ${success} 件`, 'success');
  if (state.batch.mode === 'upload' && bestUpdated) {
    toast('自己ベストを更新しました', 'success');
  }
  state.batch.busy = false;
  el('btn-exec-batch').disabled = false;
  if (state.batch.mode === 'upload') {
    closeBatchModal();
  }
}

function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) state.selectedIds.clear();
  saveUiState();
  renderSelectModeUI();
  updateView();
}

function renderSelectModeUI() {
  const btn = el('btn-select-mode');
  if (!btn) return;
  btn.classList.toggle('active', state.selectMode);
  btn.innerHTML = `<span class="material-symbols-outlined">check_box</span> ${state.selectMode ? '選択中' : '選択モード'}`;
  const actions = el('batch-actions');
  if (actions) actions.style.display = state.selectMode ? 'flex' : 'none';
  const count = el('selected-count');
  if (count) count.textContent = String(state.selectedIds.size);
}

function toggleSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  const card = el(`card-${id}`);
  if (card) card.classList.toggle('selected', state.selectedIds.has(id));
  renderSelectModeUI();
}

function clearSelection() {
  state.selectedIds.clear();
  renderSelectModeUI();
  updateView();
}

function batchDelete() {
  if (!state.selectedIds.size) return;
  if (!confirm(`選択した ${state.selectedIds.size} 件を削除しますか？`)) return;
  const ids = Array.from(state.selectedIds);
  (async () => {
    let count = 0;
    for (const id of ids) {
      try {
        await deleteFileOnDrive(id);
        state.allRecords = state.allRecords.filter((r) => r.id !== id);
        count += 1;
      } catch (err) {
        console.error(err);
      }
    }
    state.selectedIds.clear();
    recomputeBestFlags(state.allRecords);
    await updateView();
    renderSelectModeUI();
    toast(`削除しました: ${count} 件`, 'success');
  })();
}

function individualDelete(id) {
  const record = state.allRecords.find((r) => r.id === id);
  if (!record) return;
  if (!confirm(`「${record.title}」を削除しますか？`)) return;
  (async () => {
    try {
      await deleteFileOnDrive(id);
      state.allRecords = state.allRecords.filter((r) => r.id !== id);
      recomputeBestFlags(state.allRecords);
      await updateView();
      toast('削除しました', 'success');
    } catch (err) {
      console.error(err);
      toast('削除に失敗しました', 'warn');
    }
  })();
}

async function individualEdit(id) {
  const record = state.allRecords.find((r) => r.id === id);
  if (!record) return;
  state.selectedIds.clear();
  state.selectedIds.add(id);
  batchEdit();
}

function batchEdit() {
  if (!state.selectedIds.size) return;
  openBatchModal('edit');
}

function handleSortOrFilterChange() {
  updateView();
}

function setupSettingsModal() {
  state.settingsEditor.profileId = state.settings.selectedProfileId || 'default';
  renderProfileSelects();
  renderSettingsSummary();
  renderSettingsPanel();
}

function openSettingsModal() {
  state.settingsEditor.profileId = state.settings.selectedProfileId || 'default';
  renderProfileSelects();
  renderSettingsSummary();
  renderSettingsPanel();
  el('settingsModal').style.display = 'flex';
}

function closeSettingsModal() {
  el('settingsModal').style.display = 'none';
}


function getSettingsProfile() {
  return state.settings.profiles[state.settingsEditor.profileId] || getCurrentProfile();
}

function renderSettingsSummary() {
  const profile = getSettingsProfile();
  const summary = el('settings-summary');
  if (!summary || !profile) return;
  summary.textContent = `現在: ${profile.name || profile.id} / ${Math.round(profile.width || 0)}×${Math.round(profile.height || 0)} / 比率 ${(Number(profile.ratio || 0)).toFixed(5)}`;
}

function refreshProfileRatio() {
  const w = Number(el('settings-profile-width').value);
  const h = Number(el('settings-profile-height').value);
  if (w > 0 && h > 0) {
    el('settings-profile-ratio').value = (w / h).toFixed(5);
  }
}

function clampRegion(v) {
  return Math.max(0, Math.min(0.95, v));
}

function clampSize(v) {
  return Math.max(0.01, Math.min(1, v));
}

function syncRegionInputs() {
  const profile = getSettingsProfile();
  if (!profile) return;
  const key = state.settingsEditor.regionKey || 'difficulty';
  const region = profile.regions[key];
  if (!region) return;
  const map = {
    'region-x': region.x,
    'region-y': region.y,
    'region-w': region.w,
    'region-h': region.h,
  };
  for (const [id, value] of Object.entries(map)) {
    const input = el(id);
    if (input) input.value = Math.round(value * 1000) / 10;
  }
  renderRegionEditor();
}

function updateRegionFromInputs() {
  const profile = getSettingsProfile();
  if (!profile) return;
  const key = state.settingsEditor.regionKey || 'difficulty';
  const region = profile.regions[key];
  if (!region) return;
  region.x = clampRegion((Number(el('region-x').value) || 0) / 100);
  region.y = clampRegion((Number(el('region-y').value) || 0) / 100);
  region.w = clampSize((Number(el('region-w').value) || 0) / 100);
  region.h = clampSize((Number(el('region-h').value) || 0) / 100);
  saveSettings(state.settings);
  renderRegionEditor();
  renderSettingsSummary();
}

function renderRegionEditor() {
  const profile = getSettingsProfile();
  const overlay = el('settings-overlay');
  const img = el('settings-preview-img');
  if (!overlay || !img) return;
  overlay.innerHTML = '';
  if (!img.src || !img.complete) return;

  const overlayRect = overlay.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  if (!overlayRect.width || !overlayRect.height || !imgRect.width || !imgRect.height) return;

  const frame = {
    offsetX: (imgRect.left - overlayRect.left) / overlayRect.width,
    offsetY: (imgRect.top - overlayRect.top) / overlayRect.height,
    width: imgRect.width / overlayRect.width,
    height: imgRect.height / overlayRect.height,
  };

  const defs = [
    ['difficulty', '難易度'],
    ['title', '曲名'],
    ['result', '判定'],
    ['combo', 'コンボ'],
  ];

  for (const [key, label] of defs) {
    const region = profile.regions[key];
    if (!region) continue;
    const box = document.createElement('div');
    box.className = `region-box ${state.settingsEditor.regionKey === key ? 'active' : ''}`;
    box.dataset.regionKey = key;
    box.innerHTML = `
      <div class="region-label">${label}</div>
      <div class="handle nw" data-handle="nw"></div>
      <div class="handle ne" data-handle="ne"></div>
      <div class="handle sw" data-handle="sw"></div>
      <div class="handle se" data-handle="se"></div>
      <div class="handle n" data-handle="n"></div>
      <div class="handle s" data-handle="s"></div>
      <div class="handle w" data-handle="w"></div>
      <div class="handle e" data-handle="e"></div>
    `;
    box.style.left = `${(frame.offsetX + region.x * frame.width) * 100}%`;
    box.style.top = `${(frame.offsetY + region.y * frame.height) * 100}%`;
    box.style.width = `${region.w * frame.width * 100}%`;
    box.style.height = `${region.h * frame.height * 100}%`;
    box.addEventListener('pointerdown', startRegionPointer);
    overlay.appendChild(box);
  }
}

function startRegionPointer(e) {
  const box = e.currentTarget;
  const key = box.dataset.regionKey;
  const handle = e.target?.dataset?.handle || 'move';
  state.settingsEditor.regionKey = key;
  const profile = getSettingsProfile();
  const region = profile.regions[key];
  const img = el('settings-preview-img');
  const imgRect = img.getBoundingClientRect();

  const start = {
    x: e.clientX,
    y: e.clientY,
    region: { ...region },
    imgWidth: imgRect.width,
    imgHeight: imgRect.height,
    handle,
  };

  const onMove = (ev) => {
    const dx = (ev.clientX - start.x) / start.imgWidth;
    const dy = (ev.clientY - start.y) / start.imgHeight;
    const next = { ...start.region };
    if (handle === 'move') {
      next.x = clampRegion(start.region.x + dx);
      next.y = clampRegion(start.region.y + dy);
    } else {
      if (handle.includes('e')) next.w = clampSize(start.region.w + dx);
      if (handle.includes('s')) next.h = clampSize(start.region.h + dy);
      if (handle.includes('w')) {
        next.x = clampRegion(start.region.x + dx);
        next.w = clampSize(start.region.w - dx);
      }
      if (handle.includes('n')) {
        next.y = clampRegion(start.region.y + dy);
        next.h = clampSize(start.region.h - dy);
      }
    }
    region.x = next.x;
    region.y = next.y;
    region.w = next.w;
    region.h = next.h;
    saveSettings(state.settings);
    syncRegionInputs();
    renderRegionEditor();
  };

  const onUp = () => {
    box.removeEventListener('pointermove', onMove);
    box.removeEventListener('pointerup', onUp);
    box.removeEventListener('pointercancel', onUp);
  };

  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerup', onUp);
  box.addEventListener('pointercancel', onUp);
  box.setPointerCapture?.(e.pointerId);
}

function renderSettingsPanel() {
  const profile = getSettingsProfile();
  if (!profile) return;
  state.settingsEditor.regionKey = state.settingsEditor.regionKey || 'difficulty';
  const idSelect = el('settings-profile-select');
  if (idSelect) idSelect.value = profile.id;
  el('settings-profile-name').value = profile.name || profile.id;
  el('settings-profile-width').value = profile.width || '';
  el('settings-profile-height').value = profile.height || '';
  el('settings-profile-ratio').value = profile.ratio || '';
  el('settings-device-hint').value = profile.deviceHint || '';
  syncRegionInputs();
  renderSettingsSummary();
}
async function handleSettingsSampleFile(file) {
  if (!file) return;
  const imageUrl = URL.createObjectURL(file);
  state.settingsEditor.imageUrl = imageUrl;
  const img = el('settings-preview-img');
  img.src = imageUrl;
  await new Promise((resolve) => {
    img.onload = resolve;
  });
  state.settingsEditor.imageSize = { width: img.naturalWidth, height: img.naturalHeight };
  const profile = state.settings.profiles[state.settingsEditor.profileId] || getCurrentProfile();
  if (profile && profile.width && profile.height) {
    const match = detectProfileFromImageSize(state.settings.profiles, img.naturalWidth, img.naturalHeight);
    if (match) {
      state.settings.selectedProfileId = match.id;
      state.settingsEditor.profileId = match.id;
      saveSettings(state.settings);
      renderProfileSelects();
      renderSettingsPanel();
    }
  }
  renderRegionEditor();
}

function createNewProfile() {
  const base = getCurrentProfile();
  const id = makeProfileId('device');
  const next = cloneProfile(base);
  next.id = id;
  next.name = `${base.name || 'profile'} copy`;
  next.deviceHint = '';
  next.createdAt = nowIso();
  next.updatedAt = nowIso();
  state.settings = upsertProfile(state.settings, next);
  state.settings.selectedProfileId = id;
  state.settingsEditor.profileId = id;
  saveSettings(state.settings);
  setupSettingsModal();
}

function saveCurrentProfile() {
  const id = el('settings-profile-select').value;
  const current = cloneProfile(state.settings.profiles[id] || getCurrentProfile());
  current.id = id;
  current.name = el('settings-profile-name').value.trim() || current.name || id;
  current.width = Number(el('settings-profile-width').value) || current.width;
  current.height = Number(el('settings-profile-height').value) || current.height;
  current.ratio = Number(el('settings-profile-ratio').value) || (current.width / current.height);
  current.deviceHint = el('settings-device-hint').value.trim();

  state.settings.profiles[id] = current;
  state.settings.selectedProfileId = id;
  saveSettings(state.settings);
  renderProfileSelects();
  renderSettingsSummary();
  toast('設定を保存しました', 'success');
}

function deleteCurrentProfile() {
  const id = el('settings-profile-select').value;
  if (id === 'default') {
    toast('既定プロファイルは削除できません', 'warn');
    return;
  }
  if (!confirm('この機種設定を削除しますか？')) return;
  state.settings = deleteProfile(state.settings, id);
  saveSettings(state.settings);
  setupSettingsModal();
}

function selectProfileFromDropdown() {
  const id = el('profile-select').value;
  if (!state.settings.profiles[id]) return;
  state.settings.selectedProfileId = id;
  saveSettings(state.settings);
  renderProfileSelects();
  renderSettingsSummary();
  updateProfileHint();
}


function selectBatchProfileFromDropdown() {
  const id = el('batch-profile-select').value;
  if (!state.settings.profiles[id]) return;
  state.settings.selectedProfileId = id;
  saveSettings(state.settings);
  renderProfileSelects();
  updateProfileHint();
  renderPreviewProfileBadge(state.batch.items[state.batch.currentIndex] || null);
}

async function autoSelectProfileForFile(file) {
  const size = await getImageSize(file);
  const profile = detectProfileFromImageSize(state.settings.profiles, size.width, size.height);
  if (profile) {
    state.settings.selectedProfileId = profile.id;
    saveSettings(state.settings);
    renderProfileSelects();
    updateProfileHint();
  }
  return profile;
}

function restoreUIStateToControls() {
  el('sort-order').value = state.ui.sortOrder;
  el('filter-fc').value = state.ui.filterFc;
  el('filter-miss-min').value = state.ui.filterMissMin;
  el('filter-miss-max').value = state.ui.filterMissMax;
  el('filter-diff').value = state.ui.filterDiff;
  el('filter-title').value = state.ui.filterTitle;
  el('filter-level').value = state.ui.filterLevel;
  el('filter-best-only').checked = state.ui.bestOnly;
  renderSelectModeUI();
  renderProfileSelects();
  updateProfileHint();
}

function bindEvents() {
  el('authorize_button').onclick = handleAuthClick;
  el('signout_button').onclick = handleSignoutClick;
  el('upload_button').onclick = () => openBatchModal('upload');
  el('settings_button').onclick = openSettingsModal;
  if (el('batch-open-settings')) el('batch-open-settings').onclick = openSettingsModal;
  el('btn-select-mode').onclick = toggleSelectMode;

  el('profile-select').onchange = selectProfileFromDropdown;
  if (el('batch-profile-select')) el('batch-profile-select').onchange = selectBatchProfileFromDropdown;
  el('sort-order').onchange = updateView;
  el('filter-fc').onchange = updateView;
  el('filter-diff').onchange = updateView;
  el('filter-miss-min').oninput = updateView;
  el('filter-miss-max').oninput = updateView;
  el('filter-title').oninput = updateView;
  el('filter-level').oninput = updateView;
  el('filter-best-only').onchange = updateView;

  el('up-title').oninput = (e) => updateCurrentItem('title', e.target.value);
  el('up-level').oninput = (e) => updateCurrentItem('level', e.target.value);
  el('up-diff').onchange = (e) => updateCurrentItem('difficulty', e.target.value);
  el('up-perfect').oninput = (e) => updateCurrentItem('perfect', e.target.value);
  el('up-great').oninput = (e) => updateCurrentItem('great', e.target.value);
  el('up-good').oninput = (e) => updateCurrentItem('good', e.target.value);
  el('up-bad').oninput = (e) => updateCurrentItem('bad', e.target.value);
  el('up-miss-detail').oninput = (e) => updateCurrentItem('miss', e.target.value);
  el('up-combo').oninput = (e) => updateCurrentItem('combo', e.target.value);
  el('btn-exec-batch').onclick = handleBatchExecution;
  el('up-file').onchange = (e) => handleFiles(e.target.files);
  el('drop-zone').ondragover = (e) => { e.preventDefault(); el('drop-zone').classList.add('dragging'); };
  el('drop-zone').ondragleave = () => el('drop-zone').classList.remove('dragging');
  el('drop-zone').ondrop = (e) => {
    e.preventDefault();
    el('drop-zone').classList.remove('dragging');
    handleFiles(e.dataTransfer.files);
  };

  el('settings-new-btn').onclick = createNewProfile;
  el('settings-save-btn').onclick = saveCurrentProfile;
  el('settings-delete-btn').onclick = deleteCurrentProfile;
  el('settings-close-btn').onclick = closeSettingsModal;
  el('settings-sample-file').onchange = (e) => handleSettingsSampleFile(e.target.files[0]);
  el('settings-profile-select').onchange = () => {
    state.settingsEditor.profileId = el('settings-profile-select').value;
    renderSettingsPanel();
  };
  document.querySelectorAll('#settingsModal [data-region]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.settingsEditor.regionKey = btn.dataset.region;
      syncRegionInputs();
      renderRegionEditor();
    });
  });
  el('region-x').oninput = updateRegionFromInputs;
  el('region-y').oninput = updateRegionFromInputs;
  el('region-w').oninput = updateRegionFromInputs;
  el('region-h').oninput = updateRegionFromInputs;
  el('settings-profile-name').oninput = () => {};
  el('settings-profile-width').oninput = refreshProfileRatio;
  el('settings-profile-height').oninput = refreshProfileRatio;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeImageModal();
      closeBatchModal();
      closeSettingsModal();
    }
  });
}

async function handleAuthClick() {
  if (!state.gisReady) {
    toast('Googleログインの準備中です', 'warn');
    return;
  }
  state.tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) throw resp;
    state.loggedIn = true;
    setAuthUi(true);
    await fetchDataFromDrive();
  };
  if (window.gapi.client.getToken() === null) {
    state.tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    state.tokenClient.requestAccessToken({ prompt: '' });
  }
}

function handleSignoutClick() {
  revokeCurrentToken();
  state.loggedIn = false;
  setAuthUi(false);
  state.allRecords = [];
  state.filteredRecords = [];
  state.selectedIds.clear();
  updateStatusBar();
  el('grid').innerHTML = '';
  toast('ログアウトしました', 'success');
}


async function initializeExternalApis() {
  const deadline = Date.now() + 15000;
  while ((!window.gapi?.client || !window.google?.accounts?.oauth2) && Date.now() < deadline) {
    await sleep(100);
  }
  if (!window.gapi?.client || !window.google?.accounts?.oauth2) {
    toast('Google API の読み込みを待機中です', 'warn');
    return;
  }

  try {
    await initDriveClient();
    state.gapiReady = true;
  } catch (err) {
    console.error(err);
    toast('Drive 初期化に失敗しました', 'warn');
  }

  try {
    state.tokenClient = createTokenClient(async (resp) => {
      if (resp.error !== undefined) throw resp;
      state.loggedIn = true;
      setAuthUi(true);
      await fetchDataFromDrive();
    });
    state.gisReady = true;
  } catch (err) {
    console.error(err);
    toast('ログイン初期化に失敗しました', 'warn');
  }
}

function setupGlobals() {
  window.gapiLoaded = window.gapiLoaded || (() => {});
  window.gisLoaded = window.gisLoaded || (() => {});

  window.handleAuthClick = handleAuthClick;
  window.handleSignoutClick = handleSignoutClick;
  window.openBatchModal = openBatchModal;
  window.closeBatchModal = closeBatchModal;
  window.handleFiles = handleFiles;
  window.batchEdit = batchEdit;
  window.clearSelection = clearSelection;
  window.batchDelete = batchDelete;
  window.individualEdit = individualEdit;
  window.individualDelete = individualDelete;
  window.toggleSelectMode = toggleSelectMode;
  window.toggleSelection = toggleSelection;
  window.updateCurrentItem = updateCurrentItem;
  window.handleBatchExecution = handleBatchExecution;
  window.analyzeAllInBatch = analyzeAllInBatch;
  window.reanalyzeCurrentItem = reanalyzeCurrentItem;
  window.updateView = updateView;
  window.openImageModal = openImageModal;
  window.closeImageModal = closeImageModal;
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;
}

function initSettingsDefaults() {
  if (!state.settings.profiles.default) {
    state.settings.profiles.default = {
      id: 'default',
      name: 'Default / 既定',
      width: 1170,
      height: 2532,
      ratio: 1170 / 2532,
      deviceHint: '',
      regions: {
        difficulty: { x: 0.20, y: 0.07, w: 0.12, h: 0.05 },
        title: { x: 0.18, y: 0.01, w: 0.35, h: 0.055 },
        result: { x: 0.08, y: 0.54, w: 0.26, h: 0.30 },
        combo: { x: 0.37, y: 0.18, w: 0.26, h: 0.10 },
      },
    };
  }
  if (!state.settings.selectedProfileId || !state.settings.profiles[state.settings.selectedProfileId]) {
    state.settings.selectedProfileId = 'default';
  }
  saveSettings(state.settings);
}

async function initApp() {
  initSettingsDefaults();
  state.settingsEditor.profileId = state.settings.selectedProfileId || 'default';
  renderProfileSelects();
  restoreUIStateToControls();
  setAuthUi(false);
  updateStatusBar();
  setupGlobals();
  bindEvents();
  await initializeExternalApis();
  await loadDatabase();
  renderSelectModeUI();
  updateProfileHint();
  setLoaderVisible(false);
  if (state.ui.selectMode) {
    state.selectMode = true;
    renderSelectModeUI();
  }
  if (state.ui.bestOnly) {
    el('filter-best-only').checked = true;
  }
}

window.addEventListener('DOMContentLoaded', initApp);

export {
  parseFolderTitle,
  parseMissFromFileName,
  findBestMatchMusic,
  getLevelFromDb,
  buildAppProperties,
  buildFileName,
};
