/*
 * ocr-analyzer.js
 * -----------------------------------------------------------------------
 * Tesseract.js による OCR 解析処理。
 *  - 読み取り前のクロップ/前処理
 *  - 難易度・曲名・判定内訳・コンボ数の個別解析
 *  - settings.html からも使う自動範囲推定のための基本ユーティリティ
 * -----------------------------------------------------------------------
 */

function normalizeOcrText(text) {
  return (text || '')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractLinesFromOcrResult(ret) {
  const lines = [];
  const blocks = ret && ret.data && Array.isArray(ret.data.blocks) ? ret.data.blocks : null;
  if (blocks) {
    for (const block of blocks) {
      for (const paragraph of (block.paragraphs || [])) {
        for (const line of (paragraph.lines || [])) {
          const words = (line.words || []).map(w => w && w.text ? w.text : '').filter(Boolean);
          const text = words.join(' ').trim() || (line.text || '').trim();
          if (text) lines.push(text);
        }
      }
    }
  }
  if (lines.length > 0) return lines;

  const flatLines = ret && ret.data && Array.isArray(ret.data.lines) ? ret.data.lines : null;
  if (flatLines) {
    for (const line of flatLines) {
      const text = (line && (line.text || (line.words || []).map(w => w && w.text ? w.text : '').join(' '))) || '';
      if (String(text).trim()) lines.push(String(text).trim());
    }
  }
  if (lines.length > 0) return lines;

  const raw = normalizeOcrText(ret && ret.data && ret.data.text ? ret.data.text : '');
  if (raw) {
    return raw.split('\n').map(s => s.trim()).filter(Boolean);
  }
  return [];
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

function getBestTextCandidate(words, predicate) {
  return (words || [])
    .filter(w => w && w.text && predicate(w))
    .sort((a, b) => {
      const aa = (a.confidence || 0) + Math.max(0, String(a.text || '').length - 1) * 3;
      const bb = (b.confidence || 0) + Math.max(0, String(b.text || '').length - 1) * 3;
      return bb - aa;
    })[0] || null;
}

function scoreDifficultyText(diffText) {
  const cleaned = (diffText || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!cleaned) return 0;
  const words = Object.keys(DIFF_WORD_TO_CODE);
  let best = 0;
  for (const word of words) {
    if (cleaned.includes(word)) return 10 + word.length;
    const dist = levenshtein(cleaned, word) / Math.max(cleaned.length, word.length);
    best = Math.max(best, 1 - dist);
  }
  return best;
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
  const lines = (text || '').split('\n').map(s => s.trim()).filter(Boolean);
  let perfect = 0, great = 0, good = 0, bad = 0, miss = 0;
  const parseLine = (line, regex) => {
    if (regex.test(line)) {
      const nums = line.match(/\d+/g);
      if (nums && nums.length > 0) return parseInt(nums[nums.length - 1], 10);
    }
    return 0;
  };
  lines.forEach(line => {
    const cleaned = line.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/PERFECT/.test(cleaned) || levenshtein(cleaned, 'PERFECT') <= 2) perfect = parseLine(line, /PERFECT/i);
    if (/GREAT/.test(cleaned) || levenshtein(cleaned, 'GREAT') <= 2) great = parseLine(line, /GREAT/i);
    if (/G[O0QD]{1,2}D/.test(cleaned) || levenshtein(cleaned, 'GOOD') <= 2) good = parseLine(line, /G[O0QD]{2}D/i);
    if (/BAD/.test(cleaned) || levenshtein(cleaned, 'BAD') <= 1) bad = parseLine(line, /BAD/i);
    if (/MISS/.test(cleaned) || levenshtein(cleaned, 'MISS') <= 1) miss = parseLine(line, /MISS/i);
  });
  return { perfect, great, good, bad, miss };
}

function scoreBreakdownResult(text, breakdown) {
  const present = [breakdown.perfect, breakdown.great, breakdown.good, breakdown.bad, breakdown.miss]
    .filter(v => Number.isFinite(v) && v > 0).length;
  const labelHits = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS'].reduce((acc, label) => {
    const cleaned = (text || '').toUpperCase().replace(/[^A-Z]/g, '');
    return acc + (cleaned.includes(label) ? 1 : 0);
  }, 0);
  return present * 10 + labelHits * 2 + Math.min(String(text || '').length / 20, 4);
}

function parseComboText(text) {
  const matches = (text || '').match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  let best = matches[0];
  for (const m of matches) {
    if (m.length > best.length) best = m;
    else if (m.length === best.length && parseInt(m, 10) > parseInt(best, 10)) best = m;
  }
  return parseInt(best, 10);
}

function scoreComboText(text) {
  const digits = (text || '').match(/\d+/g) || [];
  if (digits.length === 0) return 0;
  const longest = digits.reduce((a, b) => (b.length > a.length ? b : a), digits[0]);
  return longest.length * 10 + Math.min(parseInt(longest, 10) || 0, 99999) / 100000;
}

function scoreMusicCandidate(candidateText) {
  if (!dbMusics || dbMusics.length === 0) return null;
  const target = normalizeString(candidateText);
  if (!target) return null;

  let best = { music: null, score: Infinity };
  for (const music of dbMusics) {
    const dbTitleNorm = normalizeString(music.title);
    if (!dbTitleNorm) continue;
    const dist = levenshtein(target, dbTitleNorm);
    const score = dist / Math.max(target.length, dbTitleNorm.length);
    if (score < best.score) {
      best = { music, score };
    }
  }
  return best.music ? best : null;
}

function collectTitleCandidatesFromResult(ret) {
  const candidates = [];
  const raw = normalizeOcrText(ret && ret.data && ret.data.text ? ret.data.text : '');
  if (raw) candidates.push(raw);

  for (const line of extractLinesFromOcrResult(ret)) {
    if (line && !candidates.includes(line)) candidates.push(line);
  }

  const words = extractWordsFromOcrResult(ret);
  if (words.length > 0) {
    const byLine = new Map();
    for (const word of words) {
      if (!word || !word.text || !word.bbox) continue;
      const key = `${Math.round(((word.bbox.y0 + word.bbox.y1) / 2) / 10) * 10}`;
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(word.text);
    }
    for (const arr of byLine.values()) {
      const joined = arr.join(' ').trim();
      if (joined && !candidates.includes(joined)) candidates.push(joined);
    }
  }

  return candidates.filter(Boolean);
}

function chooseBestTitleCandidate(textCandidates) {
  let best = null;

  for (const candidate of (textCandidates || [])) {
    const match = scoreMusicCandidate(candidate);
    const cleaned = normalizeOcrText(candidate);
    const fallbackScore = cleaned ? Math.min(cleaned.length / 10, 5) : 0;

    if (match) {
      const score = match.score;
      if (!best || score < best.score) {
        best = {
          title: match.music.title,
          musicId: match.music.id,
          score,
          rawText: candidate,
        };
      }
    } else if (!best && cleaned) {
      best = {
        title: cleaned,
        musicId: null,
        score: 9 + fallbackScore,
        rawText: candidate,
      };
    }
  }

  return best;
}

async function analyzeLoadedImage(imgElement, worker, regions) {
  const r = regions || DEFAULT_REGIONS;
  try {
    // 難易度: 白文字が小さく載るため、複数の前処理を試して最も強い結果を採用する
    const diffR = r.difficulty;
    const diffVariants = [
      { scale: 4, threshold: true, contrast: 260, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 3, threshold: true, contrast: 220, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 3, threshold: false, contrast: 240, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
    ];

    let bestDiffText = '';
    let bestDiffScore = -Infinity;
    for (const variant of diffVariants) {
      const diffBlob = await cropImage(imgElement, diffR.x, diffR.y, diffR.w, diffR.h, variant);
      const diffRet = await recognizeWithParams(worker, diffBlob, variant.lang, variant.params);
      const text = normalizeOcrText(diffRet && diffRet.data && diffRet.data.text ? diffRet.data.text : '');
      const score = scoreDifficultyText(text);
      if (score > bestDiffScore) {
        bestDiffScore = score;
        bestDiffText = text;
      }
    }
    const diffCode = detectDifficultyCode(bestDiffText);
    const dbKey = getDiffDbKey(diffCode);

    // 曲名: 複数の前処理と認識候補を比較し、楽曲DBに最も近いものを採用
    const titleR = r.title;
    const titleVariants = [
      { scale: 2.5, threshold: false, contrast: 170, grayscale: true, lang: 'jpn+eng', params: { tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 3, threshold: false, contrast: 220, grayscale: true, lang: 'jpn+eng', params: { tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 3, threshold: true, contrast: 220, grayscale: true, lang: 'jpn+eng', params: { tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 2.5, threshold: true, contrast: 180, grayscale: true, lang: 'jpn', params: { tessedit_pageseg_mode: '7', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
    ];

    let bestTitle = null;
    for (const variant of titleVariants) {
      const titleBlob = await cropImage(imgElement, titleR.x, titleR.y, titleR.w, titleR.h, variant);
      const titleRet = await recognizeWithParams(worker, titleBlob, variant.lang, variant.params);
      const candidates = collectTitleCandidatesFromResult(titleRet);
      const picked = chooseBestTitleCandidate(candidates);
      if (!picked) continue;
      if (!bestTitle || picked.score < bestTitle.score) bestTitle = picked;
    }

    const finalTitle = bestTitle ? bestTitle.title : '';
    const musicId = bestTitle ? bestTitle.musicId : null;

    let level = "";
    if (musicId) level = getLevelFromDb(musicId, dbKey) || "";

    // 判定内訳: ラベルの読み取りしやすさが変わるため、複数の前処理で最も完全なものを採用
    const bdR = r.breakdown;
    const bdVariants = [
      { scale: 2.5, threshold: false, contrast: 190, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '6', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 3, threshold: true, contrast: 225, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '6', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 3, threshold: false, contrast: 235, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '6', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 4, threshold: true, contrast: 260, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '11', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
    ];
    let bestBreakdown = { perfect: 0, great: 0, good: 0, bad: 0, miss: 0 };
    let bestBreakdownScore = -Infinity;
    for (const variant of bdVariants) {
      const bdBlob = await cropImage(imgElement, bdR.x, bdR.y, bdR.w, bdR.h, variant);
      const bdRet = await recognizeWithParams(worker, bdBlob, variant.lang, variant.params);
      const breakdown = parseBreakdownText(bdRet && bdRet.data && bdRet.data.text ? bdRet.data.text : '');
      const score = scoreBreakdownResult(bdRet && bdRet.data && bdRet.data.text ? bdRet.data.text : '', breakdown);
      if (score > bestBreakdownScore) {
        bestBreakdownScore = score;
        bestBreakdown = breakdown;
      }
    }

    // コンボ数: 数字候補のうち最も自然なものを採用
    const cbR = r.combo;
    const cbVariants = [
      { scale: 4, threshold: true, contrast: 240, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 3, threshold: true, contrast: 210, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 3, threshold: false, contrast: 220, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
      { scale: 4, threshold: false, contrast: 180, grayscale: true, lang: 'eng', params: { tessedit_pageseg_mode: '11', tessedit_char_whitelist: '0123456789', preserve_interword_spaces: '1', user_defined_dpi: '300' } },
    ];
    let bestCombo = 0;
    let bestComboScore = -Infinity;
    for (const variant of cbVariants) {
      const cbBlob = await cropImage(imgElement, cbR.x, cbR.y, cbR.w, cbR.h, variant);
      const cbRet = await recognizeWithParams(worker, cbBlob, variant.lang, variant.params);
      const text = cbRet && cbRet.data && cbRet.data.text ? cbRet.data.text : '';
      const combo = parseComboText(text);
      const score = scoreComboText(text);
      if (score > bestComboScore) {
        bestComboScore = score;
        bestCombo = combo;
      }
    }

    return {
      title: finalTitle,
      level: level,
      diff: diffCode,
      perfect: bestBreakdown.perfect,
      great: bestBreakdown.great,
      good: bestBreakdown.good,
      bad: bestBreakdown.bad,
      miss: bestBreakdown.miss,
      combo: bestCombo,
      musicId: musicId
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}
