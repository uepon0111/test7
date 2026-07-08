
(() => {
  const { util, config } = window.PRSK;
  const storage = window.PRSK.storage;
  const drive = window.PRSK.drive;
  const ocr = window.PRSK.ocr;

  const state = {
    authReady: false,
    loggedIn: false,
    dbReady: false,
    recordsLoaded: false,
    loadingToken: 0,
    viewToken: 0,
    profiles: storage.loadProfiles(),
    prefs: storage.loadPrefs(),
    manifestCache: storage.loadManifestCache(),
    selectedProfileKey: storage.getSelectedProfileKey() || 'default',
    allRecords: [],
    filteredRecords: [],
    selectedIds: new Set(),
    isSelectMode: false,
    editorQueue: [],
    currentMode: 'upload',
    activeItemId: null,
    currentSettingsProfileKey: storage.getSelectedProfileKey() || 'default',
    currentRegion: 'title',
    pendingProfileImage: '',
    pendingProfileSize: { w: 0, h: 0 },
    lastViewArgs: null,
    toastTimer: null,
    sortDirection: 'desc',
    batchWorker: null,
  };

  const $ = (id) => document.getElementById(id);
  const waitFrame = () => new Promise(r => requestAnimationFrame(r));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function toast(title, message) {
    const stack = $('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = title ? `<strong>${util.escapeHtml(title)}</strong>${util.escapeHtml(message || '')}` : util.escapeHtml(message || '');
    stack.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 280);
    }, 2600);
  }

  function setLoader(visible, text = '') {
    const loader = $('loader');
    if (!loader) return;
    loader.style.display = visible ? 'flex' : 'none';
    if (text && $('loader-text')) $('loader-text').innerText = text;
  }

  function setViewProgress(visible, pct = 0, label = '') {
    const wrap = $('view-progress-wrap');
    const bar = $('view-progress-bar');
    const lab = $('view-progress-label');
    if (!wrap || !bar || !lab) return;
    wrap.style.display = visible ? 'block' : 'none';
    lab.style.display = visible ? 'block' : 'none';
    if (visible) {
      bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      lab.innerText = label || `${Math.round(pct)}%`;
    }
  }

  async function loadDb() {
    if (state.dbReady) return;
    try {
      const [musicsResp, diffsResp] = await Promise.all([
        fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
        fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json')
      ]);
      state.dbMusics = await musicsResp.json();
      state.dbDiffs = await diffsResp.json();
    } catch (e) {
      console.error('DB Error', e);
      state.dbMusics = [];
      state.dbDiffs = [];
    }
    state.dbReady = true;
  }

  function findBestMatchMusic(ocrText) {
    const musics = state.dbMusics || [];
    if (!musics.length) return null;
    const target = util.normalizeString(ocrText);
    if (!target) return null;
    let best = null;
    let minScore = Infinity;
    for (const music of musics) {
      const titleNorm = util.normalizeString(music.title);
      const dist = util.levenshtein(target, titleNorm);
      const score = dist / Math.max(target.length, titleNorm.length, 1);
      if (score < minScore) {
        minScore = score;
        best = music;
      }
    }
    return best;
  }

  function getLevelFromDb(musicId, diffRaw) {
    if (!musicId || !state.dbDiffs?.length) return '';
    const row = state.dbDiffs.find(d => String(d.music_id) === String(musicId) && String(d.difficulty).toUpperCase() === String(diffRaw).toUpperCase());
    return row?.level || row?.play_level || row?.difficulty_level || '';
  }

  function profileForKey(key) {
    return state.profiles[key] || state.profiles.default || storage.createDefaultProfile('default');
  }

  function renderProfileOptions() {
    const selects = ['up-device', 'settings-profile-select'];
    selects.forEach(id => {
      const el = $(id);
      if (!el) return;
      const activeItem = currentItem();
      const cur = id === 'up-device'
        ? (activeItem?.data?.deviceKey || el.value || state.selectedProfileKey)
        : (el.value || state.selectedProfileKey);
      el.innerHTML = Object.values(state.profiles).map(p => `<option value="${util.escapeHtml(p.key)}">${util.escapeHtml(p.name || p.key)}</option>`).join('');
      el.value = state.profiles[cur] ? cur : (state.selectedProfileKey || 'default');
    });
  }

  function renderDifficultyOptions() {
    const values = Object.values(config.diffMeta);
    const full = values.map(meta => `<option value="${meta.raw}">${meta.raw}</option>`).join('');
    const filterDiff = $('filter-diff');
    const batchDiff = $('up-diff');
    if (filterDiff) {
      filterDiff.innerHTML = `<option value="all">すべて</option>` + full;
    }
    if (batchDiff) {
      batchDiff.innerHTML = full;
    }
  }

  function renderSortUI() {
    const sortSelect = $('sort-order');
    if (!sortSelect) return;
    sortSelect.innerHTML = `
      <option value="title">名前順</option>
      <option value="level">楽曲レベル順</option>
      <option value="miss">ミス数順</option>
      <option value="date">追加日順</option>
    `;
    sortSelect.value = state.prefs.sortMode || 'level';
    const btn = $('sort-dir-btn');
    if (btn) btn.innerHTML = state.sortDirection === 'asc' ? '<span class="material-symbols-outlined">south</span> 昇順' : '<span class="material-symbols-outlined">north</span> 降順';
    if (sortSelect.value === 'date' && btn) {
      btn.disabled = true;
      btn.style.opacity = .55;
    } else if (btn) {
      btn.disabled = false;
      btn.style.opacity = 1;
    }
  }

  function setAuthUI(isLoggedIn) {
    state.loggedIn = isLoggedIn;
    const uploadBtn = $('upload_button');
    const authBtn = $('authorize_button');
    const signoutBtn = $('signout_button');
    const authStatus = $('auth-status');
    if (uploadBtn) uploadBtn.style.display = isLoggedIn ? 'inline-flex' : 'none';
    if (authBtn) authBtn.style.display = isLoggedIn ? 'none' : 'inline-flex';
    if (signoutBtn) signoutBtn.style.display = isLoggedIn ? 'inline-flex' : 'none';
    if (authStatus) authStatus.innerText = isLoggedIn ? 'ログイン済み' : '未ログイン';
  }

  async function onApisReady() {
    state.authReady = true;
    setAuthUI(Boolean(gapi?.client?.getToken?.()));
    renderDifficultyOptions();
    renderSortUI();
    renderProfileOptions();
    bindEvents();
    await loadDb();
    await loadInitialData();
  }

  async function onAuthChanged(loggedIn) {
    setAuthUI(loggedIn);
    if (loggedIn) {
      await loadInitialData();
    } else {
      state.allRecords = [];
      state.filteredRecords = [];
      $('grid').innerHTML = '';
      $('result-count').innerText = 'ログアウトしました';
      $('loader').style.display = 'none';
      updateSelectionUI();
    }
  }

  async function loadInitialData() {
    if (!state.loggedIn) return;
    const token = ++state.loadingToken;
    setLoader(true, 'データを読み込み中...');
    try {
      $('loader-text').innerText = 'Driveの記録を取得中...';
      const records = await drive.loadRecords();
      if (token !== state.loadingToken) return;
      state.allRecords = records.map(normalizeRecord);
      storage.saveManifestCache(state.allRecords);
      state.recordsLoaded = true;
      await updateView();
    } catch (e) {
      console.error(e);
      toast('読み込み失敗', 'Driveからデータを取得できませんでした');
    } finally {
      if (token === state.loadingToken) setLoader(false);
    }
  }

  function normalizeRecord(r) {
    return {
      id: r.id,
      fileId: r.fileId || r.id,
      title: r.title || '',
      level: Number(r.level || 0),
      difficultyRaw: (r.difficultyRaw || 'EXPERT').toUpperCase(),
      perfect: Number(r.perfect || 0),
      great: Number(r.great || 0),
      missCount: Number(r.missCount ?? r.totalMiss ?? 0),
      totalMiss: Number(r.totalMiss ?? r.missCount ?? 0),
      combo: Number(r.combo || 0),
      deviceKey: r.deviceKey || 'default',
      thumbnail: r.thumbnail || '',
      addedAt: r.addedAt || Date.now(),
      source: r.source || 'new',
      isFC: Number(r.missCount ?? r.totalMiss ?? 0) === 0,
    };
  }

  function getCurrentProfile() {
    return profileForKey(state.selectedProfileKey);
  }

  async function detectProfileKeyFromImageSize(file) {
    const img = await loadImageFromFile(file);
    return storage.chooseProfileKey(state.profiles, img.naturalWidth, img.naturalHeight);
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  function getDisplayDifficulty(raw) {
    return config.diffMeta[raw]?.raw || raw || '';
  }

  function bestRecordMap(records) {
    const map = new Map();
    for (const rec of records) {
      const key = util.makeRecordKey(rec);
      const cur = map.get(key);
      if (!cur || util.isBetterRecord(rec, cur)) map.set(key, rec);
    }
    return map;
  }

  async function updateView() {
    if (!state.allRecords) return;
    renderSortUI();
    const token = ++state.viewToken;
    const sortMode = $('sort-order')?.value || state.prefs.sortMode || 'level';
    state.prefs.sortMode = sortMode;
    storage.savePrefs(state.prefs);

    const filterFc = $('filter-fc')?.value || 'all';
    const missMin = $('filter-miss-min')?.value;
    const missMax = $('filter-miss-max')?.value;
    const filterDiff = $('filter-diff')?.value || 'all';
    const filterLevel = $('filter-level')?.value;
    const filterTitle = ($('filter-title')?.value || '').trim().toLowerCase();
    const onlyBest = $('filter-best')?.checked || false;

    setViewProgress(true, 5, '読み込み中...');
    const bestMap = onlyBest ? bestRecordMap(state.allRecords) : null;
    const filtered = [];
    const source = state.allRecords;
    const chunk = Math.max(250, Math.floor(source.length / 10) || 250);

    for (let i = 0; i < source.length; i += chunk) {
      if (token !== state.viewToken) return;
      const slice = source.slice(i, i + chunk);
      for (const r of slice) {
        const miss = Number(r.totalMiss ?? r.missCount ?? 0);
        if (onlyBest && bestMap.get(util.makeRecordKey(r)) !== r) continue;
        if (filterFc === 'fc' && !r.isFC) continue;
        if (filterFc === 'unfc' && r.isFC) continue;
        if (!r.isFC) {
          if (missMin !== '' && miss < Number(missMin)) continue;
          if (missMax !== '' && miss > Number(missMax)) continue;
        } else if (missMin !== '' && Number(missMin) > 0) {
          continue;
        }
        if (filterDiff !== 'all' && String(r.difficultyRaw).toUpperCase() !== String(filterDiff).toUpperCase()) continue;
        if (filterLevel && String(r.level) !== String(filterLevel)) continue;
        if (filterTitle && !String(r.title || '').toLowerCase().includes(filterTitle)) continue;
        filtered.push(r);
      }
      setViewProgress(true, 8 + (i / source.length) * 72, `絞り込み中... ${Math.min(source.length, i + chunk)} / ${source.length}`);
      await waitFrame();
    }

    const dir = state.sortDirection || 'desc';
    filtered.sort((a, b) => util.compareRecords(a, b, sortMode, dir));
    if (sortMode === 'date') {
      filtered.sort((a, b) => util.compareRecords(a, b, 'date', 'desc'));
    }

    state.filteredRecords = filtered;
    renderGrid(filtered);
    updateSelectionUI();
    setViewProgress(true, 100, `${filtered.length}件`);
    await sleep(80);
    if (token !== state.viewToken) return;
    setViewProgress(false, 0, '');
    $('result-count').innerText = `表示: ${filtered.length} 件`;
  }

  function renderGrid(records) {
    const grid = $('grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!records.length) {
      grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
      return;
    }

    const bestMap = bestRecordMap(state.allRecords);
    for (const rec of records) {
      const thumb = rec.thumbnail ? String(rec.thumbnail).replace('=s220', '=w600') : '';
      const large = rec.thumbnail ? String(rec.thumbnail).replace('=s220', '=w1600') : '';
      const isBest = bestMap.get(util.makeRecordKey(rec)) === rec;
      const missVal = Number(rec.totalMiss ?? rec.missCount ?? 0);
      const stats = `
        <div class="record-stats">
          <span class="record-stat"><b>P</b> ${Number(rec.perfect || 0)}</span>
          <span class="record-stat"><b>G</b> ${Number(rec.great || 0)}</span>
          <span class="record-stat"><b>C</b> ${Number(rec.combo || 0)}</span>
        </div>
      `;
      const missDisplay = rec.isFC
        ? `<span class="miss-val zero">FC-0</span>`
        : `FC -<span class="miss-val">${missVal}</span>`;
      const badge = rec.isFC ? `<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>` : '';
      const bestBadge = isBest ? `<div style="position:absolute; top:12px; left:12px;" class="best-badge"><span class="material-symbols-outlined" style="font-size:1rem;">workspace_premium</span> 自己ベスト</div>` : '';
      const isSel = state.selectedIds.has(rec.id) ? 'selected' : '';
      let clickAction = '';
      let overlayActions = '';

      if (state.isSelectMode) {
        clickAction = `window.PRSK.app.toggleSelection('${rec.id}')`;
      } else {
        clickAction = `window.PRSK.app.openImageModal('${large || ''}')`;
        overlayActions = `
          <div class="card-overlay-actions">
            <div class="btn-overlay" onclick="event.stopPropagation(); window.PRSK.app.individualEdit('${rec.id}')" title="編集"><span class="material-symbols-outlined">edit</span></div>
            <div class="btn-overlay del" onclick="event.stopPropagation(); window.PRSK.app.individualDelete('${rec.id}')" title="削除"><span class="material-symbols-outlined">delete</span></div>
          </div>
        `;
      }

      grid.insertAdjacentHTML('beforeend', `
        <div class="card ${rec.isFC ? 'is-fc' : ''} ${isSel} ${state.isSelectMode ? 'select-mode-active' : ''}" id="card-${rec.id}" onclick="${clickAction}">
          <div class="card-img-container">
            ${badge}
            ${bestBadge}
            ${overlayActions}
            <div class="img-loader-spinner"></div>
            ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" onload="this.style.opacity=1; this.previousElementSibling.style.display='none';">` : '<span style="color:#aaa;">NO IMAGE</span>'}
          </div>
          <div class="card-body">
            <div class="song-meta">
              <span class="tag lvl">Lv.${rec.level || '-'}</span>
              <span class="tag ${util.difficultyClass(rec.difficultyRaw)}">${getDisplayDifficulty(rec.difficultyRaw)}</span>
            </div>
            <div class="song-title">${util.escapeHtml(rec.title)}</div>
            <div class="score-info">
              <span style="display:flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result</span>
              ${missDisplay}
            </div>
            ${stats}
          </div>
        </div>
      `);
    }
  }

  function openImageModal(src) {
    if (!src) return;
    const modal = $('imageModal');
    const img = $('modalImg');
    if (modal && img) {
      modal.style.display = 'flex';
      img.src = src;
    }
  }

  function closeImageModal() {
    const modal = $('imageModal');
    if (modal) modal.style.display = 'none';
  }

  function openBatchModal(mode = 'upload') {
    state.currentMode = mode;
    const modal = $('batchModal');
    if (!modal) return;
    modal.style.display = 'flex';
    state.editorQueue = [];
    state.activeItemId = null;
    $('batch-sidebar-list').innerHTML = '';
    $('batch-editor-container').style.display = 'none';
    $('batch-empty-msg').style.display = 'block';
    $('batch-status-msg').innerText = '待機中...';
    $('btn-exec-batch').disabled = true;

    if (mode === 'upload') {
      $('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
      $('upload-initial').style.display = 'flex';
      $('batch-workspace').style.display = 'none';
      $('up-file').value = '';
      $('btn-exec-batch').innerText = '全てアップロード';
    } else {
      $('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
      $('upload-initial').style.display = 'none';
      $('batch-workspace').style.display = 'flex';
      $('btn-exec-batch').innerText = '保存して反映';
    }
    renderProfileOptions();
  }

  function closeBatchModal() {
    $('batchModal').style.display = 'none';
    state.editorQueue.forEach(item => {
      if (item.imgUrl && item.imgUrl.startsWith('blob:')) URL.revokeObjectURL(item.imgUrl);
    });
    state.editorQueue = [];
    state.activeItemId = null;
  }

  function renderSidebarItem(itemId) {
    const item = state.editorQueue.find(i => i.id === itemId);
    if (!item) return;
    const list = $('batch-sidebar-list');
    const deviceLabel = profileForKey(item.data.deviceKey || state.selectedProfileKey).name || item.data.deviceKey;
    const statusClass = item.status === 'done' ? 'done' : item.status === 'error' ? 'error' : item.status === 'processing' ? 'processing' : 'pending';
    const statusText = item.status === 'done' ? '完了' : item.status === 'error' ? 'ERR' : item.status === 'processing' ? '解析中' : '待機';
    const existing = $(`sb-${itemId}`);
    const html = `
      <div class="sidebar-item ${state.activeItemId === itemId ? 'active' : ''}" id="sb-${itemId}" onclick="window.PRSK.app.selectItem('${itemId}')">
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <div id="sb-title-${itemId}" style="font-weight:700; font-size:0.95rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${util.escapeHtml(item.data.title || '未解析')}</div>
          <span id="sb-status-${itemId}" class="upload-status ${statusClass}">${statusText}</span>
        </div>
        <div style="font-size:0.8rem; color:#666; margin-top:4px;">${util.escapeHtml(deviceLabel)} / ${util.escapeHtml(getDisplayDifficulty(item.data.diffRaw || 'EXPERT'))}</div>
      </div>
    `;
    if (existing) existing.outerHTML = html;
    else list.insertAdjacentHTML('beforeend', html);
  }

  function updateSidebarStatus(itemId) {
    const item = state.editorQueue.find(i => i.id === itemId);
    if (!item) return;
    const el = $(`sb-status-${itemId}`);
    if (el) {
      const cls = item.status === 'done' ? 'done' : item.status === 'error' ? 'error' : item.status === 'processing' ? 'processing' : 'pending';
      el.className = `upload-status ${cls}`;
      el.innerText = item.status === 'done' ? '完了' : item.status === 'error' ? 'ERR' : item.status === 'processing' ? '解析中' : '待機';
    }
    const titleEl = $(`sb-title-${itemId}`);
    if (titleEl) titleEl.innerText = item.data.title || '未解析';
  }

  function selectItem(itemId) {
    const item = state.editorQueue.find(i => i.id === itemId);
    if (!item) return;
    state.activeItemId = itemId;
    $('batch-editor-container').style.display = 'flex';
    $('batch-empty-msg').style.display = 'none';
    state.editorQueue.forEach(q => {
      const sb = $(`sb-${q.id}`);
      if (sb) sb.classList.toggle('active', q.id === itemId);
    });
    const img = $('batch-preview-img');
    img.src = item.imgUrl || '';
    $('up-title').value = item.data.title || '';
    $('up-level').value = item.data.level || '';
    $('up-diff').value = item.data.diffRaw || 'EXPERT';
    $('up-perfect').value = Number(item.data.perfect || 0);
    $('up-great').value = Number(item.data.great || 0);
    $('up-miss-detail').value = Number(item.data.missCount || 0);
    $('up-combo').value = Number(item.data.combo || 0);
    $('up-total-miss').innerText = Number(item.data.missCount || 0);
    $('up-device').value = item.data.deviceKey || state.selectedProfileKey || 'default';
    renderProfileOptions();
    checkBatchButton();
  }

  function currentItem() {
    return state.editorQueue.find(i => i.id === state.activeItemId) || null;
  }

  function updateCurrentItem(field, value) {
    const item = currentItem();
    if (!item) return;
    if (['title', 'level', 'diffRaw', 'deviceKey'].includes(field)) item.data[field] = value;
    else if (field === 'perfect') item.data.perfect = Number(value || 0);
    else if (field === 'great') item.data.great = Number(value || 0);
    else if (field === 'missCount' || field === 'totalMiss') {
      item.data.missCount = Number(value || 0);
      item.data.totalMiss = item.data.missCount;
    } else if (field === 'combo') item.data.combo = Number(value || 0);
    if (field === 'diffRaw' && !item.data.level) {
      // keep level as manual entry
    }
    item.data.totalMiss = Number(item.data.missCount || 0);
    updateSidebarStatus(item.id);
    $('up-total-miss').innerText = item.data.totalMiss;
    checkBatchButton();
  }

  async function analyzeLoadedItem(item) {
    const profile = profileForKey(item.data.deviceKey || state.selectedProfileKey);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = item.imgUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    if (!state.batchWorker) state.batchWorker = await ocr.createWorkerInstance();
    const res = await ocr.analyzeLoadedImage(img, state.batchWorker, profile);
    if (!res) throw new Error('OCR failed');
    item.data.title = res.title || item.data.title;
    item.data.level = res.level || item.data.level;
    item.data.diffRaw = res.diffRaw || item.data.diffRaw;
    item.data.perfect = Number(res.perfect || 0);
    item.data.great = Number(res.great || 0);
    item.data.missCount = Number(res.totalMiss || 0);
    item.data.totalMiss = Number(res.totalMiss || 0);
    item.data.combo = Number(res.combo || 0);
    item.data.musicId = res.musicId || null;
    item.status = 'done';
    renderSidebarItem(item.id);
    updateSidebarStatus(item.id);
    if (state.activeItemId === item.id) selectItem(item.id);
    return res;
  }

  async function runBatchAnalysis(itemsToAnalyze) {
    if (!itemsToAnalyze.length) return;
    $('batch-status-msg').innerText = '解析中...';
    for (const item of itemsToAnalyze) {
      item.status = 'processing';
      updateSidebarStatus(item.id);
      try {
        const res = await analyzeLoadedItem(item);
        if (res) {
          toast('解析完了', `${res.title || '画像'} を読み取りました`);
        }
      } catch (e) {
        console.error(e);
        item.status = 'error';
        updateSidebarStatus(item.id);
      }
    }
    $('batch-status-msg').innerText = '処理完了';
    checkBatchButton();
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    $('upload-initial').style.display = 'none';
    $('batch-workspace').style.display = 'flex';
    $('batch-status-msg').innerText = '画像を処理中...';
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const deviceKey = await detectProfileKeyFromImageSize(file).catch(() => state.selectedProfileKey || 'default');
      const qId = `new_${Date.now()}_${i}`;
      const imgUrl = URL.createObjectURL(file);
      state.editorQueue.push({
        id: qId,
        file,
        imgUrl,
        status: 'pending',
        data: { title: '', level: '', diffRaw: 'EXPERT', perfect: 0, great: 0, missCount: 0, totalMiss: 0, combo: 0, deviceKey, musicId: null },
        originalId: null,
      });
      renderSidebarItem(qId);
    }
    await runBatchAnalysis(state.editorQueue.filter(i => i.status === 'pending'));
    if (!state.activeItemId && state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
    checkBatchButton();
  }

  async function batchEdit() {
    if (!state.selectedIds.size) return;
    openBatchModal('edit');
    const targets = state.allRecords.filter(r => state.selectedIds.has(r.id));
    $('batch-status-msg').innerText = '編集データを準備中...';
    for (const rec of targets) {
      const qId = `edit_${rec.id}`;
      const highResUrl = rec.thumbnail ? String(rec.thumbnail).replace('=s220', '=w1600') : '';
      state.editorQueue.push({
        id: qId,
        file: null,
        imgUrl: highResUrl,
        status: 'existing',
        data: {
          title: rec.title,
          level: rec.level,
          diffRaw: rec.difficultyRaw,
          perfect: rec.perfect || 0,
          great: rec.great || 0,
          missCount: rec.missCount || rec.totalMiss || 0,
          totalMiss: rec.totalMiss || rec.missCount || 0,
          combo: rec.combo || 0,
          deviceKey: rec.deviceKey || 'default',
          musicId: null
        },
        originalId: rec.id,
        originalParent: rec.parentId || null,
      });
      renderSidebarItem(qId);
    }
    if (state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
    checkBatchButton();
    $('batch-status-msg').innerText = '編集準備完了';
  }

  function checkBatchButton() {
    $('btn-exec-batch').disabled = !state.editorQueue.length;
    $('btn-exec-batch').style.opacity = state.editorQueue.length ? '1' : '.6';
  }

  function buildRecordFromItem(item, uploadedFileMeta = null) {
    const deviceKey = item.data.deviceKey || state.selectedProfileKey || 'default';
    const rec = {
      id: uploadedFileMeta?.id || item.originalId || `tmp_${Date.now()}`,
      fileId: uploadedFileMeta?.id || item.originalId || item.id,
      title: item.data.title || '',
      level: Number(item.data.level || 0),
      difficultyRaw: String(item.data.diffRaw || 'EXPERT').toUpperCase(),
      perfect: Number(item.data.perfect || 0),
      great: Number(item.data.great || 0),
      missCount: Number(item.data.missCount || item.data.totalMiss || 0),
      totalMiss: Number(item.data.totalMiss ?? item.data.missCount ?? 0),
      combo: Number(item.data.combo || 0),
      deviceKey,
      thumbnail: item.imgUrl || '',
      addedAt: item.addedAt || Date.now(),
      source: uploadedFileMeta ? 'new' : (item.source || 'new'),
      isFC: Number(item.data.missCount || item.data.totalMiss || 0) === 0
    };
    return rec;
  }

  async function handleBatchExecution() {
    if (state.currentMode === 'upload') {
      await executeUploads();
    } else {
      await executeEdits();
    }
  }

  async function executeUploads() {
    const success = [];
    let successCount = 0;
    for (const item of [...state.editorQueue]) {
      const sbStatus = $(`sb-status-${item.id}`);
      if (sbStatus) { sbStatus.innerText = '送信中'; sbStatus.className = 'upload-status processing'; }
      try {
        if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
        const newName = `${util.buildDriveFileName(item.data)}.png`;
        const created = await drive.saveRecordFile(item.data, item.file);
        const rec = buildRecordFromItem(item, created);
        rec.fileId = created.id;
        rec.id = created.id;
        rec.addedAt = Date.now();
        rec.thumbnail = await drive.refreshThumbnail(created.id) || item.imgUrl || rec.thumbnail;
        rec.isFC = rec.missCount === 0;
        if (created?.name) {
          // rename to metadata-rich file name after upload
          await drive.updateFileName(created.id, newName);
        }
        const existingBest = state.allRecords.filter(r => util.makeRecordKey(r) === util.makeRecordKey(rec));
        const isBestNow = !existingBest.length || util.isBetterRecord(rec, existingBest.reduce((best, cur) => util.isBetterRecord(cur, best) ? cur : best, existingBest[0]));
        if (isBestNow && existingBest.length) {
          toast('自己ベスト更新', `${rec.title} / ${getDisplayDifficulty(rec.difficultyRaw)} を更新しました`);
        } else if (!existingBest.length) {
          toast('自己ベスト更新', `${rec.title} / ${getDisplayDifficulty(rec.difficultyRaw)} を新規登録しました`);
        }
        success.push(rec);
        successCount++;
        state.editorQueue = state.editorQueue.filter(q => q.id !== item.id);
      } catch (e) {
        console.error(e);
        if (sbStatus) { sbStatus.innerText = '失敗'; sbStatus.className = 'upload-status error'; }
      }
    }
    if (success.length) {
      state.allRecords = [...state.allRecords, ...success];
      await drive.syncManifest(state.allRecords);
      storage.saveManifestCache(state.allRecords);
      await updateView();
    }
    finishExecution(successCount, 'アップロード');
  }

  async function executeEdits() {
    let successCount = 0;
    const updatedRecords = [];
    for (const item of [...state.editorQueue]) {
      const sbStatus = $(`sb-status-${item.id}`);
      if (sbStatus) { sbStatus.innerText = '保存中'; sbStatus.className = 'upload-status processing'; }
      try {
        const targetId = item.originalId;
        if (!targetId) throw new Error('対象IDなし');
        const newName = `${util.buildDriveFileName(item.data)}.png`;
        await drive.updateFileName(targetId, newName);
        const idx = state.allRecords.findIndex(r => r.id === targetId || r.fileId === targetId);
        if (idx >= 0) {
          state.allRecords[idx] = normalizeRecord({
            ...state.allRecords[idx],
            ...buildRecordFromItem(item),
            id: targetId,
            fileId: targetId,
          });
          updatedRecords.push(state.allRecords[idx]);
        }
        successCount++;
      } catch (e) {
        console.error(e);
        if (sbStatus) { sbStatus.innerText = '失敗'; sbStatus.className = 'upload-status error'; }
      }
    }
    if (updatedRecords.length) {
      await drive.syncManifest(state.allRecords);
      storage.saveManifestCache(state.allRecords);
      await updateView();
    }
    finishExecution(successCount, '編集');
  }

  function finishExecution(count, label) {
    $('batch-status-msg').innerText = `${label}完了: ${count}件`;
    toast(label, `${count}件の処理が完了しました`);
    setTimeout(() => closeBatchModal(), 500);
    loadInitialData();
  }

  function toggleSelectMode() {
    state.isSelectMode = !state.isSelectMode;
    $('btn-select-mode').classList.toggle('active', state.isSelectMode);
    $('btn-select-mode').innerHTML = state.isSelectMode
      ? '<span class="material-symbols-outlined">check_box</span> 選択中'
      : '<span class="material-symbols-outlined">check_box</span> 選択モード';
    if (!state.isSelectMode) state.selectedIds.clear();
    updateSelectionUI();
    renderGrid(state.filteredRecords);
  }

  function toggleSelection(id) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    updateSelectionUI();
    renderGrid(state.filteredRecords);
  }

  function updateSelectionUI() {
    const count = state.selectedIds.size;
    $('selected-count').innerText = String(count);
    $('batch-actions').style.display = count ? 'flex' : 'none';
  }

  function toggleSortDirection() {
    const sortMode = $('sort-order')?.value || 'level';
    if (sortMode === 'date') return;
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    state.prefs.sortDirection = state.sortDirection;
    storage.savePrefs(state.prefs);
    renderSortUI();
    updateView();
  }

  function selectSettingsRegion(region) {
    state.currentRegion = region;
    renderSettingsEditor();
  }

  function clearSelection() {
    state.selectedIds.clear();
    updateSelectionUI();
    renderGrid(state.filteredRecords);
  }

  async function individualEdit(id) {
    state.selectedIds = new Set([id]);
    await batchEdit();
  }

  async function individualDelete(id) {
    if (!confirm('この記録を削除しますか？')) return;
    try {
      await drive.deleteFile(id);
      state.allRecords = state.allRecords.filter(r => r.id !== id && r.fileId !== id);
      await drive.syncManifest(state.allRecords);
      storage.saveManifestCache(state.allRecords);
      await updateView();
      toast('削除', '削除しました');
    } catch (e) {
      console.error(e);
      toast('削除失敗', 'Driveから削除できませんでした');
    }
  }

  async function batchDelete() {
    if (!state.selectedIds.size) return;
    if (!confirm(`選択した ${state.selectedIds.size} 件を削除しますか？`)) return;
    const ids = [...state.selectedIds];
    try {
      for (const id of ids) await drive.deleteFile(id);
      state.allRecords = state.allRecords.filter(r => !state.selectedIds.has(r.id));
      state.selectedIds.clear();
      updateSelectionUI();
      await drive.syncManifest(state.allRecords);
      storage.saveManifestCache(state.allRecords);
      await updateView();
      toast('削除', '選択項目を削除しました');
    } catch (e) {
      console.error(e);
      toast('削除失敗', '一部削除に失敗しました');
    }
  }

  function reanalyzeCurrentItem() {
    const item = currentItem();
    if (!item) return;
    item.status = 'pending';
    item.data.deviceKey = $('up-device').value || item.data.deviceKey || 'default';
    runBatchAnalysis([item]);
  }

  function openSettingsModal() {
    $('settingsModal').style.display = 'flex';
    renderSettingsProfileList();
    renderSettingsEditor();
  }

  function closeSettingsModal() {
    $('settingsModal').style.display = 'none';
    state.pendingProfileImage = '';
  }

  function renderSettingsProfileList() {
    const list = $('settings-profile-list');
    if (!list) return;
    list.innerHTML = '';
    Object.values(state.profiles).forEach(p => {
      const active = p.key === state.currentSettingsProfileKey ? 'active' : '';
      list.insertAdjacentHTML('beforeend', `
        <div class="profile-item ${active}" onclick="window.PRSK.app.selectSettingsProfile('${p.key}')">
          <div>
            <div style="font-weight:700;">${util.escapeHtml(p.name || p.key)}</div>
            <div style="font-size:12px;color:#64748b;">${p.sampleWidth && p.sampleHeight ? `${p.sampleWidth}×${p.sampleHeight}` : '未設定'}</div>
          </div>
          <span class="material-symbols-outlined">chevron_right</span>
        </div>
      `);
    });
  }

  function selectSettingsProfile(key) {
    if (!state.profiles[key]) return;
    state.currentSettingsProfileKey = key;
    state.selectedProfileKey = key;
    storage.setSelectedProfileKey(key);
    renderSettingsProfileList();
    renderSettingsEditor();
    renderProfileOptions();
  }

  function renderSettingsEditor() {
    const profile = profileForKey(state.currentSettingsProfileKey);
    $('settings-profile-name').value = profile.name || '';
    $('settings-sample-input').value = '';
    $('settings-profile-key').innerText = profile.key;
    $('settings-preview-img').src = profile.samplePreview || '';
    renderRegionInputs(profile);
    drawRegionBoxes(profile);
  }

  function renderRegionInputs(profile) {
    const region = profile.regions[state.currentRegion] || storage.createDefaultProfile().regions.title;
    $('settings-region-x').value = region.x.toFixed(2);
    $('settings-region-y').value = region.y.toFixed(2);
    $('settings-region-w').value = region.w.toFixed(2);
    $('settings-region-h').value = region.h.toFixed(2);
    $('settings-region-label').innerText = state.currentRegion.toUpperCase();
    document.querySelectorAll('.region-chip').forEach(el => el.classList.toggle('active', el.dataset.region === state.currentRegion));
  }

  function drawRegionBoxes(profile) {
    const wrap = $('settings-overlay');
    if (!wrap) return;
    wrap.innerHTML = '';
    const regions = profile.regions || storage.createDefaultProfile().regions;
    for (const [name, region] of Object.entries(regions)) {
      const box = document.createElement('div');
      box.className = `region-box ${name === state.currentRegion ? 'active' : ''}`;
      box.dataset.region = name;
      box.style.left = `${region.x}%`;
      box.style.top = `${region.y}%`;
      box.style.width = `${region.w}%`;
      box.style.height = `${region.h}%`;
      box.innerHTML = `<div class="region-label">${name.toUpperCase()}</div><div class="handle"></div>`;
      box.addEventListener('pointerdown', onRegionPointerDown);
      wrap.appendChild(box);
    }
  }

  let dragState = null;

  function onRegionPointerDown(ev) {
    const box = ev.currentTarget;
    const region = box.dataset.region;
    state.currentRegion = region;
    renderRegionInputs(profileForKey(state.currentSettingsProfileKey));
    const rect = box.parentElement.getBoundingClientRect();
    dragState = {
      region,
      mode: ev.target.classList.contains('handle') ? 'resize' : 'move',
      startX: ev.clientX,
      startY: ev.clientY,
      rect,
      origin: { ...profileForKey(state.currentSettingsProfileKey).regions[region] },
    };
    box.setPointerCapture(ev.pointerId);
    window.addEventListener('pointermove', onRegionPointerMove);
    window.addEventListener('pointerup', onRegionPointerUp, { once: true });
  }

  function onRegionPointerMove(ev) {
    if (!dragState) return;
    const profile = profileForKey(state.currentSettingsProfileKey);
    const region = profile.regions[dragState.region];
    const rect = dragState.rect;
    const dx = (ev.clientX - dragState.startX) / rect.width * 100;
    const dy = (ev.clientY - dragState.startY) / rect.height * 100;
    if (dragState.mode === 'move') {
      region.x = util.clamp(dragState.origin.x + dx, 0, 100 - region.w);
      region.y = util.clamp(dragState.origin.y + dy, 0, 100 - region.h);
    } else {
      region.w = util.clamp(dragState.origin.w + dx, 1, 100 - dragState.origin.x);
      region.h = util.clamp(dragState.origin.h + dy, 1, 100 - dragState.origin.y);
    }
    state.profiles[profile.key] = storage.normalizeProfile(profile);
    storage.saveProfiles(state.profiles);
    renderSettingsEditor();
  }

  function onRegionPointerUp() {
    dragState = null;
    window.removeEventListener('pointermove', onRegionPointerMove);
  }

  function updateRegionFromInputs() {
    const profile = profileForKey(state.currentSettingsProfileKey);
    const region = profile.regions[state.currentRegion];
    region.x = util.clamp($('settings-region-x').value, 0, 100);
    region.y = util.clamp($('settings-region-y').value, 0, 100);
    region.w = util.clamp($('settings-region-w').value, 1, 100 - region.x);
    region.h = util.clamp($('settings-region-h').value, 1, 100 - region.y);
    state.profiles[profile.key] = storage.normalizeProfile(profile);
    storage.saveProfiles(state.profiles);
    renderSettingsEditor();
  }

  async function saveSettingsProfile() {
    const profile = profileForKey(state.currentSettingsProfileKey);
    profile.name = $('settings-profile-name').value.trim() || profile.key;
    state.profiles[profile.key] = storage.normalizeProfile(profile);
    storage.saveProfiles(state.profiles);
    renderProfileOptions();
    renderSettingsProfileList();
    toast('設定保存', '機種設定を保存しました');
  }

  async function handleSampleUpload(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImageFromDataUrl(dataUrl);
    const profile = profileForKey(state.currentSettingsProfileKey);
    profile.samplePreview = dataUrl;
    profile.sampleWidth = img.naturalWidth;
    profile.sampleHeight = img.naturalHeight;
    state.profiles[profile.key] = storage.normalizeProfile(profile);
    storage.saveProfiles(state.profiles);
    $('settings-preview-img').src = dataUrl;
    drawRegionBoxes(profile);
    renderSettingsProfileList();
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function addNewProfile() {
    const key = `profile_${Date.now()}`;
    const profile = storage.createDefaultProfile(key);
    profile.name = `機種 ${Object.keys(state.profiles).length + 1}`;
    state.profiles[key] = profile;
    storage.saveProfiles(state.profiles);
    state.currentSettingsProfileKey = key;
    state.selectedProfileKey = key;
    storage.setSelectedProfileKey(key);
    renderProfileOptions();
    renderSettingsProfileList();
    renderSettingsEditor();
  }

  function deleteCurrentProfile() {
    const key = state.currentSettingsProfileKey;
    if (key === 'default') return toast('削除不可', '標準設定は削除できません');
    if (!confirm('この機種設定を削除しますか？')) return;
    delete state.profiles[key];
    if (!state.profiles.default) state.profiles.default = storage.createDefaultProfile('default');
    state.currentSettingsProfileKey = 'default';
    state.selectedProfileKey = 'default';
    storage.setSelectedProfileKey('default');
    storage.saveProfiles(state.profiles);
    renderProfileOptions();
    renderSettingsProfileList();
    renderSettingsEditor();
  }

  function autoDetectProfileAndSet(file, selectEl) {
    loadImageFromFile(file).then(img => {
      const key = storage.chooseProfileKey(state.profiles, img.naturalWidth, img.naturalHeight);
      state.selectedProfileKey = key;
      storage.setSelectedProfileKey(key);
      if (selectEl) selectEl.value = key;
    }).catch(() => {});
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('up-file')?.addEventListener('change', (e) => handleFiles([...e.target.files || []]));
    $('settings-sample-input')?.addEventListener('change', handleSampleUpload);
    $('settings-region-x')?.addEventListener('input', updateRegionFromInputs);
    $('settings-region-y')?.addEventListener('input', updateRegionFromInputs);
    $('settings-region-w')?.addEventListener('input', updateRegionFromInputs);
    $('settings-region-h')?.addEventListener('input', updateRegionFromInputs);
    $('settings-profile-name')?.addEventListener('input', () => {
      const profile = profileForKey(state.currentSettingsProfileKey);
      profile.name = $('settings-profile-name').value;
      state.profiles[profile.key] = storage.normalizeProfile(profile);
      storage.saveProfiles(state.profiles);
      renderProfileOptions();
      renderSettingsProfileList();
    });

    $('sort-order')?.addEventListener('change', () => { renderSortUI(); updateView(); });
    $('sort-dir-btn')?.addEventListener('click', () => {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      renderSortUI();
      updateView();
    });
    ['filter-fc', 'filter-diff', 'filter-level', 'filter-title', 'filter-miss-min', 'filter-miss-max', 'filter-best']
      .forEach(id => $(id)?.addEventListener('input', updateView));
    $('up-title')?.addEventListener('input', e => updateCurrentItem('title', e.target.value));
    $('up-level')?.addEventListener('input', e => updateCurrentItem('level', e.target.value));
    $('up-diff')?.addEventListener('change', e => updateCurrentItem('diffRaw', e.target.value));
    $('up-perfect')?.addEventListener('input', e => updateCurrentItem('perfect', e.target.value));
    $('up-great')?.addEventListener('input', e => updateCurrentItem('great', e.target.value));
    $('up-miss-detail')?.addEventListener('input', e => updateCurrentItem('missCount', e.target.value));
    $('up-combo')?.addEventListener('input', e => updateCurrentItem('combo', e.target.value));
    $('up-device')?.addEventListener('change', e => updateCurrentItem('deviceKey', e.target.value));
    $('settings-region-x')?.addEventListener('change', updateRegionFromInputs);
    $('settings-region-y')?.addEventListener('change', updateRegionFromInputs);
    $('settings-region-w')?.addEventListener('change', updateRegionFromInputs);
    $('settings-region-h')?.addEventListener('change', updateRegionFromInputs);

    document.addEventListener('click', (e) => {
      if (e.target?.dataset?.closeModal === 'true') closeSettingsModal();
    });

    const dropZone = $('drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles([...e.dataTransfer.files || []]);
      });
    }

    const settingsDrop = $('settings-preview-wrap');
    if (settingsDrop) {
      settingsDrop.addEventListener('dragover', (e) => e.preventDefault());
    }

    const settingsProfileSelect = $('settings-profile-select');
    settingsProfileSelect?.addEventListener('change', (e) => selectSettingsProfile(e.target.value));
    $('settings-add-profile')?.addEventListener('click', addNewProfile);
    $('settings-delete-profile')?.addEventListener('click', deleteCurrentProfile);
    $('settings-save-profile')?.addEventListener('click', saveSettingsProfile);
    $('settings-close-btn')?.addEventListener('click', closeSettingsModal);
    $('settings-open-btn')?.addEventListener('click', openSettingsModal);

    // batch modal open/close
    $('batchModal')?.addEventListener('click', (e) => {
      if (e.target === $('batchModal')) closeBatchModal();
    });
    $('imageModal')?.addEventListener('click', (e) => {
      if (e.target === $('imageModal')) closeImageModal();
    });
  }

  function openSettingsFromButton() {
    openSettingsModal();
  }

  // Expose globals for inline handlers
  window.PRSK.app = {
    state,
    onApisReady,
    onAuthChanged,
    loadDb,
    findBestMatchMusic,
    getLevelFromDb,
    updateView,
    renderGrid,
    openImageModal,
    closeImageModal,
    openBatchModal,
    closeBatchModal,
    handleFiles,
    batchEdit,
    renderSidebarItem,
    selectItem,
    updateCurrentItem,
    updateSidebarStatus,
    runBatchAnalysis,
    reanalyzeCurrentItem,
    toggleSelectMode,
    toggleSelection,
    updateSelectionUI,
    clearSelection,
    toggleSortDirection,
    selectSettingsRegion,
    individualEdit,
    individualDelete,
    batchDelete,
    handleBatchExecution,
    executeUploads,
    executeEdits,
    finishExecution,
    loadInitialData,
    setAuthUI,
    openSettingsModal,
    closeSettingsModal,
    selectSettingsProfile,
    renderSettingsProfileList,
    renderSettingsEditor,
    updateRegionFromInputs,
    saveSettingsProfile,
    addNewProfile,
    deleteCurrentProfile,
    handleSampleUpload,
    autoDetectProfileAndSet,
    bindEvents,
  };

  window.gapiLoaded = drive.gapiLoaded;
  window.gisLoaded = drive.gisLoaded;
  window.handleAuthClick = drive.handleAuthClick;
  window.handleSignoutClick = drive.handleSignoutClick;
  window.openBatchModal = openBatchModal;
  window.closeBatchModal = closeBatchModal;
  window.analyzeAllInBatch = async () => {
    const items = state.editorQueue.filter(i => i.status === 'pending');
    await runBatchAnalysis(items);
  };
  window.reanalyzeCurrentItem = reanalyzeCurrentItem;
  window.updateCurrentItem = updateCurrentItem;
  window.toggleSelectMode = toggleSelectMode;
  window.toggleSelection = toggleSelection;
  window.clearSelection = clearSelection;
  window.toggleSortDirection = toggleSortDirection;
  window.selectSettingsRegion = selectSettingsRegion;
  window.batchDelete = batchDelete;
  window.batchEdit = batchEdit;
  window.individualEdit = individualEdit;
  window.individualDelete = individualDelete;
  window.handleBatchExecution = handleBatchExecution;
  window.selectItem = selectItem;
  window.openImageModal = openImageModal;
  window.closeImageModal = closeImageModal;
  window.closeSettingsModal = closeSettingsModal;
  window.openSettingsModal = openSettingsModal;
  window.selectSettingsProfile = selectSettingsProfile;

  async function bootstrap() {
    // set default UI states
    state.sortDirection = state.prefs.sortDirection || 'desc';
    state.currentRegion = 'title';
    renderSortUI();
    renderDifficultyOptions();
    renderProfileOptions();
    setAuthUI(false);

    // populate settings area placeholders if present
    if ($('settings-profile-select')) {
      $('settings-profile-select').innerHTML = '';
    }

    // load db even before auth
    await loadDb();
  }

  window.addEventListener('DOMContentLoaded', bootstrap);
})();
