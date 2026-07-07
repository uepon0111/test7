import { STORAGE_KEY_SETTINGS, DEFAULT_CROP_SETTINGS, DEFAULT_DEVICE_KEY, cloneCropSettings, buildDeviceProfileMap } from "./config.js";

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildBaseSettings() {
  return {
    showBestOnly: false,
    currentDeviceKey: DEFAULT_DEVICE_KEY,
    deviceProfiles: {
      auto: {
        key: "auto",
        label: "自動判定",
        sampleImageDataUrl: "",
        cropRegions: clone(DEFAULT_CROP_SETTINGS),
      },
    },
  };
}

function migrateLegacySettings(parsed) {
  const base = buildBaseSettings();
  const legacyCropRegions = parsed?.cropRegions || null;
  const rawProfiles = parsed?.deviceProfiles || parsed?.machineProfiles || {};

  const mergedProfiles = buildDeviceProfileMap(rawProfiles);
  if (legacyCropRegions) {
    mergedProfiles.auto.cropRegions = cloneCropSettings(legacyCropRegions);
  }

  return {
    ...base,
    ...parsed,
    currentDeviceKey: parsed?.currentDeviceKey || parsed?.machineKey || base.currentDeviceKey,
    deviceProfiles: mergedProfiles,
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return buildBaseSettings();
    const parsed = JSON.parse(raw);
    return migrateLegacySettings(parsed);
  } catch {
    return buildBaseSettings();
  }
}

export function saveSettings(settings) {
  const payload = {
    showBestOnly: !!settings.showBestOnly,
    currentDeviceKey: settings.currentDeviceKey || DEFAULT_DEVICE_KEY,
    deviceProfiles: settings.deviceProfiles || {},
  };
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(payload));
  } catch (e) {
    console.warn("Failed to save settings", e);
  }
}
