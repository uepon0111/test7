import { deepMerge, clamp, normalizeString } from './utils.js';

export const DIFFICULTY_ORDER = {
  E: 0, N: 1, H: 2, E2: 3, M: 4, A: 5
};

export const DIFFICULTY_LABELS = {
  E: 'EASY',
  N: 'NORMAL',
  H: 'HARD',
  E2: 'EXPERT',
  M: 'MASTER',
  A: 'APPEND'
};

export const DIFFICULTY_COLORS = {
  E: '#66DA7E',
  N: '#66C9F9',
  H: '#F5CC44',
  E2: '#EA5577',
  M: '#BB40F5',
  A: '#EE82E2'
};

export const DIFFICULTY_ALIASES = {
  EASY: 'E',
  NORMAL: 'N',
  HARD: 'H',
  EXPERT: 'E2',
  MASTER: 'M',
  APPEND: 'A',
  E: 'E',
  N: 'N',
  H: 'H',
  E2: 'E2',
  M: 'M',
  A: 'A'
};

export const REGION_COLORS = {
  title: '#38bdf8',
  diff: '#fb7185',
  result: '#34d399',
  combo: '#f59e0b'
};

export const DEFAULT_REGIONS = {
  title: { x: 19, y: 1, w: 32, h: 5 },
  diff: { x: 20, y: 7, w: 10, h: 4 },
  result: { x: 10, y: 55, w: 26, h: 30 },
  combo: { x: 56, y: 47, w: 18, h: 10 }
};

export const DEFAULT_PROFILE_TEMPLATE = {
  name: '汎用 16:9',
  match: { aspect: 16 / 9, width: null, height: null, tolerance: 0.08 },
  regions: DEFAULT_REGIONS
};

export const DEFAULT_SETTINGS = {
  rootFolderName: 'PRSK_RESULTS',
  onlyBest: false,
  sortKey: 'level',
  sortDirection: 'desc',
  activeProfileId: 'default-16x9',
  profiles: [
    {
      id: 'default-16x9',
      name: '汎用 16:9',
      match: { aspect: 16 / 9, width: null, height: null, tolerance: 0.08 },
      regions: deepMerge({}, DEFAULT_REGIONS)
    },
    {
      id: 'default-19_5x9',
      name: '汎用 19.5:9',
      match: { aspect: 19.5 / 9, width: null, height: null, tolerance: 0.08 },
      regions: deepMerge({}, DEFAULT_REGIONS)
    },
    {
      id: 'default-20x9',
      name: '汎用 20:9',
      match: { aspect: 20 / 9, width: null, height: null, tolerance: 0.08 },
      regions: deepMerge({}, DEFAULT_REGIONS)
    }
  ]
};

const STORAGE_KEY = 'prsk-result-viewer-settings-v3';

export const appState = {
  gapiReady: false,
  gisReady: false,
  tokenClient: null,
  dbMusics: [],
  dbDiffs: [],
  allRecords: [],
  filteredRecords: [],
  selectedIds: new Set(),
  isSelectMode: false,
  loading: { visible: false, text: '読み込み中...', progress: 0 },
  renderToken: 0,
  settings: loadSettings(),
  activeToastTimer: null,
  editor: {
    mode: 'upload',
    queue: [],
    activeId: null,
    sampleImageUrl: '',
    sampleImageSize: null,
    activeRegion: 'title'
  },
  view: {
    sortKey: null,
    sortDirection: null,
    onlyBest: null
  }
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepMerge({}, DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    const settings = deepMerge(DEFAULT_SETTINGS, parsed);
    settings.profiles = Array.isArray(settings.profiles) && settings.profiles.length
      ? settings.profiles.map(normalizeProfile)
      : deepMerge([], DEFAULT_SETTINGS.profiles);
    if (!settings.profiles.find(p => p.id === settings.activeProfileId)) {
      settings.activeProfileId = settings.profiles[0].id;
    }
    return settings;
  } catch (e) {
    console.warn('Failed to load settings', e);
    return deepMerge({}, DEFAULT_SETTINGS);
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.settings));
  } catch (e) {
    console.warn('Failed to save settings', e);
  }
}

export function normalizeProfile(profile) {
  const base = deepMerge({}, DEFAULT_PROFILE_TEMPLATE);
  const merged = deepMerge(base, profile || {});
  merged.id = merged.id || `profile-${Date.now()}`;
  merged.name = merged.name || '新しい機種';
  merged.match = merged.match || {};
  merged.match.aspect = Number(merged.match.aspect || (16 / 9));
  merged.match.width = merged.match.width ? Number(merged.match.width) : null;
  merged.match.height = merged.match.height ? Number(merged.match.height) : null;
  merged.match.tolerance = Number(merged.match.tolerance || 0.08);
  merged.regions = merged.regions || deepMerge({}, DEFAULT_REGIONS);
  for (const key of Object.keys(DEFAULT_REGIONS)) {
    merged.regions[key] = normalizeRegion(merged.regions[key] || DEFAULT_REGIONS[key]);
  }
  return merged;
}

export function normalizeRegion(region) {
  return {
    x: clamp(Number(region.x ?? 0), 0, 100),
    y: clamp(Number(region.y ?? 0), 0, 100),
    w: clamp(Number(region.w ?? 10), 1, 100),
    h: clamp(Number(region.h ?? 10), 1, 100)
  };
}

export function getActiveProfile() {
  const { profiles, activeProfileId } = appState.settings;
  let profile = profiles.find(p => p.id === activeProfileId);
  if (!profile) profile = profiles[0];
  return profile;
}

export function getProfileById(profileId) {
  return appState.settings.profiles.find(p => p.id === profileId) || appState.settings.profiles[0] || null;
}

export function setActiveProfile(profileId) {
  if (appState.settings.profiles.some(p => p.id === profileId)) {
    appState.settings.activeProfileId = profileId;
    saveSettings();
  }
}

export function upsertProfile(profile) {
  const normalized = normalizeProfile(profile);
  const idx = appState.settings.profiles.findIndex(p => p.id === normalized.id);
  if (idx >= 0) appState.settings.profiles[idx] = normalized;
  else appState.settings.profiles.push(normalized);
  if (!appState.settings.activeProfileId) appState.settings.activeProfileId = normalized.id;
  saveSettings();
  return normalized;
}

export function deleteProfile(profileId) {
  const idx = appState.settings.profiles.findIndex(p => p.id === profileId);
  if (idx < 0) return false;
  if (appState.settings.profiles.length <= 1) return false;
  appState.settings.profiles.splice(idx, 1);
  if (appState.settings.activeProfileId === profileId) {
    appState.settings.activeProfileId = appState.settings.profiles[0].id;
  }
  saveSettings();
  return true;
}

export function duplicateProfile(profileId, newName = '') {
  const source = getProfileById(profileId);
  if (!source) return null;
  const copy = normalizeProfile({
    ...source,
    id: `profile-${Date.now()}`,
    name: newName || `${source.name} のコピー`
  });
  appState.settings.profiles.push(copy);
  appState.settings.activeProfileId = copy.id;
  saveSettings();
  return copy;
}

export function createProfileFromImageSize(width, height, suggestedName = '') {
  const aspect = width / height;
  const base = deepMerge({}, getActiveProfile() || DEFAULT_SETTINGS.profiles[0]);
  base.id = `profile-${Date.now()}`;
  base.name = suggestedName || `${width}x${height}`;
  base.match = { aspect, width, height, tolerance: 0.05 };
  return normalizeProfile(base);
}

export function selectBestProfileForImage(width, height) {
  const aspect = width / height;
  const profiles = appState.settings.profiles;
  let best = profiles[0] || null;
  let bestScore = Infinity;
  for (const profile of profiles) {
    const m = profile.match || {};
    let score = Math.abs((m.aspect || aspect) - aspect);
    if (m.width) score += Math.abs(m.width - width) / Math.max(width, m.width) * 0.1;
    if (m.height) score += Math.abs(m.height - height) / Math.max(height, m.height) * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = profile;
    }
  }
  return best || profiles[0] || null;
}

export function setSettingValue(key, value) {
  appState.settings[key] = value;
  saveSettings();
}

export function cloneRegionMap(regionMap) {
  return {
    title: normalizeRegion(regionMap.title),
    diff: normalizeRegion(regionMap.diff),
    result: normalizeRegion(regionMap.result),
    combo: normalizeRegion(regionMap.combo)
  };
}

export function getDifficultyLabel(code) {
  return DIFFICULTY_LABELS[code] || code || '';
}

export function getDifficultyCode(value) {
  if (!value) return '';
  const key = String(value).toUpperCase();
  return DIFFICULTY_ALIASES[key] || key;
}

export function getDifficultyOrder(code) {
  return DIFFICULTY_ORDER[code] ?? 999;
}

export function compareRecordScore(a, b) {
  const missA = Number(a?.missCount ?? a?.totalMiss ?? 999999);
  const missB = Number(b?.missCount ?? b?.totalMiss ?? 999999);
  if (missA !== missB) return missA - missB;
  const perfectA = Number(a?.perfectCount ?? 0);
  const perfectB = Number(b?.perfectCount ?? 0);
  if (perfectA !== perfectB) return perfectB - perfectA;
  const greatA = Number(a?.greatCount ?? 0);
  const greatB = Number(b?.greatCount ?? 0);
  if (greatA !== greatB) return greatA - greatB;
  const comboA = Number(a?.comboCount ?? 0);
  const comboB = Number(b?.comboCount ?? 0);
  if (comboA !== comboB) return comboB - comboA;
  const dateA = new Date(a?.createdTime || a?.uploadedAt || 0).getTime();
  const dateB = new Date(b?.createdTime || b?.uploadedAt || 0).getTime();
  return dateB - dateA;
}

export function bestRecordsMap(records) {
  const map = new Map();
  for (const rec of records) {
    const key = bestKey(rec);
    const current = map.get(key);
    if (!current || compareRecordScore(rec, current) < 0) {
      map.set(key, rec);
    }
  }
  return map;
}

export function bestKey(rec) {
  return `${normalizeString(rec.title)}|${rec.level}|${rec.difficultyRaw}`;
}

export function isSelfBest(rec, records = appState.allRecords) {
  const bestMap = bestRecordsMap(records);
  return bestMap.get(bestKey(rec))?.id === rec.id;
}
