// js/trash-view.js
// 2.15-2.17: ゴミ箱・自動削除・Drive削除

import { DIFFICULTIES } from './constants.js';
import { daysAgo, escapeHtml } from './utils.js';
import { TRASH_EXPIRY_DAYS } from './constants.js';

export const TrashView = {
  _container: null,
  _emptyEl:   null,

  init(container, emptyEl) {
    this._container = container;
    this._emptyEl   = emptyEl;
  },

  render(items, onRestore, onPermDelete) {
    if (!items.length) {
      this._container.innerHTML = '';
      if (this._emptyEl) this._emptyEl.style.display = '';
      return;
    }
    if (this._emptyEl) this._emptyEl.style.display = 'none';

    const sorted = [...items].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

    this._container.innerHTML = sorted.map(item => {
      const diff      = DIFFICULTIES[item.difficulty] || DIFFICULTIES.master;
      const elapsed   = daysAgo(item.deletedAt);
      const remaining = Math.max(0, TRASH_EXPIRY_DAYS - elapsed);
      const urgentCls = remaining <= 1 ? 'remaining-urgent' : '';

      return `
        <div class="trash-item" data-id="${item.id}">
          <div class="trash-thumb">
            ${item.driveFileId
              ? `<img src="https://drive.google.com/thumbnail?id=${item.driveFileId}&sz=w200" alt="" loading="lazy">`
              : `<span class="material-symbols-outlined">image</span>`}
          </div>
          <div class="trash-body">
            <div class="trash-tags">
              <span class="diff-tag" style="background:${diff.color};color:${diff.textColor}">${diff.label}</span>
              <span class="lv-tag">Lv.${item.level ?? '?'}</span>
            </div>
            <div class="trash-title">${escapeHtml(item.title)}</div>
            <div class="trash-stats">
              <span class="trash-miss">AP -${item.missAP ?? '?'} / FC -${item.missFC ?? '?'}</span>
            </div>
            <div class="trash-remaining ${urgentCls}">
              <span class="material-symbols-outlined">schedule</span>
              ${remaining > 0 ? `${remaining}日後に完全削除` : '本日完全削除予定'}
            </div>
          </div>
          <div class="trash-actions">
            <button class="btn-text btn-restore" data-id="${item.id}" title="元に戻す">
              <span class="material-symbols-outlined">restore</span>
              <span>戻す</span>
            </button>
            <button class="btn-text btn-perm-del danger-text" data-id="${item.id}" title="完全削除">
              <span class="material-symbols-outlined">delete_forever</span>
              <span>削除</span>
            </button>
          </div>
        </div>`;
    }).join('');

    this._container.querySelectorAll('.btn-restore').forEach(btn => {
      btn.addEventListener('click', () => onRestore(btn.dataset.id));
    });
    this._container.querySelectorAll('.btn-perm-del').forEach(btn => {
      btn.addEventListener('click', () => onPermDelete(btn.dataset.id));
    });
  },
};
