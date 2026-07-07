
import { DIFFICULTIES, DIFFICULTY_COLORS, DIFFICULTY_LABELS, DIFFICULTY_ORDER } from './config.js';
import { deepClone } from './storage.js';
import { getDifficultyLabel } from './ocr.js';

export function escapeHtml(t) {
  return t ? t.toString().replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])) : '';
}

export function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP');
}

export function getDifficultyClass(key) {
  return `diff-${String(key || '').toLowerCase()}`;
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
    return el;
  })();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 200);
  }, 2800);
}

function renderDifficultyBadge(record) {
  const key = String(record.difficultyKey || 'expert').toLowerCase();
  const label = DIFFICULTY_LABELS[key] || key.toUpperCase();
  return `<span class="tag diff-${key}" style="background:${DIFFICULTY_COLORS[key] || '#ddd'}">${label}</span>`;
}

export function renderGrid(records, state) {
  const grid = document.getElementById('grid');
  const countEl = document.getElementById('result-count');
  countEl.innerText = `表示: ${records.length} 件`;

  grid.innerHTML = '';
  if (!records.length) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
    return;
  }

  for (const rec of records) {
    const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w600') : '';
    const large = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    const missDisplay = rec.isFC ? `<span class="miss-val zero">FC-0</span>` : `FC -<span class="miss-val">${rec.totalMiss ?? rec.missCount ?? 0}</span>`;
    const isSelected = state.selectedIds.has(rec.id) ? 'selected' : '';
    const isBest = rec.isPersonalBest ? '<span class="badge-pb">PB</span>' : '';
    const isNew = rec.isNewBest ? '<span class="badge-new">NEW PB</span>' : '';
    const profileInfo = rec.deviceName ? `<span>${escapeHtml(rec.deviceName)}</span>` : '';
    const comboText = rec.combo != null ? `<span>COMBO ${rec.combo}</span>` : '';
    const prText = rec.perfect != null ? `<span>P ${rec.perfect}</span>` : '';
    const grText = rec.great != null ? `<span>G ${rec.great}</span>` : '';

    let clickAction = '';
    let overlayActions = '';
    if (state.isSelectMode) {
      clickAction = `toggleSelection('${rec.id}')`;
    } else {
      clickAction = `openImageModal('${large}')`;
      overlayActions = `
        <div class="card-overlay-actions">
          <div class="btn-overlay" onclick="event.stopPropagation(); individualEdit('${rec.id}')" title="編集">
            <span class="material-symbols-outlined">edit</span>
          </div>
          <div class="btn-overlay del" onclick="event.stopPropagation(); individualDelete('${rec.id}')" title="削除">
            <span class="material-symbols-outlined">delete</span>
          </div>
        </div>`;
    }

    grid.innerHTML += `
      <div class="card ${rec.isFC ? 'is-fc' : ''} ${isSelected}" id="card-${rec.id}" onclick="${clickAction}">
        <div class="card-img-container">
          ${isBest}${isNew}
          ${overlayActions}
          <div class="img-loader-spinner"></div>
          ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" onload="this.style.opacity=1; this.previousElementSibling.style.display='none';">` : '<span style="color:#aaa;">NO IMAGE</span>'}
        </div>
        <div class="card-body">
          <div class="song-meta">
            <span class="tag lvl">Lv.${escapeHtml(rec.level ?? '-')}</span>
            ${renderDifficultyBadge(rec)}
          </div>
          <div class="song-title">${escapeHtml(rec.title || '名称未設定')}</div>
          <div class="song-subtitle">${missDisplay}</div>
          <div class="card-meta">
            ${profileInfo}
            ${prText}
            ${grText}
            ${comboText}
            <span>${formatDate(rec.addedAt || rec.createdTime)}</span>
          </div>
        </div>
      </div>`;
  }
}

export function renderProfileOptions(selectEl, profiles, selectedId) {
  selectEl.innerHTML = profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.width || '-'}×${p.height || '-'})</option>`).join('');
  selectEl.value = selectedId || profiles[0]?.id || '';
}

export function renderProfileList(listEl, profiles, activeId) {
  listEl.innerHTML = profiles.map((p) => `
    <div class="profile-item ${p.id === activeId ? 'active' : ''}" data-profile-id="${p.id}">
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">${escapeHtml(p.width || '-')} × ${escapeHtml(p.height || '-')} / ${escapeHtml(p.builtIn ? 'built-in' : 'custom')}</div>
    </div>
  `).join('');
}

export function renderRegionTabs(container, regions, activeRegion) {
  container.innerHTML = regions.map((name) => `
    <button type="button" class="region-tab ${name === activeRegion ? 'active' : ''}" data-region="${name}">${name.toUpperCase()}</button>
  `).join('');
}

export function createToastContainerIfNeeded() {
  if (document.getElementById('toast-container')) return;
  const div = document.createElement('div');
  div.id = 'toast-container';
  div.className = 'toast-container';
  document.body.appendChild(div);
}

export function applyProfileValues(form, profile, activeRegion) {
  const r = profile.regions[activeRegion];
  form.querySelector('[name="region-x"]').value = Math.round(r.x * 10000) / 100;
  form.querySelector('[name="region-y"]').value = Math.round(r.y * 10000) / 100;
  form.querySelector('[name="region-w"]').value = Math.round(r.w * 10000) / 100;
  form.querySelector('[name="region-h"]').value = Math.round(r.h * 10000) / 100;
}

export function readRegionValues(form) {
  return {
    x: Number(form.querySelector('[name="region-x"]').value) / 100,
    y: Number(form.querySelector('[name="region-y"]').value) / 100,
    w: Number(form.querySelector('[name="region-w"]').value) / 100,
    h: Number(form.querySelector('[name="region-h"]').value) / 100,
  };
}
