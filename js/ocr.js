// js/ocr.js
// 7.6 既存の読み取り精度を維持・改良する形で実装

import { DEFAULT_OCR_ZONES } from './constants.js';
import { MusicDB } from './music-db.js';

let _worker = null;

async function getWorker() {
  if (!_worker) {
    _worker = await window.Tesseract.createWorker(['jpn', 'eng']);
  }
  return _worker;
}

export async function releaseOCRWorker() {
  if (_worker) { await _worker.terminate(); _worker = null; }
}

// ---- クロップ＆前処理 ----

/**
 * 画像をゾーン指定でクロップし、前処理してBlobを返す
 * @param {HTMLImageElement} img
 * @param {{x,y,w,h}} zone 割合
 * @param {'standard'|'diff'} mode
 */
async function cropZone(img, zone, mode = 'standard') {
  const W = img.naturalWidth, H = img.naturalHeight;
  const cx = Math.round(zone.x * W), cy = Math.round(zone.y * H);
  const cw = Math.round(zone.w * W), ch = Math.round(zone.h * H);
  const SCALE = 2; // OCR精度向上のため2倍に拡大

  const canvas = document.createElement('canvas');
  canvas.width  = cw * SCALE;
  canvas.height = ch * SCALE;
  const ctx = canvas.getContext('2d');

  if (mode === 'diff') {
    // 難易度バッジ：白いテキストを二値化で強調
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d  = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const v = gray > 185 ? 0 : 255; // 明るい（白）テキスト → 黒に反転
      d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
    }
    ctx.putImageData(id, 0, 0);
  } else {
    // 通常：グレースケール + コントラスト強調
    ctx.filter = 'grayscale(100%) contrast(160%)';
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
  }

  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

// ---- テキスト解析 ----

function detectDifficulty(text) {
  const u = text.toUpperCase().replace(/\s/g, '');
  if (/APP[EF]ND|APEND|APP/.test(u) && !/MASTER|EXPERT/.test(u)) return 'append';
  if (/MASTER/.test(u)) return 'master';
  if (/EXPERT/.test(u)) return 'expert';
  if (/HARD/.test(u))   return 'hard';
  if (/NORMAL/.test(u)) return 'normal';
  if (/EASY/.test(u))   return 'easy';
  return null;
}

/**
 * リザルトブロックのテキストから PERFECT/GREAT/GOOD/BAD/MISS を抽出
 * 7.6: GOOD以下は既存で精度高いのでそのまま採用、PERFECTとGREATを追加
 */
function parseResultBlock(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let perfect = null, great = null, good = null, bad = null, miss = null;

  const lastNum = str => {
    // OCR誤認対策（数字文脈でのO→0, I→1 等）
    const cleaned = str.replace(/[OoQ]/g, '0').replace(/[Il|!]/g, '1');
    const m = cleaned.match(/\d+/g);
    return m ? parseInt(m[m.length - 1], 10) : null;
  };

  for (const line of lines) {
    const u = line.toUpperCase();
    const n = lastNum(line);
    if (n === null) continue;

    // PERFECTは他のキーワードを含まない行
    if (/PERF/i.test(u) && !/GREAT|GOOD|BAD|MISS/.test(u)) {
      if (perfect === null) perfect = n;
    } else if (/GR[EF3]AT|GREET|GR3AT/.test(u)) {
      if (great === null) great = n;
    } else if (/^G[O0Q]{2}D|G[O0]{2}[D0]/.test(u) || u.startsWith('GOOD')) {
      if (good === null) good = n;
    } else if (/^BAD/.test(u)) {
      if (bad === null) bad = n;
    } else if (/^M[I1lL]SS/.test(u)) {
      if (miss === null) miss = n;
    }
  }

  // 正規表現でも試みる（行単位で失敗した場合のフォールバック）
  if (perfect === null) {
    const m = text.match(/PERF[EF]CT\s*[:\s]*(\d+)/i);
    if (m) perfect = parseInt(m[1]);
  }
  if (great === null) {
    const m = text.match(/GR[EF]AT\s*[:\s]*(\d+)/i);
    if (m) great = parseInt(m[1]);
  }
  if (good === null) {
    const m = text.match(/G[O0]{2}D\s*[:\s]*(\d+)/i);
    if (m) good = parseInt(m[1]);
  }
  if (bad === null) {
    const m = text.match(/BAD\s*[:\s]*(\d+)/i);
    if (m) bad = parseInt(m[1]);
  }
  if (miss === null) {
    const m = text.match(/M[I1]SS\s*[:\s]*(\d+)/i);
    if (m) miss = parseInt(m[1]);
  }

  return {
    perfect: perfect ?? 0,
    great:   great   ?? 0,
    good:    good    ?? 0,
    bad:     bad     ?? 0,
    miss:    miss    ?? 0,
  };
}

function parseCombo(text) {
  const clean = text.replace(/[OoQ]/g,'0').replace(/[Il|]/g,'1');
  const m = clean.match(/COMBO[^0-9]*([0-9]+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

// ---- メイン解析関数 ----

/**
 * 7.2-7.4: 画像解析 + 矛盾チェック（最大2回）
 * @param {HTMLImageElement} img
 * @param {object|null} zones カスタムゾーン（nullなら標準ゾーン）
 * @returns {object} 解析結果
 */
export async function analyzeImage(img, zones = null) {
  const Z      = zones || DEFAULT_OCR_ZONES;
  const worker = await getWorker();

  let lastResult = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // 1. 難易度（緑ゾーン）
      const diffBlob = await cropZone(img, Z.difficulty, 'diff');
      const diffText = (await worker.recognize(diffBlob, { lang: 'eng' })).data.text;
      const difficulty = detectDifficulty(diffText);

      // 2. タイトル（赤ゾーン）
      const titleBlob  = await cropZone(img, Z.title, 'standard');
      const titleText  = (await worker.recognize(titleBlob, { lang: 'jpn' })).data.text;
      const matched    = MusicDB.findBestMatch(titleText);
      const title      = matched ? matched.title : titleText.replace(/\r?\n/g,'').trim();
      const musicId    = matched?.id ?? null;
      const pronunciation = matched?.pronunciation ?? '';

      // 3. DBからレベル・総ノーツ数を取得
      const level      = (musicId && difficulty) ? MusicDB.getLevel(musicId, difficulty) : null;
      const totalNotes = (musicId && difficulty) ? MusicDB.getTotalNotes(musicId, difficulty) : null;

      // 4. リザルトブロック（橙ゾーン）
      const resBlob  = await cropZone(img, Z.results, 'standard');
      const resText  = (await worker.recognize(resBlob, { lang: 'eng' })).data.text;
      const { perfect, great, good, bad, miss } = parseResultBlock(resText);

      // 5. コンボ（紫ゾーン）
      const cmbBlob  = await cropZone(img, Z.combo, 'standard');
      const cmbText  = (await worker.recognize(cmbBlob, { lang: 'eng' })).data.text;
      const combo    = parseCombo(cmbText);

      // 6. 矛盾チェック（7.4: 総ノーツ数）
      const computed = perfect + great + good + bad + miss;
      const isValid  = totalNotes ? Math.abs(computed - totalNotes) <= 2 : true;

      const result = {
        title, pronunciation, musicId, difficulty: difficulty || 'master',
        level, totalNotes, perfect, great, good, bad, miss, combo,
        isValidTotal: isValid, computedTotal: computed,
        inconsistency: !isValid
          ? `読み取りノーツ数 ${computed} がDB値 ${totalNotes} と一致しません`
          : null,
        attempt,
      };

      lastResult = result;

      // 1回目で失敗なら2回目へ
      if (isValid || attempt === 2) return result;

    } catch (e) {
      console.error(`[OCR] attempt ${attempt} error:`, e);
      if (attempt === 2) throw e;
    }
  }
  return lastResult;
}

// ---- ゾーンオーバーレイ描画 ----

/**
 * 6.1-6.4: 各ゾーンを色付き矩形でキャンバスに描画
 */
export function drawZoneOverlays(canvas, imgW, imgH, zones = null) {
  const Z   = zones || DEFAULT_OCR_ZONES;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sx = canvas.width  / imgW;
  const sy = canvas.height / imgH;

  for (const zone of Object.values(Z)) {
    const x = zone.x * imgW * sx;
    const y = zone.y * imgH * sy;
    const w = zone.w * imgW * sx;
    const h = zone.h * imgH * sy;

    ctx.strokeStyle = zone.color;
    ctx.lineWidth   = 2.5;
    ctx.strokeRect(x, y, w, h);

    // 半透明の背景に白文字でラベル
    ctx.fillStyle = zone.color;
    ctx.fillRect(x, y, Math.min(w, 80), 18);
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 12px sans-serif';
    ctx.fillText(zone.label, x + 3, y + 13);
  }
}
