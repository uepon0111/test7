// js/card.js
// 2.10: リザルト画像・タイトル・レベル・難易度・ミス数・達成状況を1カードに表示

import { DIFFICULTIES, MODES } from './constants.js';
import { escapeHtml, getModeMiss } from './utils.js';

/**
 * レコードカードを生成して返す
 * @param {object} record
 * @param {string} mode 'ap'|'contest'|'fc'
 * @param {number} cols 列数（1=モバイルリスト形式, 2+= デスクトップグリッド形式）
 * @param {Function} onDetail クリック時のコールバック
 * @param {Function} onEdit 編集ボタン
 * @param {Function} onDelete 削除ボタン
 */
export function renderCard(record, mode, cols, onDetail, onEdit, onDelete) {
  const diff     = DIFFICULTIES[record.difficulty] || DIFFICULTIES.master;
  const modeInfo = MODES[mode];
  const missVal  = getModeMiss(record, mode);
  const isAch    = record[modeInfo.achKey];

  const card = document.createElement('div');
  card.className = `result-card ${cols === 1 ? 'card-list' : 'card-grid'}`;
  card.dataset.id = record.id;

  // --- サムネイル ---
  const thumbEl = _buildThumb(record, diff, isAch, record.isAP, record.isFC);

  // --- 達成バッジ ---
  const achBadge = record.isAP
    ? `<span class="ach-badge badge-ap"><span class="material-symbols-outlined">workspace_premium</span>ALL PERFECT</span>`
    : record.isFC
    ? `<span class="ach-badge badge-fc"><span class="material-symbols-outlined">check_circle</span>FULL COMBO</span>`
    : '';

  // --- ミス数表示 ---
  let missHtml;
  if (record.isAP) {
    missHtml = `<span class="miss-zero">AP達成</span>`;
  } else if (record.isFC && (mode === 'fc')) {
    missHtml = `<span class="miss-zero">FC達成</span>`;
  } else {
    const cls = missVal === 0 ? 'miss-zero' : 'miss-val';
    missHtml = `<span class="${cls}">${modeInfo.short} -${missVal}</span>`;
  }

  card.innerHTML = `
    <div class="card-thumb-wrap" tabindex="0" role="button" aria-label="${escapeHtml(record.title)}を表示"></div>
    <div class="card-body">
      <div class="card-tags">
        <span class="diff-tag" style="background:${diff.color};color:${diff.textColor}">${diff.label}</span>
        <span class="lv-tag">Lv.${record.level ?? '?'}</span>
        ${achBadge}
      </div>
      <div class="card-title">${escapeHtml(record.title)}</div>
      <div class="card-footer">
        <span class="miss-wrap">${missHtml}</span>
        <div class="card-btns">
          <button class="icon-btn-sm btn-edit" title="編集">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button class="icon-btn-sm btn-delete" title="削除">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </div>
    </div>`;

  card.querySelector('.card-thumb-wrap').appendChild(thumbEl);

  // イベント
  card.querySelector('.card-thumb-wrap').addEventListener('click', () => onDetail(record));
  card.querySelector('.card-body').addEventListener('click', e => {
    if (!e.target.closest('.card-btns')) onDetail(record);
  });
  card.querySelector('.btn-edit').addEventListener('click', e => {
    e.stopPropagation(); onEdit(record);
  });
  card.querySelector('.btn-delete').addEventListener('click', e => {
    e.stopPropagation(); onDelete(record);
  });

  return card;
}

function _buildThumb(record, diff, isAch, isAP, isFC) {
  const wrap = document.createElement('div');
  wrap.className = 'thumb-inner';

  if (record.thumbBlob) {
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.alt = record.title;
    img.loading = 'lazy';
    img.dataset.obj = '1'; // Object URL追跡用マーカー
    const url = URL.createObjectURL(record.thumbBlob);
    img.src = url;
    // VirtualScrollがrevokeするが、ロードエラー時のために保持
    wrap.appendChild(img);
  } else if (record.driveFileId) {
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.alt = record.title;
    img.loading = 'lazy';
    img.src = `https://drive.google.com/thumbnail?id=${record.driveFileId}&sz=w400`;
    wrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'thumb-placeholder';
    ph.innerHTML = `<span class="material-symbols-outlined">image</span>`;
    wrap.appendChild(ph);
  }

  // AP/FCリボン
  if (isAP) {
    const r = document.createElement('div');
    r.className = 'thumb-ribbon ribbon-ap';
    r.innerHTML = `<span class="material-symbols-outlined">workspace_premium</span>`;
    wrap.appendChild(r);
  } else if (isFC) {
    const r = document.createElement('div');
    r.className = 'thumb-ribbon ribbon-fc';
    r.innerHTML = `<span class="material-symbols-outlined">check_circle</span>`;
    wrap.appendChild(r);
  }

  return wrap;
}
