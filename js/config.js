
export const APP_NAME = 'プロセカ リザルト';
export const ROOT_FOLDER_NAME = 'プロセカリザルト';
export const DEVICE_CONTAINER_NAME = 'devices';
export const DRIVE_SCHEMA = 'v2';

export const STORAGE_KEYS = {
  settings: 'prsk-result-viewer-settings-v2',
  ui: 'prsk-result-viewer-ui-v2',
};

export const DIFFICULTIES = [
  { key: 'easy', label: 'EASY', short: 'E', color: '#66DA7E', order: 0 },
  { key: 'normal', label: 'NORMAL', short: 'N', color: '#66C9F9', order: 1 },
  { key: 'hard', label: 'HARD', short: 'H', color: '#F5CC44', order: 2 },
  { key: 'expert', label: 'EXPERT', short: 'X', color: '#EA5577', order: 3 },
  { key: 'master', label: 'MASTER', short: 'M', color: '#BB40F5', order: 4 },
  { key: 'append', label: 'APPEND', short: 'A', color: '#EE82E2', order: 5 },
];

export const DIFFICULTY_ORDER = Object.fromEntries(DIFFICULTIES.map((d, i) => [d.key, i]));
export const DIFFICULTY_LABELS = Object.fromEntries(DIFFICULTIES.map((d) => [d.key, d.label]));
export const DIFFICULTY_COLORS = Object.fromEntries(DIFFICULTIES.map((d) => [d.key, d.color]));
export const DIFFICULTY_SHORT_TO_KEY = { E: 'easy', N: 'normal', H: 'hard', X: 'expert', M: 'master', A: 'append' };
export const DIFFICULTY_KEY_TO_SHORT = Object.fromEntries(Object.entries(DIFFICULTY_SHORT_TO_KEY).map(([k, v]) => [v, k]));

export const DEFAULT_PROFILE_REGIONS = {
  title:   { x: 0.17, y: 0.02, w: 0.38, h: 0.06 },
  diff:    { x: 0.19, y: 0.075, w: 0.12, h: 0.04 },
  result:  { x: 0.08, y: 0.52, w: 0.42, h: 0.28 },
  combo:   { x: 0.52, y: 0.42, w: 0.36, h: 0.18 },
};

export const DEFAULT_DEVICE_PROFILES = [
  {
    id: 'auto-1959',
    name: '標準 19.5:9',
    width: 1170,
    height: 2532,
    builtIn: true,
    regions: structuredClone(DEFAULT_PROFILE_REGIONS),
  },
  {
    id: 'auto-209',
    name: '標準 20:9',
    width: 1080,
    height: 2400,
    builtIn: true,
    regions: structuredClone(DEFAULT_PROFILE_REGIONS),
  },
  {
    id: 'auto-169',
    name: '標準 16:9',
    width: 1080,
    height: 1920,
    builtIn: true,
    regions: structuredClone(DEFAULT_PROFILE_REGIONS),
  },
  {
    id: 'auto-tablet',
    name: 'タブレット 4:3',
    width: 1536,
    height: 2048,
    builtIn: true,
    regions: structuredClone(DEFAULT_PROFILE_REGIONS),
  },
];

export const DEFAULT_SETTINGS = {
  showBestOnly: false,
  sortKey: 'level',
  sortDirection: 'desc',
  selectedProfileId: DEFAULT_DEVICE_PROFILES[0].id,
  profiles: DEFAULT_DEVICE_PROFILES,
};
