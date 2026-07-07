import { APP_CONFIG, DIFFICULTY_ALIASES, DIFFICULTY_META, DIFFICULTY_ORDER } from './config.js';

export function normalizeDifficulty(value) {
  if (!value) return 'EXPERT';
  const token = String(value).trim().toUpperCase();
  return DIFFICULTY_ALIASES[token] || DIFFICULTY_ALIASES[token[0]] || token;
}

export function difficultyIndex(value) {
  const normalized = normalizeDifficulty(value);
  const index = DIFFICULTY_ORDER.indexOf(normalized);
  return index === -1 ? 999 : index;
}

export function difficultyColor(value) {
  const normalized = normalizeDifficulty(value);
  return DIFFICULTY_META[normalized]?.color || '#cccccc';
}

export function difficultyShort(value) {
  const normalized = normalizeDifficulty(value);
  return DIFFICULTY_META[normalized]?.short || normalized.slice(0, 1);
}

export function parseFolderTitle(folderName) {
  if (!folderName) return null;
  const name = String(folderName).trim();
  const compact = name.match(/^(\d+)(?:\s*([A-Z]+))?\s+(.+)$/i);
  if (!compact) return null;

  const level = Number.parseInt(compact[1], 10);
  const diffToken = compact[2] ? normalizeDifficulty(compact[2]) : 'EXPERT';
  const title = compact[3].trim();

  if (!DIFFICULTY_ORDER.includes(diffToken)) return null;

  return {
    level,
    difficulty: diffToken,
    difficultyRaw: diffToken,
    title,
  };
}

export function buildFolderName(level, difficulty, title) {
  return `${level} ${normalizeDifficulty(difficulty)} ${title}`.replace(/\s+/g, ' ').trim();
}

export function parseScoreFromFileName(fileName) {
  if (!fileName) return null;
  const match = String(fileName).match(/^FC(?:-(\d+))?/i);
  if (!match) return null;
  return match[1] == null ? 0 : Number.parseInt(match[1], 10);
}

export function buildMetaKey(record) {
  return `${record.title}||${record.level}||${normalizeDifficulty(record.difficultyRaw)}`;
}

export function parseDriveDescription(description) {
  if (!description || typeof description !== 'string') return null;
  if (!description.startsWith(APP_CONFIG.metaPrefix)) return null;
  try {
    return JSON.parse(description.slice(APP_CONFIG.metaPrefix.length));
  } catch (error) {
    console.warn('Failed to parse record metadata', error);
    return null;
  }
}

export function serializeDriveDescription(meta) {
  return `${APP_CONFIG.metaPrefix}${JSON.stringify(meta)}`;
}

export function compareScore(a, b) {
  const aMiss = Number.isFinite(a?.missCount) ? a.missCount : Number.POSITIVE_INFINITY;
  const bMiss = Number.isFinite(b?.missCount) ? b.missCount : Number.POSITIVE_INFINITY;
  if (aMiss !== bMiss) return aMiss - bMiss;

  const aCombo = Number.isFinite(a?.comboCount) ? a.comboCount : -1;
  const bCombo = Number.isFinite(b?.comboCount) ? b.comboCount : -1;
  if (aCombo !== bCombo) return bCombo - aCombo;

  const aPerfect = Number.isFinite(a?.perfectCount) ? a.perfectCount : -1;
  const bPerfect = Number.isFinite(b?.perfectCount) ? b.perfectCount : -1;
  if (aPerfect !== bPerfect) return bPerfect - aPerfect;

  const aGreat = Number.isFinite(a?.greatCount) ? a.greatCount : Number.POSITIVE_INFINITY;
  const bGreat = Number.isFinite(b?.greatCount) ? b.greatCount : Number.POSITIVE_INFINITY;
  if (aGreat !== bGreat) return aGreat - bGreat;

  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

export function isBetterScore(candidate, currentBest) {
  if (!currentBest) return true;
  return compareScore(candidate, currentBest) < 0;
}

export function computeBestMap(records) {
  const bestMap = new Map();
  for (const record of records) {
    const key = buildMetaKey(record);
    const current = bestMap.get(key);
    if (!current || isBetterScore(record, current)) {
      bestMap.set(key, record);
    }
  }
  return bestMap;
}

export function isSelfBest(record, bestMap) {
  const best = bestMap.get(buildMetaKey(record));
  if (!best) return false;
  return compareScore(record, best) === 0;
}

function compareDirection(aValue, bValue, direction = 'asc') {
  if (aValue === bValue) return 0;
  const base = aValue < bValue ? -1 : 1;
  return direction === 'desc' ? -base : base;
}

export function sortRecords(records, sortKey, direction = 'desc') {
  const list = [...records];
  const compareName = (a, b) => compareDirection(a.title.localeCompare(b.title, 'ja'), 0, direction) || 0;

  list.sort((a, b) => {
    const nameCmp = a.title.localeCompare(b.title, 'ja');
    const levelCmp = Number(a.level ?? 0) - Number(b.level ?? 0);
    const missCmp = Number(a.missCount ?? 0) - Number(b.missCount ?? 0);
    const dateCmp = new Date(a.createdTime || 0).getTime() - new Date(b.createdTime || 0).getTime();
    const diffCmp = difficultyIndex(a.difficultyRaw) - difficultyIndex(b.difficultyRaw);
    const difficultyPriorityCmp = diffCmp;
    const namePriorityCmp = nameCmp;
    const missPriorityCmp = missCmp;
    const datePriorityCmp = dateCmp;

    const primary = (() => {
      if (sortKey === 'name') return direction === 'desc' ? -nameCmp : nameCmp;
      if (sortKey === 'level') return direction === 'desc' ? -levelCmp : levelCmp;
      if (sortKey === 'miss') return direction === 'desc' ? -missCmp : missCmp;
      if (sortKey === 'date') return direction === 'desc' ? -dateCmp : dateCmp;
      return direction === 'desc' ? -nameCmp : nameCmp;
    })();

    if (primary !== 0) return primary;

    if (sortKey === 'name') return difficultyPriorityCmp || missPriorityCmp || datePriorityCmp;
    if (sortKey === 'level') return difficultyPriorityCmp || namePriorityCmp || missPriorityCmp || datePriorityCmp;
    if (sortKey === 'miss') return levelCmp || difficultyPriorityCmp || namePriorityCmp || datePriorityCmp;
    if (sortKey === 'date') return 0;

    return levelCmp || difficultyPriorityCmp || missPriorityCmp || datePriorityCmp;
  });

  return list;
}

export function applyFilters(records, settings, bestMap = null) {
  const filters = settings?.filters || {};
  let list = [...records];

  if (filters.selfBestOnly) {
    const map = bestMap || computeBestMap(records);
    list = list.filter((record) => isSelfBest(record, map));
  }

  list = list.filter((record) => {
    if (filters.fc === 'fc' && !record.isFC) return false;
    if (filters.fc === 'unfc' && record.isFC) return false;

    const missMin = filters.missMin;
    const missMax = filters.missMax;
    const missCount = Number(record.missCount ?? 0);
    if (missMin !== '' && missCount < Number(missMin)) return false;
    if (missMax !== '' && missCount > Number(missMax)) return false;

    if (filters.diff !== 'all' && normalizeDifficulty(record.difficultyRaw) !== normalizeDifficulty(filters.diff)) return false;
    if (filters.level !== '' && String(record.level) !== String(filters.level).trim()) return false;
    if (filters.title && !String(record.title ?? '').toLowerCase().includes(String(filters.title).trim().toLowerCase())) return false;
    return true;
  });

  return sortRecords(list, settings?.sort?.key || 'level', settings?.sort?.direction || 'desc');
}

export function getBestRecordForKey(records, keyRecord) {
  const key = buildMetaKey(keyRecord);
  return records.filter((record) => buildMetaKey(record) === key).sort(compareScore)[0] || null;
}
