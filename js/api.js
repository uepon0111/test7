// api.js — the data layer. Fetches the master JSON files provided by the
// sekai-world community database and the sekai.best asset CDN, then shapes
// them into a normalized song list the rest of the app works with.
//
// IMPORTANT: only metadata JSON is fetched here (song titles, difficulty
// numbers, tag lists, character lists...). Actual audio files are never
// requested by this module — those are only requested by player.js, and
// only once a person opens a specific song and picks a vocal (see
// player.js `loadVocal`).

const DB_BASE = "https://sekai-world.github.io/sekai-master-db-diff";
const ASSET_BASE = "https://storage.sekai.best/sekai-jp-assets";

const ENDPOINTS = {
  musics: `${DB_BASE}/musics.json`,
  difficulties: `${DB_BASE}/musicDifficulties.json`,
  vocals: `${DB_BASE}/musicVocals.json`,
  gameCharacters: `${DB_BASE}/gameCharacters.json`,
  outsideCharacters: `${DB_BASE}/outsideCharacters.json`,
  tags: `${DB_BASE}/musicTags.json`,
  originals: `${DB_BASE}/musicOriginals.json`,
};

export const DIFFICULTY_ORDER = ["easy", "normal", "hard", "expert", "master", "append"];

export const DIFFICULTY_LABELS = {
  easy: "EASY",
  normal: "NORMAL",
  hard: "HARD",
  expert: "EXPERT",
  master: "MASTER",
  append: "APPEND",
};

export const UNIT_TAGS = ["all", "vocaloid", "light_music_club", "idol", "street", "theme_park", "school_refusal", "other"];

export const UNIT_TAG_LABELS = {
  all: "全て",
  vocaloid: "バチャシン",
  light_music_club: "レオニ",
  idol: "モモジャン",
  street: "ビビバス",
  theme_park: "ワンダショ",
  school_refusal: "ニーゴ",
  other: "その他",
};

async function fetchJson(url) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) {
    throw new Error(`データの取得に失敗しました (${res.status}): ${url}`);
  }
  return res.json();
}

/** Fetches every master JSON file needed to build the song list (metadata only). */
export async function fetchAllMasterData() {
  const entries = Object.entries(ENDPOINTS);
  const results = await Promise.all(entries.map(([, url]) => fetchJson(url)));
  const data = {};
  entries.forEach(([key], i) => {
    data[key] = results[i];
  });
  return data;
}

export function jacketUrl(assetbundleName) {
  return `${ASSET_BASE}/music/jacket/${assetbundleName}/${assetbundleName}.png`;
}

export function vocalAudioUrl(assetbundleName) {
  return `${ASSET_BASE}/music/long/${assetbundleName}/${assetbundleName}.mp3`;
}

export function gameCharacterIconUrl(characterId) {
  return `${ASSET_BASE}/character/character_sd_l/chr_sp_${characterId}.png`;
}

/**
 * Merges musics / musicDifficulties / musicVocals / musicTags / musicOriginals
 * into a flat array of enriched song objects. This is the single source of
 * truth the rest of the app (query.js, list-view.js, detail-view.js) reads.
 */
export function buildSongs(raw) {
  const { musics, difficulties, vocals, tags, originals } = raw;

  const diffByMusic = groupBy(difficulties, "musicId");
  const vocalsByMusic = groupBy(vocals, "musicId");
  const tagsByMusic = groupBy(tags, "musicId");
  const originalByMusic = new Map(originals.map((o) => [o.musicId, o]));

  return musics.map((m) => {
    const rawDiffs = (diffByMusic.get(m.id) || []).slice().sort(
      (a, b) => DIFFICULTY_ORDER.indexOf(a.musicDifficulty) - DIFFICULTY_ORDER.indexOf(b.musicDifficulty)
    );
    const difficulties = rawDiffs.map((d) => ({
      difficulty: d.musicDifficulty,
      level: d.playLevel,
      notes: d.totalNoteCount,
    }));
    const levelByDifficulty = {};
    for (const d of difficulties) levelByDifficulty[d.difficulty] = d;

    const songVocals = (vocalsByMusic.get(m.id) || [])
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((v) => ({
        id: v.id,
        type: v.musicVocalType,
        caption: v.caption,
        assetbundleName: v.assetbundleName,
        // Raw data isn't always pre-sorted by seq within a vocal's
        // character list (confirmed against live data), so sort
        // explicitly to keep avatar order consistent and correct.
        characters: (v.characters || [])
          .slice()
          .sort((a, b) => a.seq - b.seq)
          .map((c) => ({
            type: c.characterType,
            id: c.characterId,
          })),
      }));

    const singerKeys = new Set();
    for (const v of songVocals) {
      for (const c of v.characters) singerKeys.add(`${c.type}:${c.id}`);
    }

    const songTags = (tagsByMusic.get(m.id) || [])
      .map((t) => t.musicTag)
      .filter((t) => t !== "all");

    return {
      id: m.id,
      title: m.title,
      pronunciation: m.pronunciation || "",
      lyricist: m.lyricist || "-",
      composer: m.composer || "-",
      arranger: m.arranger || "-",
      isNewlyWrittenMusic: !!m.isNewlyWrittenMusic,
      publishedAt: m.publishedAt || 0,
      jacketAssetbundleName: m.assetbundleName,
      difficulties,
      levelByDifficulty,
      tags: songTags,
      vocals: songVocals,
      singerKeys,
      original: originalByMusic.get(m.id) || null,
    };
  });
}

function groupBy(arr, key) {
  const map = new Map();
  for (const item of arr) {
    const k = item[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}
