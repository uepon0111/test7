// query.js — pure functions that turn (songs + filters/sort/search state)
// into the visible list. No DOM access here; filter.js / sort.js / search.js
// own the UI and call into this module.

let collatorJa = null;
function getCollator() {
  if (!collatorJa) collatorJa = new Intl.Collator("ja", { usage: "sort", sensitivity: "base" });
  return collatorJa;
}

export function filterSongs(songs, filters) {
  return songs.filter((song) => {
    if (filters.unitTag !== "all" && !song.tags.includes(filters.unitTag)) return false;
    if (filters.newlyWritten === "new" && !song.isNewlyWrittenMusic) return false;
    if (filters.newlyWritten === "cover" && song.isNewlyWrittenMusic) return false;
    if (filters.characters.size > 0) {
      for (const key of filters.characters) {
        if (!song.singerKeys.has(key)) return false;
      }
    }
    return true;
  });
}

export function sortSongs(songs, sort) {
  const dir = sort.direction === "asc" ? 1 : -1;
  const arr = songs.slice();
  const collator = getCollator();

  if (sort.field === "title") {
    arr.sort((a, b) => dir * collator.compare(a.pronunciation || a.title, b.pronunciation || b.title));
  } else if (sort.field === "id") {
    arr.sort((a, b) => dir * (a.id - b.id));
  } else if (sort.field === "date") {
    arr.sort((a, b) => dir * (a.publishedAt - b.publishedAt));
  } else if (sort.field === "level") {
    const diff = sort.levelDifficulty;
    arr.sort((a, b) => {
      const av = a.levelByDifficulty[diff] ? a.levelByDifficulty[diff].level : null;
      const bv = b.levelByDifficulty[diff] ? b.levelByDifficulty[diff].level : null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // songs without this difficulty always sink to the end
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }
  return arr;
}

/** Normalizes full/half-width and katakana/hiragana so kana input matches either form. */
export function normalizeKana(str) {
  if (!str) return "";
  return str
    .normalize("NFKC")
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .toLowerCase()
    .trim();
}

function titleHaystack(song) {
  return normalizeKana(song.title) + " " + normalizeKana(song.pronunciation);
}

function creditHaystack(song) {
  return [song.lyricist, song.composer, song.arranger].map(normalizeKana).join(" ");
}

export function searchSongs(songs, rawQuery) {
  const q = normalizeKana(rawQuery);
  if (!q) return songs;
  return songs.filter((song) => titleHaystack(song).includes(q) || creditHaystack(song).includes(q));
}

/** Real-time typeahead candidates: title/reading matches first, then credit matches. */
export function searchSuggestions(songs, rawQuery, limit = 8) {
  const q = normalizeKana(rawQuery);
  if (!q) return [];
  const titleMatches = [];
  const creditMatches = [];
  for (const song of songs) {
    if (titleHaystack(song).includes(q)) {
      titleMatches.push(song);
    } else if (creditHaystack(song).includes(q)) {
      creditMatches.push(song);
    }
    if (titleMatches.length >= limit) break;
  }
  return titleMatches.concat(creditMatches).slice(0, limit);
}
