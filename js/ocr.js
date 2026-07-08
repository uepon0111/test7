import { appState, getActiveProfile, selectBestProfileForImage, getDifficultyCode, getDifficultyLabel } from './state.js';
import { normalizeString, clamp } from './utils.js';

let workerPromise = null;

async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const worker = await Tesseract.createWorker('jpn+eng', 1, {
      logger: () => {}
    });
    return worker;
  })();
  return workerPromise;
}

function getRegion(profile, key) {
  const p = profile || getActiveProfile();
  return p?.regions?.[key] || { x: 0, y: 0, w: 10, h: 10 };
}

export function cropImage(imageElement, region, kind = 'standard') {
  const canvas = document.createElement('canvas');
  const w = imageElement.naturalWidth;
  const h = imageElement.naturalHeight;
  const x = w * (region.x / 100);
  const y = h * (region.y / 100);
  const cw = w * (region.w / 100);
  const ch = h * (region.h / 100);
  canvas.width = Math.max(1, Math.round(cw));
  canvas.height = Math.max(1, Math.round(ch));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (kind === 'threshold') {
    ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = gray > 150 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
  } else if (kind === 'gray') {
    ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
  }

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export function findBestMatchMusic(ocrText) {
  if (!appState.dbMusics || appState.dbMusics.length === 0) return null;
  const target = normalizeString(ocrText);
  if (!target) return null;

  const levenshtein = (s1, s2) => {
    if (s1.length > s2.length) [s1, s2] = [s2, s1];
    let dist = Array.from({ length: s1.length + 1 }, (_, i) => i);
    for (let i2 = 0; i2 < s2.length; i2++) {
      let newDist = [i2 + 1];
      for (let i1 = 0; i1 < s1.length; i1++) {
        if (s1[i1] === s2[i2]) newDist.push(dist[i1]);
        else newDist.push(1 + Math.min(dist[i1], dist[i1 + 1], newDist[newDist.length - 1]));
      }
      dist = newDist;
    }
    return dist[dist.length - 1];
  };

  let bestMatch = null;
  let minScore = Infinity;
  for (const music of appState.dbMusics) {
    const dbTitleNorm = normalizeString(music.title);
    if (!dbTitleNorm) continue;
    const dist = levenshtein(target, dbTitleNorm);
    const score = dist / Math.max(target.length, dbTitleNorm.length);
    if (score < minScore) {
      minScore = score;
      bestMatch = music;
    }
  }
  return bestMatch;
}

function parseCountLine(lines, labelRegex) {
  for (const line of lines) {
    if (labelRegex.test(line)) {
      const nums = String(line).match(/\d+/g);
      if (nums && nums.length) return parseInt(nums[nums.length - 1], 10);
    }
  }
  return 0;
}

function parseLabel(text) {
  const t = String(text || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (t.includes('APPEND')) return 'A';
  if (t.includes('MASTER')) return 'M';
  if (t.includes('EXPERT')) return 'E2';
  if (t.includes('HARD')) return 'H';
  if (t.includes('NORMAL')) return 'N';
  if (t.includes('EASY')) return 'E';
  return 'M';
}

function detectDifficultyText(text) {
  const upper = String(text || '').toUpperCase();
  if (upper.includes('APPEND')) return { code: 'A', label: 'APPEND' };
  if (upper.includes('MASTER')) return { code: 'M', label: 'MASTER' };
  if (upper.includes('EXPERT')) return { code: 'E2', label: 'EXPERT' };
  if (upper.includes('HARD')) return { code: 'H', label: 'HARD' };
  if (upper.includes('NORMAL')) return { code: 'N', label: 'NORMAL' };
  if (upper.includes('EASY')) return { code: 'E', label: 'EASY' };
  return { code: 'M', label: 'MASTER' };
}

export async function analyzeLoadedImage(imgElement, profile = null) {
  try {
    const p = profile || getActiveProfile();
    const worker = await getWorker();

    const diffBlob = await cropImage(imgElement, getRegion(p, 'diff'), 'threshold');
    const diffRet = await worker.recognize(diffBlob, { lang: 'eng' });
    const diffInfo = detectDifficultyText(diffRet.data.text || '');
    const diffCode = diffInfo.code;

    const titleBlob = await cropImage(imgElement, getRegion(p, 'title'), 'gray');
    const titleRet = await worker.recognize(titleBlob, { lang: 'jpn' });
    const matchedMusic = findBestMatchMusic(titleRet.data.text || '');
    const title = matchedMusic ? matchedMusic.title : String(titleRet.data.text || '').replace(/\r?\n/g, '').trim();

    const level = matchedMusic
      ? String(getLevelFromDb(matchedMusic.id, diffCode) || '')
      : '';

    const resultBlob = await cropImage(imgElement, getRegion(p, 'result'), 'gray');
    const resultRet = await worker.recognize(resultBlob, { lang: 'eng' });
    const lines = String(resultRet.data.text || '').split('\n').map(s => s.trim()).filter(Boolean);

    const perfect = parseCountLine(lines, /PERFECT/i);
    const great = parseCountLine(lines, /GREAT/i);
    const good = parseCountLine(lines, /GOOD/i);
    const bad = parseCountLine(lines, /BAD/i);
    const miss = parseCountLine(lines, /MISS/i);

    const comboBlob = await cropImage(imgElement, getRegion(p, 'combo'), 'gray');
    const comboRet = await worker.recognize(comboBlob, { lang: 'eng' });
    const comboText = String(comboRet.data.text || '').replace(/\s+/g, ' ');
    const comboNums = comboText.match(/\d+/g);
    const combo = comboNums && comboNums.length ? parseInt(comboNums[comboNums.length - 1], 10) : 0;

    return {
      title,
      level,
      diff: diffCode,
      difficultyRaw: diffCode,
      difficulty: diffInfo.label,
      perfectCount: perfect,
      greatCount: great,
      goodCount: good,
      badCount: bad,
      missDetailCount: miss,
      totalMiss: good + bad + miss,
      comboCount: combo,
      musicId: matchedMusic ? matchedMusic.id : null
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

export function getLevelFromDb(musicId, diffKey) {
  if (!musicId || !diffKey || !appState.dbDiffs) return null;
  const entry = appState.dbDiffs.find(d => String(d.musicId) === String(musicId) && getDifficultyCode(d.musicDifficulty) === diffKey);
  return entry ? entry.playLevel : null;
}

export function autoProfileForSize(width, height) {
  return selectBestProfileForImage(width, height);
}

export async function analyzeWithProfile(imgElement, profileId) {
  const p = appState.settings.profiles.find(x => x.id === profileId) || getActiveProfile();
  return await analyzeLoadedImage(imgElement, p);
}
