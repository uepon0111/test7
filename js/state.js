import { DEFAULT_SETTINGS } from './config.js';

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mergeDeep(target, source) {
  const output = deepClone(target) ?? {};
  if (!source || typeof source !== 'object') return output;

  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = mergeDeep(output[key] ?? {}, value);
    } else {
      output[key] = deepClone(value);
    }
  }
  return output;
}

export const state = {
  appReady: false,
  gapiReady: false,
  gisReady: false,
  isAuthenticated: false,
  records: [],
  filteredRecords: [],
  bestMap: new Map(),
  selectedIds: new Set(),
  isSelectMode: false,
  editorQueue: [],
  activeItemId: null,
  currentMode: 'upload',
  dbMusics: [],
  dbDiffs: [],
  driveCache: {
    rootFolder: null,
    fcFolder: null,
    songFolders: new Map(),
  },
  settings: loadSettings(),
  sampleImageUrl: '',
  sampleFileName: '',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem('prsk-result-viewer-settings-v2');
    if (!raw) return deepClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return mergeDeep(DEFAULT_SETTINGS, parsed);
  } catch (error) {
    console.warn('Failed to load settings', error);
    return deepClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(nextSettings = state.settings) {
  state.settings = mergeDeep(DEFAULT_SETTINGS, nextSettings);
  localStorage.setItem('prsk-result-viewer-settings-v2', JSON.stringify(state.settings));
  return state.settings;
}

export function updateSettings(partial) {
  state.settings = mergeDeep(state.settings, partial);
  localStorage.setItem('prsk-result-viewer-settings-v2', JSON.stringify(state.settings));
  return state.settings;
}

export function resetRuntimeState() {
  state.records = [];
  state.filteredRecords = [];
  state.bestMap = new Map();
  state.selectedIds.clear();
  state.isSelectMode = false;
  state.editorQueue = [];
  state.activeItemId = null;
  state.currentMode = 'upload';
  state.driveCache.rootFolder = null;
  state.driveCache.fcFolder = null;
  state.driveCache.songFolders = new Map();
}
