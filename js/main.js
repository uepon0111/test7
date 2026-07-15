/*
 * main.js
 * -----------------------------------------------------------------------
 * index.html のブートストラップ処理。ページ読み込み時に一度だけ実行され、
 * 各モジュールの初期化(イベント登録・セレクトボックスの選択肢生成など)を行います。
 * -----------------------------------------------------------------------
 */

// 難易度セレクトボックスの選択肢を DIFFICULTIES (config.js) から生成する。
// filter-diff には「すべて」を含め、up-diff (アップロード編集フォーム) には含めない。
function populateDifficultySelect(selectEl, opts) {
  opts = opts || {};
  let html = '';
  if (opts.includeAll) html += `<option value="all">すべて</option>`;
  html += DIFFICULTIES.map(d => `<option value="${d.code}">${d.label}</option>`).join('');
  selectEl.innerHTML = html;
  if (opts.defaultValue) selectEl.value = opts.defaultValue;
}

window.onload = async () => {
  // 難易度フィルターの選択肢を生成
  populateDifficultySelect(document.getElementById('filter-diff'), { includeAll: true, defaultValue: 'all' });

  // 各種イベント初期化
  initSortControls();
  initBestOnlyToggle();
  initFilterControls();
  initUploadEditor();
  initSettingsPanel(); // 読み取り設定モーダル(以前のsettings.html)の初期化。ページ遷移が発生しないため、開いてもログインが切れない。

  // 楽曲マスターDBの読み込み (アップロード解析時に使用)。失敗した場合は画面上に警告を出す。
  loadMusicDb().then(ok => { if (!ok) showDbLoadWarning(); });

  // 機種プロファイルを準備 (未作成なら「デフォルト」を1件作成)
  getDeviceProfiles();
};
