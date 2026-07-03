// js/music-db.js

import { MUSIC_URL, DIFF_URL } from './constants.js';
import { normalizeString, levenshtein } from './utils.js';

let _musics = null;
let _diffs  = null;

export const MusicDB = {
  async init() {
    if (_musics && _diffs) return;
    try {
      const [mr, dr] = await Promise.all([fetch(MUSIC_URL), fetch(DIFF_URL)]);
      _musics = await mr.json();
      _diffs  = await dr.json();
    } catch (e) {
      console.warn('[MusicDB] 楽曲データ取得失敗:', e);
      _musics = [];
      _diffs  = [];
    }
  },

  /** OCRテキストから最も近い楽曲を返す */
  findBestMatch(ocrText) {
    if (!_musics?.length) return null;
    const target = normalizeString(ocrText);
    if (!target) return null;

    let best = null, bestScore = Infinity;
    for (const m of _musics) {
      const t = normalizeString(m.title);
      const p = normalizeString(m.pronunciation || '');
      const distT = levenshtein(target, t);
      const distP = p ? levenshtein(target, p) : Infinity;
      const dist  = Math.min(distT, distP);
      const score = dist / Math.max(target.length, t.length, 1);
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return best;
  },

  /** タイトル / 読み方で部分一致検索（最大20件） */
  search(query) {
    if (!_musics) return [];
    const q = normalizeString(query);
    if (!q) return _musics.slice(0, 20);
    return _musics.filter(m => {
      return normalizeString(m.title).includes(q) ||
             normalizeString(m.pronunciation || '').includes(q);
    }).slice(0, 20);
  },

  getDiffEntry(musicId, diffKey) {
    if (!_diffs) return null;
    return _diffs.find(d => d.musicId === musicId && d.musicDifficulty === diffKey) || null;
  },

  getLevel(musicId, diffKey) {
    return this.getDiffEntry(musicId, diffKey)?.playLevel ?? null;
  },

  getTotalNotes(musicId, diffKey) {
    return this.getDiffEntry(musicId, diffKey)?.totalNoteCount ?? null;
  },

  getMusicById(id) {
    return _musics?.find(m => m.id === id) || null;
  },

  getAll() { return _musics || []; },
};
