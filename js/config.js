/**
 * config.js
 * ---------------------------------------------------------------------------
 * アプリ全体で使用する定数・設定値を一元管理するファイル。
 *   - Google API のキー情報
 * ★重要: 既存運用中のGCP認証情報のため、値は変更しないこと。
 *   - 難易度の定義（表示名 / カラーコード / 並び順ランク / Driveファイル名用コード）
 *   - Google Drive 上の保存フォルダ名
 * ★重要: 既存運用中のGCP認証情報のため、値は変更しないこと。
 *   - 楽曲マスターDB（sekai-world）のURL
 *   - localStorage のキー名
 *   - OCR読み取り範囲のデフォルト値（機種プロファイル未設定時のフォールバック）
 * ---------------------------------------------------------------------------
 */
const Config = (() => {

  // ↓↓↓ GCP Settings（既存運用中の値。変更しないこと） ↓↓↓
  const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
  const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';
  // ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑

  const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
  const SCOPES = 'https://www.googleapis.com/auth/drive';

  // Drive 上のフォルダ構成（フラット構造：ルート直下の results フォルダに全画像を格納）
  // 楽曲ごとにフォルダを作成・検索していた旧構造より通信回数が大幅に少ない。
  const ROOT_FOLDER_NAME = 'プロセカリザルト';
  const RESULTS_FOLDER_NAME = 'results';

  // 楽曲マスターDB（sekai-world）
  const MUSIC_DB_URL = 'https://sekai-world.github.io/sekai-master-db-diff/musics.json';
  const MUSIC_DIFF_DB_URL = 'https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json';

  // localStorage キー
  const LS_DEVICE_PROFILES = 'prsk_device_profiles_v1';

  // 難易度定義
  // code: Driveファイル名やCSSクラスに使う2文字コード
  // rank: 楽曲難易度順ソート時の並び順（数値が大きいほど高難易度側）
  const DIFFICULTIES = {
    easy:   { code: 'EZ', label: 'EASY',   color: '#66DA7E', rank: 1 },
    normal: { code: 'NM', label: 'NORMAL', color: '#66C9F9', rank: 2 },
    hard:   { code: 'HD', label: 'HARD',   color: '#F5CC44', rank: 3 },
    expert: { code: 'EX', label: 'EXPERT', color: '#EA5577', rank: 4 },
    master: { code: 'MS', label: 'MASTER', color: '#BB40F5', rank: 5 },
    append: { code: 'AP', label: 'APPEND', color: '#EE82E2', rank: 6 },
  };
  const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'expert', 'master', 'append'];

  const CODE_TO_KEY = {};
  DIFFICULTY_ORDER.forEach((k) => { CODE_TO_KEY[DIFFICULTIES[k].code] = k; });

  function keyFromCode(code) { return CODE_TO_KEY[code] || null; }
  function codeFromKey(key) { return (DIFFICULTIES[key] || {}).code || null; }
  function labelFromKey(key) { return (DIFFICULTIES[key] || {}).label || key || '?'; }
  function colorFromKey(key) { return (DIFFICULTIES[key] || {}).color || '#999999'; }
  function rankFromKey(key) { return (DIFFICULTIES[key] || {}).rank || 0; }

  // OCR読み取り範囲のデフォルト値（比率 0〜1。機種プロファイル未設定/未検出時のフォールバック）
  // 実際の座標は設定ページ（settings.html）で機種ごとに調整することを想定している。
  const DEFAULT_REGIONS = {
    title:      { x: 0.19, y: 0.010, w: 0.32, h: 0.05 },
    difficulty: { x: 0.20, y: 0.070, w: 0.10, h: 0.04 },
    breakdown:  { x: 0.10, y: 0.360, w: 0.24, h: 0.47 },
    combo:      { x: 0.34, y: 0.190, w: 0.32, h: 0.06 },
  };
  const DEFAULT_REF_RESOLUTION = { width: 1170, height: 2532 };

  // 設定ページで各読み取り範囲を視覚化する際のラベル・色
  const REGION_META = {
    title:      { key: 'title',      label: '曲名',     order: 1, color: '#3b82f6' },
    difficulty: { key: 'difficulty', label: '難易度',   order: 2, color: '#fd7e14' },
    breakdown:  { key: 'breakdown',  label: '判定内訳', order: 3, color: '#28a745' },
    combo:      { key: 'combo',      label: 'コンボ数', order: 4, color: '#e83e8c' },
  };
  const REGION_KEYS = ['title', 'difficulty', 'breakdown', 'combo'];

  return {
    CLIENT_ID, API_KEY, DISCOVERY_DOC, SCOPES,
    ROOT_FOLDER_NAME, RESULTS_FOLDER_NAME,
    MUSIC_DB_URL, MUSIC_DIFF_DB_URL,
    LS_DEVICE_PROFILES,
    DIFFICULTIES, DIFFICULTY_ORDER,
    keyFromCode, codeFromKey, labelFromKey, colorFromKey, rankFromKey,
    DEFAULT_REGIONS, DEFAULT_REF_RESOLUTION,
    REGION_META, REGION_KEYS,
  };
})();
