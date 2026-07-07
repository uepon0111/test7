export const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
export const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';

export const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
export const SCOPES = 'https://www.googleapis.com/auth/drive';

export const DRIVE_ROOT_FOLDER_NAME = 'プロセカリザルト';
export const DRIVE_FC_FOLDER_NAME = 'FC';

export const DIFFICULTY_ORDER = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'MASTER', 'APPEND'];
export const DIFFICULTY_META = {
  EASY:   { key: 'EASY',   label: 'EASY',   color: '#66DA7E', dbKey: 'easy',   rank: 0 },
  NORMAL: { key: 'NORMAL', label: 'NORMAL', color: '#66C9F9', dbKey: 'normal', rank: 1 },
  HARD:   { key: 'HARD',   label: 'HARD',   color: '#F5CC44', dbKey: 'hard',   rank: 2 },
  EXPERT: { key: 'EXPERT', label: 'EXPERT', color: '#EA5577', dbKey: 'expert', rank: 3 },
  MASTER: { key: 'MASTER', label: 'MASTER', color: '#BB40F5', dbKey: 'master', rank: 4 },
  APPEND: { key: 'APPEND', label: 'APPEND', color: '#EE82E2', dbKey: 'append', rank: 5 },
};

export const DIFFICULTY_ALIASES = {
  A: 'APPEND',
  M: 'MASTER',
  E: 'EXPERT',
  H: 'HARD',
  N: 'NORMAL',
  L: 'EASY',
};

export const DEFAULT_REGIONS = {
  diff:   { x: 0.20, y: 0.07, w: 0.10, h: 0.04 },
  title:  { x: 0.19, y: 0.01, w: 0.32, h: 0.05 },
  result: { x: 0.10, y: 0.55, w: 0.28, h: 0.30 },
  combo:  { x: 0.55, y: 0.16, w: 0.22, h: 0.09 },
};

export const REGION_KEYS = ['diff', 'title', 'result', 'combo'];

export const SORT_FIELDS = {
  title: 'title',
  level: 'level',
  miss: 'miss',
  date: 'date',
};

export const STORAGE_KEYS = {
  profiles: 'prsk.viewer.machineProfiles.v2',
  prefs: 'prsk.viewer.preferences.v2',
  lastProfile: 'prsk.viewer.lastProfile.v2',
};

export const DEFAULT_PREFS = {
  sortField: 'level',
  sortDir: 'desc',
  showBestOnly: false,
  filters: {
    fc: 'all',
    missMin: '',
    missMax: '',
    diff: 'all',
    level: '',
    title: '',
  },
  activeProfileId: '',
};

export const RESULT_FIELDS = ['perfect', 'great', 'good', 'bad', 'miss', 'combo'];

export function cloneRegions() {
  return JSON.parse(JSON.stringify(DEFAULT_REGIONS));
}

export function normalizeDifficultyCode(value) {
  if (!value) return 'EXPERT';
  const raw = String(value).trim().toUpperCase();
  if (DIFFICULTY_META[raw]) return raw;
  if (DIFFICULTY_ALIASES[raw]) return DIFFICULTY_ALIASES[raw];
  if (raw === 'E') return 'EXPERT';
  return raw;
}

export function difficultyRankOf(value) {
  const diff = normalizeDifficultyCode(value);
  return DIFFICULTY_META[diff]?.rank ?? 99;
}

export function difficultyDbKeyOf(value) {
  const diff = normalizeDifficultyCode(value);
  return DIFFICULTY_META[diff]?.dbKey ?? 'expert';
}

export function difficultyLabelOf(value) {
  const diff = normalizeDifficultyCode(value);
  return DIFFICULTY_META[diff]?.label ?? diff;
}

export function difficultyColorOf(value) {
  const diff = normalizeDifficultyCode(value);
  return DIFFICULTY_META[diff]?.color ?? '#999';
}

export function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
