/*
 * analysis-log.js
 * -----------------------------------------------------------------------
 * 「実測ログ」表示を担当します。ocr-analyzer.js が生成した解析結果
 * (item.analysis: debugLog・identification・warnings・notes) を、
 *   - 項目ごとの切り出し座標(pxRect)・二値化後に実際にOCRへ渡した画像・OCR生テキスト
 *   - 曲名などの特定方法(曲名から/統計から逆算/特定できず)と警告・注記
 *   - 統計から逆算した場合の候補一覧(クリックで選び直せる)
 * として可視化します。
 *   - buildLogModalHtml() / openAnalysisLog()  詳細ログをモーダルで表示
 *   - renderAnalysisPanel()                    編集フォーム内の警告・候補・総ノーツ数の要約表示
 *   - refreshLiveChecks()                      手入力で値を修正した際のリアルタイム整合性チェック
 *   - applyCandidate()                         候補一覧から楽曲を選び直す
 * -----------------------------------------------------------------------
 */

// ============================================================
// 詳細ログモーダル
// ============================================================

function openAnalysisLog(itemId) {
  const item = editorQueue.find(q => q.id === itemId);
  if (!item) return;
  if (!item.analysis) {
    alert('この画像はまだ解析されていません。先に「この画像を再解析」を行ってください。');
    return;
  }
  document.getElementById('log-modal-body').innerHTML = buildLogModalHtml(item);
  document.getElementById('logModal').style.display = 'flex';
}

function closeLogModal() {
  document.getElementById('logModal').style.display = 'none';
}

const IDENTIFICATION_METHOD_LABEL = {
  title: '曲名の読み取りから特定',
  stats: '難易度・レベル・総ノーツ数から推定',
  manual: '手動で選択',
  unresolved: '特定できませんでした',
};

function buildLogModalHtml(item) {
  const a = item.analysis;
  const id = a.identification || {};
  const methodLabel = IDENTIFICATION_METHOD_LABEL[id.method] || id.method || '-';

  let html = '<div class="log-summary">';
  html += `<div class="log-summary-row"><span class="log-summary-label">楽曲の特定方法</span><span>${escapeHtml(methodLabel)}</span></div>`;
  if (typeof id.titleMatchScore === 'number') {
    html += `<div class="log-summary-row"><span class="log-summary-label">曲名マッチ差分スコア</span><span>${id.titleMatchScore.toFixed(3)} (0に近いほど一致)</span></div>`;
  }
  html += `<div class="log-summary-row"><span class="log-summary-label">総ノーツ数(実測合計)</span><span>${a.totalNoteCount}${(a.totalNoteCountDb !== null && a.totalNoteCountDb !== undefined) ? ` / DB: ${a.totalNoteCountDb}${a.totalNoteCountDb === a.totalNoteCount ? ' (一致)' : ' (不一致)'}` : ''}</span></div>`;
  html += '</div>';

  const warnings = a.warnings || [];
  const notes = a.notes || [];
  if (warnings.length > 0 || notes.length > 0) {
    html += '<div class="log-messages">';
    warnings.forEach(w => {
      html += `<div class="log-message-item is-warning"><span class="material-symbols-outlined">warning</span><span>${escapeHtml(w.message)}</span></div>`;
    });
    notes.forEach(n => {
      html += `<div class="log-message-item is-note"><span class="material-symbols-outlined">info</span><span>${escapeHtml(n)}</span></div>`;
    });
    html += '</div>';
  }

  if (id.method === 'stats' && id.candidates && id.candidates.length > 0) {
    html += '<div class="log-candidates"><h4>候補一覧(クリックで採用)</h4><div class="log-candidate-list">';
    id.candidates.forEach((c, i) => {
      html += `
        <button type="button" class="log-candidate-chip ${i === 0 ? 'primary' : ''}" onclick="applyCandidate('${item.id}', ${c.musicId}, '${c.diff}')">
          <span class="log-candidate-title">${escapeHtml(c.title)}</span>
          <span class="log-candidate-meta">${escapeHtml(getDiffLabel(c.diff))} Lv.${c.level} ・ ノーツ${c.totalNoteCount}${c.noteDiff > 0 ? `(差${c.noteDiff})` : ''}</span>
        </button>`;
    });
    html += '</div></div>';
  }

  html += '<div class="log-fields">';
  REGION_DEFS.forEach(def => {
    const f = a.debugLog ? a.debugLog[def.key] : null;
    if (!f) return;
    html += `
      <div class="log-field-card">
        <div class="log-field-header">
          <span class="log-field-dot" style="background-color:${def.color}"></span>
          <span class="log-field-label">${escapeHtml(def.label)}</span>
          <span class="log-field-coords">x:${f.pxRect.x} / y:${f.pxRect.y} / w:${f.pxRect.w} / h:${f.pxRect.h}px${typeof f.threshold === 'number' ? ` ・しきい値:${f.threshold}` : ''}</span>
          ${(f.confidence !== null && f.confidence !== undefined) ? `<span class="log-field-confidence">OCR信頼度 ${Math.round(f.confidence)}</span>` : ''}
        </div>
        <div class="log-field-body">
          <img class="log-field-image" src="${f.dataUrl}" alt="${escapeHtml(def.label)}の二値化画像">
          <div class="log-field-text">
            <div class="log-field-text-row"><span>OCR生テキスト</span><code>${escapeHtml((f.rawText || '').trim() || '(空)')}</code></div>
            <div class="log-field-text-row"><span>解釈結果</span><code>${escapeHtml(f.parsed || '')}</code></div>
          </div>
        </div>
      </div>`;
  });
  html += '</div>';

  return html;
}

// ============================================================
// 編集フォーム内の要約表示(警告バナー・候補チップ・総ノーツ数)
// ============================================================

function renderAnalysisPanel(item) {
  const warnEl = document.getElementById('up-warnings');
  const candEl = document.getElementById('up-candidates');
  if (!warnEl || !candEl) return;

  const a = item ? item.analysis : null;
  if (!a) {
    warnEl.style.display = 'none';
    warnEl.innerHTML = '';
    candEl.innerHTML = '';
    refreshLiveChecks(item);
    return;
  }

  const messages = (a.warnings || []).map(w => Object.assign({ isNote: false }, w))
    .concat((a.notes || []).map(n => ({ message: n, isNote: true })));

  if (messages.length > 0) {
    warnEl.style.display = 'flex';
    warnEl.innerHTML = messages.map(w => `
      <div class="analysis-warning-item ${w.isNote ? 'is-note' : ''}">
        <span class="material-symbols-outlined">${w.isNote ? 'info' : 'warning'}</span>
        <span>${escapeHtml(w.message)}</span>
      </div>`).join('');
  } else {
    warnEl.style.display = 'none';
    warnEl.innerHTML = '';
  }

  const id = a.identification || {};
  const cands = (id.method === 'stats') ? (id.candidates || []) : [];
  if (cands.length > 0) {
    candEl.innerHTML = '<div class="analysis-candidates-label">候補から選び直す:</div>' + cands.map((c, i) => `
      <button type="button" class="log-candidate-chip ${i === 0 ? 'primary' : ''}" onclick="applyCandidate('${item.id}', ${c.musicId}, '${c.diff}')">
        ${escapeHtml(c.title)} <span class="log-candidate-meta">${escapeHtml(getDiffLabel(c.diff))} Lv.${c.level}</span>
      </button>`).join('');
  } else {
    candEl.innerHTML = '';
  }

  refreshLiveChecks(item);
}

// 判定内訳・コンボ数を手入力で修正した際に、DB側の総ノーツ数とその場で突き合わせて表示する。
// (item.analysis.totalNoteCountDb は解析時点で特定できた楽曲の「正解の総ノーツ数」)
function refreshLiveChecks(item) {
  const notesInfoEl = document.getElementById('up-total-notes-info');
  const comboInput = document.getElementById('up-combo');
  if (!notesInfoEl || !comboInput) return;

  if (!item) {
    notesInfoEl.innerHTML = '';
    comboInput.classList.remove('field-warning');
    return;
  }

  const d = item.data;
  const sum = toInt(d.perfect, 0) + toInt(d.great, 0) + toInt(d.good, 0) + toInt(d.bad, 0) + toInt(d.missDetail, 0);
  const dbCount = (item.analysis && typeof item.analysis.totalNoteCountDb === 'number') ? item.analysis.totalNoteCountDb : null;
  const mismatch = (dbCount !== null && dbCount !== sum);

  notesInfoEl.innerHTML = `総ノーツ数(実測合計): <strong>${sum}</strong>` +
    (dbCount !== null ? ` <span class="${mismatch ? 'mismatch' : 'match'}">(DB: ${dbCount}${mismatch ? ' ・不一致' : ' ・一致'})</span>` : '');

  const combo = toInt(d.combo, 0);
  const limit = (dbCount !== null) ? dbCount : sum;
  comboInput.classList.toggle('field-warning', combo > limit && limit > 0);
}

// ============================================================
// 候補の手動選択
// ============================================================

function applyCandidate(itemId, musicId, diffCode) {
  const item = editorQueue.find(q => q.id === itemId);
  if (!item) return;
  const music = dbMusicsById.get(musicId);
  if (!music) return;
  const row = getDiffRow(musicId, getDiffDbKey(diffCode));

  item.data.title = music.title;
  item.data.musicId = musicId;
  item.data.diff = diffCode;
  if (row) item.data.level = row.playLevel;
  item.status = 'done';

  // 解析結果側にも反映し、「選び直した」ことが分かるようにする。
  // 総ノーツ数の整合性だけは選び直した楽曲に対して再チェックする。
  if (item.analysis) {
    item.analysis.identification.method = 'manual';
    item.analysis.identification.candidates = [];
    item.analysis.musicId = musicId;
    item.analysis.title = music.title;
    item.analysis.diff = diffCode;
    if (row) item.analysis.level = row.playLevel;
    item.analysis.totalNoteCountDb = row ? row.totalNoteCount : null;

    const ocrSum = toInt(item.data.perfect, 0) + toInt(item.data.great, 0) + toInt(item.data.good, 0) + toInt(item.data.bad, 0) + toInt(item.data.missDetail, 0);
    item.analysis.warnings = (item.analysis.warnings || []).filter(w => w.code !== 'note-count-mismatch' && w.code !== 'unresolved');
    if (row && row.totalNoteCount !== ocrSum) {
      item.analysis.warnings.push({
        code: 'note-count-mismatch',
        message: `総ノーツ数が一致しません(読み取り値: ${ocrSum} / DB: ${row.totalNoteCount})。判定内訳の読み取りに誤りがある可能性があります。`,
      });
    }
  }

  if (document.getElementById('up-title')) document.getElementById('up-title').value = item.data.title;
  if (document.getElementById('up-level')) document.getElementById('up-level').value = item.data.level;
  if (document.getElementById('up-diff')) document.getElementById('up-diff').value = item.data.diff;

  const titleEl = document.getElementById(`sb-title-${itemId}`);
  if (titleEl) titleEl.innerText = music.title || '名称未設定';
  updateSidebarStatus(itemId);
  renderAnalysisPanel(item);

  closeLogModal();
}
