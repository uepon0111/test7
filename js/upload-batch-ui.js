/**
 * upload-batch-ui.js
 * ---------------------------------------------------------------------------
 * アップロード / 編集用モーダルのロジック一式。
 *   - ドロップゾーン・ファイル選択
 *   - サイドバー（キュー一覧）
 *   - エディタ（曲名・レベル・難易度・PERFECT/GREAT/GOOD/BAD/MISS・コンボ・機種プロファイル）
 *   - 一括解析 / 個別再解析（アップロード時は画像の解像度から機種プロファイルを自動選択）
 *   - 実行（アップロード / 編集保存）と、自己ベスト更新時のトースト通知
 * ---------------------------------------------------------------------------
 */
const UploadBatchUI = (() => {

  let editorQueue = []; // { id, file, imgUrl, status, data:{}, originalId }
  let activeItemId = null;
  let currentMode = 'upload'; // 'upload' | 'edit'

  function _defaultItemData() {
    return {
      title: '', level: '', diff: 'MS',
      perfect: 0, great: 0, good: 0, bad: 0, missDetail: 0, totalMiss: 0,
      combo: 0, musicId: null, deviceProfileId: null, existingExt: null,
    };
  }

  // ---- モーダル開閉 -----------------------------------------------------

  function openBatchModal(mode) {
    currentMode = mode;
    const modal = document.getElementById('batchModal');
    modal.style.display = 'flex';

    editorQueue = [];
    activeItemId = null;
    document.getElementById('batch-sidebar-list').innerHTML = '';
    document.getElementById('batch-editor-container').style.display = 'none';
    document.getElementById('batch-empty-msg').style.display = 'block';
    document.getElementById('batch-status-msg').innerText = '待機中...';
    document.getElementById('btn-exec-batch').disabled = true;

    if (mode === 'upload') {
      document.getElementById('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
      document.getElementById('upload-initial').style.display = 'flex';
      document.getElementById('batch-workspace').style.display = 'none';
      document.getElementById('up-file').value = '';
      document.getElementById('btn-exec-batch').innerText = '全てアップロード';
    } else {
      document.getElementById('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
      document.getElementById('upload-initial').style.display = 'none';
      document.getElementById('batch-workspace').style.display = 'flex';
      document.getElementById('btn-exec-batch').innerText = '保存して反映';
    }
  }

  function closeBatchModal() {
    document.getElementById('batchModal').style.display = 'none';
    OcrEngine.terminateWorker();
  }

  // ---- ドロップゾーン・ファイル取り込み -------------------------------------

  function _initDropZone() {
    const dropZone = document.getElementById('drop-zone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    });
    document.getElementById('up-file').addEventListener('change', (e) => handleFiles(e.target.files));
  }

  function _getImageDimensions(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });
  }

  async function handleFiles(files) {
    if (files.length === 0) return;
    document.getElementById('upload-initial').style.display = 'none';
    document.getElementById('batch-workspace').style.display = 'flex';
    document.getElementById('batch-status-msg').innerText = '画像を処理中...';

    const newItems = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const qId = 'new_' + Date.now() + '_' + i;
      const imgUrl = URL.createObjectURL(file);
      const dims = await _getImageDimensions(imgUrl);
      const profile = DeviceProfiles.findBestMatch(dims.width, dims.height);

      const item = {
        id: qId,
        file,
        imgUrl,
        status: 'pending',
        data: { ..._defaultItemData(), deviceProfileId: profile ? profile.id : null },
        originalId: null,
        imgWidth: dims.width,
        imgHeight: dims.height,
      };
      editorQueue.push(item);
      newItems.push(item);
      renderSidebarItem(qId);
    }

    await runBatchAnalysis(newItems);

    if (!activeItemId && editorQueue.length > 0) selectItem(editorQueue[0].id);
    checkBatchButton();
  }

  // ---- 編集モードの初期化（一覧からの選択項目を読み込む） ----------------------

  async function batchEdit() {
    if (AppState.selectedIds.size === 0) return;
    openBatchModal('edit');

    const targets = AppState.allRecords.filter((r) => AppState.selectedIds.has(r.id));
    document.getElementById('batch-status-msg').innerText = '編集データを準備中...';

    for (const rec of targets) {
      const qId = 'edit_' + rec.id;
      const highResUrl = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
      const existingExt = (rec.raw && rec.raw.name && rec.raw.name.includes('.'))
        ? rec.raw.name.split('.').pop() : 'jpg';

      editorQueue.push({
        id: qId,
        file: null,
        imgUrl: highResUrl,
        status: 'existing',
        data: {
          title: rec.title,
          level: rec.level,
          diff: rec.diffCode,
          perfect: rec.perfect, great: rec.great, good: rec.good, bad: rec.bad, missDetail: rec.miss,
          totalMiss: rec.missCount,
          combo: rec.combo,
          musicId: rec.musicId,
          deviceProfileId: null,
          existingExt,
        },
        originalId: rec.id,
      });
      renderSidebarItem(qId);
    }
    if (editorQueue.length > 0) selectItem(editorQueue[0].id);
    checkBatchButton();
    document.getElementById('batch-status-msg').innerText = '編集準備完了';
  }

  // ---- サイドバー ---------------------------------------------------------

  function renderSidebarItem(id) {
    const item = editorQueue.find((q) => q.id === id);
    const div = document.createElement('div');
    div.className = 'sidebar-item';
    div.id = `sb-${id}`;
    div.onclick = () => selectItem(id);

    div.innerHTML = `
        <img src="${item.imgUrl}" class="sidebar-thumb" crossorigin="anonymous">
        <div class="sidebar-info">
            <div class="sidebar-title" id="sb-title-${id}">${Utils.escapeHtml(item.data.title) || '名称未設定'}</div>
            <div class="sidebar-status">
                <span id="sb-status-${id}" class="upload-status ${item.status === 'existing' ? 'done' : item.status}">${item.status === 'existing' ? 'EXIST' : item.status}</span>
                <button class="btn-remove-side" onclick="UploadBatchUI.removeBatchItem(event, '${id}')">
                    <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
                </button>
            </div>
        </div>
    `;
    document.getElementById('batch-sidebar-list').appendChild(div);
  }

  function _populateDeviceSelect(selectedId) {
    const sel = document.getElementById('up-device');
    if (!sel) return;
    sel.innerHTML = '';
    DeviceProfiles.getAll().forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function selectItem(id) {
    activeItemId = id;
    const item = editorQueue.find((q) => q.id === id);
    if (!item) return;

    document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
    const sbEl = document.getElementById(`sb-${id}`);
    if (sbEl) sbEl.classList.add('active');

    document.getElementById('batch-editor-container').style.display = 'flex';
    document.getElementById('batch-empty-msg').style.display = 'none';

    document.getElementById('batch-preview-img').src = item.imgUrl;

    document.getElementById('up-title').value = item.data.title;
    document.getElementById('up-level').value = item.data.level;
    document.getElementById('up-diff').value = item.data.diff;

    document.getElementById('up-perfect').value = item.data.perfect;
    document.getElementById('up-great').value = item.data.great;
    document.getElementById('up-good').value = item.data.good;
    document.getElementById('up-bad').value = item.data.bad;
    document.getElementById('up-miss-detail').value = item.data.missDetail;
    document.getElementById('up-total-miss').innerText = item.data.totalMiss;
    document.getElementById('up-combo').value = item.data.combo;

    _populateDeviceSelect(item.data.deviceProfileId);
  }

  function updateCurrentItem(field, value) {
    if (!activeItemId) return;
    const item = editorQueue.find((q) => q.id === activeItemId);
    if (!item) return;

    if (['good', 'bad', 'missDetail', 'level', 'perfect', 'great', 'combo'].includes(field)) {
      item.data[field] = parseInt(value, 10) || 0;
    } else {
      item.data[field] = value;
    }

    if (field === 'diff' && item.data.musicId != null) {
      const newDiffKey = Config.keyFromCode(value);
      const newLvl = MusicDB.getLevelFromDb(item.data.musicId, newDiffKey);
      if (newLvl) { item.data.level = newLvl; document.getElementById('up-level').value = newLvl; }
    }

    if (['good', 'bad', 'missDetail'].includes(field)) {
      item.data.totalMiss = item.data.good + item.data.bad + item.data.missDetail;
      document.getElementById('up-total-miss').innerText = item.data.totalMiss;
    }

    if (field === 'title') {
      document.getElementById(`sb-title-${activeItemId}`).innerText = value || '名称未設定';
    }
    item.status = 'done';
    updateSidebarStatus(activeItemId);
  }

  function onDeviceChange(value) {
    if (!activeItemId) return;
    const item = editorQueue.find((q) => q.id === activeItemId);
    if (!item) return;
    item.data.deviceProfileId = value;
    reanalyzeCurrentItem();
  }

  function updateSidebarStatus(id) {
    const item = editorQueue.find((q) => q.id === id);
    if (!item) return;
    const statusEl = document.getElementById(`sb-status-${id}`);
    statusEl.innerText = 'OK';
    statusEl.className = 'upload-status done';
  }

  function removeBatchItem(e, id) {
    e.stopPropagation();
    editorQueue = editorQueue.filter((q) => q.id !== id);
    const el = document.getElementById(`sb-${id}`);
    if (el) el.remove();
    if (activeItemId === id) {
      document.getElementById('batch-editor-container').style.display = 'none';
      document.getElementById('batch-empty-msg').style.display = 'block';
      activeItemId = null;
    }
    checkBatchButton();
  }

  function checkBatchButton() {
    const btn = document.getElementById('btn-exec-batch');
    btn.disabled = editorQueue.length === 0;
    const label = currentMode === 'upload' ? '全てアップロード' : '保存して反映';
    btn.innerText = editorQueue.length > 0 ? `${label} (${editorQueue.length}件)` : label;
  }

  // ---- 解析（OCR） ---------------------------------------------------------

  async function runBatchAnalysis(itemsToAnalyze) {
    if (itemsToAnalyze.length === 0) return;
    const statusMsg = document.getElementById('batch-status-msg');
    statusMsg.innerText = '解析中... (しばらくお待ちください)';

    for (const item of itemsToAnalyze) {
      const el = document.getElementById(`sb-status-${item.id}`);
      if (el) { el.innerText = '解析中'; el.className = 'upload-status processing'; }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = item.imgUrl;
      try {
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
        item.imgWidth = img.naturalWidth;
        item.imgHeight = img.naturalHeight;

        if (!item.data.deviceProfileId) {
          const p = DeviceProfiles.findBestMatch(img.naturalWidth, img.naturalHeight);
          item.data.deviceProfileId = p ? p.id : null;
        }
        const profile = DeviceProfiles.getById(item.data.deviceProfileId);

        const res = await OcrEngine.analyze(img, profile);
        if (res) {
          item.data.title = res.title;
          item.data.level = res.level;
          item.data.diff = Config.codeFromKey(res.diffKey) || item.data.diff;
          item.data.perfect = res.perfect;
          item.data.great = res.great;
          item.data.good = res.good;
          item.data.bad = res.bad;
          item.data.missDetail = res.miss;
          item.data.totalMiss = res.missCount;
          item.data.combo = res.combo;
          item.data.musicId = res.musicId;
          item.status = 'done';
        } else {
          item.status = 'error';
        }
      } catch (e) {
        console.error('Analysis Failed for ' + item.id, e);
        item.status = 'error';
      }

      updateSidebarStatus(item.id);
      if (item.status === 'done') {
        document.getElementById(`sb-title-${item.id}`).innerText = item.data.title;
        if (activeItemId === item.id) selectItem(item.id);
      } else {
        const statEl = document.getElementById(`sb-status-${item.id}`);
        if (statEl) { statEl.innerText = 'ERR'; statEl.className = 'upload-status error'; }
      }
    }
    statusMsg.innerText = '処理完了';
  }

  async function reanalyzeCurrentItem() {
    if (!activeItemId) return;
    const item = editorQueue.find((q) => q.id === activeItemId);
    if (item) await runBatchAnalysis([item]);
  }

  async function analyzeAllInBatch() {
    if (editorQueue.length === 0) return;
    await runBatchAnalysis(editorQueue);
  }

  // ---- 実行（アップロード / 編集保存） ---------------------------------------

  async function handleBatchExecution() {
    const btn = document.getElementById('btn-exec-batch');
    btn.disabled = true;
    btn.innerText = '処理中...';

    if (currentMode === 'upload') await executeUploads();
    else await executeEdits();
  }

  async function executeUploads() {
    let successCount = 0;
    const priorBestMap = BestScore.computeBestMap(AppState.allRecords);

    for (const item of [...editorQueue]) {
      const sbStatus = document.getElementById(`sb-status-${item.id}`);
      if (sbStatus) { sbStatus.innerText = '送信中'; sbStatus.className = 'upload-status processing'; }

      try {
        if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
        const diffKey = Config.keyFromCode(item.data.diff);
        const uploadData = {
          title: item.data.title, level: item.data.level, diffKey,
          musicId: item.data.musicId,
          perfect: item.data.perfect, great: item.data.great,
          good: item.data.good, bad: item.data.bad, miss: item.data.missDetail,
          combo: item.data.combo,
        };
        const newRec = await DriveStorage.uploadResult(item.file, uploadData);

        // 自己ベスト更新の判定・通知
        const key = BestScore.groupKey(newRec);
        const priorBest = priorBestMap.get(key);
        if (priorBest && BestScore.isBetter(newRec, priorBest)) {
          Toast.show(`自己ベスト更新！ ${newRec.title}(${newRec.difficultyLabel}) ミス数 ${priorBest.missCount} → ${newRec.missCount}`, 'success', 7000);
        }
        priorBestMap.set(key, (!priorBest || BestScore.isBetter(newRec, priorBest)) ? newRec : priorBest);

        editorQueue = editorQueue.filter((q) => q.id !== item.id);
        const sbEl = document.getElementById(`sb-${item.id}`);
        if (sbEl) sbEl.remove();
        successCount++;
      } catch (e) {
        console.error(e);
        if (sbStatus) { sbStatus.innerText = '失敗'; sbStatus.className = 'upload-status error'; }
      }
    }
    finishExecution(successCount, 'アップロード');
  }

  async function executeEdits() {
    let successCount = 0;
    for (const item of [...editorQueue]) {
      const sbStatus = document.getElementById(`sb-status-${item.id}`);
      if (sbStatus) { sbStatus.innerText = '保存中'; sbStatus.className = 'upload-status processing'; }

      try {
        if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
        const diffKey = Config.keyFromCode(item.data.diff);
        const updateData = {
          title: item.data.title, level: item.data.level, diffKey,
          musicId: item.data.musicId,
          perfect: item.data.perfect, great: item.data.great,
          good: item.data.good, bad: item.data.bad, miss: item.data.missDetail,
          combo: item.data.combo,
          existingExt: item.data.existingExt,
        };
        await DriveStorage.updateResult(item.originalId, updateData);

        editorQueue = editorQueue.filter((q) => q.id !== item.id);
        const sbEl = document.getElementById(`sb-${item.id}`);
        if (sbEl) sbEl.remove();
        successCount++;
      } catch (e) {
        console.error(e);
        if (sbStatus) { sbStatus.innerText = '失敗'; sbStatus.className = 'upload-status error'; }
      }
    }
    finishExecution(successCount, '更新');
  }

  function finishExecution(count, actionName) {
    if (editorQueue.length === 0) {
      alert(`${actionName}完了 (${count}件)`);
      closeBatchModal();
      AppState.selectedIds.clear();
      GalleryUI.updateSelectionUI();
      Main.refreshData();
    } else {
      alert(`${count}件 ${actionName}成功。エラー分を確認してください。`);
      checkBatchButton();
    }
  }

  return {
    init: _initDropZone,
    openBatchModal, closeBatchModal,
    handleFiles, batchEdit,
    renderSidebarItem, selectItem, updateCurrentItem, onDeviceChange,
    updateSidebarStatus, removeBatchItem, checkBatchButton,
    runBatchAnalysis, reanalyzeCurrentItem, analyzeAllInBatch,
    handleBatchExecution,
  };
})();
