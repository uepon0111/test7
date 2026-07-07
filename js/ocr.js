import { DEFAULT_REGIONS, difficultyDbKeyOf, normalizeDifficultyCode } from './config.js';

let dbMusics = [];
let dbDiffs = [];
let dbPromise = null;

export async function preloadMusicDatabase() {
  if (!dbPromise) {
    dbPromise = Promise.all([
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json').then((r) => r.json()),
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json').then((r) => r.json()),
    ]).then(([musics, diffs]) => {
      dbMusics = musics || [];
      dbDiffs = diffs || [];
      return { dbMusics, dbDiffs };
    }).catch((error) => {
      console.error('DB load error', error);
      dbMusics = [];
      dbDiffs = [];
      return { dbMusics, dbDiffs };
    });
  }
  return dbPromise;
}

export function getDbState() {
  return { dbMusics, dbDiffs };
}

export function normalizeString(str) {
  if (!str) return '';
  return String(str)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .replace(/[\s\-_・｡。]/g, '');
}

export function findBestMatchMusic(ocrText) {
  if (!dbMusics || dbMusics.length === 0) return null;
  const target = normalizeString(ocrText);
  if (!target) return null;

  let bestMatch = null;
  let minScore = Infinity;

  const levenshtein = (s1, s2) => {
    if (s1.length > s2.length) [s1, s2] = [s2, s1];
    let dist = Array.from({ length: s1.length + 1 }, (_, i) => i);
    for (let i2 = 0; i2 < s2.length; i2++) {
      const newDist = [i2 + 1];
      for (let i1 = 0; i1 < s1.length; i1++) {
        if (s1[i1] === s2[i2]) newDist.push(dist[i1]);
        else newDist.push(1 + Math.min(dist[i1], dist[i1 + 1], newDist[newDist.length - 1]));
      }
      dist = newDist;
    }
    return dist[dist.length - 1];
  };

  for (const music of dbMusics) {
    const dbTitleNorm = normalizeString(music.title);
    const dist = levenshtein(target, dbTitleNorm);
    const score = dist / Math.max(target.length, dbTitleNorm.length);
    if (score < minScore) {
      minScore = score;
      bestMatch = music;
    }
  }
  return bestMatch;
}

export function getLevelFromDb(musicId, diffKey) {
  if (!musicId || !diffKey || !dbDiffs) return null;
  const entry = dbDiffs.find((d) => d.musicId === musicId && d.musicDifficulty === diffKey);
  return entry ? entry.playLevel : null;
}

export function normalizeDifficultyText(text) {
  const raw = String(text || '').toUpperCase().replace(/\s+/g, '');
  if (!raw) return 'EXPERT';

  if (/APPEND/.test(raw) || /APEND/.test(raw) || /A{1,}P{0,}E{0,}N{0,}D/.test(raw)) return 'APPEND';
  if (/MASTER/.test(raw)) return 'MASTER';
  if (/EXPERT/.test(raw)) return 'EXPERT';
  if (/HARD/.test(raw)) return 'HARD';
  if (/NORMAL/.test(raw)) return 'NORMAL';
  if (/EASY/.test(raw)) return 'EASY';

  return normalizeDifficultyCode(raw);
}

async function cropImage(imageElement, region, mode = 'standard') {
  const canvas = document.createElement('canvas');
  const w = imageElement.naturalWidth;
  const h = imageElement.naturalHeight;
  const x = Math.round((region?.x || 0) * w);
  const y = Math.round((region?.y || 0) * h);
  const cw = Math.max(1, Math.round((region?.w || 0.01) * w));
  const ch = Math.max(1, Math.round((region?.h || 0.01) * h));

  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, cw, ch);

  if (mode === 'threshold') {
    const imageData = ctx.getImageData(0, 0, cw, ch);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = gray > 180 ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    ctx.filter = 'grayscale(100%) contrast(140%)';
    ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, cw, ch);
  }

  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function extractNumberByLabel(text, labels) {
  const lines = String(text || '').split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.toUpperCase().replace(/\s+/g, ' ');
    for (const label of labels) {
      const labelRe = new RegExp(`${label}\\s*[:：]?\\s*(\\d+)`, 'i');
      const reverseRe = new RegExp(`(\\d+)\\s*[:：]?\\s*${label}`, 'i');
      let m = line.match(labelRe) || line.match(reverseRe);
      if (!m && line.includes(label)) {
        const nums = line.match(/\d+/g);
        if (nums && nums.length > 0) return parseInt(nums[nums.length - 1], 10);
      }
      if (m) return parseInt(m[1], 10);
    }
  }
  return null;
}

function parseResultCounts(text) {
  const perfect = extractNumberByLabel(text, ['PERFECT']);
  const great = extractNumberByLabel(text, ['GREAT']);
  const good = extractNumberByLabel(text, ['GOOD']);
  const bad = extractNumberByLabel(text, ['BAD']);
  const miss = extractNumberByLabel(text, ['MISS']);

  return {
    perfect: perfect ?? 0,
    great: great ?? 0,
    good: good ?? 0,
    bad: bad ?? 0,
    miss: miss ?? 0,
  };
}

function parseComboCount(text) {
  const normalized = String(text || '').toUpperCase().replace(/\s+/g, ' ');
  const match = normalized.match(/(?:MAX\s*)?COMBO[^0-9]*(\d+)|(\d+)\s*(?:MAX\s*)?COMBO/i);
  if (match) return parseInt(match[1] || match[2], 10);

  const numbers = normalized.match(/\d+/g);
  if (numbers && numbers.length === 1) return parseInt(numbers[0], 10);

  return null;
}

export async function analyzeLoadedImage(imgElement, worker, profile) {
  const regions = profile?.regions || DEFAULT_REGIONS;

  const diffBlob = await cropImage(imgElement, regions.diff, 'threshold');
  const diffRet = await worker.recognize(diffBlob, { lang: 'eng' });
  const diffText = diffRet.data.text || '';
  const diffRaw = normalizeDifficultyText(diffText);

  const titleBlob = await cropImage(imgElement, regions.title, 'standard');
  const titleRet = await worker.recognize(titleBlob, { lang: 'jpn' });
  const titleText = (titleRet.data.text || '').replace(/\r?\n/g, ' ').trim();
  const matchedMusic = findBestMatchMusic(titleText);
  const finalTitle = matchedMusic ? matchedMusic.title : titleText;
  const musicId = matchedMusic ? matchedMusic.id : null;
  const level = musicId ? (getLevelFromDb(musicId, difficultyDbKeyOf(diffRaw)) || '') : '';

  const resultBlob = await cropImage(imgElement, regions.result, 'standard');
  const resultRet = await worker.recognize(resultBlob, { lang: 'jpn' });
  const resultCounts = parseResultCounts(resultRet.data.text || '');
  const missCount = resultCounts.good + resultCounts.bad + resultCounts.miss;

  const comboBlob = await cropImage(imgElement, regions.combo, 'standard');
  const comboRet = await worker.recognize(comboBlob, { lang: 'eng' });
  const comboCount = parseComboCount(comboRet.data.text || '');

  return {
    title: finalTitle,
    level,
    diff: diffRaw,
    perfect: resultCounts.perfect,
    great: resultCounts.great,
    good: resultCounts.good,
    bad: resultCounts.bad,
    miss: resultCounts.miss,
    missCount,
    combo: comboCount,
    musicId,
  };
}
