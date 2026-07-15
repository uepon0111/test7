/*
 * music-db.js
 * -----------------------------------------------------------------------
 * プロセカ非公式マスターDB(musics.json / musicDifficulties.json)の取得と、
 * 「DBに対する問い合わせ」を担当するデータ層です。
 *   - loadMusicDb()               DB取得 + 検索用インデックスの構築
 *   - findBestMatchMusicWithScore() OCRで読み取った曲名から最も近い楽曲をスコア付きで返す
 *   - getDiffRow() / getDiffRowsForMusic()  楽曲id×難易度キーから譜面データ(レベル・総ノーツ数)を引く
 *   - findCandidatesByStats()      難易度・レベル・総ノーツ数から楽曲を逆算する候補検索
 *
 * ここでは「どの値を最終的に採用するか」といった判断は行わず、単に検索結果を返すだけです。
 * 複数の手がかりを突き合わせて最終的な曲名・難易度・レベルを決定する処理は
 * result-resolver.js が担当します(責務を分離することで、判断ロジックの見通しを良くしています)。
 * -----------------------------------------------------------------------
 */

// --- 検索高速化用インデックス (loadMusicDb() で構築) ---
let dbMusicsById = new Map();      // musicId -> music
let dbDiffsByMusicId = new Map();  // musicId -> [musicDifficulties の行, ...]

async function loadMusicDb() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch(MUSICS_URL),
      fetch(MUSIC_DIFFICULTIES_URL)
    ]);
    if (!musicsResp.ok || !diffsResp.ok) throw new Error('DB fetch failed: ' + musicsResp.status + '/' + diffsResp.status);
    dbMusics = await musicsResp.json();
    dbDiffs = await diffsResp.json();
    buildDbIndexes();
    return true;
  } catch (e) {
    console.error("DB Error", e);
    dbMusics = dbMusics || [];
    dbDiffs = dbDiffs || [];
    buildDbIndexes();
    return false;
  }
}

function buildDbIndexes() {
  dbMusicsById = new Map((dbMusics || []).map(m => [m.id, m]));
  dbDiffsByMusicId = new Map();
  (dbDiffs || []).forEach(row => {
    if (!dbDiffsByMusicId.has(row.musicId)) dbDiffsByMusicId.set(row.musicId, []);
    dbDiffsByMusicId.get(row.musicId).push(row);
  });
}

// 曲名の類似楽曲をスコア付きで返す。score は正規化レーベンシュタイン距離(0=完全一致 / 1=まったく違う)で、
// 数値が小さいほど信頼できるマッチであることを示す(result-resolver.js が閾値判定に使用)。
function findBestMatchMusicWithScore(ocrText) {
  if (!dbMusics || dbMusics.length === 0) return null;
  const target = normalizeString(ocrText);
  if (target.length === 0) return null;
  let bestMatch = null, minScore = Infinity;
  for (const music of dbMusics) {
    const dbTitleNorm = normalizeString(music.title);
    const dist = levenshtein(target, dbTitleNorm);
    const score = dist / Math.max(target.length, dbTitleNorm.length, 1);
    if (score < minScore) { minScore = score; bestMatch = music; }
  }
  return bestMatch ? { music: bestMatch, score: minScore } : null;
}

// 後方互換用の薄いラッパー(スコア不要で楽曲だけ欲しい呼び出し元向け)
function findBestMatchMusic(ocrText) {
  const r = findBestMatchMusicWithScore(ocrText);
  return r ? r.music : null;
}

function getDiffRowsForMusic(musicId) {
  if (musicId === null || musicId === undefined) return [];
  return dbDiffsByMusicId.get(musicId) || [];
}

function getDiffRow(musicId, diffKey) {
  if (!musicId || !diffKey) return null;
  return getDiffRowsForMusic(musicId).find(r => r.musicDifficulty === diffKey) || null;
}

function getLevelFromDb(musicId, diffKey) {
  const row = getDiffRow(musicId, diffKey);
  return row ? row.playLevel : null;
}

// 曲名の読み取りに自信が持てない場合に使う「逆算」検索。
// diffKey(読み取った難易度)で絞り込んだ上で、総ノーツ数が近い順 → レベルが近い順 →
// 曲名の類似度が高い順、の優先度でソートした候補一覧を返す(要求仕様の「その楽曲難易度で
// そのノーツ数のものをリストアップし、最も近いものを採用する」をそのまま実装したもの)。
// diffKey に該当する譜面が1件も無い場合は、難易度の絞り込みなしで全譜面から探す
// (難易度自体の読み取りも誤っていた可能性を考慮したフォールバック)。
function findCandidatesByStats({ diffKey, totalNoteCount, level, titleText, limit }) {
  if (!dbDiffs || dbDiffs.length === 0) return [];
  limit = limit || 5;

  let rows = diffKey ? dbDiffs.filter(r => r.musicDifficulty === diffKey) : dbDiffs;
  if (rows.length === 0) rows = dbDiffs;

  const titleTarget = titleText ? normalizeString(titleText) : '';

  const scored = rows.map(row => {
    const music = dbMusicsById.get(row.musicId) || null;
    if (!music) return null;
    const noteDiff = (typeof totalNoteCount === 'number') ? Math.abs(row.totalNoteCount - totalNoteCount) : 0;
    const levelDiff = (typeof level === 'number' && level !== null) ? Math.abs(row.playLevel - level) : 0;
    let titleSim = 1;
    if (titleTarget) {
      const dbNorm = normalizeString(music.title);
      titleSim = levenshtein(titleTarget, dbNorm) / Math.max(titleTarget.length, dbNorm.length, 1);
    }
    return { row, music, noteDiff, levelDiff, titleSim };
  }).filter(Boolean);

  // 優先度チェーン: 総ノーツ数の近さ → レベルの近さ → 曲名の類似度
  scored.sort((a, b) => (a.noteDiff - b.noteDiff) || (a.levelDiff - b.levelDiff) || (a.titleSim - b.titleSim));
  return scored.slice(0, limit);
}
