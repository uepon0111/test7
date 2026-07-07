import { STORAGE_KEY_SETTINGS, DEFAULT_CROP_SETTINGS } from "./config.js";

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function loadSettings() {
  const base = {
    showBestOnly: false,
    cropRegions: clone(DEFAULT_CROP_SETTINGS),
    sampleImageDataUrl: "",
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const merged = {
      ...base,
      ...parsed,
      cropRegions: {
        ...clone(DEFAULT_CROP_SETTINGS),
        ...(parsed.cropRegions || {}),
      },
    };
    return merged;
  } catch {
    return base;
  }
}

export function saveSettings(settings) {
  const payload = {
    showBestOnly: !!settings.showBestOnly,
    cropRegions: settings.cropRegions,
  };
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(payload));
  } catch (e) {
    console.warn("Failed to save settings", e);
  }
}
