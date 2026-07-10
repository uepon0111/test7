/**
 * sort-filter.js
 * ---------------------------------------------------------------------------
 * 一覧の絞り込み・並び替えロジック。
 *
 * 【並び替え優先順位】（各モードの主キーは昇順/降順を切り替え可能）
 *   名前順       : 名前 → 楽曲難易度 → ミス数 → 追加日
 *   楽曲レベル順 : レベル → 楽曲難易度 → 名前 → ミス数 → 追加日
 *   ミス数順     : ミス数 → 楽曲レベル → 楽曲難易度 → 名前 → 追加日
 *   追加日順     : 追加日のみ
 *
 * タイブレーク（2番目以降のキー）は主キーの昇順/降順によらず固定方向:
 *   楽曲難易度: 高難易度が先（APPEND→MASTER→...→EASY）
 *   名前      : あいうえお順（ja collation）
 *   ミス数    : 少ない方が先
 *   楽曲レベル: 高い方が先
 *   追加日    : 新しい方が先
 * ---------------------------------------------------------------------------
 */
const SortFilter = (() => {

  function tieDifficulty(a, b) { return Config.rankFromKey(b.difficultyKey) - Config.rankFromKey(a.difficultyKey); }
  function tieName(a, b) { return a.title.localeCompare(b.title, 'ja'); }
  function tieMiss(a, b) { return a.missCount - b.missCount; }
  function tieLevel(a, b) { return b.level - a.level; }
  function tieDate(a, b) { return b.createdTimestamp - a.createdTimestamp; }

  function compare(field, dir, a, b) {
    const sign = dir === 'asc' ? 1 : -1;
    switch (field) {
      case 'name':
        return (a.title.localeCompare(b.title, 'ja') * sign) || tieDifficulty(a, b) || tieMiss(a, b) || tieDate(a, b);
      case 'level':
        return ((a.level - b.level) * sign) || tieDifficulty(a, b) || tieName(a, b) || tieMiss(a, b) || tieDate(a, b);
      case 'missCount':
        return ((a.missCount - b.missCount) * sign) || tieLevel(a, b) || tieDifficulty(a, b) || tieName(a, b) || tieDate(a, b);
      case 'date':
        return (a.createdTimestamp - b.createdTimestamp) * sign;
      default:
        return 0;
    }
  }

  function filter(records, opts) {
    const { fc, missMin, missMax, diff, level, title, bestOnly } = opts;
    return records.filter((r) => {
      if (fc === 'fc' && !r.isFC) return false;
      if (fc === 'unfc' && r.isFC) return false;
      if (!r.isFC) {
        if (missMin !== '' && missMin != null && r.missCount < parseInt(missMin, 10)) return false;
        if (missMax !== '' && missMax != null && r.missCount > parseInt(missMax, 10)) return false;
      } else {
        if (missMin !== '' && missMin != null && 0 < parseInt(missMin, 10)) return false;
      }
      if (diff && diff !== 'all' && r.difficultyKey !== diff) return false;
      if (level && r.level != level) return false;
      if (title && !r.title.toLowerCase().includes(title)) return false;
      if (bestOnly && !r.isBest) return false;
      return true;
    });
  }

  function sort(records, field, dir) {
    const copy = records.slice();
    copy.sort((a, b) => compare(field, dir, a, b));
    return copy;
  }

  return { compare, filter, sort };
})();
