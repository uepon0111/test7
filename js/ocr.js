
import { DIFFICULTY_ALIASES } from './config.js';

async function loadImageElement(fileOrUrl) {
  const src = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(src);
      resolve(img);
    };
    img.onerror = (err) => {
      if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(src);
      reject(err);
    };
    img.src = src;
  });
}

export async function loadImageFromFile(fileOrUrl) {
  return await loadImageElement(fileOrUrl);
}

export function cropRegion(imageElement, region) {
  const canvas = document.createElement('canvas');
  const x = Math.max(0, Math.floor(imageElement.naturalWidth * region.x));
  const y = Math.max(0, Math.floor(imageElement.naturalHeight * region.y));
  const w = Math.max(1, Math.floor(imageElement.naturalWidth * region.w));
  const h = Math.max(1, Math.floor(imageElement.naturalHeight * region.h));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageElement, x, y, w, h, 0, 0, w, h);
  return canvas;
}

async function recognizeText(canvas, lang) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const res = await window.Tesseract.recognize(blob, lang);
  return (res?.data?.text || '').trim();
}

function normalizeDiffText(text) {
  const t = String(text || '').toUpperCase().replace(/\s+/g, '');
  if (t.includes('APPEND')) return 'APPEND';
  if (t.includes('MASTER')) return 'MASTER';
  if (t.includes('EXPERT')) return 'EXPERT';
  if (t.includes('HARD')) return 'HARD';
  if (t.includes('NORMAL')) return 'NORMAL';
  if (t.includes('EASY')) return 'EASY';

  for (const [key, value] of Object.entries(DIFFICULTY_ALIASES)) {
    if (t === key || t.includes(key)) return value;
  }
  return null;
}

export function detectProfileFromImageSize(profiles, width, height) {
  const list = Object.values(profiles || {});
  if (list.length === 0) return null;
  const ratio = width / height;
  let best = list[0];
  let bestScore = Infinity;
  for (const profile of list) {
    const pW = Number(profile.width) || width;
    const pH = Number(profile.height) || height;
    const pRatio = Number(profile.ratio) || (pW / pH);
    const score = Math.abs(width - pW) / Math.max(width, pW)
      + Math.abs(height - pH) / Math.max(height, pH)
      + Math.abs(ratio - pRatio) * 1.8;
    if (score < bestScore) {
      bestScore = score;
      best = profile;
    }
  }
  return best;
}

export async function analyzeScreenshot(file, profile) {
  const img = await loadImageFromFile(file);
  const regions = profile?.regions || {};
  const diffCanvas = cropRegion(img, regions.difficulty);
  const titleCanvas = cropRegion(img, regions.title);
  const resultCanvas = cropRegion(img, regions.result);
  const comboCanvas = cropRegion(img, regions.combo);

  const [diffText, titleText, resultText, comboText] = await Promise.all([
    recognizeText(diffCanvas, 'eng'),
    recognizeText(titleCanvas, 'jpn'),
    recognizeText(resultCanvas, 'eng'),
    recognizeText(comboCanvas, 'eng'),
  ]);

  const diff = normalizeDiffText(diffText) || 'EXPERT';

  const counts = {
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    miss: 0,
  };

  const lines = String(resultText || '')
    .toUpperCase()
    .replace(/O/g, '0')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const patterns = [
    { key: 'perfect', re: /PERFECT/ },
    { key: 'great', re: /GREAT/ },
    { key: 'good', re: /GOOD/ },
    { key: 'bad', re: /BAD/ },
    { key: 'miss', re: /MISS/ },
  ];

  const parseCount = (line) => {
    const nums = line.match(/\d+/g);
    return nums ? parseInt(nums[nums.length - 1], 10) : 0;
  };

  for (const line of lines) {
    for (const p of patterns) {
      if (p.re.test(line)) {
        counts[p.key] = parseCount(line);
      }
    }
  }

  const comboNums = String(comboText || '').match(/\d+/g);
  const combo = comboNums ? parseInt(comboNums[comboNums.length - 1], 10) : null;

  return {
    raw: {
      diffText,
      titleText,
      resultText,
      comboText,
    },
    diff,
    titleText: String(titleText || '').replace(/\r?\n/g, ' ').trim(),
    counts,
    combo,
    image: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
}

export function getImageSize(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
