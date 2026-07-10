/**
 * music-db.js
 * ---------------------------------------------------------------------------
 * sekai-world の楽曲マスターDB（musics.json / musicDifficulties.json）を取得し、
 * OCRで読み取ったタイトル文字列との近似一致（レーベンシュタイン距離）や、
 * 楽曲ID・難易度からのレベル参照を行う。
 * ---------------------------------------------------------------------------
 */
const MusicDB = (() => {
  let musics = [];
  let diffs = [];
  let loaded = false;
  let loadPromise = null;

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const [musicsResp, diffsResp] = await Promise.all([
          fetch(Config.MUSIC_DB_URL),
          fetch(Config.MUSIC_DIFF_DB_URL),
        ]);
        musics = await musicsResp.json();
        diffs = await diffsResp.json();
        loaded = true;
      } catch (e) {
        console.error('MusicDB load error', e);
      }
    })();
    return loadPromise;
  }

  function findBestMatchMusic(ocrText) {
    if (!musics || musics.length === 0) return null;
    const target = Utils.normalizeString(ocrText);
    if (target.length === 0) return null;
    let bestMatch = null;
    let minScore = Infinity;
    for (const music of musics) {
      const dbTitleNorm = Utils.normalizeString(music.title);
      const dist = Utils.levenshtein(target, dbTitleNorm);
      const score = dist / Math.max(target.length, dbTitleNorm.length, 1);
      if (score < minScore) { minScore = score; bestMatch = music; }
    }
    return bestMatch;
  }

  function getLevelFromDb(musicId, diffKey) {
    if (musicId == null || !diffKey || !diffs) return null;
    const entry = diffs.find((d) => d.musicId === musicId && d.musicDifficulty === diffKey);
    return entry ? entry.playLevel : null;
  }

  function getTitleById(musicId) {
    if (musicId == null) return null;
    const m = musics.find((mm) => mm.id === musicId);
    return m ? m.title : null;
  }

  function isLoaded() { return loaded; }

  return { load, findBestMatchMusic, getLevelFromDb, getTitleById, isLoaded };
})();
