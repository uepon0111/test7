
import { DEFAULT_SETTINGS, DEFAULT_REGIONS, state, saveJSON, loadJSON, LOCAL_STORAGE_KEY, clamp } from './state.js';

function normalizePreset(preset) {
  const regions = preset?.regions || {};
  return {
    id: preset?.id || `preset-${Date.now()}`,
    name: preset?.name || '新しい機種',
    width: Number(preset?.width || 0),
    height: Number(preset?.height || 0),
    aspectRatio: Number(preset?.aspectRatio || 0),
    regions: {
      diff:   { ...DEFAULT_REGIONS.diff,   ...(regions.diff || {}) },
      title:  { ...DEFAULT_REGIONS.title,  ...(regions.title || {}) },
      result: { ...DEFAULT_REGIONS.result, ...(regions.result || {}) },
      combo:  { ...DEFAULT_REGIONS.combo,  ...(regions.combo || {}) },
    },
    updatedAt: preset?.updatedAt || Date.now(),
  };
}

export function initSettings() {
  const loaded = loadJSON(LOCAL_STORAGE_KEY, null);
  if (!loaded || !Array.isArray(loaded.presets) || loaded.presets.length === 0) {
    state.settings = structuredClone(DEFAULT_SETTINGS);
    saveSettings();
    return state.settings;
  }
  state.settings = {
    currentPresetId: loaded.currentPresetId || loaded.presets?.[0]?.id || DEFAULT_SETTINGS.currentPresetId,
    bestOnly: !!loaded.bestOnly,
    presets: loaded.presets.map(normalizePreset),
  };
  if (!state.settings.presets.some((p) => p.id === state.settings.currentPresetId)) {
    state.settings.currentPresetId = state.settings.presets[0]?.id || DEFAULT_SETTINGS.currentPresetId;
  }
  saveSettings();
  return state.settings;
}

export function saveSettings() {
  saveJSON(LOCAL_STORAGE_KEY, state.settings);
}

export function getPresets() {
  return state.settings.presets;
}

export function getCurrentPreset() {
  return state.settings.presets.find((p) => p.id === state.settings.currentPresetId) || state.settings.presets[0] || normalizePreset(DEFAULT_SETTINGS.presets[0]);
}

export function setCurrentPresetId(id) {
  if (state.settings.presets.some((p) => p.id === id)) {
    state.settings.currentPresetId = id;
    saveSettings();
    return true;
  }
  return false;
}

export function upsertPreset(preset) {
  const normalized = normalizePreset(preset);
  const index = state.settings.presets.findIndex((p) => p.id === normalized.id);
  if (index >= 0) state.settings.presets[index] = normalized;
  else state.settings.presets.unshift(normalized);
  state.settings.currentPresetId = normalized.id;
  saveSettings();
  return normalized;
}

export function deletePreset(id) {
  const idx = state.settings.presets.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  state.settings.presets.splice(idx, 1);
  if (state.settings.currentPresetId === id) {
    state.settings.currentPresetId = state.settings.presets[0]?.id || '';
  }
  saveSettings();
  return true;
}

export function setBestOnly(value) {
  state.settings.bestOnly = !!value;
  saveSettings();
}

export function setPresetRegions(presetId, regions) {
  const preset = state.settings.presets.find((p) => p.id === presetId);
  if (!preset) return null;
  preset.regions = {
    diff:   { ...preset.regions.diff,   ...(regions.diff || {}) },
    title:  { ...preset.regions.title,  ...(regions.title || {}) },
    result: { ...preset.regions.result, ...(regions.result || {}) },
    combo:  { ...preset.regions.combo,  ...(regions.combo || {}) },
  };
  preset.updatedAt = Date.now();
  saveSettings();
  return preset;
}

export function setPresetCanvasSize(presetId, width, height) {
  const preset = state.settings.presets.find((p) => p.id === presetId);
  if (!preset) return null;
  preset.width = Math.max(0, Number(width) || 0);
  preset.height = Math.max(0, Number(height) || 0);
  preset.aspectRatio = preset.width > 0 && preset.height > 0 ? preset.width / preset.height : 0;
  preset.updatedAt = Date.now();
  saveSettings();
  return preset;
}

export function cloneCurrentPreset(newName) {
  const current = getCurrentPreset();
  return upsertPreset({
    ...current,
    id: `preset-${Date.now()}`,
    name: newName || `${current.name} コピー`,
    updatedAt: Date.now(),
  });
}

export function createPresetFromImageMeta(imageMeta, name) {
  const width = Number(imageMeta?.width || 0);
  const height = Number(imageMeta?.height || 0);
  return upsertPreset({
    id: `preset-${Date.now()}`,
    name: name || imageMeta?.name || `機種 ${width}×${height}`,
    width,
    height,
    aspectRatio: width > 0 && height > 0 ? width / height : 0,
    regions: structuredClone(DEFAULT_REGIONS),
    updatedAt: Date.now(),
  });
}

export function matchPresetForImage(width, height) {
  const ratio = width > 0 && height > 0 ? width / height : 0;
  const presets = state.settings.presets;
  if (!presets.length) return null;
  let best = presets[0];
  let bestScore = Infinity;
  for (const preset of presets) {
    const ratioScore = preset.aspectRatio ? Math.abs(preset.aspectRatio - ratio) / preset.aspectRatio : 0.05;
    const sizeScore = preset.width && preset.height
      ? (Math.abs(preset.width - width) / Math.max(1, preset.width) + Math.abs(preset.height - height) / Math.max(1, preset.height)) / 2
      : 0.2;
    const score = ratioScore * 2 + sizeScore;
    if (score < bestScore) {
      bestScore = score;
      best = preset;
    }
  }
  return best;
}

export function getPresetById(id) {
  return state.settings.presets.find((p) => p.id === id) || null;
}

export function normalizeRect(rect) {
  return {
    x: clamp(Number(rect?.x) || 0, 0, 1),
    y: clamp(Number(rect?.y) || 0, 0, 1),
    w: clamp(Number(rect?.w) || 0, 0, 1),
    h: clamp(Number(rect?.h) || 0, 0, 1),
  };
}

export function getPresetForDeviceName(name) {
  return state.settings.presets.find((p) => p.name === name) || null;
}
