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
 *   - 判定内訳 (PERFECT/GREAT/GOOD/BAD/MISS) ※元のGOOD/BAD/MISS読み取り範囲を拡張
 *   - コンボ数 ※新規追加(暫定の読み取り範囲。設定画面で調整してください)
 * -----------------------------------------------------------------------
 */

// 画像の指定範囲(比率 x,y,w,h ∈ [0,1])を切り出してCanvas化する。
// OCR用に少し大きめに拡大し、必要に応じて二値化/反転も行えるようにしている。
async function cropImage(imageElement, xRatio, yRatio, wRatio, hRatio, type = 'filter-standard', opts = {}) {
  const canvas = document.createElement('canvas');
  const w = imageElement.naturalWidth;
  const h = imageElement.naturalHeight;
  const ctx = canvas.getContext('2d');

  const scale = opts.scale || 1;
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 180;
  const invert = !!opts.invert;

  if (type === 'threshold-diff' || type === 'threshold-strong') {
    canvas.width = Math.max(1, Math.round(w * wRatio * scale));
    canvas.height = Math.max(1, Math.round(h * hRatio * scale));
    ctx.drawImage(imageElement, w * xRatio, h * yRatio, w * wRatio, h * hRatio, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      let v = gray > threshold ? 0 : 255;
      if (invert) v = 255 - v;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    canvas.width = Math.max(1, Math.round(w * wRatio * scale));
    canvas.height = Math.max(1, Math.round(h * hRatio * scale));
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.filter = `grayscale(100%) contrast(${opts.contrast || 150}%) brightness(${opts.brightness || 100}%)`;
    ctx.drawImage(imageElement, w * xRatio, h * yRatio, w * wRatio, h * hRatio, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function normalizeOcrText(text) {
  return normalizeString((text || '').normalize ? text.normalize('NFKC') : String(text || ''))
    .replace(/[｜|]/g, '')
    .replace(/[“”"']/g, '')
    .trim();
}

function extractLongestNumber(text) {
  const matches = (text || '').match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  let best = matches[0];
  for (const m of matches) {
    if (m.length > best.length) best = m;
  }
  return parseInt(best, 10);
}

async function recognizeBest(worker, blob, attempts) {
  let best = null;

  for (const attempt of attempts) {
    try {
      const result = await worker.recognize(blob, attempt.options || {});
      const rawText = result?.data?.text || '';
      const confidence = Number.isFinite(result?.data?.confidence) ? result.data.confidence : 0;
      const score = attempt.score ? attempt.score(rawText, confidence, result) : confidence;

      if (
        !best ||
        score > best.score ||
        (score === best.score && confidence > best.confidence)
      ) {
        best = {
          text: rawText,
          confidence,
          score,
          result,
        };
      }
    } catch (e) {
      console.error('OCR attempt failed', e);
    }
  }

  return best || { text: '', confidence: 0, score: 0, result: null };
}

function scoreTitleCandidate(text, confidence) {
  const matchedMusic = findBestMatchMusic(text);
  if (!matchedMusic) {
    return {
      matchedMusic: null,
      score: confidence * 0.2,
    };
  }

  const target = normalizeString(text);
  const title = normalizeString(matchedMusic.title);
  const dist = levenshtein(target, title);
  const ratio = dist / Math.max(target.length || 1, title.length || 1);
  let score = (1 - ratio) * 100 + confidence * 0.15;

  if (target && (target.includes(title) || title.includes(target))) score += 10;
  if (target === title) score += 20;

  return { matchedMusic, score };
}

// OCRで読み取った文字列から難易度を判定する。
// 完全一致(部分文字列として含む)を優先し、見つからない場合はレーベンシュタイン距離で
// 最も近い難易度名を採用する(6種類すべてに対して一貫した精度で判定するため)。
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

function isLikelyLabel(line, label) {
  const clean = normalizeOcrText(line).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const target = label.toUpperCase();
  if (!clean) return false;
  if (clean.includes(target)) return true;
  return levenshtein(clean.replace(/\d+/g, ''), target) <= 2;
}

// 判定内訳のテキストから PERFECT/GREAT/GOOD/BAD/MISS の数値を読み取る。
// 文字の誤認識を考慮し、完全一致だけでなく近似一致も受け付ける。
function parseBreakdownText(text) {
  const lines = (text || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  let perfect = 0, great = 0, good = 0, bad = 0, miss = 0;

  const candidates = [
    { key: 'perfect', label: 'PERFECT' },
    { key: 'great',   label: 'GREAT'   },
    { key: 'good',    label: 'GOOD'    },
    { key: 'bad',     label: 'BAD'     },
    { key: 'miss',    label: 'MISS'    },
  ];

  for (const line of lines) {
    const nums = line.match(/\d+/g);
    if (!nums) continue;
    const value = parseInt(nums[nums.length - 1], 10);
    const normalized = normalizeOcrText(line).toUpperCase();

    for (const c of candidates) {
      if (c.key === 'good' && /G[O0QD]{2}D|GOOD/.test(normalized)) {
        good = good || value;
      } else if (isLikelyLabel(normalized, c.label)) {
        if (c.key === 'perfect') perfect = perfect || value;
        if (c.key === 'great') great = great || value;
        if (c.key === 'good') good = good || value;
        if (c.key === 'bad') bad = bad || value;
        if (c.key === 'miss') miss = miss || value;
      }
    }
  }

  return { perfect, great, good, bad, miss };
}

// コンボ数のテキストから最も桁数の多い数値を採用する。
// 「COMBO」ラベルが読めていれば、その行の数値を優先する。
function parseComboText(text) {
  const lines = (text || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  for (const line of lines) {
    if (/COMBO|コンボ/i.test(line)) {
      const nums = line.match(/\d+/g);
      if (nums && nums.length > 0) {
        return parseInt(nums[nums.length - 1], 10);
      }
    }
  }
  const matches = (text || '').match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  let best = matches[0];
  for (const m of matches) { if (m.length > best.length) best = m; }
  return parseInt(best, 10);
}

// 画像1枚を解析する。regions には { difficulty, title, breakdown, combo } (各 {x,y,w,h}) を渡す。
async function analyzeLoadedImage(imgElement, worker, regions) {
  const r = regions || DEFAULT_REGIONS;
  try {
    // 難易度
    const diffR = r.difficulty;
    const diffBlob = await cropImage(imgElement, diffR.x, diffR.y, diffR.w, diffR.h, 'threshold-diff', {
      scale: 3,
      threshold: 170,
    });
    const diffAltBlob = await cropImage(imgElement, diffR.x, diffR.y, diffR.w, diffR.h, 'filter-standard', {
      scale: 3,
      contrast: 180,
      brightness: 105,
    });

    const diffBest = await recognizeBest(worker, diffBlob, [
      {
        options: {
          lang: 'eng',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          tessedit_pageseg_mode: 8,
          user_defined_dpi: 300,
        },
      },
      {
        options: {
          lang: 'eng',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          tessedit_pageseg_mode: 7,
          user_defined_dpi: 300,
        },
      },
    ]);

    const diffBestAlt = await recognizeBest(worker, diffAltBlob, [
      {
        options: {
          lang: 'eng',
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          tessedit_pageseg_mode: 8,
          user_defined_dpi: 300,
        },
      },
    ]);

    const diffText = [diffBest.text, diffBestAlt.text].filter(Boolean).join('\n');
    const diffCode = detectDifficultyCode(diffText.toUpperCase());
    const dbKey = getDiffDbKey(diffCode);

    // 曲名
    const titleR = r.title;
    const titleBlob = await cropImage(imgElement, titleR.x, titleR.y, titleR.w, titleR.h, 'filter-standard', {
      scale: 3,
      contrast: 180,
      brightness: 110,
    });
    const titleAltBlob = await cropImage(imgElement, titleR.x, titleR.y, titleR.w, titleR.h, 'filter-standard', {
      scale: 4,
      contrast: 165,
      brightness: 105,
    });

    const titleAttempts = [
      {
        options: {
          lang: 'jpn',
          tessedit_pageseg_mode: 7,
          user_defined_dpi: 300,
        },
      },
      {
        options: {
          lang: 'jpn',
          tessedit_pageseg_mode: 6,
          user_defined_dpi: 300,
        },
      },
      {
        options: {
          lang: 'jpn+eng',
          tessedit_pageseg_mode: 7,
          user_defined_dpi: 300,
        },
      },
    ];

    const titleBest1 = await recognizeBest(worker, titleBlob, titleAttempts);
    const titleBest2 = await recognizeBest(worker, titleAltBlob, titleAttempts);

    const titleCandidates = [titleBest1, titleBest2]
      .filter(v => v && v.text)
      .map(v => {
        const scored = scoreTitleCandidate(v.text, v.confidence || 0);
        return {
          text: v.text,
          confidence: v.confidence || 0,
          matchedMusic: scored.matchedMusic,
          score: scored.score,
        };
      })
      .sort((a, b) => b.score - a.score);

    const bestTitleCandidate = titleCandidates[0] || { text: '', matchedMusic: null };
    const matchedMusic = bestTitleCandidate.matchedMusic || findBestMatchMusic(bestTitleCandidate.text);
    const finalTitle = matchedMusic ? matchedMusic.title : normalizeOcrText(bestTitleCandidate.text).replace(/\r?\n/g, '').trim();
    const musicId = matchedMusic ? matchedMusic.id : null;

    // レベル
    let level = "";
    if (musicId) level = getLevelFromDb(musicId, dbKey) || "";

    // 判定内訳 (PERFECT/GREAT/GOOD/BAD/MISS)
    const bdR = r.breakdown;
    const bdBlob = await cropImage(imgElement, bdR.x, bdR.y, bdR.w, bdR.h, 'filter-standard', {
      scale: 3,
      contrast: 170,
      brightness: 108,
    });
    const bdAltBlob = await cropImage(imgElement, bdR.x, bdR.y, bdR.w, bdR.h, 'threshold-strong', {
      scale: 3,
      threshold: 170,
    });

    const bdBest1 = await recognizeBest(worker, bdBlob, [
      {
        options: {
          lang: 'jpn',
          tessedit_pageseg_mode: 6,
          user_defined_dpi: 300,
        },
      },
      {
        options: {
          lang: 'jpn+eng',
          tessedit_pageseg_mode: 6,
          user_defined_dpi: 300,
        },
      },
    ]);

    const bdBest2 = await recognizeBest(worker, bdAltBlob, [
      {
        options: {
          lang: 'jpn',
          tessedit_pageseg_mode: 6,
          user_defined_dpi: 300,
        },
      },
    ]);

    const breakdown = parseBreakdownText([bdBest1.text, bdBest2.text].filter(Boolean).join('\n'));

    // コンボ数
    const cbR = r.combo;
    const cbBlob = await cropImage(imgElement, cbR.x, cbR.y, cbR.w, cbR.h, 'filter-standard', {
      scale: 3,
      contrast: 175,
      brightness: 108,
    });
    const cbAltBlob = await cropImage(imgElement, cbR.x, cbR.y, cbR.w, cbR.h, 'threshold-strong', {
      scale: 3,
      threshold: 175,
    });

    const comboBest1 = await recognizeBest(worker, cbBlob, [
      {
        options: {
          lang: 'eng',
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: 7,
          user_defined_dpi: 300,
        },
      },
      {
        options: {
          lang: 'eng',
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: 8,
          user_defined_dpi: 300,
        },
      },
    ]);

    const comboBest2 = await recognizeBest(worker, cbAltBlob, [
      {
        options: {
          lang: 'eng',
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: 7,
          user_defined_dpi: 300,
        },
      },
    ]);

    const combo = parseComboText([comboBest1.text, comboBest2.text].filter(Boolean).join('\n'));

    return {
      title: finalTitle, level: level, diff: diffCode,
      perfect: breakdown.perfect, great: breakdown.great,
      good: breakdown.good, bad: breakdown.bad, miss: breakdown.miss,
      combo: combo,
      musicId: musicId
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}
