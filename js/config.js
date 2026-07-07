export const APP_CONFIG = {
  clientId: '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com',
  apiKey: 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0',
  discoveryDoc: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  scopes: 'https://www.googleapis.com/auth/drive',
  rootFolderName: 'プロセカリザルト',
  fcFolderName: 'FC',
  storageKey: 'prsk-result-viewer-settings-v2',
  metaPrefix: 'PRSK_RESULT_META:',
};

export const DIFFICULTY_ORDER = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'MASTER', 'APPEND'];

export const DIFFICULTY_META = {
  EASY:   { code: 'EASY',   short: 'E', color: '#66DA7E' },
  NORMAL: { code: 'NORMAL', short: 'N', color: '#66C9F9' },
  HARD:   { code: 'HARD',   short: 'H', color: '#F5CC44' },
  EXPERT: { code: 'EXPERT', short: 'E', color: '#EA5577' },
  MASTER: { code: 'MASTER', short: 'M', color: '#BB40F5' },
  APPEND: { code: 'APPEND', short: 'A', color: '#EE82E2' },
};

export const DIFFICULTY_ALIASES = {
  E: 'EXPERT',
  M: 'MASTER',
  A: 'APPEND',
  H: 'HARD',
  N: 'NORMAL',
  EASY: 'EASY',
  NORMAL: 'NORMAL',
  HARD: 'HARD',
  EXPERT: 'EXPERT',
  MASTER: 'MASTER',
  APPEND: 'APPEND',
};

export const DEFAULT_CROPS = {
  diff:   { x: 0.20, y: 0.07, w: 0.10, h: 0.04 },
  title:  { x: 0.19, y: 0.01, w: 0.32, h: 0.05 },
  result: { x: 0.10, y: 0.55, w: 0.20, h: 0.28 },
  combo:  { x: 0.58, y: 0.36, w: 0.28, h: 0.16 },
};

export const DEFAULT_SETTINGS = {
  cropRegions: DEFAULT_CROPS,
  filters: {
    fc: 'all',
    missMin: '',
    missMax: '',
    diff: 'all',
    title: '',
    level: '',
    selfBestOnly: false,
  },
  sort: {
    key: 'level',
    direction: 'desc',
  },
};

export const SORT_OPTIONS = [
  { value: 'name', label: '名前順' },
  { value: 'level', label: '楽曲レベル順' },
  { value: 'miss', label: 'ミス数順' },
  { value: 'date', label: '追加日順' },
];

export const SORT_DIRECTION_LABEL = {
  asc: '昇順',
  desc: '降順',
};
