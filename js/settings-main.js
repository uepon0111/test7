/**
 * settings-main.js
 * ---------------------------------------------------------------------------
 * settings.html（読み取り範囲設定画面）のロジック一式。
 *   - 機種プロファイルの一覧表示・新規作成・削除・保存（DeviceProfiles経由）
 *   - サンプル画像のアップロード（このページ内でのみ使用。保存はしない）
 *   - RegionEditor（ドラッグ&リサイズ）と数値入力の双方向同期
 * ---------------------------------------------------------------------------
 */
const SettingsMain = (() => {

  let profiles = [];          // 作業用のローカルコピー（保存ボタンでDeviceProfilesへ反映）
  let activeProfileId = null;
  let currentRegions = {};    // 比率(0〜1)。編集中の作業値
  let currentRefWidth = 0;
  let currentRefHeight = 0;
  const sampleImageCache = {}; // profileId -> objectURL（このセッション内のみ有効）

  function init() {
    profiles = DeviceProfiles.getAll().map((p) => JSON.parse(JSON.stringify(p)));
    _initSampleDropZone();
    _renderProfileList();
    if (profiles.length > 0) selectProfile(profiles[0].id);
  }

  // ---- プロファイル一覧 -----------------------------------------------------

  function _renderProfileList() {
    const list = document.getElementById('profile-list');
    list.innerHTML = '';
    profiles.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'profile-item' + (p.id === activeProfileId ? ' active' : '');
      div.dataset.id = p.id;
      div.innerHTML = `
        <span class="material-symbols-outlined profile-item-icon">smartphone</span>
        <span class="profile-item-name">${Utils.escapeHtml(p.name || '無題のプロファイル')}</span>
        <button class="btn-remove-side profile-item-del" title="削除">
          <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
        </button>
      `;
      div.addEventListener('click', () => selectProfile(p.id));
      div.querySelector('.profile-item-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteProfile(p.id);
      });
      list.appendChild(div);
    });
  }

  function selectProfile(id) {
    const p = profiles.find((pp) => pp.id === id);
    if (!p) return;
    activeProfileId = id;
    currentRegions = JSON.parse(JSON.stringify(p.regions));
    currentRefWidth = p.refWidth || 0;
    currentRefHeight = p.refHeight || 0;

    document.getElementById('profile-name-input').value = p.name;
    _renderProfileList();
    _renderRegionControls();
    _syncAllNumericInputs();
    _updateRefResolutionDisplay();

    const cachedUrl = sampleImageCache[id];
    if (cachedUrl) {
      _showSampleImage(cachedUrl, false);
    } else {
      _showDropZone();
    }

    const canDelete = profiles.length > 1;
    document.getElementById('btn-delete-profile').disabled = !canDelete;
  }

  function createNewProfile() {
    const p = DeviceProfiles.createBlank('新しいプロファイル');
    profiles.push(p);
    _renderProfileList();
    selectProfile(p.id);
    Toast.show('新しいプロファイルを作成しました。サンプル画像をアップロードして範囲を調整し、保存してください。', 'info', 6000);
  }

  function deleteProfile(id) {
    if (profiles.length <= 1) {
      Toast.show('プロファイルは最低1件必要です', 'error');
      return;
    }
    if (!confirm('このプロファイルを削除しますか？（この操作は保存不要で即座に反映されます）')) return;

    DeviceProfiles.remove(id);
    profiles = profiles.filter((p) => p.id !== id);
    delete sampleImageCache[id];

    if (activeProfileId === id) {
      activeProfileId = null;
      if (profiles.length > 0) selectProfile(profiles[0].id);
    } else {
      _renderProfileList();
    }
    Toast.show('プロファイルを削除しました', 'info');
  }

  // 設定パネル側の削除ボタン用（現在選択中のプロファイルを削除する）
  function deleteActiveProfile() {
    if (!activeProfileId) return;
    deleteProfile(activeProfileId);
  }

  function onProfileNameChange(value) {
    const p = profiles.find((pp) => pp.id === activeProfileId);
    if (!p) return;
    p.name = value;
    _renderProfileList();
  }

  function saveCurrentProfile() {
    const p = profiles.find((pp) => pp.id === activeProfileId);
    if (!p) return;

    const nameInput = document.getElementById('profile-name-input');
    p.name = (nameInput.value || '').trim() || '無題のプロファイル';
    p.regions = JSON.parse(JSON.stringify(currentRegions));
    if (currentRefWidth && currentRefHeight) {
      p.refWidth = currentRefWidth;
      p.refHeight = currentRefHeight;
    }

    DeviceProfiles.upsert(p);
    _renderProfileList();
    Toast.show(`「${p.name}」を保存しました`, 'success');
  }

  function resetRegionsToDefault() {
    if (!confirm('読み取り範囲をデフォルト値にリセットしますか？（保存するまで確定しません）')) return;
    currentRegions = DeviceProfiles.defaultRegions();
    _renderRegionControls();
    _syncAllNumericInputs();
    if (document.getElementById('region-editor-wrapper').style.display !== 'none') {
      RegionEditor.mount(document.getElementById('region-editor-wrapper'), currentRegions, _onRegionChangeFromEditor);
    }
  }

  // ---- サンプル画像 ---------------------------------------------------------

  function _initSampleDropZone() {
    const dz = document.getElementById('sample-drop-zone');
    const input = document.getElementById('sample-file-input');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', (e) => { e.preventDefault(); dz.classList.remove('dragover'); });
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) _onSampleFileSelected(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => {
      if (e.target.files.length > 0) _onSampleFileSelected(e.target.files[0]);
    });

    document.getElementById('btn-replace-sample').addEventListener('click', () => input.click());
  }

  function _onSampleFileSelected(file) {
    if (!file || !file.type.startsWith('image/')) {
      Toast.show('画像ファイルを選択してください', 'error');
      return;
    }
    const url = URL.createObjectURL(file);
    sampleImageCache[activeProfileId] = url;
    _showSampleImage(url, true);
  }

  function _showSampleImage(url, isNewUpload) {
    document.getElementById('sample-drop-zone').style.display = 'none';
    const wrapper = document.getElementById('region-editor-wrapper');
    wrapper.style.display = 'inline-block';
    const img = document.getElementById('sample-img');

    const onImgReady = () => {
      if (isNewUpload) {
        currentRefWidth = img.naturalWidth;
        currentRefHeight = img.naturalHeight;
        _updateRefResolutionDisplay();
      }
      RegionEditor.mount(wrapper, currentRegions, _onRegionChangeFromEditor);
    };

    if (img.src === url) {
      onImgReady();
    } else {
      img.onload = onImgReady;
      img.src = url;
    }
  }

  function _showDropZone() {
    document.getElementById('sample-drop-zone').style.display = 'flex';
    document.getElementById('region-editor-wrapper').style.display = 'none';
  }

  function _updateRefResolutionDisplay() {
    const el = document.getElementById('ref-resolution-display');
    if (!el) return;
    el.textContent = (currentRefWidth && currentRefHeight)
      ? `基準解像度: ${currentRefWidth} × ${currentRefHeight} px（アスペクト比 ${(currentRefWidth / currentRefHeight).toFixed(3)}）`
      : '基準解像度: 未設定（サンプル画像をアップロードしてください）';
  }

  // ---- 読み取り範囲コントロール（数値⇔ドラッグの双方向同期） --------------------

  function _renderRegionControls() {
    const container = document.getElementById('region-controls-list');
    container.innerHTML = '';
    Config.REGION_KEYS.forEach((key) => {
      const meta = Config.REGION_META[key];
      const group = document.createElement('div');
      group.className = 'region-control-group';
      group.innerHTML = `
        <div class="region-control-header">
          <span class="region-swatch" style="background:${meta.color}"></span>
          <span class="region-control-title">${meta.label}</span>
        </div>
        <div class="region-control-inputs">
          <label>X<input type="number" step="0.1" min="0" max="100" id="ri-${key}-x"
            onchange="SettingsMain.onNumericInputChange('${key}')"
            onfocus="RegionEditor.focusRegion('${key}')"></label>
          <label>Y<input type="number" step="0.1" min="0" max="100" id="ri-${key}-y"
            onchange="SettingsMain.onNumericInputChange('${key}')"
            onfocus="RegionEditor.focusRegion('${key}')"></label>
          <label>W<input type="number" step="0.1" min="1" max="100" id="ri-${key}-w"
            onchange="SettingsMain.onNumericInputChange('${key}')"
            onfocus="RegionEditor.focusRegion('${key}')"></label>
          <label>H<input type="number" step="0.1" min="1" max="100" id="ri-${key}-h"
            onchange="SettingsMain.onNumericInputChange('${key}')"
            onfocus="RegionEditor.focusRegion('${key}')"></label>
          <span class="region-unit">%</span>
        </div>
      `;
      container.appendChild(group);
    });
  }

  function _syncAllNumericInputs() {
    Config.REGION_KEYS.forEach((key) => _updateNumericInputs(key, currentRegions[key]));
  }

  function _updateNumericInputs(key, region) {
    if (!region) return;
    const xEl = document.getElementById(`ri-${key}-x`);
    const yEl = document.getElementById(`ri-${key}-y`);
    const wEl = document.getElementById(`ri-${key}-w`);
    const hEl = document.getElementById(`ri-${key}-h`);
    if (!xEl) return;
    xEl.value = Utils.toPercentStr(region.x);
    yEl.value = Utils.toPercentStr(region.y);
    wEl.value = Utils.toPercentStr(region.w);
    hEl.value = Utils.toPercentStr(region.h);
  }

  // RegionEditor（ドラッグ/リサイズ）側からの変更 → 数値入力へ反映
  function _onRegionChangeFromEditor(key, region) {
    currentRegions[key] = region;
    _updateNumericInputs(key, region);
  }

  // 数値入力側からの変更 → RegionEditor（矩形）へ反映
  function onNumericInputChange(key) {
    const xRaw = parseFloat(document.getElementById(`ri-${key}-x`).value);
    const yRaw = parseFloat(document.getElementById(`ri-${key}-y`).value);
    const wRaw = parseFloat(document.getElementById(`ri-${key}-w`).value);
    const hRaw = parseFloat(document.getElementById(`ri-${key}-h`).value);

    let x = Utils.clamp(isNaN(xRaw) ? 0 : xRaw / 100, 0, 1);
    let y = Utils.clamp(isNaN(yRaw) ? 0 : yRaw / 100, 0, 1);
    let w = Utils.clamp(isNaN(wRaw) ? 0.02 : wRaw / 100, 0.01, 1);
    let h = Utils.clamp(isNaN(hRaw) ? 0.02 : hRaw / 100, 0.01, 1);

    // 画像の外にはみ出さないように調整
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;

    const region = { x, y, w, h };
    currentRegions[key] = region;
    _updateNumericInputs(key, region);

    if (document.getElementById('region-editor-wrapper').style.display !== 'none') {
      RegionEditor.setRegion(key, region);
    }
  }

  return {
    init, selectProfile, createNewProfile, deleteProfile, deleteActiveProfile,
    onProfileNameChange, saveCurrentProfile, resetRegionsToDefault,
    onNumericInputChange,
  };
})();

window.addEventListener('load', () => SettingsMain.init());
