
import { DIFFICULTY_ORDER, DIFFICULTY_SHORT_TO_KEY, DIFFICULTY_LABELS } from './config.js';

function normalizeString(str) {
  return String(str || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '')
    .replace(/[\-_・]/g, '')
    .toUpperCase();
}

export function normalizeTitle(str) {
  return String(str || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '')
    .replace(/[\-_・]/g, '')
    .toLowerCase();
}

export function levenshtein(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 0; i < b.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < a.length; j++) {
      if (a[j] === b[i]) cur.push(prev[j]);
      else cur.push(1 + Math.min(prev[j], prev[j + 1], cur[cur.length - 1]));
    }
    prev = cur;
  }
  return prev[prev.length - 1];
}

export function findBestMatchMusic(ocrText, dbMusics = []) {
  if (!ocrText || !dbMusics.length) return null;
  const target = normalizeTitle(ocrText);
  if (!target) return null;
  let best = null;
  let bestScore = Infinity;
  for (const music of dbMusics) {
    const title = normalizeTitle(music.title || '');
    if (!title) continue;
    const dist = levenshtein(target, title);
    const score = dist / Math.max(target.length, title.length);
    if (score < bestScore) {
      bestScore = score;
      best = music;
    }
  }
  return best;
}

export function getLevelFromDb(musicId, diffKey, dbDiffs = []) {
  if (!musicId || !diffKey) return null;
  const entry = dbDiffs.find((d) => String(d.musicId) === String(musicId) && String(d.musicDifficulty).toLowerCase() === String(diffKey).toLowerCase());
  return entry ? Number(entry.playLevel) : null;
}

async function cropImage(imageElement, region, mode = 'standard') {
  const canvas = document.createElement('canvas');
  const w = imageElement.naturalWidth || imageElement.width;
  const h = imageElement.naturalHeight || imageElement.height;
  const ctx = canvas.getContext('2d');
  const x = Math.max(0, Math.min(1, region.x));
  const y = Math.max(0, Math.min(1, region.y));
  const rw = Math.max(0.001, Math.min(1, region.w));
  const rh = Math.max(0.001, Math.min(1, region.h));

  if (mode === 'threshold') {
    const scale = 1.5;
    canvas.width = Math.max(1, Math.floor(w * rw * scale));
    canvas.height = Math.max(1, Math.floor(h * rh * scale));
    ctx.drawImage(imageElement, w * x, h * y, w * rw, h * rh, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const bw = gray > 180 ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = bw;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    canvas.width = Math.max(1, Math.floor(w * rw));
    canvas.height = Math.max(1, Math.floor(h * rh));
    ctx.filter = 'grayscale(100%) contrast(150%)';
    ctx.drawImage(imageElement, w * x, h * y, w * rw, h * rh, 0, 0, canvas.width, canvas.height);
  }
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function extractLabelCount(text, patterns) {
  const lines = String(text || '').split(/\r?\n/).map((l) => normalizeString(l)).filter(Boolean);
  for (const line of lines) {
    for (const pat of patterns) {
      if (pat.test(line)) {
        const nums = line.match(/\d+/g);
        if (nums && nums.length) return Number(nums[nums.length - 1]);
      }
    }
  }
  const joined = lines.join(' ');
  if (patterns.some((p) => p.test(joined))) {
    const nums = joined.match(/\d+/g);
    if (nums && nums.length) return Number(nums[nums.length - 1]);
  }
  return 0;
}

function parseDifficultyText(text) {
  const t = normalizeString(text);
  if (/A?PP?E?N?D/.test(t)) return 'append';
  if (/M[AE]S?T?E?R/.test(t)) return 'master';
  if (/E[XP]?[PE]?[ER]?[RT]?/.test(t) && /EXPERT/.test(t)) return 'expert';
  if (/N[O0]RMAL/.test(t)) return 'normal';
  if (/EAS[YV]/.test(t)) return 'easy';
  if (/HARD/.test(t)) return 'hard';
  // exact words are preferred, but if OCR is weak, fall back to expert.
  if (t.includes('NORMAL')) return 'normal';
  if (t.includes('EASY')) return 'easy';
  if (t.includes('EXPERT')) return 'expert';
  if (t.includes('MASTER')) return 'master';
  if (t.includes('APPEND')) return 'append';
  if (t.includes('HARD')) return 'hard';
  return 'expert';
}

function parseComboText(text) {
  const t = normalizeString(text);
  const nums = t.match(/\d+/g);
  return nums && nums.length ? Number(nums[0]) : 0;
}

function parseResultCounts(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => normalizeString(l)).filter(Boolean);
  const get = (patterns) => {
    for (const line of lines) {
      if (patterns.some((p) => p.test(line))) {
        const nums = line.match(/\d+/g);
        if (nums && nums.length) return Number(nums[nums.length - 1]);
      }
    }
    return 0;
  };
  return {
    perfect: get([/^PERFECT/, /^PERFEC?T$/, /PERECT/]),
    great: get([/^GREAT/, /^GREATS?$/]),
    good: get([/^GOOD/, /^G00D/, /^GO0D/, /^G0OD/]),
    bad: get([/^BAD/]),
    miss: get([/^MISS/]),
  };
}

export async function analyzeImageWithProfile(imageElement, worker, profile, dbMusics = [], dbDiffs = []) {
  const regions = profile?.regions || {};
  const titleBlob = await cropImage(imageElement, regions.title || { x: 0.17, y: 0.02, w: 0.38, h: 0.06 }, 'standard');
  const diffBlob = await cropImage(imageElement, regions.diff || { x: 0.19, y: 0.075, w: 0.12, h: 0.04 }, 'threshold');
  const resultBlob = await cropImage(imageElement, regions.result || { x: 0.08, y: 0.52, w: 0.42, h: 0.28 }, 'standard');
  const comboBlob = await cropImage(imageElement, regions.combo || { x: 0.52, y: 0.42, w: 0.36, h: 0.18 }, 'threshold');

  const [titleRet, diffRet, resultRet, comboRet] = await Promise.all([
    worker.recognize(titleBlob, { lang: 'jpn' }),
    worker.recognize(diffBlob, { lang: 'eng' }),
    worker.recognize(resultBlob, { lang: 'jpn' }),
    worker.recognize(comboBlob, { lang: 'jpn' }),
  ]);

  const diffKey = parseDifficultyText(diffRet?.data?.text || '');
  const matchedMusic = findBestMatchMusic(titleRet?.data?.text || '', dbMusics);
  const title = matchedMusic ? (matchedMusic.title || String(titleRet?.data?.text || '').replace(/\r?\n/g, '').trim()) : String(titleRet?.data?.text || '').replace(/\r?\n/g, '').trim();
  const musicId = matchedMusic ? matchedMusic.id : null;
  const level = getLevelFromDb(musicId, diffKey, dbDiffs) || null;

  const counts = parseResultCounts(resultRet?.data?.text || '');
  const combo = parseComboText(comboRet?.data?.text || '');

  return {
    title,
    level,
    difficultyKey: diffKey,
    perfect: counts.perfect,
    great: counts.great,
    good: counts.good,
    bad: counts.bad,
    miss: counts.miss,
    totalMiss: counts.good + counts.bad + counts.miss,
    combo,
    musicId,
    raw: {
      title: titleRet?.data?.text || '',
      diff: diffRet?.data?.text || '',
      result: resultRet?.data?.text || '',
      combo: comboRet?.data?.text || '',
    },
  };
}

export function selectBestProfile(width, height, profiles = []) {
  const aspect = width / Math.max(1, height);
  let best = profiles[0] || null;
  let bestScore = Infinity;
  for (const profile of profiles) {
    const pAspect = (profile.width || 1) / Math.max(1, profile.height || 1);
    const aspectScore = Math.abs(pAspect - aspect) / aspect;
    const sizeScore = Math.abs((profile.width || 1) - width) / Math.max(1, width) + Math.abs((profile.height || 1) - height) / Math.max(1, height);
    const score = aspectScore * 3 + sizeScore;
    if (score < bestScore) {
      bestScore = score;
      best = profile;
    }
  }
  return best;
}

export async function readImageSize(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, imageUrl: url };
  } catch {
    return { width: 0, height: 0, imageUrl: url };
  }
}

export function getDifficultyOrder(key) {
  return DIFFICULTY_ORDER[key] ?? 99;
}

export function getDifficultyLabel(key) {
  return DIFFICULTY_LABELS[key] || String(key || '').toUpperCase();
}
