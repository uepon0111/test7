/**
 * state.js
 * ---------------------------------------------------------------------------
 * index.html（一覧画面）全体で共有するミュータブルな状態。
 * 各モジュールはこの AppState を読み書きすることで連携する。
 * settings.html 側はこのファイルを読み込まず、専用のローカル状態を持つ。
 * ---------------------------------------------------------------------------
 */
const AppState = {
  allRecords: [],       // Driveから取得した全リザルト（BestScoreによる isBest 付与済み）
  filteredRecords: [],  // 現在表示中（絞り込み・並び替え後）のリザルト
  selectedIds: new Set(), // 選択モードで選択中のファイルID
  isSelectMode: false,

  // 並び替え状態
  sortField: 'level', // 'name' | 'level' | 'missCount' | 'date'
  sortDir: 'desc',    // 'asc' | 'desc'
};
