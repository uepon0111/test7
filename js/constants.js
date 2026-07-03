// js/constants.js

export const DIFFICULTIES = {
  easy:   { label: 'EASY',   color: '#66DA7E', textColor: '#1a5c2a' },
  normal: { label: 'NORMAL', color: '#66C9F9', textColor: '#0d4a6b' },
  hard:   { label: 'HARD',   color: '#F5CC44', textColor: '#5c4500' },
  expert: { label: 'EXPERT', color: '#EA5577', textColor: '#ffffff' },
  master: { label: 'MASTER', color: '#BB40F5', textColor: '#ffffff' },
  append: { label: 'APPEND', color: '#EE82E2', textColor: '#4B1542' },
};

export const DIFF_ORDER = ['easy', 'normal', 'hard', 'expert', 'master', 'append'];

export const MODES = {
  ap:      { label: 'AP基準',   short: 'AP',   missKey: 'missAP',      achKey: 'isAP',  achLabel: 'AP達成' },
  contest: { label: '大会基準', short: '大会', missKey: 'missContest', achKey: 'isAP',  achLabel: 'AP達成' },
  fc:      { label: 'FC基準',   short: 'FC',   missKey: 'missFC',      achKey: 'isFC',  achLabel: 'FC達成' },
};

// OCRゾーン定義（画像サイズに対する割合）
// 赤=タイトル 緑=難易度 青=レベル 橙=リザルト 紫=コンボ
export const DEFAULT_OCR_ZONES = {
  title:      { x: 0.19,  y: 0.005, w: 0.40,  h: 0.063, color: 'rgba(220,40,40,0.85)',   label: 'タイトル' },
  difficulty: { x: 0.185, y: 0.063, w: 0.135, h: 0.073, color: 'rgba(30,180,30,0.85)',   label: '難易度' },
  level:      { x: 0.296, y: 0.063, w: 0.158, h: 0.073, color: 'rgba(30,80,255,0.85)',   label: 'レベル' },
  results:    { x: 0.075, y: 0.48,  w: 0.27,  h: 0.36,  color: 'rgba(230,120,0,0.85)',   label: 'リザルト' },
  combo:      { x: 0.33,  y: 0.48,  w: 0.24,  h: 0.13,  color: 'rgba(160,0,230,0.85)',   label: 'コンボ' },
};

export const TRASH_EXPIRY_DAYS = 3;

// Google Drive認証設定（既存アプリから引き継ぎ）
export const CLIENT_ID   = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
export const API_KEY     = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';
export const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
export const SCOPES      = 'https://www.googleapis.com/auth/drive';

export const DRIVE_ROOT_NAME   = 'プロセカリザルト';
export const DRIVE_IMG_FOLDER  = 'images';
export const DRIVE_META_FILE   = 'metadata.json';

export const MUSIC_URL = 'https://sekai-world.github.io/sekai-master-db-diff/musics.json';
export const DIFF_URL  = 'https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json';
