
import { state } from './state.js';
import { initSettings, setBestOnly, getCurrentPreset, setCurrentPresetId, saveSettings } from './settings.js';
import { gapiLoaded, gisLoaded, handleAuthClick, handleSignoutClick, fetchDataFromDrive, setAuthUI } from './drive.js';
import { updateView, initMainUI, showToast, openSettingsModal, closeSettingsModal, renderSettingsModal, syncPresetForm, handleSampleUpload, refreshDeviceSelects, updateCurrentItem } from './ui.js';


function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.dataset.src = src;
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function loadGoogleApis() {
  await Promise.all([
    loadScript('https://apis.google.com/js/api.js'),
    loadScript('https://accounts.google.com/gsi/client'),
  ]);
}

async function loadDatabase() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json'),
    ]);
    state.dbMusics = await musicsResp.json();
    state.dbDiffs = await diffsResp.json();
  } catch (error) {
    console.error('DB Error', error);
    showToast('データベース取得失敗', '曲情報の取得に失敗しました。', 'error');
  }
}

function wireEvents() {
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) window.handleFiles(e.dataTransfer.files);
    });
  }

  const upFile = document.getElementById('up-file');
  if (upFile) upFile.addEventListener('change', (e) => window.handleFiles(e.target.files));

  const sampleFile = document.getElementById('sample-file');
  if (sampleFile) sampleFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleSampleUpload(file);
  });

  const bestOnly = document.getElementById('filter-best-only');
  if (bestOnly) {
    bestOnly.addEventListener('change', () => {
      setBestOnly(bestOnly.checked);
      updateView();
    });
  }

  const sortDirection = document.getElementById('sort-direction');
  if (sortDirection) sortDirection.addEventListener('change', () => updateView());

  const deviceSelect = document.getElementById('up-device');
  if (deviceSelect) {
    deviceSelect.addEventListener('change', () => {
      const id = deviceSelect.value;
      state.currentUploadDeviceId = id;
      if (state.activeItemId) updateCurrentItem('devicePresetId', id);
      refreshDeviceSelects();
    });
  }

  const presetName = document.getElementById('preset-name');
  if (presetName) presetName.addEventListener('input', () => syncPresetForm());
  const presetWidth = document.getElementById('preset-width');
  if (presetWidth) presetWidth.addEventListener('input', () => syncPresetForm());
  const presetHeight = document.getElementById('preset-height');
  if (presetHeight) presetHeight.addEventListener('input', () => syncPresetForm());

  const settingsPresetSelect = document.getElementById('settings-preset-select');
  if (settingsPresetSelect) {
    settingsPresetSelect.addEventListener('change', () => {
      setCurrentPresetId(settingsPresetSelect.value);
      renderSettingsModal();
      refreshDeviceSelects();
    });
  }
}

function initDefaultControls() {
  const sort = document.getElementById('sort-order');
  if (sort) sort.value = 'title';
  const direction = document.getElementById('sort-direction');
  if (direction) direction.value = 'asc';
  const diff = document.getElementById('filter-diff');
  if (diff) diff.value = 'all';
  const fc = document.getElementById('filter-fc');
  if (fc) fc.value = 'all';
  refreshDeviceSelects();
}

async function boot() {
  initSettings();
  await loadGoogleApis();
  initDefaultControls();
  initMainUI();
  wireEvents();
  await loadDatabase();
}

window.handleAuthClick = handleAuthClick;
window.handleSignoutClick = handleSignoutClick;
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;
window.fetchDataFromDrive = fetchDataFromDrive;
window.setAuthUI = setAuthUI;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.renderSettingsModal = renderSettingsModal;
window.syncPresetForm = syncPresetForm;
window.handleSampleUpload = handleSampleUpload;
window.updateCurrentItem = window.updateCurrentItem;

window.onDataLoaded = async () => {
  document.getElementById('loader').style.display = 'none';
  await updateView();
};

window.addEventListener('DOMContentLoaded', boot);
