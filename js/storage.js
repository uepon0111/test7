
import { DEFAULT_PROFILE, STORAGE_KEYS } from './config.js';

function safeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createDefaultSettings() {
  return {
    selectedProfileId: DEFAULT_PROFILE.id,
    profiles: {
      [DEFAULT_PROFILE.id]: {
        ...DEFAULT_PROFILE,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    },
  };
}

export function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEYS.settings);
  const parsed = raw ? safeParse(raw, null) : null;
  const fallback = createDefaultSettings();

  if (!parsed || typeof parsed !== 'object') {
    return fallback;
  }

  const profiles = parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : fallback.profiles;
  if (!profiles[DEFAULT_PROFILE.id]) {
    profiles[DEFAULT_PROFILE.id] = {
      ...DEFAULT_PROFILE,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  const selectedProfileId = parsed.selectedProfileId && profiles[parsed.selectedProfileId]
    ? parsed.selectedProfileId
    : DEFAULT_PROFILE.id;

  return { selectedProfileId, profiles };
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

export function loadUIState() {
  const raw = localStorage.getItem(STORAGE_KEYS.ui);
  const parsed = raw ? safeParse(raw, {}) : {};
  return {
    sortOrder: parsed.sortOrder || 'level_desc',
    filterFc: parsed.filterFc || 'all',
    filterMissMin: parsed.filterMissMin || '',
    filterMissMax: parsed.filterMissMax || '',
    filterDiff: parsed.filterDiff || 'all',
    filterTitle: parsed.filterTitle || '',
    filterLevel: parsed.filterLevel || '',
    bestOnly: Boolean(parsed.bestOnly),
    selectMode: Boolean(parsed.selectMode),
  };
}

export function saveUIState(uiState) {
  localStorage.setItem(STORAGE_KEYS.ui, JSON.stringify(uiState));
}

export function upsertProfile(settings, profile) {
  const next = structuredClone(settings);
  next.profiles[profile.id] = {
    ...profile,
    updatedAt: nowIso(),
  };
  if (!next.selectedProfileId || !next.profiles[next.selectedProfileId]) {
    next.selectedProfileId = profile.id;
  }
  return next;
}

export function deleteProfile(settings, profileId) {
  const next = structuredClone(settings);
  if (profileId === DEFAULT_PROFILE.id) return next;
  delete next.profiles[profileId];
  if (!next.profiles[next.selectedProfileId]) {
    next.selectedProfileId = DEFAULT_PROFILE.id;
  }
  return next;
}

export function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile));
}

export function makeProfileId(baseName = 'profile') {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${baseName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}_${suffix}`;
}
