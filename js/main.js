/**
 * main.js
 * ---------------------------------------------------------------------------
 * index.html（一覧画面）のブートストラップ処理。
 *   - 起動時の初期化（楽曲DB読み込み、Google API初期化）
 *   - Driveからのデータ取得（DriveStorage経由）と自己ベスト付与（BestScore経由）
 *   - 並び替え・絞り込みコントロールの制御（SortFilter経由）と結果描画（GalleryUI経由）
 *   - 絞り込み/並び替え実行中の視覚的なローディング表示
 * ---------------------------------------------------------------------------
 */
const Main = (() => {

  async function boot() {
    GoogleAuth.init({
      onSignedIn: refreshData,
      onSignedOut: () => {
        document.getElementById('result-count').innerText = 'ログアウトしました';
        document.getElementById('grid').innerHTML = '';
        AppState.allRecords = [];
        AppState.filteredRecords = [];
        AppState.selectedIds.clear();
        GalleryUI.updateSelectionUI();
      },
    });

    UploadBatchUI.init();

    try {
      await MusicDB.load();
    } catch (e) {
      console.error('MusicDB load failed', e);
    }
  }

  async function refreshData() {
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    loader.style.display = 'flex';
    loaderText.innerText = 'データを読み込み中...';
    document.getElementById('result-count').innerText = 'データ取得中...';

    try {
      const records = await DriveStorage.listAllResults();
      BestScore.annotateIsBest(records);
      AppState.allRecords = records;
      onDataLoaded();
    } catch (e) {
      console.error(e);
      loader.style.display = 'none';
      document.getElementById('result-count').innerText = 'データ取得に失敗しました';
    }
  }

  function onDataLoaded() {
    document.getElementById('loader').style.display = 'none';
    updateView();
  }

  // 並び替え方向トグル（昇順⇔降順）
  function toggleSortDir() {
    AppState.sortDir = AppState.sortDir === 'asc' ? 'desc' : 'asc';
    _syncSortDirIcon();
    updateView();
  }

  function _syncSortDirIcon() {
    const icon = document.getElementById('sort-dir-icon');
    const btn = document.getElementById('sort-dir-toggle');
    if (!icon) return;
    icon.textContent = AppState.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
    if (btn) btn.title = AppState.sortDir === 'asc' ? '昇順' : '降順';
  }

  function onSortFieldChange(value) {
    AppState.sortField = value;
    updateView();
  }

  /**
   * 絞り込み・並び替えを実行して描画する。
   * 処理自体は同期的で高速だが、体感的な「処理中」表示を一瞬入れたうえで
   * requestAnimationFrame により描画をブラウザの次フレームへ回し、
   * その後カード内の画像読み込み進捗（GalleryUI側）を表示する。
   * これにより並び替え・絞り込み操作のたびにロード状況が視覚的にわかるようにしている。
   */
  function updateView() {
    if (!AppState.allRecords) return;

    const resultCountEl = document.getElementById('result-count');
    resultCountEl.innerText = '絞り込み中...';

    const wrap = document.getElementById('load-progress-wrap');
    const bar = document.getElementById('load-progress-bar');
    const txt = document.getElementById('load-progress-text');
    if (wrap) {
      wrap.style.display = 'flex';
      bar.style.width = '0%';
      bar.classList.add('indeterminate');
      txt.innerText = '絞り込み処理中...';
    }

    requestAnimationFrame(() => {
      const opts = {
        fc: document.getElementById('filter-fc').value,
        missMin: document.getElementById('filter-miss-min').value,
        missMax: document.getElementById('filter-miss-max').value,
        diff: document.getElementById('filter-diff').value,
        level: document.getElementById('filter-level').value,
        title: document.getElementById('filter-title').value.trim().toLowerCase(),
        bestOnly: document.getElementById('filter-best-only').checked,
      };

      let list = SortFilter.filter(AppState.allRecords, opts);
      list = SortFilter.sort(list, AppState.sortField, AppState.sortDir);

      AppState.filteredRecords = list;
      if (bar) bar.classList.remove('indeterminate');
      GalleryUI.renderGrid(list);
    });
  }

  window.onload = async function () {
    _syncSortDirIcon();
    await boot();
  };

  return { boot, refreshData, onDataLoaded, updateView, toggleSortDir, onSortFieldChange };
})();
