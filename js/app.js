import { state } from "./state.js";
import { loadSettings, saveSettings } from "./storage.js";
import { initializeGapiClient, handleAuthClick, handleSignoutClick, fetchDataFromDrive, setAuthUI } from "./drive.js";
import {
  initializeUI,
  openBatchModal,
  closeBatchModal,
  handleFiles,
  batchEdit,
  toggleSelectMode,
  clearSelection,
  batchDelete,
  updateSelectionUI,
  updateCurrentItem,
  reanalyzeCurrentItem,
  analyzeAllInBatch,
  handleBatchExecution,
  openImageModal,
  closeImageModal,
  individualEdit,
  individualDelete,
  toggleSelection,
  openSettingsModal,
  closeSettingsModal,
  togglePBOnly,
  onDataLoaded,
  applyFiltersAndSort,
  updateBestOnlyFromSettings,
  showToast,
} from "./ui.js";


const resourceFlags = window.__resourceFlags || (window.__resourceFlags = { gapi: false, gis: false });

async function loadDb() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch("https://sekai-world.github.io/sekai-master-db-diff/musics.json"),
      fetch("https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json"),
    ]);
    state.dbMusics = await musicsResp.json();
    state.dbDiffs = await diffsResp.json();
  } catch (e) {
    console.error("DB load failed", e);
    state.dbMusics = [];
    state.dbDiffs = [];
  }
}

function bindGlobalHandlers() {
  window.gapiLoaded = () => {
    resourceFlags.gapi = true;
    state.gapiScriptReady = true;
    maybeInitGoogleClient();
  };
  window.gisLoaded = () => {
    resourceFlags.gis = true;
    state.gisScriptReady = true;
    maybeInitGoogleClient();
  };

  window.handleAuthClick = handleAuthClick;
  window.handleSignoutClick = handleSignoutClick;
  window.openBatchModal = openBatchModal;
  window.closeBatchModal = closeBatchModal;
  window.handleFiles = handleFiles;
  window.batchEdit = batchEdit;
  window.toggleSelectMode = toggleSelectMode;
  window.clearSelection = clearSelection;
  window.batchDelete = batchDelete;
  window.updateSelectionUI = updateSelectionUI;
  window.updateCurrentItem = updateCurrentItem;
  window.reanalyzeCurrentItem = reanalyzeCurrentItem;
  window.analyzeAllInBatch = analyzeAllInBatch;
  window.handleBatchExecution = handleBatchExecution;
  window.openImageModal = openImageModal;
  window.closeImageModal = closeImageModal;
  window.individualEdit = individualEdit;
  window.individualDelete = individualDelete;
  window.toggleSelection = toggleSelection;
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;
  window.togglePBOnly = togglePBOnly;
  window.onDataLoaded = onDataLoaded;
  window.applyFiltersAndSort = applyFiltersAndSort;
  window.updateBestOnlyFromSettings = updateBestOnlyFromSettings;
  window.showToast = showToast;
}

let googleInitStarted = false;
async function maybeInitGoogleClient() {
  if (googleInitStarted) return;
  if (!state.gapiScriptReady || !state.gisScriptReady) return;
  if (!window.gapi || !window.google) return;

  googleInitStarted = true;
  try {
    await initializeGapiClient();
  } catch (e) {
    console.error("Google client init failed", e);
    googleInitStarted = false;
    return;
  }
  setAuthUI(false);
}

async function initApp() {
  state.settings = loadSettings();
  state.showBestOnly = !!state.settings.showBestOnly;
  state.gapiScriptReady = !!resourceFlags.gapi;
  state.gisScriptReady = !!resourceFlags.gis;

  initializeUI();
  bindGlobalHandlers();
  await loadDb();

  const upFile = document.getElementById("up-file");
  upFile.addEventListener("change", async (ev) => {
    await handleFiles(ev.target.files);
  });
  const dropZone = document.getElementById("drop-zone");
  dropZone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    dropZone.classList.remove("dragover");
    const files = ev.dataTransfer?.files;
    if (files?.length) await handleFiles(files);
  });

  // Initial UI
  setAuthUI(false);
  onDataLoaded();
  maybeInitGoogleClient();
}

window.addEventListener("DOMContentLoaded", initApp);
