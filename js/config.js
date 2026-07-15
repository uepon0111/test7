/*
 * config.js
 * -----------------------------------------------------------------------
 * アプリ全体で共有する定数・設定値をまとめたファイルです。
 * index.html から読み込まれます(読み取り設定は別ページではなく index.html 内の
 * モーダルになったため、設定用スクリプトも含めすべて index.html 経由で読み込まれます)。
 * -----------------------------------------------------------------------
 */

// ↓↓↓ GCP Settings ↓↓↓ (元のindex.htmlから移動。値は変更していません)
const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';
// ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive';

// 楽曲マスターデータ (プロセカ非公式データベース)
const MUSICS_URL = 'https://sekai-world.github.io/sekai-master-db-diff/musics.json';
const MUSIC_DIFFICULTIES_URL = 'https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json';

// --- Google Drive 上のフォルダ構成 ---
// ルートフォルダ名は既存運用との継続性のため変更していません。
const ROOT_FOLDER_NAME = "プロセカリザルト";
// 新方式: ルート直下の1つのフォルダに全リザルト画像をフラットに格納し、
// 曲ごとのサブフォルダを作らないことでフォルダ作成/検索コストを大幅に削減します。
const RESULTS_FOLDER_NAME = "Results";
// 旧方式(曲ごとのサブフォルダ構成)。読み取り専用の後方互換用に残します。
const LEGACY_FOLDER_NAME = "FC";

// --- 難易度定義 ---
// code: 内部/保存用の2文字コード, label: 表示名, color: タグ色, rank: 易しい順の序列, dbKey: マスターDB上のキー
const DIFFICULTIES = [
  { code: 'EZ', label: 'EASY',   color: '#66DA7E', rank: 1, dbKey: 'easy' },
  { code: 'NM', label: 'NORMAL', color: '#66C9F9', rank: 2, dbKey: 'normal' },
  { code: 'HD', label: 'HARD',   color: '#F5CC44', rank: 3, dbKey: 'hard' },
  { code: 'EX', label: 'EXPERT', color: '#EA5577', rank: 4, dbKey: 'expert' },
  { code: 'MS', label: 'MASTER', color: '#BB40F5', rank: 5, dbKey: 'master' },
  { code: 'AP', label: 'APPEND', color: '#EE82E2', rank: 6, dbKey: 'append' },
];

// 旧バージョン(1文字コード: H/E/M/A)からの変換マップ。旧データ読み込み時の後方互換用。
const LEGACY_DIFF_CODE_MAP = { 'H': 'HD', 'E': 'EX', 'M': 'MS', 'A': 'AP' };

function getDiffByCode(code) { return DIFFICULTIES.find(d => d.code === code) || null; }
function getDiffRank(code) { const d = getDiffByCode(code); return d ? d.rank : 0; }
function getDiffColor(code) { const d = getDiffByCode(code); return d ? d.color : '#999999'; }
function getDiffLabel(code) { const d = getDiffByCode(code); return d ? d.label : (code || '?'); }
function getDiffDbKey(code) { const d = getDiffByCode(code); return d ? d.dbKey : null; }
function getCodeFromDbKey(dbKey) { const d = DIFFICULTIES.find(d => d.dbKey === dbKey); return d ? d.code : null; }

// --- 読み取り範囲(クロップ範囲)のデフォルト値 ---
// すべて画像サイズに対する比率(0〜1)。プロフィールが1件も無い場合の最終フォールバックとして使用します。
// 添付いただいたリザルト画面のサンプル(1530×1069)を実際にピクセル単位で計測して定めた値です。
// 機種(解像度・UIレイアウト)によってはズレるため、実運用では設定モーダルの
// ドラッグ&ドロップ・座標入力で機種ごとのプロファイルとして調整してください。
//
// binarize: そのままだと自動判定(auto)で問題ありません。auto は二値化の際に
//   「画素数が少ない方=文字、多い方=背景」とみなして白背景+黒文字に統一する方式で、
//   難易度バッジのようにバッジごとに背景色が違っても追従できます。
//   自動判定がどうしても合わない機種がある場合のみ、設定モーダルの各範囲タブから
//   dark-text(文字が濃い色) / light-text(文字が薄い色・白文字など) に固定できます。
const DEFAULT_REGIONS = {
  difficulty: { x: 0.186, y: 0.076, w: 0.112, h: 0.040, binarize: 'auto' },
  level:      { x: 0.302, y: 0.076, w: 0.103, h: 0.040, binarize: 'auto' },
  title:      { x: 0.185, y: 0.012, w: 0.280, h: 0.058, binarize: 'auto' },
  breakdown:  { x: 0.115, y: 0.535, w: 0.200, h: 0.240, binarize: 'auto' },
  combo:      { x: 0.335, y: 0.535, w: 0.180, h: 0.040, binarize: 'auto' },
};

// 読み取り範囲の項目メタ情報 (設定モーダルでの表示順・ラベル・色に使用)
const REGION_DEFS = [
  { key: 'difficulty', label: '難易度',   color: '#007bff' },
  { key: 'level',      label: 'レベル',   color: '#17a2b8' },
  { key: 'title',      label: '曲名',     color: '#28a745' },
  { key: 'breakdown',  label: '判定内訳', color: '#e6a700' },
  { key: 'combo',      label: 'コンボ数', color: '#dc3545' },
];

// 二値化の極性(どちらが文字か)の選択肢。設定モーダルのプルダウンに使用します。
const BINARIZE_MODES = [
  { key: 'auto',       label: '自動判定' },
  { key: 'dark-text',  label: '文字が濃い色' },
  { key: 'light-text', label: '文字が薄い色(白文字など)' },
];

// --- localStorage キー ---
const LS_KEY_DEVICE_PROFILES = 'prsk_device_profiles_v1';

// --- ソート設定 ---
const SORT_MODES = [
  { key: 'name',  label: '名前順' },
  { key: 'level', label: '楽曲レベル順' },
  { key: 'miss',  label: 'ミス数順' },
  { key: 'date',  label: '追加日順' },
];
const DEFAULT_SORT_MODE = 'level';
const DEFAULT_SORT_DIRECTIONS = { name: 'asc', level: 'desc', miss: 'asc', date: 'desc' };
