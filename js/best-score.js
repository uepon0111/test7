/**
 * best-score.js
 * ---------------------------------------------------------------------------
 * 「自己ベスト」判定ロジック。
 * 同じ楽曲・難易度のリザルトの中から、最も良い記録を1件選び出す。
 *
 * 判定基準（優先順）:
 *   1) 失点数(missCount = good+bad+miss) が少ない方が良い
 *   2) 同数なら最大コンボが多い方が良い
 *   3) それでも同じなら PERFECT数が多い方が良い
 *   4) それでも同じなら新しい記録を優先
 * ---------------------------------------------------------------------------
 */
const BestScore = (() => {

  function groupKey(rec) {
    if (rec.musicId != null) return `id:${rec.musicId}:${rec.difficultyKey}`;
    return `t:${Utils.normalizeString(rec.title)}:${rec.difficultyKey}`;
  }

  // a が b より優れているか（同値ならfalse）
  function isBetter(a, b) {
    if (a.missCount !== b.missCount) return a.missCount < b.missCount;
    if (a.combo !== b.combo) return a.combo > b.combo;
    if (a.perfect !== b.perfect) return a.perfect > b.perfect;
    return a.createdTimestamp > b.createdTimestamp;
  }

  function computeBestMap(records) {
    const map = new Map();
    for (const rec of records) {
      const key = groupKey(rec);
      const cur = map.get(key);
      if (!cur || isBetter(rec, cur)) map.set(key, rec);
    }
    return map;
  }

  // 各レコードに isBest フラグを付与して返す（配列は破壊的に更新される）
  function annotateIsBest(records) {
    const bestMap = computeBestMap(records);
    const bestIds = new Set(Array.from(bestMap.values()).map((r) => r.id));
    records.forEach((r) => { r.isBest = bestIds.has(r.id); });
    return records;
  }

  return { groupKey, isBetter, computeBestMap, annotateIsBest };
})();
