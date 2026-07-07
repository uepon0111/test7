import { DEFAULT_CROPS } from './config.js';
import { state } from './state.js';

let workerPromise = null;

export async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker();
  }
  return workerPromise;
}

export async function cropImage(imageElement, region, mode = 'standard') {
  const { x, y, w, h } = region;
  const canvas = document.createElement('canvas');
  const srcWidth = imageElement.naturalWidth;
  const srcHeight = imageElement.naturalHeight;
  const ctx = canvas.getContext('2d');

  if (mode === 'threshold') {
    const scale = 1.5;
    canvas.width = Math.max(1, Math.round(srcWidth * w * scale));
    canvas.height = Math.max(1, Math.round(srcHeight * h * scale));
    ctx.drawImage(imageElement, srcWidth * x, srcHeight * y, srcWidth * w, srcHeight * h, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const value = gray > 180 ? 0 : 255;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    canvas.width = Math.max(1, Math.round(srcWidth * w));
    canvas.height = Math.max(1, Math.round(srcHeight * h));
    ctx.filter = 'grayscale(100%) contrast(150%)';
    ctx.drawImage(imageElement, srcWidth * x, srcHeight * y, srcWidth * w, srcHeight * h, 0, 0, canvas.width, canvas.height);
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function recognizeBlob(blob, lang) {
  const worker = await getOcrWorker();
  const result = await worker.recognize(blob, { lang });
  return result?.data?.text || '';
}

function normalizeText(value) {
  return String(value || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/[|]/g, 'I')
    .replace(/[Oo]/g, '0');
}

function parseNumberAfterLabel(text, labelPattern) {
  const normalized = normalizeText(text).toUpperCase();
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (labelPattern.test(line)) {
      const numbers = line.match(/\d+/g);
      if (numbers && numbers.length > 0) {
        return Number.parseInt(numbers[numbers.length - 1], 10);
      }
    }
  }
  return null;
}

function parseAllJudgements(text) {
  const normalized = normalizeText(text).toUpperCase();
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = {
    perfect: null,
    great: null,
    good: null,
    bad: null,
    miss: null,
  };

  const labels = [
    ['perfect', /PERFECT/],
    ['great', /GREAT/],
    ['good', /GOOD/],
    ['bad', /BAD/],
    ['miss', /MISS/],
  ];

  for (const line of lines) {
    for (const [key, regex] of labels) {
      if (regex.test(line)) {
        const numbers = line.match(/\d+/g);
        if (numbers && numbers.length > 0) {
          result[key] = Number.parseInt(numbers[numbers.length - 1], 10);
        }
      }
    }
  }

  return result;
}

function parseCombo(text) {
  const normalized = normalizeText(text).toUpperCase();
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/COMBO/.test(line)) {
      const numbers = line.match(/\d+/g);
      if (numbers && numbers.length > 0) {
        return Number.parseInt(numbers[numbers.length - 1], 10);
      }
    }
  }
  return null;
}

function normalizeDifficultyToken(token) {
  const value = String(token || '').toUpperCase();
  if (value.includes('APPEND') || value === 'A') return 'APPEND';
  if (value.includes('MASTER') || value === 'M') return 'MASTER';
  if (value.includes('EXPERT') || value === 'E') return 'EXPERT';
  if (value.includes('HARD') || value === 'H') return 'HARD';
  if (value.includes('NORMAL') || value === 'N') return 'NORMAL';
  if (value.includes('EASY')) return 'EASY';
  return 'EXPERT';
}

function levenshtein(a, b) {
  const s1 = String(a || '');
  const s2 = String(b || '');
  const rows = s1.length + 1;
  const cols = s2.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[rows - 1][cols - 1];
}

function normalizeSearchText(text) {
  return String(text || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!！?？.,。、:：・\-―_「」『』（）()【】\[\]{}]/g, '')
    .toLowerCase();
}

function findBestMatchMusic(ocrText) {
  const target = normalizeSearchText(ocrText);
  if (!target) return null;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const music of state.dbMusics || []) {
    const candidates = [
      music.title,
      music.titleRuby,
      music.title_kana,
      music.titleRomaji,
      music.titleRoman,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const score = levenshtein(target, normalizeSearchText(candidate));
      if (score < bestScore) {
        bestScore = score;
        best = music;
      }
    }
  }

  return bestScore <= Math.max(2, Math.floor(target.length * 0.2)) ? best : null;
}

function getLevelFromDb(musicId, diffKey) {
  if (!musicId || !diffKey || !state.dbDiffs?.length) return null;
  const normalized = normalizeDifficultyToken(diffKey);

  const matched = state.dbDiffs.find((entry) => {
    const entryMusicId = entry.musicId ?? entry.music_id ?? entry.musicID ?? entry.id ?? entry.music_id;
    if (String(entryMusicId) !== String(musicId)) return false;

    const tokens = [
      entry.difficulty,
      entry.diff,
      entry.musicDifficulty,
      entry.levelType,
      entry.category,
      entry.difficultyName,
      entry.difficulty_name,
    ]
      .filter(Boolean)
      .map((value) => String(value).toUpperCase());

    const hasToken = tokens.some((token) => {
      if (token === normalized) return true;
      if (normalized === 'APPEND' && token.startsWith('APP')) return true;
      if (normalized === 'MASTER' && token.startsWith('MAS')) return true;
      if (normalized === 'EXPERT' && token.startsWith('EXP')) return true;
      if (normalized === 'HARD' && token.startsWith('HAR')) return true;
      if (normalized === 'NORMAL' && token.startsWith('NOR')) return true;
      if (normalized === 'EASY' && token.startsWith('EAS')) return true;
      return false;
    });

    return hasToken;
  });

  if (!matched) return null;

  const levelValue = [
    matched.playLevel,
    matched.level,
    matched.musicLevel,
    matched.difficultyLevel,
    matched.difficulty_level,
    matched.basicLevel,
  ].find((value) => value != null && value !== '');

  if (levelValue == null) return null;
  const numeric = Number(levelValue);
  return Number.isFinite(numeric) ? numeric : String(levelValue);
}

export async function analyzeImageFromElement(imageElement, cropSettings = DEFAULT_CROPS) {
  try {
    const diffBlob = await cropImage(imageElement, cropSettings.diff, 'threshold');
    const diffText = normalizeText(await recognizeBlob(diffBlob, 'eng')).toUpperCase();
    let difficulty = 'EXPERT';
    if (/APPEND|^A$/.test(diffText)) difficulty = 'APPEND';
    else if (/MASTER|^M$/.test(diffText)) difficulty = 'MASTER';
    else if (/EXPERT|^E$/.test(diffText)) difficulty = 'EXPERT';
    else if (/HARD|^H$/.test(diffText)) difficulty = 'HARD';
    else if (/NORMAL|^N$/.test(diffText)) difficulty = 'NORMAL';
    else if (/EASY/.test(diffText)) difficulty = 'EASY';

    const titleBlob = await cropImage(imageElement, cropSettings.title, 'standard');
    const titleText = normalizeText(await recognizeBlob(titleBlob, 'jpn'));
    const matchedMusic = findBestMatchMusic(titleText);
    const title = matchedMusic?.title || titleText.replace(/\r?\n/g, ' ').trim();
    const musicId = matchedMusic?.id ?? null;

    let level = null;
    if (musicId) {
      level = getLevelFromDb(musicId, difficulty);
    }

    const resultBlob = await cropImage(imageElement, cropSettings.result, 'standard');
    const resultText = await recognizeBlob(resultBlob, 'jpn');
    const judgements = parseAllJudgements(resultText);

    const comboBlob = await cropImage(imageElement, cropSettings.combo, 'standard');
    const comboText = await recognizeBlob(comboBlob, 'jpn');
    const comboCount = parseCombo(comboText) ?? parseCombo(resultText);

    const good = Number.isFinite(judgements.good) ? judgements.good : 0;
    const bad = Number.isFinite(judgements.bad) ? judgements.bad : 0;
    const miss = Number.isFinite(judgements.miss) ? judgements.miss : 0;

    return {
      title,
      level,
      difficulty,
      musicId,
      metrics: {
        perfect: Number.isFinite(judgements.perfect) ? judgements.perfect : 0,
        great: Number.isFinite(judgements.great) ? judgements.great : 0,
        good,
        bad,
        miss,
        combo: Number.isFinite(comboCount) ? comboCount : 0,
      },
      raw: {
        diffText,
        titleText,
        resultText,
        comboText,
      },
      totalMiss: good + bad + miss,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}
