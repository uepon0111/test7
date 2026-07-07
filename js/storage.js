import { DEFAULT_PREFS, cloneRegions, makeId, STORAGE_KEYS } from './config.js';

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function loadJson(key, fallback) {
  return safeParse(localStorage.getItem(key), fallback);
}

export function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadPreferences() {
  const raw = loadJson(STORAGE_KEYS.prefs, null);
  const prefs = structuredClone(DEFAULT_PREFS);
  if (!raw) return prefs;
  return {
    ...prefs,
    ...raw,
    filters: { ...prefs.filters, ...(raw.filters || {}) },
  };
}

export function savePreferences(prefs) {
  saveJson(STORAGE_KEYS.prefs, prefs);
}

export function loadProfiles() {
  const raw = loadJson(STORAGE_KEYS.profiles, []);
  const profiles = Array.isArray(raw) ? raw : [];
  return profiles.map(normalizeProfile);
}

export function saveProfiles(profiles) {
  saveJson(STORAGE_KEYS.profiles, profiles.map(normalizeProfile));
}

export function normalizeProfile(profile) {
  const now = new Date().toISOString();
  const id = profile?.id || makeId('profile');
  const regions = profile?.regions || cloneRegions();
  return {
    id,
    name: profile?.name || '未設定',
    width: Number(profile?.width) || 0,
    height: Number(profile?.height) || 0,
    regions: {
      diff: regionOrDefault(regions.diff),
      title: regionOrDefault(regions.title),
      result: regionOrDefault(regions.result),
      combo: regionOrDefault(regions.combo),
    },
    createdAt: profile?.createdAt || now,
    updatedAt: now,
  };
}

function regionOrDefault(region) {
  const base = cloneRegions();
  const fallback = base.diff;
  const r = region || fallback;
  return {
    x: Number(r.x) || 0,
    y: Number(r.y) || 0,
    w: Number(r.w) || 0,
    h: Number(r.h) || 0,
  };
}

export function loadLastProfileId() {
  return localStorage.getItem(STORAGE_KEYS.lastProfile) || '';
}

export function saveLastProfileId(profileId) {
  if (profileId) localStorage.setItem(STORAGE_KEYS.lastProfile, profileId);
}
