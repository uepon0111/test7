
export const LOCAL_STORAGE_KEY = 'prsk-result-viewer-settings-v2';
export const ROOT_FOLDER_NAME = 'プロセカリザルト';
export const DEVICE_FOLDER_PREFIX = 'device';

export const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'MASTER', 'APPEND'];
export const DIFF_COLORS = {
  EASY: '#66DA7E',
  NORMAL: '#66C9F9',
  HARD: '#F5CC44',
  EXPERT: '#EA5577',
  MASTER: '#BB40F5',
  APPEND: '#EE82E2',
};

export const DIFF_ORDER = {
  EASY: 0,
  NORMAL: 1,
  HARD: 2,
  EXPERT: 3,
  MASTER: 4,
  APPEND: 5,
};

export const DIFF_SHORT = {
  EASY: 'E',
  NORMAL: 'N',
  HARD: 'H',
  EXPERT: 'X',
  MASTER: 'M',
  APPEND: 'A',
};

export const DIFF_FROM_SHORT = {
  E: 'EASY',
  N: 'NORMAL',
  H: 'HARD',
  X: 'EXPERT',
  M: 'MASTER',
  A: 'APPEND',
};

export const DEFAULT_REGIONS = {
  diff:   { x: 0.20, y: 0.07, w: 0.10, h: 0.045 },
  title:  { x: 0.19, y: 0.01, w: 0.32, h: 0.055 },
  result: { x: 0.10, y: 0.55, w: 0.26, h: 0.30 },
  combo:  { x: 0.58, y: 0.48, w: 0.18, h: 0.11 },
};

export const DEFAULT_SETTINGS = {
  currentPresetId: 'default-preset',
  bestOnly: false,
  presets: [
    {
      id: 'default-preset',
      name: 'デフォルト',
      width: 0,
      height: 0,
      aspectRatio: 0,
      regions: structuredClone(DEFAULT_REGIONS),
      updatedAt: Date.now(),
    },
  ],
};

export const state = {
  gapiInited: false,
  gisInited: false,
  tokenClient: null,
  dbMusics: [],
  dbDiffs: [],
  allRecords: [],
  filteredRecords: [],
  selectedIds: new Set(),
  isSelectMode: false,
  uploadQueue: [],
  activeItemId: null,
  currentMode: 'upload',
  currentViewToken: 0,
  loadingViewToken: 0,
  viewBusy: false,
  settings: structuredClone(DEFAULT_SETTINGS),
  toastTimers: new Map(),
  bestMap: new Map(),
  currentUploadDeviceId: '',
};

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u3000\s]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
}

export function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value || '';
  }
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatShortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getDifficultyLabel(raw) {
  return DIFFICULTIES.includes(raw) ? raw : 'EXPERT';
}

export function getDifficultyColor(raw) {
  return DIFF_COLORS[getDifficultyLabel(raw)] || '#999';
}

export function computeBestScore(record) {
  return [
    -(record.totalMiss ?? 999999),
    -(record.combo ?? 0),
    -(record.perfect ?? 0),
    -(record.great ?? 0) * -1, // lower great is better
  ];
}

export function compareBest(a, b) {
  const missA = a.totalMiss ?? 999999;
  const missB = b.totalMiss ?? 999999;
  if (missA !== missB) return missA - missB;
  const comboA = a.combo ?? 0;
  const comboB = b.combo ?? 0;
  if (comboA !== comboB) return comboB - comboA;
  const perfectA = a.perfect ?? 0;
  const perfectB = b.perfect ?? 0;
  if (perfectA !== perfectB) return perfectB - perfectA;
  const greatA = a.great ?? 0;
  const greatB = b.great ?? 0;
  if (greatA !== greatB) return greatA - greatB;
  const goodA = a.good ?? 0;
  const goodB = b.good ?? 0;
  if (goodA !== goodB) return goodA - goodB;
  const dateA = new Date(a.createdTime || a.modifiedTime || 0).getTime();
  const dateB = new Date(b.createdTime || b.modifiedTime || 0).getTime();
  return dateA - dateB;
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
