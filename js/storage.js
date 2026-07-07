import { STORAGE_KEY_SETTINGS, LEGACY_STORAGE_KEY_SETTINGS, DEFAULT_CROP_SETTINGS, createProfileId } from "./config.js";

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function createDefaultProfile({ id = "default", label = "既定", width = 0, height = 0, sampleImageDataUrl = "", cropRegions = DEFAULT_CROP_SETTINGS } = {}) {
  return {
    id,
    label,
    width: Number(width) || 0,
    height: Number(height) || 0,
    sampleImageDataUrl,
    cropRegions: clone(cropRegions || DEFAULT_CROP_SETTINGS),
  };
}

function normalizeProfile(profile, fallbackId = "default") {
  const nextId = profile?.id || fallbackId;
  return {
    id: nextId,
    label: String(profile?.label || "機種").trim() || "機種",
    width: Number(profile?.width) || 0,
    height: Number(profile?.height) || 0,
    sampleImageDataUrl: String(profile?.sampleImageDataUrl || ""),
    cropRegions: {
      ...clone(DEFAULT_CROP_SETTINGS),
      ...(profile?.cropRegions || {}),
    },
  };
}

export function normalizeSettings(raw) {
  const baseProfile = createDefaultProfile();
  const base = {
    showBestOnly: false,
    activeModelId: baseProfile.id,
    profiles: { [baseProfile.id]: baseProfile },
  };

  if (!raw || typeof raw !== "object") return base;

  const showBestOnly = !!raw.showBestOnly;
  const profiles = {};

  if (raw.profiles && typeof raw.profiles === "object") {
    for (const [id, profile] of Object.entries(raw.profiles)) {
      profiles[id] = normalizeProfile({ ...profile, id }, id);
    }
  } else {
    profiles[baseProfile.id] = normalizeProfile({
      id: baseProfile.id,
      label: raw.label || "既定",
      width: raw.width || 0,
      height: raw.height || 0,
      sampleImageDataUrl: raw.sampleImageDataUrl || "",
      cropRegions: raw.cropRegions || DEFAULT_CROP_SETTINGS,
    }, baseProfile.id);
  }

  if (!Object.keys(profiles).length) profiles[baseProfile.id] = baseProfile;
  const activeModelId = raw.activeModelId && profiles[raw.activeModelId] ? raw.activeModelId : Object.keys(profiles)[0];

  return {
    showBestOnly,
    activeModelId,
    profiles,
  };
}

export function loadSettings() {
  try {
    const rawV3 = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (rawV3) return normalizeSettings(JSON.parse(rawV3));
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY_SETTINGS);
    if (rawLegacy) return normalizeSettings(JSON.parse(rawLegacy));
  } catch (e) {
    console.warn("Failed to load settings", e);
  }
  return normalizeSettings(null);
}

export function saveSettings(settings) {
  try {
    const payload = normalizeSettings(settings);
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(payload));
  } catch (e) {
    console.warn("Failed to save settings", e);
  }
}

export function getProfile(settings, profileId) {
  const normalized = normalizeSettings(settings);
  return normalized.profiles[profileId] || normalized.profiles[normalized.activeModelId] || Object.values(normalized.profiles)[0] || createDefaultProfile();
}

export function getActiveProfile(settings) {
  return getProfile(settings, normalizeSettings(settings).activeModelId);
}

export function listProfiles(settings) {
  return Object.values(normalizeSettings(settings).profiles);
}

export function upsertProfile(settings, profile) {
  const normalized = normalizeSettings(settings);
  const next = normalizeProfile(profile, profile?.id || createProfileId(profile?.width, profile?.height));
  normalized.profiles[next.id] = next;
  if (!normalized.activeModelId) normalized.activeModelId = next.id;
  return normalized;
}

export function setActiveProfileId(settings, profileId) {
  const normalized = normalizeSettings(settings);
  if (normalized.profiles[profileId]) normalized.activeModelId = profileId;
  return normalized;
}

export function getProfileIdByDimensions(settings, width, height) {
  const normalized = normalizeSettings(settings);
  const profiles = Object.values(normalized.profiles);
  if (!profiles.length) return normalized.activeModelId;

  const targetW = Number(width) || 0;
  const targetH = Number(height) || 0;
  const targetRatio = targetW > 0 && targetH > 0 ? targetW / targetH : 0;
  const targetPixels = targetW * targetH || 0;

  let best = profiles[0];
  let bestScore = Infinity;

  for (const profile of profiles) {
    const pw = Number(profile.width) || 0;
    const ph = Number(profile.height) || 0;
    const ratio = pw > 0 && ph > 0 ? pw / ph : 0;
    const pixels = pw * ph || 0;
    const ratioDiff = targetRatio && ratio ? Math.abs(targetRatio - ratio) : (targetRatio || ratio ? 0.15 : 0.25);
    const pixelDiff = targetPixels && pixels ? Math.abs(targetPixels - pixels) / Math.max(targetPixels, pixels) : 0.25;
    const score = ratioDiff * 3 + pixelDiff;
    if (score < bestScore) {
      bestScore = score;
      best = profile;
    }
  }

  return best?.id || normalized.activeModelId;
}
