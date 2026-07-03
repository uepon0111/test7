// js/filter-sort.js

import { DIFF_ORDER } from './constants.js';
import { normalizeString, getModeMiss } from './utils.js';

/** メインのフィルタ＋ソート処理 */
export function applyFiltersAndSort(records, state) {
  let result = filterRecords(records, state);
  if (state.bestOnly) result = getBestOnly(result, state.mode);
  return sortRecords(result, state.sort, state.mode);
}

function filterRecords(records, { mode, filters }) {
  const { search, difficulty, level, status, missMin, missMax } = filters;
  const searchNorm = search ? normalizeString(search) : '';

  return records.filter(r => {
    // 検索（曲名・読み方）
    if (searchNorm) {
      const t = normalizeString(r.title);
      const p = normalizeString(r.pronunciation || '');
      if (!t.includes(searchNorm) && !p.includes(searchNorm)) return false;
    }
    // 難易度フィルタ
    if (difficulty !== 'all' && r.difficulty !== difficulty) return false;
    // レベルフィルタ
    if (level !== '' && level !== null && level !== undefined) {
      if (r.level !== Number(level)) return false;
    }
    // 達成状況フィルタ
    if (status === 'ap'     && !r.isAP) return false;
    if (status === 'fc'     && !r.isFC) return false;
    if (status === 'non-ap' &&  r.isAP) return false;
    if (status === 'non-fc' &&  r.isFC) return false;
    // ミス数範囲フィルタ
    const m = getModeMiss(r, mode);
    if (missMin !== '' && missMin !== null && m < Number(missMin)) return false;
    if (missMax !== '' && missMax !== null && m > Number(missMax)) return false;
    return true;
  });
}

/** 自己ベストのみ表示：(musicId, difficulty) または (title正規化, difficulty) でグループ化 */
function getBestOnly(records, mode) {
  const map = new Map();
  for (const r of records) {
    const key = r.musicId
      ? `${r.musicId}::${r.difficulty}`
      : `${normalizeString(r.title)}::${r.difficulty}`;
    const cur = map.get(key);
    if (!cur || getModeMiss(r, mode) < getModeMiss(cur, mode)) {
      map.set(key, r);
    }
  }
  return Array.from(map.values());
}

const diffRank = d => DIFF_ORDER.indexOf(d);

/** 3.1-3.4 並び替え優先度 */
function sortRecords(records, { by, dir }, mode) {
  const asc = dir === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => {
    const titleCmp = () => a.title.localeCompare(b.title, 'ja');
    const levelCmp = () => (a.level || 0) - (b.level || 0);
    const diffCmp  = () => diffRank(b.difficulty) - diffRank(a.difficulty); // 高い難易度が先
    const missCmp  = () => getModeMiss(a, mode) - getModeMiss(b, mode);
    const dateCmp  = () => new Date(a.addedAt) - new Date(b.addedAt);

    if (by === 'title') {
      // 3.1: 名前→難易度→ミス数→追加日
      return (titleCmp() || diffCmp() || missCmp() || dateCmp()) * asc;
    }
    if (by === 'level') {
      // 3.2: レベル→難易度→名前→ミス数→追加日
      return (levelCmp() || diffCmp() || titleCmp() || missCmp() || dateCmp()) * asc;
    }
    if (by === 'miss') {
      // 3.3: ミス数→レベル→難易度→名前→追加日
      return (missCmp() || (-levelCmp()) || diffCmp() || titleCmp() || dateCmp()) * asc;
    }
    if (by === 'added') {
      // 3.4: 追加日のみ
      return dateCmp() * asc;
    }
    return 0;
  });
}

/**
 * 2.19: 新規登録時に自己ベスト更新チェック
 * @returns {Array<{mode,oldMiss,newMiss}>} 更新されたモードの一覧
 */
export function checkSelfBest(newRecord, existingRecords) {
  const sameKey = r => r.musicId && newRecord.musicId
    ? r.musicId === newRecord.musicId && r.difficulty === newRecord.difficulty
    : normalizeString(r.title) === normalizeString(newRecord.title) && r.difficulty === newRecord.difficulty;

  const group = existingRecords.filter(r => r.id !== newRecord.id && sameKey(r));
  if (group.length === 0) return null; // 初登録

  const improvements = [];
  for (const m of ['ap', 'contest', 'fc']) {
    const newM  = getModeMiss(newRecord, m);
    const bestM = Math.min(...group.map(r => getModeMiss(r, m)));
    if (newM < bestM) improvements.push({ mode: m, oldMiss: bestM, newMiss: newM });
  }
  return improvements.length ? improvements : null;
}
