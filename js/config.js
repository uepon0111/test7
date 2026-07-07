export const ROOT_FOLDER_NAME = "プロセカリザルト";
export const RESULT_SUBFOLDER_NAME = "FC";
export const STORAGE_KEY_SETTINGS = "prsk-result-viewer-settings-v2";

export const DIFFICULTY_DEFS = {
  easy: {
    key: "easy",
    label: "EASY",
    color: "#66DA7E",
    order: 1,
    aliases: ["EASY", "EZ"],
  },
  normal: {
    key: "normal",
    label: "NORMAL",
    color: "#66C9F9",
    order: 2,
    aliases: ["NORMAL", "NM"],
  },
  hard: {
    key: "hard",
    label: "HARD",
    color: "#F5CC44",
    order: 3,
    aliases: ["HARD", "H"],
  },
  expert: {
    key: "expert",
    label: "EXPERT",
    color: "#EA5577",
    order: 4,
    aliases: ["EXPERT", "E"],
  },
  master: {
    key: "master",
    label: "MASTER",
    color: "#BB40F5",
    order: 5,
    aliases: ["MASTER", "M"],
  },
  append: {
    key: "append",
    label: "APPEND",
    color: "#EE82E2",
    order: 6,
    aliases: ["APPEND", "A"],
  },
};

export const DIFFICULTY_KEYS = Object.keys(DIFFICULTY_DEFS);

export const DEFAULT_CROP_SETTINGS = {
  diff: { x: 0.20, y: 0.07, w: 0.10, h: 0.04 },
  title: { x: 0.19, y: 0.01, w: 0.32, h: 0.05 },
  result: { x: 0.10, y: 0.55, w: 0.20, h: 0.28 },
  combo: { x: 0.60, y: 0.72, w: 0.26, h: 0.12 },
};

export const SORT_OPTIONS = [
  { value: "name_asc", label: "名前順（昇順）", primary: "name", direction: "asc" },
  { value: "name_desc", label: "名前順（降順）", primary: "name", direction: "desc" },
  { value: "level_asc", label: "楽曲レベル順（昇順）", primary: "level", direction: "asc" },
  { value: "level_desc", label: "楽曲レベル順（降順）", primary: "level", direction: "desc" },
  { value: "miss_asc", label: "ミス数順（昇順）", primary: "miss", direction: "asc" },
  { value: "miss_desc", label: "ミス数順（降順）", primary: "miss", direction: "desc" },
  { value: "date_asc", label: "追加日順（昇順）", primary: "date", direction: "asc" },
  { value: "date_desc", label: "追加日順（降順）", primary: "date", direction: "desc" },
];

export function normalizeDifficultyToken(token) {
  if (!token) return null;
  const upper = String(token).trim().toUpperCase();
  for (const def of Object.values(DIFFICULTY_DEFS)) {
    if (def.aliases.includes(upper)) return def.key;
  }
  return null;
}

export function getDifficultyDef(key) {
  return DIFFICULTY_DEFS[key] || DIFFICULTY_DEFS.expert;
}

export function getDifficultyLabel(key) {
  return getDifficultyDef(key).label;
}

export function getDifficultyColor(key) {
  return getDifficultyDef(key).color;
}

export function buildSongFolderName(level, diffKey, title) {
  const safeLevel = String(level || "").trim();
  const safeTitle = String(title || "").trim();
  const label = getDifficultyLabel(diffKey);
  return `${safeLevel} ${label} ${safeTitle}`.replace(/\s+/g, " ").trim();
}

export function getDifficultyOrderKey(key) {
  return getDifficultyDef(key).order;
}

export function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}
