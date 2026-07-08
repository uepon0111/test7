import { appState, bestKey, bestRecordsMap, compareRecordScore, isSelfBest, getDifficultyOrder, getDifficultyLabel, DIFFICULTY_COLORS } from './state.js';
import { escapeHtml, nextFrame, debounce, formatDate, normalizeString } from './utils.js';

let pendingViewUpdate = null;

function getSortCriterionLabel() {
  const key = appState.settings.sortKey || 'level';
  const direction = appState.settings.sortDirection || 'desc';
  const dirText = direction === 'asc' ? '昇順' : '降順';
  const labels = { title: '名前順', level: '楽曲レベル順', miss: 'ミス数順', date: '追加日順' };
  return `${labels[key] || '並び順'} / ${dirText}`;
}

export function setLoadingState(visible, text = '読み込み中...', progress = 0) {
  appState.loading.visible = visible;
  appState.loading.text = text;
  appState.loading.progress = Math.max(0, Math.min(1, progress || 0));
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loader-text');
  const loaderBar = document.getElementById('loader-progress-bar');
  if (!loader) return;
  loader.style.display = visible ? 'flex' : 'none';
  if (loaderText) loaderText.textContent = text;
  if (loaderBar) loaderBar.style.width = `${Math.round(appState.loading.progress * 100)}%`;
}

export function showToast(message, kind = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(appState.activeToastTimer);
  appState.activeToastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function getScoreGroupValue(rec) {
  return Number(rec.missCount ?? rec.totalMiss ?? 0);
}

function compareByKey(a, b, key, direction) {
  const dir = direction === 'asc' ? 1 : -1;
  if (key === 'title') {
    return dir * a.title.localeCompare(b.title, 'ja');
  }
  if (key === 'level') {
    return dir * ((Number(a.level) || 0) - (Number(b.level) || 0));
  }
  if (key === 'miss') {
    return dir * (getScoreGroupValue(a) - getScoreGroupValue(b));
  }
  if (key === 'date') {
    return dir * (new Date(a.createdTime || a.uploadedAt || 0).getTime() - new Date(b.createdTime || b.uploadedAt || 0).getTime());
  }
  return 0;
}

function compareDifficulty(a, b, direction) {
  const dir = direction === 'asc' ? 1 : -1;
  return dir * (getDifficultyOrder(a.difficultyRaw) - getDifficultyOrder(b.difficultyRaw));
}

function sortRecords(list) {
  const key = appState.settings.sortKey || 'level';
  const dir = appState.settings.sortDirection || 'desc';
  const sorted = list.slice();
  sorted.sort((a, b) => {
    if (key === 'date') {
      return compareByKey(a, b, 'date', dir);
    }
    if (key === 'title') {
      return (
        compareByKey(a, b, 'title', dir) ||
        compareDifficulty(a, b, dir) ||
        compareByKey(a, b, 'miss', dir) ||
        compareByKey(a, b, 'date', dir)
      );
    }
    if (key === 'level') {
      return (
        compareByKey(a, b, 'level', dir) ||
        compareDifficulty(a, b, dir) ||
        compareByKey(a, b, 'title', dir) ||
        compareByKey(a, b, 'miss', dir) ||
        compareByKey(a, b, 'date', dir)
      );
    }
    if (key === 'miss') {
      return (
        compareByKey(a, b, 'miss', dir) ||
        compareByKey(a, b, 'level', dir) ||
        compareDifficulty(a, b, dir) ||
        compareByKey(a, b, 'title', dir) ||
        compareByKey(a, b, 'date', dir)
      );
    }
    return compareByKey(a, b, 'level', dir);
  });
  return sorted;
}

function applyFilters(records, bestMap = null) {
  const fcF = document.getElementById('filter-fc')?.value || 'all';
  const msMin = document.getElementById('filter-miss-min')?.value ?? '';
  const msMax = document.getElementById('filter-miss-max')?.value ?? '';
  const dfF = document.getElementById('filter-diff')?.value || 'all';
  const lvF = document.getElementById('filter-level')?.value || '';
  const tiF = (document.getElementById('filter-title')?.value || '').trim().toLowerCase();
  const onlyBest = !!appState.settings.onlyBest;

  return records.filter(r => {
    if (onlyBest && bestMap && bestMap.get(bestKey(r))?.id !== r.id) return false;
    if (fcF === 'fc' && !r.isFC) return false;
    if (fcF === 'unfc' && r.isFC) return false;

    const miss = getScoreGroupValue(r);
    if (msMin !== '' && miss < parseInt(msMin, 10)) return false;
    if (msMax !== '' && miss > parseInt(msMax, 10)) return false;

    if (dfF !== 'all' && r.difficultyRaw !== dfF) return false;
    if (lvF && String(r.level) !== String(lvF)) return false;
    if (tiF && !normalizeString(r.title).includes(normalizeString(tiF))) return false;
    return true;
  });
}

function renderCard(rec, bestMap = null) {
  const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w600') : '';
  const large = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
  const missDisplay = rec.isFC ? `<span class="miss-val zero">FC-0</span>` : `FC -<span class="miss-val">${getScoreGroupValue(rec)}</span>`;
  const badge = rec.isFC ? `<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>` : '';
  const isSel = appState.selectedIds.has(rec.id) ? 'selected' : '';
  const isBest = bestMap ? bestMap.get(bestKey(rec))?.id === rec.id : isSelfBest(rec);
  const bestBadge = isBest ? `<div class="best-badge">BEST</div>` : '';
  let clickAction = '';
  let overlayActions = '';

  if (appState.isSelectMode) {
    clickAction = `toggleSelection('${rec.id}')`;
  } else {
    clickAction = `openImageModal('${large}')`;
    overlayActions = `
      <div class="card-overlay-actions">
        <div class="btn-overlay" onclick="event.stopPropagation(); individualEdit('${rec.id}')" title="編集"><span class="material-symbols-outlined">edit</span></div>
        <div class="btn-overlay del" onclick="event.stopPropagation(); individualDelete('${rec.id}')" title="削除"><span class="material-symbols-outlined">delete</span></div>
      </div>
    `;
  }

  return `
    <div class="card ${rec.isFC ? 'is-fc' : ''} ${isSel} ${appState.isSelectMode ? 'select-mode-active' : ''}" id="card-${rec.id}" onclick="${clickAction}">
      <div class="card-img-container">
        ${badge}
        ${bestBadge}
        ${overlayActions}
        <div class="img-loader-spinner"></div>
        ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" onload="this.style.opacity=1; this.previousElementSibling.style.display='none';">` : '<span style="color:#aaa;">NO IMAGE</span>'}
      </div>
      <div class="card-body">
        <div class="song-meta">
          <span class="tag lvl">Lv.${escapeHtml(rec.level)}</span>
          <span class="tag diff-${rec.difficultyRaw}" style="background:${DIFFICULTY_COLORS[rec.difficultyRaw] || '#ddd'}; color:#fff;">${escapeHtml(rec.difficulty)}</span>
        </div>
        <div class="song-title">${escapeHtml(rec.title)}</div>
        <div class="score-info">
          <span style="display:flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result</span>
          ${missDisplay}
        </div>
        <div class="score-mini">P ${Number(rec.perfectCount ?? 0)} / G ${Number(rec.greatCount ?? 0)} / C ${Number(rec.comboCount ?? 0)}</div>
      </div>
    </div>`;
}

async function renderGrid(records) {
  const grid = document.getElementById('grid');
  const resultCount = document.getElementById('result-count');
  resultCount.textContent = appState.settings.onlyBest
    ? `表示: ${records.length} 件 / 自己ベストのみ`
    : `表示: ${records.length} 件`;
  if (records.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
    return;
  }

  const bestMap = bestRecordsMap(appState.allRecords);
  const chunks = [];
  const chunkSize = 40;
  for (let i = 0; i < records.length; i += chunkSize) {
    chunks.push(records.slice(i, i + chunkSize));
  }
  grid.innerHTML = '';
  let html = '';
  for (let i = 0; i < chunks.length; i++) {
    html += chunks[i].map(rec => renderCard(rec, bestMap)).join('');
    grid.innerHTML = html;
    setLoadingState(true, `表示を更新中... (${Math.min(records.length, (i + 1) * chunkSize)}/${records.length})`, (i + 1) / chunks.length);
    await nextFrame();
  }
  setLoadingState(false);
}

export async function updateView() {
  const token = ++appState.renderToken;
  if (!appState.allRecords) return;
  setLoadingState(true, '表示を更新中...', 0);

  const source = appState.allRecords.slice();
  const filtered = [];
  const chunk = 120;
  const bestMap = appState.settings.onlyBest ? bestRecordsMap(source) : null;
  for (let i = 0; i < source.length; i += chunk) {
    const slice = source.slice(i, i + chunk);
    filtered.push(...applyFilters(slice, bestMap));
    setLoadingState(true, '絞り込み中...', Math.min((i + chunk) / Math.max(source.length, 1), 0.75));
    await nextFrame();
    if (token !== appState.renderToken) return;
  }

  const sorted = sortRecords(filtered);
  appState.filteredRecords = sorted;
  if (token !== appState.renderToken) return;
  await renderGrid(sorted);
  if (token === appState.renderToken) setLoadingState(false);
}

export function refreshSelectionUI() {
  const bar = document.getElementById('batch-actions');
  const countSpan = document.getElementById('selected-count');
  if (countSpan) countSpan.textContent = String(appState.selectedIds.size);
  if (bar) bar.style.display = appState.selectedIds.size > 0 ? 'flex' : 'none';
}

export function toggleSelectMode() {
  appState.isSelectMode = !appState.isSelectMode;
  const btn = document.getElementById('btn-select-mode');
  if (btn) btn.classList.toggle('active', appState.isSelectMode);
  if (!appState.isSelectMode) {
    appState.selectedIds.clear();
    refreshSelectionUI();
  }
  renderGrid(appState.filteredRecords);
}

export function toggleSelection(id) {
  if (appState.selectedIds.has(id)) appState.selectedIds.delete(id);
  else appState.selectedIds.add(id);
  const card = document.getElementById(`card-${id}`);
  if (card) {
    if (appState.selectedIds.has(id)) card.classList.add('selected');
    else card.classList.remove('selected');
  }
  refreshSelectionUI();
}

export function clearSelection() {
  appState.selectedIds.clear();
  refreshSelectionUI();
  renderGrid(appState.filteredRecords);
}

export function openImageModal(src) {
  if (!src) return;
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalImg');
  if (modal && img) {
    modal.style.display = 'flex';
    img.src = src;
  }
}

export function closeImageModal() {
  const modal = document.getElementById('imageModal');
  if (modal) modal.style.display = 'none';
}

export function setSortKey(key) {
  appState.settings.sortKey = key;
}

export function setSortDirection(direction) {
  appState.settings.sortDirection = direction;
}

export function toggleSortDirection() {
  appState.settings.sortDirection = appState.settings.sortDirection === 'asc' ? 'desc' : 'asc';
  const btn = document.getElementById('sort-direction-button');
  if (btn) btn.textContent = appState.settings.sortDirection === 'asc' ? '昇順' : '降順';
  if (window.saveAppSettings) window.saveAppSettings();
  updateView();
}

export function toggleBestOnly() {
  appState.settings.onlyBest = !appState.settings.onlyBest;
  const btn = document.getElementById('best-only-button');
  if (btn) {
    btn.classList.toggle('active', appState.settings.onlyBest);
    btn.textContent = appState.settings.onlyBest ? 'ON' : 'OFF';
  }
  if (window.saveAppSettings) window.saveAppSettings();
  updateView();
}

export function updateFilterBadge() {
  const btn = document.getElementById('best-only-button');
  if (btn) {
    btn.classList.toggle('active', !!appState.settings.onlyBest);
    btn.textContent = appState.settings.onlyBest ? 'ON' : 'OFF';
  }
  const sortBtn = document.getElementById('sort-direction-button');
  if (sortBtn) sortBtn.textContent = appState.settings.sortDirection === 'asc' ? '昇順' : '降順';
}

export function applySettingsToSortUI() {
  const key = document.getElementById('sort-key');
  if (key) key.value = appState.settings.sortKey || 'level';
  const dir = document.getElementById('sort-direction-button');
  if (dir) dir.textContent = appState.settings.sortDirection === 'asc' ? '昇順' : '降順';
  const best = document.getElementById('best-only-button');
  if (best) best.textContent = appState.settings.onlyBest ? 'ON' : 'OFF';
  if (best) best.classList.toggle('active', !!appState.settings.onlyBest);
}

export function getRecordById(id) {
  return appState.allRecords.find(r => r.id === id) || null;
}

export function getSelectedRecords() {
  return appState.allRecords.filter(r => appState.selectedIds.has(r.id));
}

export function highlightBestNotice(record, improvedFrom = null) {
  const title = record?.title ? `「${record.title}」` : 'リザルト';
  const msg = improvedFrom
    ? `${title} が自己ベスト更新しました`
    : `${title} を保存しました`;
  showToast(msg, 'success');
}
