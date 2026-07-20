// state.js — the single mutable state object shared by every UI module.
// There is no framework here: modules mutate `state` directly and then
// call the relevant render function (see main.js for wiring).

export const state = {
  status: "loading", // 'loading' | 'ready' | 'error'
  errorMessage: "",

  songs: [], // all songs, built once from the master data
  songsById: new Map(),

  filters: {
    unitTag: "all",
    newlyWritten: "all", // 'all' | 'new' | 'cover'
    characters: new Set(), // Set of "type:id" keys, AND-combined
  },

  sort: {
    field: "id", // 'title' | 'id' | 'level' | 'date'
    direction: "asc", // 'asc' | 'desc'
    levelDifficulty: "master",
  },

  searchQuery: "",

  viewMode: "grid3", // 'list1' | 'grid3' | 'grid5'

  route: { name: "list", songId: null },

  settings: {
    introSkip: false,
  },
};

const SETTINGS_KEY = "sekaiMusicLibrary:settings";
const VIEW_MODE_KEY = "sekaiMusicLibrary:viewMode";

export function loadPersistedState() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.introSkip === "boolean") state.settings.introSkip = parsed.introSkip;
    }
  } catch (e) {
    /* ignore malformed/blocked storage */
  }
  try {
    const vm = localStorage.getItem(VIEW_MODE_KEY);
    if (vm === "list1" || vm === "grid3" || vm === "grid5") state.viewMode = vm;
  } catch (e) {
    /* ignore */
  }
}

export function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch (e) {
    /* ignore */
  }
}

export function persistViewMode() {
  try {
    localStorage.setItem(VIEW_MODE_KEY, state.viewMode);
  } catch (e) {
    /* ignore */
  }
}

export function getVisibleSongCount() {
  return state.songs.length;
}
