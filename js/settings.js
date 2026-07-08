import { appState, getActiveProfile, getProfileById, setActiveProfile, upsertProfile, deleteProfile, duplicateProfile, cloneRegionMap, normalizeRegion, selectBestProfileForImage, saveSettings } from './state.js';
import { clamp, makeId } from './utils.js';

let previewState = {
  dragging: false,
  resizing: false,
  pointerStart: null,
  regionStart: null,
  imageRect: null
};

function currentProfile() {
  return getProfileById(appState.settings.activeProfileId) || getActiveProfile();
}

export function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderSettingsModal();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}

export function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.style.display = 'none';
}

export function renderSettingsModal() {
  const profileSelect = document.getElementById('settings-profile-select');
  const profile = currentProfile();
  if (!profileSelect) return;

  profileSelect.innerHTML = appState.settings.profiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  profileSelect.value = profile.id;

  const rootName = document.getElementById('settings-root-folder-name');
  if (rootName) rootName.value = appState.settings.rootFolderName;
  const profileName = document.getElementById('settings-profile-name');
  if (profileName) profileName.value = profile.name;

  renderRegionInputs(profile);
  renderPreview(profile);
  updateProfileHints();
}

function updateProfileHints() {
  const hint = document.getElementById('settings-profile-hint');
  const imgInfo = appState.editor.sampleImageSize;
  if (!hint) return;
  if (imgInfo) {
    hint.textContent = `選択中画像: ${imgInfo.width}×${imgInfo.height} / ${appState.editor.sampleImageProfileName || '自動判定中'}`;
  } else {
    hint.textContent = 'サンプル画像を読み込むと、比率に近い機種が自動選択されます。';
  }
}

function renderRegionInputs(profile) {
  const wrap = document.getElementById('settings-region-list');
  if (!wrap) return;
  const keys = [
    ['title', '曲名'],
    ['diff', '難易度'],
    ['result', 'リザルト'],
    ['combo', 'コンボ']
  ];
  wrap.innerHTML = keys.map(([key, label]) => `
    <button class="region-tab ${appState.editor.activeRegion === key ? 'active' : ''}" onclick="selectSettingsRegion('${key}')">${label}</button>
  `).join('');

  const region = profile.regions[appState.editor.activeRegion];
  setRegionInputs(region, appState.editor.activeRegion);
  renderPreview(profile);
}

function setRegionInputs(region, key) {
  const ids = ['x', 'y', 'w', 'h'];
  ids.forEach(id => {
    const el = document.getElementById(`region-${id}`);
    if (el) el.value = Number(region[id]).toFixed(2);
  });
  const title = document.getElementById('settings-region-name');
  if (title) title.textContent = key === 'title' ? '曲名' : key === 'diff' ? '難易度' : key === 'result' ? 'リザルト' : 'コンボ';
}

function renderPreview(profile) {
  const img = document.getElementById('settings-preview-img');
  const overlay = document.getElementById('settings-preview-overlay');
  const container = document.getElementById('settings-preview-container');
  if (!img || !overlay || !container) return;

  if (appState.editor.sampleImageUrl) {
    img.src = appState.editor.sampleImageUrl;
  } else {
    img.removeAttribute('src');
  }

  overlay.innerHTML = '';
  for (const [key, region] of Object.entries(profile.regions)) {
    const box = document.createElement('div');
    box.className = `preview-box ${key === appState.editor.activeRegion ? 'active' : ''}`;
    box.dataset.key = key;
    box.innerHTML = `<span class="preview-label">${key.toUpperCase()}</span><span class="preview-grip"></span>`;
    overlay.appendChild(box);
  }

  requestAnimationFrame(() => positionOverlayBoxes());
}

function positionOverlayBoxes() {
  const img = document.getElementById('settings-preview-img');
  const overlay = document.getElementById('settings-preview-overlay');
  if (!img || !overlay || !img.complete || !img.naturalWidth) return;
  const rect = img.getBoundingClientRect();
  const profile = currentProfile();
  const scaleX = rect.width / img.naturalWidth;
  const scaleY = rect.height / img.naturalHeight;
  overlay.style.left = `${rect.left - overlay.parentElement.getBoundingClientRect().left}px`;
  overlay.style.top = `${rect.top - overlay.parentElement.getBoundingClientRect().top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;

  for (const [key, region] of Object.entries(profile.regions)) {
    const box = overlay.querySelector(`.preview-box[data-key="${key}"]`);
    if (!box) continue;
    const left = region.x / 100 * rect.width;
    const top = region.y / 100 * rect.height;
    const width = region.w / 100 * rect.width;
    const height = region.h / 100 * rect.height;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.style.borderColor = `var(--region-${key}, #38bdf8)`;
    box.style.background = `color-mix(in srgb, var(--region-${key}, #38bdf8) 16%, transparent)`;
  }
}

function updatePreviewFromInputs() {
  const profile = currentProfile();
  const key = appState.editor.activeRegion;
  const region = {
    x: clamp(parseFloat(document.getElementById('region-x')?.value || '0') || 0, 0, 100),
    y: clamp(parseFloat(document.getElementById('region-y')?.value || '0') || 0, 0, 100),
    w: clamp(parseFloat(document.getElementById('region-w')?.value || '10') || 10, 1, 100),
    h: clamp(parseFloat(document.getElementById('region-h')?.value || '10') || 10, 1, 100)
  };
  profile.regions[key] = normalizeRegion(region);
  upsertProfile(profile);
  renderPreview(profile);
  if (window.saveAppSettings) window.saveAppSettings();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}

function handleOverlayPointerDown(ev) {
  const target = ev.target.closest('.preview-box');
  if (!target) return;
  const key = target.dataset.key;
  appState.editor.activeRegion = key;
  renderRegionInputs(currentProfile());
  const overlay = document.getElementById('settings-preview-overlay');
  const img = document.getElementById('settings-preview-img');
  if (!overlay || !img) return;
  const rect = img.getBoundingClientRect();
  previewState.imageRect = rect;
  previewState.pointerStart = { x: ev.clientX, y: ev.clientY };
  previewState.regionStart = { ...currentProfile().regions[key] };
  const isResize = ev.target.classList.contains('preview-grip');
  previewState.resizing = isResize;
  previewState.dragging = !isResize;
  overlay.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}

function handleOverlayPointerMove(ev) {
  if (!previewState.dragging && !previewState.resizing) return;
  const profile = currentProfile();
  const key = appState.editor.activeRegion;
  const rect = previewState.imageRect;
  if (!rect) return;
  const dx = ev.clientX - previewState.pointerStart.x;
  const dy = ev.clientY - previewState.pointerStart.y;
  const dxPct = (dx / rect.width) * 100;
  const dyPct = (dy / rect.height) * 100;
  const start = previewState.regionStart;
  let next = { ...start };
  if (previewState.resizing) {
    next.w = clamp(start.w + dxPct, 1, 100);
    next.h = clamp(start.h + dyPct, 1, 100);
  } else {
    next.x = clamp(start.x + dxPct, 0, 100 - start.w);
    next.y = clamp(start.y + dyPct, 0, 100 - start.h);
  }
  profile.regions[key] = normalizeRegion(next);
  upsertProfile(profile);
  setRegionInputs(profile.regions[key], key);
  renderPreview(profile);
}

function handleOverlayPointerUp(ev) {
  previewState.dragging = false;
  previewState.resizing = false;
  previewState.pointerStart = null;
  previewState.regionStart = null;
  previewState.imageRect = null;
}

export async function onSampleImageSelected(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  appState.editor.sampleImageUrl = url;
  const image = new Image();
  image.onload = () => {
    appState.editor.sampleImageSize = { width: image.naturalWidth, height: image.naturalHeight };
    const profile = selectBestProfileForImage(image.naturalWidth, image.naturalHeight);
    if (profile) {
      setActiveProfile(profile.id);
      appState.editor.sampleImageProfileName = profile.name;
    }
    renderSettingsModal();
    updateProfileHints();
  };
  image.src = url;
}

export function selectSettingsRegion(key) {
  appState.editor.activeRegion = key;
  const profile = currentProfile();
  renderRegionInputs(profile);
  renderPreview(profile);
}

export function saveSettingsFromModal() {
  const rootInput = document.getElementById('settings-root-folder-name');
  if (rootInput) appState.settings.rootFolderName = rootInput.value.trim() || 'PRSK_RESULTS';
  saveSettings();
  if (window.showToastMessage) window.showToastMessage('設定を保存しました', 'success');
  renderSettingsModal();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}

export function addProfileFromCurrent() {
  const profile = currentProfile();
  const clone = {
    ...profile,
    id: `profile-${Date.now()}`,
    name: `${profile.name} のコピー`
  };
  appState.settings.profiles.push(clone);
  appState.settings.activeProfileId = clone.id;
  saveSettings();
  renderSettingsModal();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}

export function deleteCurrentProfile() {
  if (appState.settings.profiles.length <= 1) return;
  const profile = currentProfile();
  const idx = appState.settings.profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) appState.settings.profiles.splice(idx, 1);
  if (!appState.settings.profiles.find(p => p.id === appState.settings.activeProfileId)) {
    appState.settings.activeProfileId = appState.settings.profiles[0].id;
  }
  saveSettings();
  renderSettingsModal();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}

export function duplicateCurrentProfile() {
  const profile = currentProfile();
  const copy = {
    ...JSON.parse(JSON.stringify(profile)),
    id: `profile-${Date.now()}`,
    name: `${profile.name} のコピー`
  };
  appState.settings.profiles.push(copy);
  appState.settings.activeProfileId = copy.id;
  saveSettings();
  renderSettingsModal();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}

export function onProfileSelectChange(value) {
  setActiveProfile(value);
  renderSettingsModal();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}

export function onProfileNameChange(value) {
  const profile = currentProfile();
  profile.name = value || profile.name;
  upsertProfile(profile);
  renderSettingsModal();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}

export function wireSettingsEvents() {
  const overlay = document.getElementById('settings-preview-overlay');
  const img = document.getElementById('settings-preview-img');
  if (overlay) {
    overlay.addEventListener('pointerdown', handleOverlayPointerDown);
    overlay.addEventListener('pointermove', handleOverlayPointerMove);
    overlay.addEventListener('pointerup', handleOverlayPointerUp);
    overlay.addEventListener('pointercancel', handleOverlayPointerUp);
  }
  if (img) {
    img.addEventListener('load', () => {
      positionOverlayBoxes();
    });
  }
  const inputs = ['region-x', 'region-y', 'region-w', 'region-h'];
  for (const id of inputs) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreviewFromInputs);
  }
  const profileSelect = document.getElementById('settings-profile-select');
  if (profileSelect) profileSelect.addEventListener('change', e => onProfileSelectChange(e.target.value));
  const nameInput = document.getElementById('settings-profile-name');
  if (nameInput) nameInput.addEventListener('input', e => onProfileNameChange(e.target.value));
  const rootInput = document.getElementById('settings-root-folder-name');
  if (rootInput) rootInput.addEventListener('input', e => {
    appState.settings.rootFolderName = e.target.value.trim() || 'PRSK_RESULTS';
    saveSettings();
  });
  const file = document.getElementById('settings-sample-file');
  if (file) file.addEventListener('change', e => onSampleImageSelected(e.target.files?.[0]));
}

export function syncSettingsInputs() {
  const profile = currentProfile();
  const profileSelect = document.getElementById('settings-profile-select');
  const nameInput = document.getElementById('settings-profile-name');
  if (profileSelect) profileSelect.value = profile.id;
  if (nameInput) nameInput.value = profile.name;
  renderSettingsModal();
  if (window.syncEditorProfileNames) window.syncEditorProfileNames();
}
