
import { DEFAULT_REGIONS, DIFFICULTIES } from './state.js';
import { getCurrentPreset, normalizeRect } from './settings.js';

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function cropImage(imageElement, rect, options = {}) {
  const { threshold = false, contrast = true, scale = 1.5 } = options;
  const { naturalWidth: w, naturalHeight: h } = imageElement;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const x = w * rect.x;
  const y = h * rect.y;
  const cw = Math.max(1, w * rect.w);
  const ch = Math.max(1, h * rect.h);

  if (threshold) {
    canvas.width = Math.max(1, Math.round(cw * scale));
    canvas.height = Math.max(1, Math.round(ch * scale));
    ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = gray > 180 ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    canvas.width = Math.max(1, Math.round(cw));
    canvas.height = Math.max(1, Math.round(ch));
    ctx.filter = contrast ? 'grayscale(100%) contrast(160%)' : 'none';
    ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
  }
  return canvasToBlob(canvas);
}

function normalizeText(value) {
  return String(value || '')
    .replace(/[\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function detectDifficulty(text) {
  const t = normalizeText(text);
  if (/(?:A\s*P+E?N?D|APPEND)/.test(t)) return 'APPEND';
  if (/MASTER/.test(t)) return 'MASTER';
  if (/EXPERT/.test(t)) return 'EXPERT';
  if (/HARD/.test(t)) return 'HARD';
  if (/NORMAL/.test(t)) return 'NORMAL';
  if (/EASY/.test(t)) return 'EASY';
  return 'EXPERT';
}

function parseCount(text, keywords) {
  const lines = normalizeText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    for (const keyword of keywords) {
      if (keyword.test(line)) {
        const nums = line.match(/\d+/g);
        if (nums && nums.length) return parseInt(nums[nums.length - 1], 10) || 0;
      }
    }
  }
  const joined = normalizeText(text);
  for (const keyword of keywords) {
    const idx = joined.search(keyword);
    if (idx >= 0) {
      const tail = joined.slice(idx);
      const nums = tail.match(/\d+/g);
      if (nums && nums.length) return parseInt(nums[0], 10) || 0;
    }
  }
  return 0;
}

function parseJudgementText(text) {
  const t = normalizeText(text);
  const match = (keyword) => {
    const r = new RegExp(`${keyword}[^0-9]{0,20}(\\d+)`, 'i');
    const m = t.match(r);
    return m ? parseInt(m[1], 10) || 0 : 0;
  };
  return {
    perfect: match('PERFECT'),
    great: match('GREAT'),
    good: match('GOOD'),
    bad: match('BAD'),
    miss: match('MISS'),
  };
}

function parseComboText(text) {
  const t = normalizeText(text);
  const patterns = [
    /MAX\s*COMBO[^0-9]*(\d+)/i,
    /COMBO[^0-9]*(\d+)/i,
    /(\d+)\s*COMBO/i,
    /x\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return parseInt(m[1], 10) || 0;
  }
  const nums = t.match(/\d+/g);
  if (nums && nums.length) return parseInt(nums[nums.length - 1], 10) || 0;
  return 0;
}

async function guessTitle(imgElement, worker, rect) {
  const blob = await cropImage(imgElement, rect, { contrast: true, threshold: false });
  const ret = await worker.recognize(blob, { lang: 'jpn' });
  return normalizeText(ret?.data?.text || '').replace(/\s+/g, ' ').trim();
}

async function ocrRegion(imgElement, worker, rect, lang, options = {}) {
  const blob = await cropImage(imgElement, rect, options);
  const ret = await worker.recognize(blob, { lang });
  return String(ret?.data?.text || '');
}

export async function analyzeLoadedImage(imgElement, worker, preset = getCurrentPreset()) {
  const regions = {
    diff: normalizeRect(preset?.regions?.diff || DEFAULT_REGIONS.diff),
    title: normalizeRect(preset?.regions?.title || DEFAULT_REGIONS.title),
    result: normalizeRect(preset?.regions?.result || DEFAULT_REGIONS.result),
    combo: normalizeRect(preset?.regions?.combo || DEFAULT_REGIONS.combo),
  };

  const diffText = await ocrRegion(imgElement, worker, regions.diff, 'eng', { threshold: true, contrast: false });
  const difficultyRaw = detectDifficulty(diffText);

  const titleText = await guessTitle(imgElement, worker, regions.title);
  const resultText = await ocrRegion(imgElement, worker, regions.result, 'jpn', { contrast: true });
  const comboText = await ocrRegion(imgElement, worker, regions.combo, 'jpn', { contrast: true });

  const counts = parseJudgementText(resultText);
  const combo = parseComboText(comboText) || parseComboText(resultText);
  const totalMiss = (counts.good || 0) + (counts.bad || 0) + (counts.miss || 0);

  return {
    title: titleText,
    difficultyRaw,
    perfect: counts.perfect || 0,
    great: counts.great || 0,
    good: counts.good || 0,
    bad: counts.bad || 0,
    miss: counts.miss || 0,
    combo: combo || 0,
    totalMiss,
    raw: { diffText, titleText, resultText, comboText },
  };
}

export async function createTesseractWorker() {
  if (!window.Tesseract) throw new Error('Tesseract.js が読み込まれていません');
  const worker = await window.Tesseract.createWorker(['jpn', 'eng']);
  return worker;
}
