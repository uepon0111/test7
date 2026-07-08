
export const APP_NAME = 'プロセカ リザルト管理';
export const ROOT_FOLDER_NAME = 'プロセカリザルト';
export const FC_FOLDER_NAME = 'FC';

export const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
export const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';
export const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
export const SCOPES = 'https://www.googleapis.com/auth/drive';

export const DIFFICULTIES = [
  { key: 'EASY', label: 'EASY', color: '#66DA7E', order: 0 },
  { key: 'NORMAL', label: 'NORMAL', color: '#66C9F9', order: 1 },
  { key: 'HARD', label: 'HARD', color: '#F5CC44', order: 2 },
  { key: 'EXPERT', label: 'EXPERT', color: '#EA5577', order: 3 },
  { key: 'MASTER', label: 'MASTER', color: '#BB40F5', order: 4 },
  { key: 'APPEND', label: 'APPEND', color: '#EE82E2', order: 5 },
];

export const DIFFICULTY_ORDER = Object.fromEntries(DIFFICULTIES.map((d, i) => [d.key, i]));
export const DIFFICULTY_SHORT = {
  E: 'EXPERT',
  M: 'MASTER',
  H: 'HARD',
  A: 'APPEND',
  N: 'NORMAL',
  L: 'EASY',
  EZ: 'EASY',
  EASY: 'EASY',
  NORMAL: 'NORMAL',
  HARD: 'HARD',
  EXPERT: 'EXPERT',
  MASTER: 'MASTER',
  APPEND: 'APPEND',
};
export const DIFFICULTY_ALIASES = Object.fromEntries(
  Object.entries(DIFFICULTY_SHORT).map(([k, v]) => [k.toUpperCase(), v])
);

export const DEFAULT_PROFILE = {
  id: 'default',
  name: 'Default / 既定',
  deviceHint: '',
  width: 1170,
  height: 2532,
  ratio: 1170 / 2532,
  regions: {
    difficulty: { x: 0.20, y: 0.07, w: 0.12, h: 0.05 },
    title: { x: 0.18, y: 0.01, w: 0.35, h: 0.055 },
    result: { x: 0.08, y: 0.54, w: 0.26, h: 0.30 },
    combo: { x: 0.37, y: 0.18, w: 0.26, h: 0.10 },
  },
};

export const STORAGE_KEYS = {
  settings: 'prsk-result-viewer.settings.v2',
  ui: 'prsk-result-viewer.ui.v2',
};

export const SORT_OPTIONS = {
  name_asc: { key: 'name', direction: 1 },
  name_desc: { key: 'name', direction: -1 },
  level_asc: { key: 'level', direction: 1 },
  level_desc: { key: 'level', direction: -1 },
  miss_asc: { key: 'miss', direction: 1 },
  miss_desc: { key: 'miss', direction: -1 },
  date_asc: { key: 'date', direction: 1 },
  date_desc: { key: 'date', direction: -1 },
};
