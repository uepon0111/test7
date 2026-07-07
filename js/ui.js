import { SORT_OPTIONS, DIFFICULTY_DEFS, getDifficultyColor, getDifficultyLabel, escapeHtml, DEFAULT_CROP_SETTINGS } from "./config.js";
import { state } from "./state.js";
import { saveSettings, getActiveProfile, getProfile, getProfileIdByDimensions, upsertProfile, setActiveProfileId, listProfiles, createDefaultProfile } from "./storage.js";
import {
  fetchDataFromDrive,
  uploadQueueItem,
  updateQueueItem,
  deleteDriveFile,
  recomputeBestFlags,
  getRecordKey,
  getBestMissForKey,
  ensureSongFolderForItem,
} from "./drive.js";
import { analyzeLoadedImage, createOcrWorker, getLevelFromDb, getCropSettingsForModel } from "./ocr.js";

function el(id) {
  return document.getElementById(id);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function regionKeys() {
  return ["diff", "title", "result", "combo"];
}

function regionLabel(key) {
  const map = { diff: "難易度", title: "曲名", result: "判定内訳", combo: "コンボ" };
  return map[key] || key;
}

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}

function currentProfileId() {
  return state.settings?.activeModelId || Object.keys(state.settings?.profiles || {})[0] || "default";
}

function getCurrentProfile() {
  return getProfile(state.settings, currentProfileId());
}

function setProfileRegion(profileId, key, nextRegion) {
  if (!state.settings?.profiles?.[profileId]) return;
  const profile = state.settings.profiles[profileId];
  profile.cropRegions = profile.cropRegions || cloneSettings(DEFAULT_CROP_SETTINGS);
  profile.cropRegions[key] = {
    x: clamp(Number(nextRegion.x) || 0, 0, 1),
    y: clamp(Number(nextRegion.y) || 0, 0, 1),
    w: clamp(Number(nextRegion.w) || 0.01, 0.01, 1),
    h: clamp(Number(nextRegion.h) || 0.01, 0.01, 1),
  };
}

function getProfileRegion(profileId, key) {
  const profile = getProfile(state.settings, profileId || currentProfileId());
  return profile?.cropRegions?.[key] || DEFAULT_CROP_SETTINGS[key];
}

function profileOptionsHtml(selectedId) {
  return listProfiles(state.settings).map((p) => {
    const label = [p.label || "機種", p.width && p.height ? `${p.width}×${p.height}` : ""].filter(Boolean).join(" / ");
    return `<option value="${escapeHtml(p.id)}"${p.id === selectedId ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function syncProfileSelects() {
  const profileId = currentProfileId();
  const editorSelect = el("up-model");
  if (editorSelect) {
    const prev = editorSelect.value || profileId;
    editorSelect.innerHTML = profileOptionsHtml(prev);
    editorSelect.value = prev && state.settings?.profiles?.[prev] ? prev : profileId;
  }

  const settingsSelect = el("settings-model-select");
  if (settingsSelect) {
    settingsSelect.innerHTML = profileOptionsHtml(profileId);
    settingsSelect.value = profileId;
  }

  const settingsName = el("settings-model-name");
  if (settingsName) settingsName.value = getCurrentProfile().label || "機種";

  const settingsInfo = el("settings-model-info");
  if (settingsInfo) {
    const p = getCurrentProfile();
    settingsInfo.textContent = p.width && p.height ? `${p.width} × ${p.height}` : "サイズ未設定";
  }
}

function setActiveProfile(profileId) {
  if (!state.settings?.profiles?.[profileId]) return;
  state.settings = setActiveProfileId(state.settings, profileId);
  saveSettings(state.settings);
  syncProfileSelects();
  renderSettingsUI();
}

function getDisplayRect(imgEl) {
  const wrap = el("settings-preview-wrap");
  if (!wrap || !imgEl?.naturalWidth || !imgEl?.naturalHeight) return null;
  const wrapRect = wrap.getBoundingClientRect();
  const scale = Math.min(wrapRect.width / imgEl.naturalWidth, wrapRect.height / imgEl.naturalHeight);
  const displayW = imgEl.naturalWidth * scale;
  const displayH = imgEl.naturalHeight * scale;
  return {
    scale,
    x: (wrapRect.width - displayW) / 2,
    y: (wrapRect.height - displayH) / 2,
    w: displayW,
    h: displayH,
    naturalW: imgEl.naturalWidth,
    naturalH: imgEl.naturalHeight,
  };
}

function regionToPixels(region, rect) {
  return {
    left: rect.x + region.x * rect.w,
    top: rect.y + region.y * rect.h,
    width: region.w * rect.w,
    height: region.h * rect.h,
  };
}

function pixelsToRegion(left, top, width, height, rect) {
  return {
    x: clamp((left - rect.x) / rect.w, 0, 1),
    y: clamp((top - rect.y) / rect.h, 0, 1),
    w: clamp(width / rect.w, 0.01, 1),
    h: clamp(height / rect.h, 0.01, 1),
  };
}

export function showToast(title, body = "", kind = "success", timeout = 3200) {
  const host = el("toast-container");
  if (!host) return;
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div>${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ""}`;
  host.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    toast.style.transition = "all .25s ease";
    window.setTimeout(() => toast.remove(), 250);
  }, timeout);
}

export function renderControlOptions() {
  const sortSelect = el("sort-order");
  if (sortSelect) {
    sortSelect.innerHTML = SORT_OPTIONS.map((opt) => `<option value="${opt.value}">${escapeHtml(opt.label)}</option>`).join("");
    sortSelect.value = "level_desc";
  }

  const diffFilter = el("filter-diff");
  if (diffFilter) {
    diffFilter.innerHTML = `<option value="all">すべて</option>` + Object.values(DIFFICULTY_DEFS).map((d) => `<option value="${d.key}">${escapeHtml(d.label)}</option>`).join("");
  }

  const batchDiff = el("up-diff");
  if (batchDiff) {
    batchDiff.innerHTML = Object.values(DIFFICULTY_DEFS).map((d) => `<option value="${d.key}">${escapeHtml(d.label)}</option>`).join("");
  }

  syncProfileSelects();
  const pbBtn = el("btn-pb-only");
  if (pbBtn) pbBtn.classList.toggle("toggle-on", !!state.settings?.showBestOnly);
}

export function syncTopButtons() {
  const btn = el("btn-pb-only");
  if (btn) {
    const active = !!state.settings?.showBestOnly;
    btn.classList.toggle("toggle-on", active);
    btn.innerHTML = `<span class="material-symbols-outlined">emoji_events</span> 自己ベストのみ${active ? "ON" : "OFF"}`;
  }
}

function getSortSpec() {
  const v = el("sort-order")?.value || "level_desc";
  const [primary, direction] = v.split("_");
  return { primary, direction };
}

function compareText(a, b, direction = "asc") {
  return direction === "asc" ? a.localeCompare(b, "ja") : b.localeCompare(a, "ja");
}

function compareNumber(a, b, direction = "asc") {
  return direction === "asc" ? a - b : b - a;
}

function compareByDate(a, b, direction = "asc") {
  const av = a.addedTime || 0;
  const bv = b.addedTime || 0;
  return compareNumber(av, bv, direction);
}

function compareByDifficulty(a, b) {
  const ao = a.difficultyOrder || 999;
  const bo = b.difficultyOrder || 999;
  return ao - bo;
}

function compareRecords(a, b, primary, direction) {
  const name = compareText(a.title || "", b.title || "", direction);
  const level = compareNumber(Number(a.level || 0), Number(b.level || 0), direction);
  const miss = compareNumber(Number(a.totalMiss ?? a.missCount ?? 0), Number(b.totalMiss ?? b.missCount ?? 0), direction);
  const date = compareByDate(a, b, direction);

  const diff = compareByDifficulty(a, b);
  const nameAsc = compareText(a.title || "", b.title || "", "asc");
  const missAsc = compareNumber(Number(a.totalMiss ?? a.missCount ?? 0), Number(b.totalMiss ?? b.missCount ?? 0), "asc");
  const dateAsc = compareByDate(a, b, "asc");

  if (primary === "name") return name || diff || missAsc || dateAsc;
  if (primary === "level") return level || diff || nameAsc || missAsc || dateAsc;
  if (primary === "miss") return miss || level || diff || nameAsc || dateAsc;
  if (primary === "date") return date;
  return level || diff || nameAsc || missAsc || dateAsc;
}

export function applyFiltersAndSort() {
  let list = [...state.allRecords];
  const fcFilter = el("filter-fc")?.value || "all";
  const missMin = el("filter-miss-min")?.value || "";
  const missMax = el("filter-miss-max")?.value || "";
  const diffFilter = el("filter-diff")?.value || "all";
  const levelFilter = el("filter-level")?.value || "";
  const titleFilter = (el("filter-title")?.value || "").trim().toLowerCase();

  list = list.filter((r) => {
    if (state.settings?.showBestOnly && !r.isBest) return false;
    if (fcFilter === "fc" && !r.isFC) return false;
    if (fcFilter === "unfc" && r.isFC) return false;
    const miss = Number(r.totalMiss ?? r.missCount ?? 0);
    if (missMin !== "" && miss < Number(missMin)) return false;
    if (missMax !== "" && miss > Number(missMax)) return false;
    if (diffFilter !== "all" && r.difficultyRaw !== diffFilter) return false;
    if (levelFilter && String(r.level) !== String(levelFilter)) return false;
    if (titleFilter && !String(r.title || "").toLowerCase().includes(titleFilter)) return false;
    return true;
  });

  const { primary, direction } = getSortSpec();
  list.sort((a, b) => compareRecords(a, b, primary, direction));

  state.filteredRecords = list;
  renderGrid(list);
}

export function updateView() {
  applyFiltersAndSort();
}

export function renderGrid(records) {
  const grid = el("grid");
  const count = el("result-count");
  if (!grid || !count) return;

  count.textContent = `表示: ${records.length} 件`;
  grid.replaceChildren();

  if (!records.length) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const rec of records) {
    const thumb = rec.thumbnail || "";
    const large = rec.thumbnail ? rec.thumbnail.replace("=s220", "=w1600") : "";
    const miss = Number(rec.totalMiss ?? rec.missCount ?? 0);
    const missDisplay = rec.isFC ? `<span class="miss-val zero">FC-0</span>` : `FC -<span class="miss-val">${miss}</span>`;
    const badge = rec.isFC ? `<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>` : "";
    const pbBadge = rec.isBest ? `<div class="badge-pb">PB</div>` : "";
    const isSel = state.selectedIds.has(rec.id) ? "selected" : "";
    const diffColor = getDifficultyColor(rec.difficultyRaw);
    const diffLabel = getDifficultyLabel(rec.difficultyRaw);
    const metricLine = [];
    if (rec.perfect || rec.great || rec.good || rec.bad || rec.missDetail || rec.combo) {
      metricLine.push(`<span class="metric-chip">P ${Number(rec.perfect || 0)}</span>`);
      metricLine.push(`<span class="metric-chip">G ${Number(rec.great || 0)}</span>`);
      metricLine.push(`<span class="metric-chip">C ${Number(rec.combo || 0)}</span>`);
    }

    let clickAction = "";
    let overlayActions = "";

    if (state.isSelectMode) {
      clickAction = `toggleSelection('${rec.id}')`;
    } else {
      clickAction = `openImageModal('${large}')`;
      overlayActions = `
        <div class="card-overlay-actions">
            <div class="btn-overlay" onclick="event.stopPropagation(); individualEdit('${rec.id}')" title="編集"><span class="material-symbols-outlined">edit</span></div>
            <div class="btn-overlay del" onclick="event.stopPropagation(); individualDelete('${rec.id}')" title="削除"><span class="material-symbols-outlined">delete</span></div>
        </div>`;
    }

    const card = document.createElement("div");
    card.className = `card ${rec.isFC ? 'is-fc' : ''} ${rec.isBest ? 'is-pb' : ''} ${isSel} ${state.isSelectMode ? 'select-mode-active' : ''}`;
    card.id = `card-${rec.id}`;
    card.setAttribute("onclick", clickAction);
    card.innerHTML = `
      <div class="card-img-container">
        ${badge}
        ${pbBadge}
        ${overlayActions}
        <div class="img-loader-spinner"></div>
        ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" decoding="async" onload="this.style.opacity=1; this.previousElementSibling.style.display='none';">` : '<span style="color:#aaa;">NO IMAGE</span>'}
      </div>
      <div class="card-body">
        <div class="song-meta">
          <span class="tag lvl">Lv.${escapeHtml(rec.level ?? "")}</span>
          <span class="tag diff-${rec.difficultyRaw}" style="background:${diffColor};">${diffLabel}</span>
        </div>
        <div class="song-title">${escapeHtml(rec.title)}</div>
        <div class="score-info">
          <span style="display:flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result</span>
          ${missDisplay}
        </div>
        ${metricLine.length ? `<div class="metric-line">${metricLine.join("")}</div>` : ""}
      </div>`;
    fragment.appendChild(card);
  }
  grid.appendChild(fragment);
}

export function updateSelectionUI() {
  const bar = el("batch-actions");
  const count = el("selected-count");
  if (count) count.textContent = String(state.selectedIds.size);
  if (bar) bar.style.display = state.selectedIds.size > 0 ? "flex" : "none";
}

export function toggleSelectMode() {
  state.isSelectMode = !state.isSelectMode;
  const btn = el("btn-select-mode");
  if (btn) btn.classList.toggle("active", state.isSelectMode);
  if (!state.isSelectMode) {
    state.selectedIds.clear();
    updateSelectionUI();
  }
  renderGrid(state.filteredRecords);
}

export function togglePBOnly() {
  state.settings.showBestOnly = !state.settings.showBestOnly;
  saveSettings(state.settings);
  syncTopButtons();
  applyFiltersAndSort();
}

export function clearSelection() {
  state.selectedIds.clear();
  updateSelectionUI();
  renderGrid(state.filteredRecords);
}

export function toggleSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  updateSelectionUI();
  renderGrid(state.filteredRecords);
}

export function openImageModal(src) {
  if (!src) return;
  el("imageModal").style.display = "flex";
  el("modalImg").src = src;
}

export function closeImageModal() {
  el("imageModal").style.display = "none";
}

function ensureProfileEditorBindings() {
  const settingsSelect = el("settings-model-select");
  if (settingsSelect) settingsSelect.onchange = (ev) => setActiveProfile(ev.target.value);
  const settingsName = el("settings-model-name");
  if (settingsName) settingsName.oninput = (ev) => {
    const profile = getCurrentProfile();
    profile.label = ev.target.value || "機種";
    syncProfileSelects();
  };
  const settingsNew = el("settings-model-new");
  if (settingsNew) settingsNew.onclick = createSettingsProfile;
}

export function openSettingsModal() {
  renderSettingsUI();
  el("settingsModal").style.display = "flex";
}

export function closeSettingsModal() {
  el("settingsModal").style.display = "none";
}

function renderSettingsUI() {
  syncProfileSelects();
  ensureProfileEditorBindings();
  const profile = getCurrentProfile();
  const list = el("settings-region-list");
  if (!list) return;
  list.innerHTML = "";

  regionKeys().forEach((key) => {
    const region = getProfileRegion(profile.id, key);
    const group = document.createElement("div");
    group.className = "crop-group";
    group.dataset.region = key;
    group.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:700;">${regionLabel(key)}</div>
        <div class="settings-help">${key}</div>
      </div>
      <div class="crop-grid" style="margin-top:10px;">
        <div><label>x</label><input type="number" step="0.01" min="0" max="1" value="${region.x}"></div>
        <div><label>y</label><input type="number" step="0.01" min="0" max="1" value="${region.y}"></div>
        <div><label>w</label><input type="number" step="0.01" min="0.01" max="1" value="${region.w}"></div>
        <div><label>h</label><input type="number" step="0.01" min="0.01" max="1" value="${region.h}"></div>
      </div>
    `;

    const inputs = group.querySelectorAll("input");
    ["x", "y", "w", "h"].forEach((field, idx) => {
      inputs[idx].addEventListener("input", (ev) => {
        setProfileRegion(profile.id, key, {
          ...getProfileRegion(profile.id, key),
          [field]: Number(ev.target.value),
        });
        updateSettingsPreview();
      });
    });

    list.appendChild(group);
  });

  const sampleInput = el("settings-sample-file");
  if (sampleInput) {
    sampleInput.value = "";
    sampleInput.onchange = handleSettingsSampleUpload;
  }

  const saveBtn = el("settings-save-btn");
  if (saveBtn) saveBtn.onclick = commitSettings;
  const resetBtn = el("settings-reset-btn");
  if (resetBtn) resetBtn.onclick = resetSettings;
  const closeBtn = el("settings-close-btn");
  if (closeBtn) closeBtn.onclick = closeSettingsModal;

  const preview = el("settings-preview-img");
  if (preview) {
    preview.onload = updateSettingsPreview;
    preview.src = profile.sampleImageDataUrl || "";
  }

  const info = el("settings-model-info");
  if (info) info.textContent = profile.width && profile.height ? `${profile.width} × ${profile.height}` : "サイズ未設定";
  updateSettingsPreview();
}

function attachRegionDragHandlers(box, profileId, key) {
  let mode = null;
  let startX = 0;
  let startY = 0;
  let startRegion = null;
  let rect = null;

  const onMove = (ev) => {
    if (!mode || !startRegion || !rect) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const deltaX = dx / rect.w;
    const deltaY = dy / rect.h;
    const current = getProfileRegion(profileId, key);

    if (mode === "move") {
      setProfileRegion(profileId, key, {
        x: clamp(startRegion.x + deltaX, 0, 1 - startRegion.w),
        y: clamp(startRegion.y + deltaY, 0, 1 - startRegion.h),
        w: startRegion.w,
        h: startRegion.h,
      });
    } else if (mode === "resize") {
      setProfileRegion(profileId, key, {
        x: startRegion.x,
        y: startRegion.y,
        w: clamp(startRegion.w + deltaX, 0.01, 1 - startRegion.x),
        h: clamp(startRegion.h + deltaY, 0.01, 1 - startRegion.y),
      });
    }
    updateSettingsPreview();
  };

  const end = () => {
    mode = null;
    startRegion = null;
    rect = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
  };

  box.addEventListener("pointerdown", (ev) => {
    const handle = ev.target.closest(".crop-handle");
    mode = handle ? "resize" : "move";
    startX = ev.clientX;
    startY = ev.clientY;
    startRegion = { ...getProfileRegion(profileId, key) };
    const previewRect = getDisplayRect(el("settings-preview-img"));
    if (!previewRect) return;
    rect = previewRect;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    ev.preventDefault();
    ev.stopPropagation();
  });
}

function updateSettingsPreview() {
  const layer = el("settings-overlay-layer");
  const img = el("settings-preview-img");
  if (!layer || !img) return;
  layer.innerHTML = "";
  const profile = getCurrentProfile();
  const rect = getDisplayRect(img);
  if (!rect) return;

  regionKeys().forEach((key) => {
    const r = getProfileRegion(profile.id, key);
    const pix = regionToPixels(r, rect);
    const box = document.createElement("div");
    box.className = "crop-box";
    box.style.left = `${pix.left}px`;
    box.style.top = `${pix.top}px`;
    box.style.width = `${pix.width}px`;
    box.style.height = `${pix.height}px`;
    box.style.borderColor = getDifficultyColor(key === "diff" ? "easy" : key === "title" ? "normal" : key === "result" ? "master" : "append");
    box.innerHTML = `<div class="crop-label">${regionLabel(key)}</div><div class="crop-handle"></div>`;
    attachRegionDragHandlers(box, profile.id, key);
    layer.appendChild(box);
  });
}

async function fileToImageSize(file) {
  if (!file) return { width: 0, height: 0 };
  if (window.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(file);
      const size = { width: bmp.width || 0, height: bmp.height || 0 };
      if (bmp.close) bmp.close();
      return size;
    } catch {}
  }
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
      URL.revokeObjectURL(url);
      resolve(size);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

function updateEditorModelSelect() {
  const select = el("up-model");
  if (!select) return;
  const current = select.value || currentProfileId();
  select.innerHTML = profileOptionsHtml(current);
  select.value = current && state.settings?.profiles?.[current] ? current : currentProfileId();
}

function setItemModelId(item, modelId) {
  if (!state.settings?.profiles?.[modelId]) return;
  item.data.modelId = modelId;
  item.data.modelLabel = state.settings.profiles[modelId].label || "";
}

function readProfileFromItem(item) {
  const modelId = item.data.modelId || currentProfileId();
  if (state.settings?.profiles?.[modelId]) return modelId;
  return currentProfileId();
}

function cloneProfileForNewId(baseProfile, sampleData) {
  const nextId = `${baseProfile.id}_${Date.now().toString(36)}`;
  return {
    id: nextId,
    label: `${baseProfile.label || "機種"}（複製）`,
    width: sampleData.width || baseProfile.width || 0,
    height: sampleData.height || baseProfile.height || 0,
    sampleImageDataUrl: sampleData.sampleImageDataUrl || baseProfile.sampleImageDataUrl || "",
    cropRegions: cloneSettings(baseProfile.cropRegions || DEFAULT_CROP_SETTINGS),
  };
}

export function createSettingsProfile() {
  const profile = getCurrentProfile();
  const created = cloneProfileForNewId(profile, {});
  state.settings.profiles[created.id] = created;
  state.settings.activeModelId = created.id;
  saveSettings(state.settings);
  syncProfileSelects();
  renderSettingsUI();
  showToast("機種を追加しました", "新しい機種プロファイルを作成しました。", "success");
}

function handleSettingsSampleUpload(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || "");
    const size = await fileToImageSize(file);
    const profile = getCurrentProfile();
    profile.sampleImageDataUrl = dataUrl;
    profile.width = size.width || profile.width || 0;
    profile.height = size.height || profile.height || 0;
    const preview = el("settings-preview-img");
    if (preview) preview.src = profile.sampleImageDataUrl;
    syncProfileSelects();
    updateSettingsPreview();
  };
  reader.readAsDataURL(file);
}

function commitSettings() {
  saveSettings(state.settings);
  syncTopButtons();
  updateEditorModelSelect();
  closeSettingsModal();
  applyFiltersAndSort();
  showToast("設定を保存しました", "機種ごとの読み取り範囲を反映しました。", "success");
}

function resetSettings() {
  const profile = getCurrentProfile();
  profile.cropRegions = cloneSettings(DEFAULT_CROP_SETTINGS);
  profile.sampleImageDataUrl = "";
  profile.width = 0;
  profile.height = 0;
  saveSettings(state.settings);
  renderSettingsUI();
  showToast("設定を初期化しました", "標準の読み取り範囲に戻しました。", "warn");
}

export function initializeUI() {
  renderControlOptions();
  syncTopButtons();
  updateSelectionUI();
  const pb = el("btn-pb-only");
  if (pb) pb.onclick = togglePBOnly;
  const settingsBtn = el("btn-settings");
  if (settingsBtn) settingsBtn.onclick = openSettingsModal;
}

function getActiveEditorItem() {
  return state.editorQueue.find((item) => item.id === state.activeItemId);
}

function getItemModelId(item) {
  return item.data.modelId || currentProfileId();
}

export function openBatchModal(mode) {
  state.currentMode = mode;
  const modal = el("batchModal");
  modal.style.display = "flex";

  state.editorQueue = [];
  state.activeItemId = null;
  el("batch-sidebar-list").innerHTML = "";
  el("batch-editor-container").style.display = "none";
  el("batch-empty-msg").style.display = "block";
  el("batch-status-msg").textContent = "待機中...";
  el("btn-exec-batch").disabled = true;

  if (mode === "upload") {
    el("batch-modal-title").innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
    el("upload-initial").style.display = "flex";
    el("batch-workspace").style.display = "none";
    el("up-file").value = "";
    el("btn-exec-batch").textContent = "全てアップロード";
  } else {
    el("batch-modal-title").innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
    el("upload-initial").style.display = "none";
    el("batch-workspace").style.display = "flex";
    el("btn-exec-batch").textContent = "保存して反映";
  }
}

export function closeBatchModal() {
  el("batchModal").style.display = "none";
}

async function runBatchAnalysis(itemsToAnalyze) {
  if (!itemsToAnalyze.length) return;
  const statusMsg = el("batch-status-msg");
  statusMsg.textContent = "解析中... (しばらくお待ちください)";
  const worker = await createOcrWorker();

  for (const item of itemsToAnalyze) {
    const elStatus = el(`sb-status-${item.id}`);
    if (elStatus) {
      elStatus.textContent = "解析中";
      elStatus.className = "upload-status processing";
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = item.imgUrl;

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const res = await analyzeLoadedImage(img, worker, getItemModelId(item));
      if (res) {
        item.data = {
          title: res.title,
          level: res.level,
          diff: res.diff,
          perfect: res.perfect,
          great: res.great,
          good: res.good,
          bad: res.bad,
          missDetail: res.missDetail,
          totalMiss: res.totalMiss,
          combo: res.combo,
          musicId: res.musicId,
          modelId: getItemModelId(item),
          modelLabel: state.settings?.profiles?.[getItemModelId(item)]?.label || "",
          imageWidth: item.data.imageWidth || 0,
          imageHeight: item.data.imageHeight || 0,
        };
        item.status = "done";
      } else {
        item.status = "error";
      }
    } catch (e) {
      console.error("Analysis Failed for " + item.id, e);
      item.status = "error";
    }

    updateSidebarStatus(item.id);
    if (item.status === "done") {
      el(`sb-title-${item.id}`).textContent = item.data.title;
      if (state.activeItemId === item.id) selectItem(item.id);
    } else if (elStatus) {
      elStatus.textContent = "ERR";
      elStatus.className = "upload-status error";
    }
  }

  await worker.terminate();
  statusMsg.textContent = "処理完了";
}

export async function handleFiles(files) {
  if (!files || files.length === 0) return;
  el("upload-initial").style.display = "none";
  el("batch-workspace").style.display = "flex";
  el("batch-status-msg").textContent = "画像を処理中...";

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const qId = `new_${Date.now()}_${i}`;
    const size = await fileToImageSize(file);
    const modelId = getProfileIdByDimensions(state.settings, size.width, size.height);
    const model = getProfile(state.settings, modelId) || createDefaultProfile();
    state.editorQueue.push({
      id: qId,
      file,
      imgUrl: URL.createObjectURL(file),
      status: "pending",
      data: {
        title: "",
        level: "",
        diff: "master",
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        missDetail: 0,
        totalMiss: 0,
        combo: 0,
        musicId: null,
        modelId,
        modelLabel: model.label || "",
        imageWidth: size.width || 0,
        imageHeight: size.height || 0,
      },
      originalId: null,
      originalParent: null,
    });
    renderSidebarItem(qId);
  }

  updateEditorModelSelect();
  await runBatchAnalysis(state.editorQueue.filter((item) => item.status === "pending"));
  if (!state.activeItemId && state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
  checkBatchButton();
}

export function renderSidebarItem(id) {
  const item = state.editorQueue.find((q) => q.id === id);
  if (!item) return;

  const div = document.createElement("div");
  div.className = "sidebar-item";
  div.id = `sb-${id}`;
  div.onclick = () => selectItem(id);

  div.innerHTML = `
    <img src="${item.imgUrl}" class="sidebar-thumb" crossorigin="anonymous" loading="lazy" decoding="async">
    <div class="sidebar-info">
      <div class="sidebar-title" id="sb-title-${id}">${escapeHtml(item.data.title || "名称未設定")}</div>
      <div class="sidebar-status">
        <span id="sb-status-${id}" class="upload-status ${item.status === 'existing' ? 'done' : item.status}">${item.status === 'existing' ? 'EXIST' : item.status}</span>
        <button class="btn-remove-side" onclick="removeBatchItem(event, '${id}')">
          <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
        </button>
      </div>
    </div>
  `;
  el("batch-sidebar-list").appendChild(div);
}

export function selectItem(id) {
  state.activeItemId = id;
  const item = state.editorQueue.find((q) => q.id === id);
  if (!item) return;

  document.querySelectorAll(".sidebar-item").forEach((n) => n.classList.remove("active"));
  el(`sb-${id}`)?.classList.add("active");

  el("batch-editor-container").style.display = "flex";
  el("batch-empty-msg").style.display = "none";

  const imgEl = el("batch-preview-img");
  imgEl.src = item.imgUrl;

  el("up-title").value = item.data.title || "";
  el("up-level").value = item.data.level || "";
  updateEditorModelSelect();
  el("up-model").value = getItemModelId(item);
  el("up-diff").value = item.data.diff || "master";
  el("up-perfect").value = item.data.perfect || 0;
  el("up-great").value = item.data.great || 0;
  el("up-good").value = item.data.good || 0;
  el("up-bad").value = item.data.bad || 0;
  el("up-miss-detail").value = item.data.missDetail || 0;
  el("up-combo").value = item.data.combo || 0;
  el("up-total-miss").textContent = String(item.data.totalMiss || 0);
}

export function updateCurrentItem(field, value) {
  if (!state.activeItemId) return;
  const item = state.editorQueue.find((q) => q.id === state.activeItemId);
  if (!item) return;

  if (field === "modelId") {
    setItemModelId(item, value);
    updateEditorModelSelect();
  } else if (["perfect", "great", "good", "bad", "missDetail", "combo", "level"].includes(field)) {
    item.data[field] = parseInt(value, 10) || 0;
  } else {
    item.data[field] = value;
  }

  if (["perfect", "great", "good", "bad", "missDetail"].includes(field)) {
    item.data.totalMiss = Number(item.data.good || 0) + Number(item.data.bad || 0) + Number(item.data.missDetail || 0);
    el("up-total-miss").textContent = String(item.data.totalMiss);
  }

  if (field === "diff" && item.data.musicId) {
    const newLevel = getLevelFromDb(item.data.musicId, item.data.diff);
    if (newLevel) {
      item.data.level = newLevel;
      el("up-level").value = newLevel;
    }
  }

  if (field === "title") el(`sb-title-${state.activeItemId}`).textContent = value || "名称未設定";
  item.status = "done";
  updateSidebarStatus(state.activeItemId);
}

export function updateSidebarStatus(id) {
  const item = state.editorQueue.find((q) => q.id === id);
  if (!item) return;
  const statusEl = el(`sb-status-${id}`);
  if (statusEl) {
    statusEl.textContent = "OK";
    statusEl.className = "upload-status done";
  }
}

export function removeBatchItem(ev, id) {
  ev.stopPropagation();
  const idx = state.editorQueue.findIndex((q) => q.id === id);
  if (idx >= 0) {
    const removed = state.editorQueue.splice(idx, 1)[0];
    if (removed?.imgUrl) URL.revokeObjectURL(removed.imgUrl);
  }
  el(`sb-${id}`)?.remove();
  if (state.activeItemId === id) {
    state.activeItemId = null;
    if (state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
    else {
      el("batch-editor-container").style.display = "none";
      el("batch-empty-msg").style.display = "block";
    }
  }
  checkBatchButton();
}

export function checkBatchButton() {
  const btn = el("btn-exec-batch");
  if (!btn) return;
  btn.disabled = state.editorQueue.length === 0;
  const label = state.currentMode === "upload" ? "全てアップロード" : "保存して反映";
  btn.textContent = state.editorQueue.length > 0 ? `${label} (${state.editorQueue.length}件)` : label;
}

function updateModelMetadataFromEditor() {
  const item = getActiveEditorItem();
  if (!item) return;
  const modelId = el("up-model")?.value || currentProfileId();
  setItemModelId(item, modelId);
}

export function reanalyzeCurrentItem() {
  if (!state.activeItemId) return;
  updateModelMetadataFromEditor();
  const item = getActiveEditorItem();
  if (item) runBatchAnalysis([item]);
}

export function analyzeAllInBatch() {
  if (state.editorQueue.length === 0) return;
  state.editorQueue.forEach(updateModelMetadataFromEditor);
  runBatchAnalysis(state.editorQueue);
}

function finishExecution(count, actionName, pbMessages = []) {
  if (pbMessages.length) {
    pbMessages.forEach((msg) => showToast("自己ベスト更新", msg, "success", 4500));
  }

  if (state.editorQueue.length === 0) {
    alert(`${actionName}完了 (${count}件)`);
    closeBatchModal();
    state.selectedIds.clear();
    updateSelectionUI();
    fetchDataFromDrive();
  } else {
    alert(`${count}件 ${actionName}成功。エラー分を確認してください。`);
    checkBatchButton();
  }
}

export async function executeUploads() {
  let successCount = 0;
  const pbMessages = [];

  for (const item of [...state.editorQueue]) {
    const sbStatus = el(`sb-status-${item.id}`);
    if (sbStatus) {
      sbStatus.textContent = "送信中";
      sbStatus.className = "upload-status processing";
    }

    try {
      if (!item.data.title || !item.data.level) throw new Error("必須項目不足");

      const recordKey = getRecordKey({
        title: item.data.title,
        difficultyRaw: item.data.diff,
      });
      const previousBest = getBestMissForKey(state.allRecords, recordKey);

      await uploadQueueItem(item);

      if (item.data.totalMiss < previousBest) {
        pbMessages.push(`${item.data.title} / ${item.data.level} / ${getDifficultyLabel(item.data.diff)} で自己ベスト更新`);
      }

      state.editorQueue = state.editorQueue.filter((q) => q.id !== item.id);
      el(`sb-${item.id}`)?.remove();
      successCount++;
    } catch (e) {
      console.error(e);
      if (sbStatus) {
        sbStatus.textContent = "失敗";
        sbStatus.className = "upload-status error";
      }
    }
  }

  finishExecution(successCount, "アップロード", pbMessages);
}

export async function executeEdits() {
  let successCount = 0;
  const pbMessages = [];

  for (const item of [...state.editorQueue]) {
    const sbStatus = el(`sb-status-${item.id}`);
    if (sbStatus) {
      sbStatus.textContent = "保存中";
      sbStatus.className = "upload-status processing";
    }

    try {
      if (!item.data.title || !item.data.level) throw new Error("必須項目不足");

      const recordKey = getRecordKey({
        title: item.data.title,
        difficultyRaw: item.data.diff,
      });
      const previousBest = getBestMissForKey(state.allRecords, recordKey, item.originalId);

      await updateQueueItem(item);

      if (item.data.totalMiss < previousBest) {
        pbMessages.push(`${item.data.title} / ${item.data.level} / ${getDifficultyLabel(item.data.diff)} で自己ベスト更新`);
      }

      state.editorQueue = state.editorQueue.filter((q) => q.id !== item.id);
      el(`sb-${item.id}`)?.remove();
      successCount++;
    } catch (e) {
      console.error(e);
      if (sbStatus) {
        sbStatus.textContent = "失敗";
        sbStatus.className = "upload-status error";
      }
    }
  }

  finishExecution(successCount, "更新", pbMessages);
}

export async function handleBatchExecution() {
  const btn = el("btn-exec-batch");
  btn.disabled = true;
  btn.textContent = "処理中...";

  if (state.currentMode === "upload") await executeUploads();
  else await executeEdits();
}

export async function individualEdit(id) {
  state.selectedIds.clear();
  state.selectedIds.add(id);
  await batchEdit();
}

export async function individualDelete(id) {
  if (!confirm("このリザルトを削除しますか？")) return;
  const loader = el("loader");
  loader.style.display = "flex";
  el("grid").innerHTML = "";
  try {
    await deleteDriveFile(id);
    alert("削除しました");
    await fetchDataFromDrive();
  } catch (e) {
    alert("エラー: " + e.message);
    await fetchDataFromDrive();
  }
}

export async function batchEdit() {
  if (state.selectedIds.size === 0) return;
  openBatchModal("edit");

  const targets = state.allRecords.filter((r) => state.selectedIds.has(r.id));
  el("batch-status-msg").textContent = "編集データを準備中...";

  for (const rec of targets) {
    const qId = `edit_${rec.id}`;
    const highResUrl = rec.thumbnail ? rec.thumbnail.replace("=s220", "=w1600") : "";
    const modelId = rec.modelId || currentProfileId();

    state.editorQueue.push({
      id: qId,
      file: null,
      imgUrl: highResUrl,
      status: "existing",
      data: {
        title: rec.title,
        level: rec.level,
        diff: rec.difficultyRaw,
        perfect: rec.perfect || 0,
        great: rec.great || 0,
        good: rec.good || 0,
        bad: rec.bad || 0,
        missDetail: rec.missDetail || 0,
        totalMiss: rec.totalMiss || rec.missCount || 0,
        combo: rec.combo || 0,
        musicId: rec.musicId || null,
        modelId,
        modelLabel: rec.modelLabel || state.settings?.profiles?.[modelId]?.label || "",
        imageWidth: rec.imageWidth || 0,
        imageHeight: rec.imageHeight || 0,
      },
      originalId: rec.id,
      originalParent: rec.parentId,
    });
    renderSidebarItem(qId);
  }

  updateEditorModelSelect();
  if (state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
  checkBatchButton();
  el("batch-status-msg").textContent = "編集準備完了";
}

export async function batchDelete() {
  if (!confirm(`選択した ${state.selectedIds.size} 件を削除しますか？`)) return;
  const loader = el("loader");
  loader.style.display = "flex";
  el("grid").innerHTML = "";
  try {
    for (const id of state.selectedIds) {
      await deleteDriveFile(id);
    }
    alert("削除しました");
    state.selectedIds.clear();
    updateSelectionUI();
    await fetchDataFromDrive();
  } catch (e) {
    alert("削除エラー: " + e.message);
    await fetchDataFromDrive();
  }
}

export function updateBestOnlyFromSettings() {
  syncTopButtons();
  applyFiltersAndSort();
}

export function onDataLoaded() {
  el("loader").style.display = "none";
  if (!state.allRecords.length) {
    el("grid").innerHTML = "";
    const authText = el("auth-status")?.textContent || "";
    el("result-count").textContent = authText.includes("ログイン済") ? "データなし" : "ログインしてください";
    return;
  }
  applyFiltersAndSort();
}
