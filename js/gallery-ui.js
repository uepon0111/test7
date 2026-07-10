/**
 * gallery-ui.js
 * ---------------------------------------------------------------------------
 * 一覧グリッドの描画、画像拡大モーダル（PERFECT/GREAT/GOOD/BAD/MISS/コンボの
 * 詳細表示を含む）、選択モード（複数選択・一括削除・一括編集）、
 * 画像読み込み進捗バーの表示を担当する。
 * ---------------------------------------------------------------------------
 */
const GalleryUI = (() => {

  let imgLoadTotal = 0;
  let imgLoadDone = 0;

  // ---- グリッド描画 -------------------------------------------------------

  function renderGrid(records) {
    const grid = document.getElementById('grid');
    document.getElementById('result-count').innerText = `表示: ${records.length} 件`;
    grid.innerHTML = '';

    if (records.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
      _finishImageProgress();
      return;
    }

    const thumbCount = records.filter((r) => r.thumbnail).length;
    _startImageProgress(thumbCount);

    records.forEach((rec) => {
      const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w600') : '';
      const missDisplay = rec.isFC
        ? `<span class="miss-val zero">FC-0</span>`
        : `FC -<span class="miss-val">${rec.missCount}</span>`;
      const badge = rec.isFC
        ? `<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>`
        : '';
      const isSel = AppState.selectedIds.has(rec.id) ? 'selected' : '';

      let clickAction = '';
      let overlayActions = '';
      if (AppState.isSelectMode) {
        clickAction = `GalleryUI.toggleSelection('${rec.id}')`;
      } else {
        clickAction = `GalleryUI.openImageModal('${rec.id}')`;
        overlayActions = `
          <div class="card-overlay-actions">
              <div class="btn-overlay" onclick="event.stopPropagation(); GalleryUI.individualEdit('${rec.id}')" title="編集"><span class="material-symbols-outlined">edit</span></div>
              <div class="btn-overlay del" onclick="event.stopPropagation(); GalleryUI.individualDelete('${rec.id}')" title="削除"><span class="material-symbols-outlined">delete</span></div>
          </div>
        `;
      }

      grid.innerHTML += `
        <div class="card ${rec.isFC ? 'is-fc' : ''} ${isSel} ${AppState.isSelectMode ? 'select-mode-active' : ''}" id="card-${rec.id}" onclick="${clickAction}">
          <div class="card-img-container">
            ${badge}
            ${overlayActions}
            <div class="img-loader-spinner"></div>
            ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" onload="this.style.opacity=1; this.previousElementSibling.style.display='none'; GalleryUI.onImageLoaded();" onerror="GalleryUI.onImageLoaded();">` : '<span style="color:#aaa;">NO IMAGE</span>'}
          </div>
          <div class="card-body">
            <div class="song-meta"><span class="tag lvl">Lv.${rec.level}</span><span class="tag diff-${rec.diffCode}">${rec.difficultyLabel}</span></div>
            <div class="song-title">${Utils.escapeHtml(rec.title)}</div>
            <div class="score-info"><span style="display:flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result</span>${missDisplay}</div>
          </div>
        </div>`;
    });

    if (thumbCount === 0) _finishImageProgress();
  }

  // ---- 画像読み込み進捗バー -----------------------------------------------

  function _startImageProgress(total) {
    imgLoadTotal = total;
    imgLoadDone = 0;
    const wrap = document.getElementById('load-progress-wrap');
    const bar = document.getElementById('load-progress-bar');
    const txt = document.getElementById('load-progress-text');
    if (!wrap) return;
    if (total === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    bar.style.width = '0%';
    txt.innerText = `画像読み込み中 0 / ${total}`;
  }

  function onImageLoaded() {
    imgLoadDone++;
    const bar = document.getElementById('load-progress-bar');
    const txt = document.getElementById('load-progress-text');
    const pct = imgLoadTotal > 0 ? Math.min(100, Math.round((imgLoadDone / imgLoadTotal) * 100)) : 100;
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.innerText = `画像読み込み中 ${imgLoadDone} / ${imgLoadTotal}`;
    if (imgLoadDone >= imgLoadTotal) _finishImageProgress();
  }

  function _finishImageProgress() {
    const wrap = document.getElementById('load-progress-wrap');
    if (!wrap) return;
    setTimeout(() => { wrap.style.display = 'none'; }, 350);
  }

  // ---- 画像拡大モーダル -----------------------------------------------------

  function openImageModal(id) {
    const rec = AppState.allRecords.find((r) => r.id === id) || AppState.filteredRecords.find((r) => r.id === id);
    if (!rec) return;
    const large = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    document.getElementById('imageModal').style.display = 'flex';
    document.getElementById('modalImg').src = large;
    _renderModalStats(rec);
  }

  function _renderModalStats(rec) {
    const el = document.getElementById('modal-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="modal-stats-title">
        ${Utils.escapeHtml(rec.title)}
        <span class="tag diff-${rec.diffCode}">${rec.difficultyLabel}</span>
        <span class="tag lvl">Lv.${rec.level}</span>
      </div>
      <div class="modal-stats-grid">
        <div class="mstat"><span class="mstat-label">PERFECT</span><span class="mstat-val">${rec.perfect}</span></div>
        <div class="mstat"><span class="mstat-label">GREAT</span><span class="mstat-val">${rec.great}</span></div>
        <div class="mstat"><span class="mstat-label">GOOD</span><span class="mstat-val">${rec.good}</span></div>
        <div class="mstat"><span class="mstat-label">BAD</span><span class="mstat-val">${rec.bad}</span></div>
        <div class="mstat"><span class="mstat-label">MISS</span><span class="mstat-val">${rec.miss}</span></div>
        <div class="mstat"><span class="mstat-label">MAX COMBO</span><span class="mstat-val">${rec.combo}</span></div>
      </div>
      <div class="modal-stats-date">追加日: ${Utils.formatDateTime(rec.createdTimestamp)}${rec.isBest ? ' <span class="best-flag">★ 自己ベスト</span>' : ''}</div>
    `;
  }

  function closeImageModal() {
    document.getElementById('imageModal').style.display = 'none';
  }

  // ---- 選択モード -----------------------------------------------------------

  function toggleSelectMode() {
    AppState.isSelectMode = !AppState.isSelectMode;
    const btn = document.getElementById('btn-select-mode');
    if (AppState.isSelectMode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
      AppState.selectedIds.clear();
      updateSelectionUI();
    }
    renderGrid(AppState.filteredRecords);
  }

  function toggleSelection(id) {
    if (AppState.selectedIds.has(id)) AppState.selectedIds.delete(id);
    else AppState.selectedIds.add(id);

    const card = document.getElementById(`card-${id}`);
    if (card) card.classList.toggle('selected', AppState.selectedIds.has(id));
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const bar = document.getElementById('batch-actions');
    document.getElementById('selected-count').innerText = AppState.selectedIds.size;
    bar.style.display = AppState.selectedIds.size > 0 ? 'flex' : 'none';
  }

  function clearSelection() {
    AppState.selectedIds.clear();
    updateSelectionUI();
    renderGrid(AppState.filteredRecords);
  }

  // ---- 個別・一括アクション --------------------------------------------------

  function individualEdit(id) {
    AppState.selectedIds.clear();
    AppState.selectedIds.add(id);
    UploadBatchUI.batchEdit();
  }

  async function individualDelete(id) {
    if (!confirm('このリザルトを削除しますか？')) return;
    const loader = document.getElementById('loader');
    loader.style.display = 'flex';
    document.getElementById('grid').innerHTML = '';
    try {
      await DriveStorage.deleteResult(id);
      alert('削除しました');
      await Main.refreshData();
    } catch (e) {
      alert('エラー: ' + e.message);
      Main.refreshData();
    }
  }

  async function batchDelete() {
    if (!confirm(`選択した ${AppState.selectedIds.size} 件を削除しますか？`)) return;
    const loader = document.getElementById('loader');
    loader.style.display = 'flex';
    document.getElementById('grid').innerHTML = '';
    try {
      await DriveStorage.deleteResults(Array.from(AppState.selectedIds));
      alert('削除しました');
      AppState.selectedIds.clear();
      updateSelectionUI();
      await Main.refreshData();
    } catch (e) {
      alert('削除エラー: ' + e.message);
      Main.refreshData();
    }
  }

  return {
    renderGrid, onImageLoaded,
    openImageModal, closeImageModal,
    toggleSelectMode, toggleSelection, updateSelectionUI, clearSelection,
    individualEdit, individualDelete, batchDelete,
  };
})();
