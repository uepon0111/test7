/*
 * ocr-analyzer.js
 * -----------------------------------------------------------------------
 * リザルト画像から Tesseract.js (OCR) を使って情報を読み取る処理。
 * 読み取る範囲(座標)は「機種プロファイル」(device-profiles.js)から与えられ、
 * 設定ページで自由に調整できます。
 *
 * 読み取る項目:
 *   - 難易度 (EASY/NORMAL/HARD/EXPERT/MASTER/APPEND)
 *   - 曲名 (マスターDBとのファジーマッチングで補正)
 *   - 判定内訳 (PERFECT/GREAT/GOOD/BAD/MISS)
 *   - コンボ数
 * -----------------------------------------------------------------------
 */

function toBoxRect(box) {
  if (!box) return null;
  if (typeof box.x0 === 'number') {
    return { left: box.x0, top: box.y0, right: box.x1, bottom: box.y1 };
  }
  if (typeof box.left === 'number') {
    return { left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height };
  }
  return null;
}

function unionRects(rects) {
  const valid = (rects || []).map(toBoxRect).filter(Boolean);
  if (valid.length === 0) return null;
  const left = Math.min(...valid.map(r => r.left));
  const top = Math.min(...valid.map(r => r.top));
  const right = Math.max(...valid.map(r => r.right));
  const bottom = Math.max(...valid.map(r => r.bottom));
  return { left, top, right, bottom };
}

function expandRect(rect, padX, padY, maxW, maxH) {
  if (!rect) return null;
  const left = clamp(rect.left - padX, 0, maxW);
  const top = clamp(rect.top - padY, 0, maxH);
  const right = clamp(rect.right + padX, 0, maxW);
  const bottom = clamp(rect.bottom + padY, 0, maxH);
  return { left, top, right, bottom };
}

function rectToRegion(rect, imgW, imgH) {
  if (!rect) return null;
  return {
    x: clamp(rect.left / imgW, 0, 1),
    y: clamp(rect.top / imgH, 0, 1),
    w: clamp((rect.right - rect.left) / imgW, 0.01, 1),
    h: clamp((rect.bottom - rect.top) / imgH, 0.01, 1),
  };
}

function extractWordsFromOcrResult(ret) {
  const words = [];
  const blocks = ret && ret.data && Array.isArray(ret.data.blocks) ? ret.data.blocks : null;
  if (blocks) {
    for (const block of blocks) {
      for (const paragraph of (block.paragraphs || [])) {
        for (const line of (paragraph.lines || [])) {
          for (const word of (line.words || [])) {
            if (word && word.text) words.push(word);
          }
        }
      }
    }
  }
  if (words.length > 0) return words;

  const flatWords = ret && ret.data && Array.isArray(ret.data.words) ? ret.data.words : null;
  if (flatWords) return flatWords.filter(Boolean);
  return [];
}

// 画像の指定範囲(比率 x,y,w,h ∈ [0,1])を切り出してCanvas化する。
async function cropImage(imageElement, xRatio, yRatio, wRatio, hRatio, options = {}) {
  const {
    scale = 2,
    threshold = false,
    contrast = 170,
    grayscale = true,
  } = options;

  const canvas = document.createElement('canvas');
  const w = imageElement.naturalWidth;
  const h = imageElement.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const cropW = Math.max(1, Math.round(w * wRatio));
  const cropH = Math.max(1, Math.round(h * hRatio));
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  canvas.width = outW;
  canvas.height = outH;

  ctx.imageSmoothingEnabled = true;
  ctx.filter = `${grayscale ? 'grayscale(100%) ' : ''}contrast(${contrast}%)`.trim();
  ctx.drawImage(
    imageElement,
    Math.round(w * xRatio),
    Math.round(h * yRatio),
    cropW,
    cropH,
    0,
    0,
    outW,
    outH
  );

  if (threshold) {
    const imageData = ctx.getImageData(0, 0, outW, outH);
    const data = imageData.data;
    const hist = new Array(256).fill(0);
    const grayVals = new Uint8Array(outW * outH);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      grayVals[p] = gray;
      hist[gray] += 1;
    }

    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = -1, thresholdVal = 128;
    const total = grayVals.length;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) {
        maxVar = between;
        thresholdVal = t;
      }
    }

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const v = grayVals[p] > thresholdVal ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function recognizeWithParams(worker, blob, lang, params = {}, output = { blocks: true }) {
  if (params && Object.keys(params).length > 0) {
    await worker.setParameters(params);
  }
  return await worker.recognize(blob, { lang }, output);
}

async function recognizeBestVariant(worker, imageElement, xRatio, yRatio, wRatio, hRatio, lang, attempts, output = { blocks: true }) {
  let best = null;

  for (const attempt of attempts) {
    const blob = await cropImage(imageElement, xRatio, yRatio, wRatio, hRatio, attempt.preprocess || {});
    const ret = await recognizeWithParams(worker, blob, attempt.lang || lang, attempt.params || {}, output);
    const text = normalizeOcrText((ret && ret.data && ret.data.text) || '');
    const confidence = Number((ret && ret.data && ret.data.confidence) || 0);
    const score = typeof attempt.score === 'function'
      ? attempt.score({ ret, text, confidence })
      : confidence + text.length * 2;

    if (!best || score > best.score) {
      best = { ret, text, confidence, score };
    }
  }

  return best ? best.ret : null;
}

function normalizeOcrText(text) {
  return (text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractNumericValue(text) {
  const matches = (text || '').match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  let best = matches[0];
  for (const m of matches) {
    if (m.length > best.length) best = m;
  }
  return parseInt(best, 10) || 0;
}

function scoreBreakdownText(text, confidence = 0) {
  const upper = (text || '').toUpperCase();
  const labels = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS'];
  let labelHits = 0;
  let digitHits = 0;
  for (const label of labels) {
    if (upper.includes(label)) labelHits += 1;
  }
  const digitMatches = upper.match(/\d+/g);
  if (digitMatches) digitHits = digitMatches.length;
  return confidence + labelHits * 120 + digitHits * 12;
}

function scoreComboText(text, confidence = 0) {
  const value = extractNumericValue(text);
  if (!value) return confidence;
  return confidence + String(value).length * 50 + 100;
}

function scoreTitleText(text, confidence = 0) {
  const cleaned = normalizeString(text || '');
  if (!cleaned) return -Infinity;
  let score = confidence + Math.min(cleaned.length * 3, 120);
  const matched = findBestMatchMusic(text || '');
  if (matched && matched.title) {
    const target = normalizeString(matched.title);
    const dist = levenshtein(cleaned, target);
    score += Math.max(0, 240 - dist * 14);
  }
  return score;
}

// OCRで読み取った文字列から難易度を判定する。
const DIFF_WORD_TO_CODE = { EASY: 'EZ', NORMAL: 'NM', HARD: 'HD', EXPERT: 'EX', MASTER: 'MS', APPEND: 'AP' };

function detectDifficultyCode(diffText) {
  const cleaned = (diffText || '').toUpperCase().replace(/[^A-Z]/g, '');
  const words = Object.keys(DIFF_WORD_TO_CODE);
  if (!cleaned) return 'EX';

  for (const word of words) {
    if (cleaned.includes(word)) return DIFF_WORD_TO_CODE[word];
  }
  let bestWord = 'EXPERT', bestDist = Infinity;
  for (const word of words) {
    const dist = levenshtein(cleaned, word) / Math.max(cleaned.length, word.length);
    if (dist < bestDist) { bestDist = dist; bestWord = word; }
  }
  return DIFF_WORD_TO_CODE[bestWord];
}

function parseBreakdownText(text) {
  const lines = normalizeOcrText(text).split('\n');
  let perfect = 0, great = 0, good = 0, bad = 0, miss = 0;
  const parseLine = (line, regex) => {
    if (regex.test(line)) {
      const nums = line.match(/\d+/g);
      if (nums) return parseInt(nums[nums.length - 1], 10);
    }
    return 0;
  };

  lines.forEach(line => {
    const upper = line.toUpperCase();
    if (/P(?:ER)?F(?:E)?CT/.test(upper) || /PERFECT/.test(upper)) perfect = parseLine(line, /P(?:ER)?F(?:E)?CT|PERFECT/i);
    if (/GR[EA4]T/.test(upper) || /GREAT/.test(upper)) great = parseLine(line, /GR[EA4]T|GREAT/i);
    if (/G[O0QD]{2}D/.test(upper) || /GOOD/.test(upper)) good = parseLine(line, /G[O0QD]{2}D|GOOD/i);
    if (/BAD/.test(upper)) bad = parseLine(line, /BAD/i);
    if (/MISS/.test(upper)) miss = parseLine(line, /MISS/i);
  });
  return { perfect, great, good, bad, miss };
}

function parseComboText(text) {
  const cleaned = normalizeOcrText(text);
  const matches = cleaned.match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  let best = matches[0];
  for (const m of matches) { if (m.length > best.length) best = m; }
  return parseInt(best, 10) || 0;
}

function getBestTextCandidate(words, predicate) {
  return (words || [])
    .filter(w => w && w.text && predicate(w))
    .sort((a, b) => {
      const aa = (a.confidence || 0) + Math.max(0, (a.text || '').length - 1) * 3;
      const bb = (b.confidence || 0) + Math.max(0, (b.text || '').length - 1) * 3;
      return bb - aa;
    })[0] || null;
}

function pickWordBox(word) {
  return toBoxRect(word && (word.bbox || word.boundingBox || word.box || null));
}

function wordCenterY(word) {
  const box = pickWordBox(word);
  return box ? (box.top + box.bottom) / 2 : 0;
}

function wordCenterX(word) {
  const box = pickWordBox(word);
  return box ? (box.left + box.right) / 2 : 0;
}

function clusterWordsByRows(words, tolerancePx) {
  const sorted = (words || []).slice().filter(w => pickWordBox(w)).sort((a, b) => wordCenterY(a) - wordCenterY(b));
  const clusters = [];
  for (const word of sorted) {
    const centerY = wordCenterY(word);
    let cluster = clusters[clusters.length - 1];
    if (!cluster || Math.abs(cluster.centerY - centerY) > tolerancePx) {
      cluster = { words: [word], centerY, minY: centerY, maxY: centerY };
      clusters.push(cluster);
    } else {
      cluster.words.push(word);
      cluster.centerY = (cluster.centerY * (cluster.words.length - 1) + centerY) / cluster.words.length;
      cluster.minY = Math.min(cluster.minY, centerY);
      cluster.maxY = Math.max(cluster.maxY, centerY);
    }
  }
  return clusters;
}

function findNearestWordOnSameRow(words, refWord, options = {}) {
  const {
    yTolerancePx = 18,
    direction = 'right',
    maxDistancePx = 220,
  } = options;

  const refBox = pickWordBox(refWord);
  if (!refBox) return null;
  const refCenterY = (refBox.top + refBox.bottom) / 2;
  const refRight = refBox.right;
  const refLeft = refBox.left;

  let best = null;
  let bestDist = Infinity;
  for (const word of words || []) {
    if (word === refWord) continue;
    const box = pickWordBox(word);
    if (!box) continue;
    const centerY = (box.top + box.bottom) / 2;
    if (Math.abs(centerY - refCenterY) > yTolerancePx) continue;

    const dist = direction === 'right'
      ? (box.left - refRight)
      : (refLeft - box.right);

    if (dist < 0 || dist > maxDistancePx) continue;
    const score = dist - (word.confidence || 0) * 0.2;
    if (score < bestDist) {
      bestDist = score;
      best = word;
    }
  }
  return best;
}

function filterWordsByRegion(words, imgW, imgH, predicate) {
  return (words || []).filter(word => {
    const box = pickWordBox(word);
    if (!box) return false;
    const cx = ((box.left + box.right) / 2) / imgW;
    const cy = ((box.top + box.bottom) / 2) / imgH;
    return predicate(word, box, cx, cy);
  });
}

// 画像1枚を解析する。regions には { difficulty, title, breakdown, combo } (各 {x,y,w,h}) を渡す。
async function analyzeLoadedImage(imgElement, worker, regions) {
  const r = regions || DEFAULT_REGIONS;
  try {
    const diffR = r.difficulty;
    const diffRet = await recognizeBestVariant(worker, imgElement, diffR.x, diffR.y, diffR.w, diffR.h, 'eng', [
      {
        preprocess: { scale: 3.5, threshold: true, contrast: 250 },
        params: {
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        score: ({ text, confidence }) => {
          const upper = text.toUpperCase();
          let hit = 0;
          for (const word of Object.keys(DIFF_WORD_TO_CODE)) {
            if (upper.includes(word)) hit += 1;
          }
          return confidence + hit * 250 + upper.length * 2;
        },
      },
      {
        preprocess: { scale: 4, threshold: false, contrast: 220 },
        params: {
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        score: ({ text, confidence }) => {
          const upper = text.toUpperCase();
          let hit = 0;
          for (const word of Object.keys(DIFF_WORD_TO_CODE)) {
            if (upper.includes(word)) hit += 1;
          }
          return confidence + hit * 220 + upper.length;
        },
      },
    ]);
    const diffCode = detectDifficultyCode((diffRet && diffRet.data && diffRet.data.text) || '');
    const dbKey = getDiffDbKey(diffCode);

    const titleR = r.title;
    const titleRet = await recognizeBestVariant(worker, imgElement, titleR.x, titleR.y, titleR.w, titleR.h, 'jpn+eng', [
      {
        preprocess: { scale: 2.5, threshold: false, contrast: 185 },
        params: {
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        score: ({ text, confidence }) => scoreTitleText(text, confidence),
      },
      {
        preprocess: { scale: 3, threshold: true, contrast: 215 },
        params: {
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        score: ({ text, confidence }) => scoreTitleText(text, confidence) + 15,
      },
    ]);
    const titleText = normalizeOcrText((titleRet && titleRet.data && titleRet.data.text) || '');
    const matchedMusic = findBestMatchMusic(titleText);
    const finalTitle = matchedMusic ? matchedMusic.title : titleText.replace(/\r?\n/g, ' ').trim();
    const musicId = matchedMusic ? matchedMusic.id : null;

    let level = '';
    if (musicId) level = getLevelFromDb(musicId, dbKey) || '';

    const bdR = r.breakdown;
    const bdRet = await recognizeBestVariant(worker, imgElement, bdR.x, bdR.y, bdR.w, bdR.h, 'eng', [
      {
        preprocess: { scale: 2.5, threshold: false, contrast: 190 },
        params: {
          tessedit_pageseg_mode: '6',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        score: ({ text, confidence }) => scoreBreakdownText(text, confidence),
      },
      {
        preprocess: { scale: 3, threshold: true, contrast: 230 },
        params: {
          tessedit_pageseg_mode: '6',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        score: ({ text, confidence }) => scoreBreakdownText(text, confidence) + 20,
      },
    ]);
    const breakdown = parseBreakdownText((bdRet && bdRet.data && bdRet.data.text) || '');

    const cbR = r.combo;
    const cbRet = await recognizeBestVariant(worker, imgElement, cbR.x, cbR.y, cbR.w, cbR.h, 'eng', [
      {
        preprocess: { scale: 3.5, threshold: true, contrast: 230 },
        params: {
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        score: ({ text, confidence }) => scoreComboText(text, confidence),
      },
      {
        preprocess: { scale: 4, threshold: false, contrast: 220 },
        params: {
          tessedit_pageseg_mode: '7',
          tessedit_char_whitelist: '0123456789',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        },
        score: ({ text, confidence }) => scoreComboText(text, confidence) + 10,
      },
    ]);
    const combo = parseComboText((cbRet && cbRet.data && cbRet.data.text) || '');

    return {
      title: finalTitle,
      level: level,
      diff: diffCode,
      perfect: breakdown.perfect,
      great: breakdown.great,
      good: breakdown.good,
      bad: breakdown.bad,
      miss: breakdown.miss,
      combo: combo,
      musicId: musicId,
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}
