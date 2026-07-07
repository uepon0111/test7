import { DEFAULT_CROP_SETTINGS, getDifficultyLabel, normalizeDifficultyToken } from "./config.js";
import { state } from "./state.js";

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[\u3000\s]+/g, " ")
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  const m = String(value || "").replace(/,/g, "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function levenshtein(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 0; i < b.length; i++) {
    let curr = [i + 1];
    for (let j = 0; j < a.length; j++) {
      if (a[j] === b[i]) curr.push(prev[j]);
      else curr.push(1 + Math.min(prev[j], prev[j + 1], curr[curr.length - 1]));
    }
    prev = curr;
  }
  return prev[prev.length - 1];
}

export function findBestMatchMusic(ocrText) {
  if (!state.dbMusics?.length) return null;
  const target = normalizeText(ocrText);
  if (!target) return null;

  let bestMatch = null;
  let minScore = Infinity;

  for (const music of state.dbMusics) {
    const dbTitle = normalizeText(music.title);
    const dist = levenshtein(target, dbTitle);
    const score = dist / Math.max(target.length, dbTitle.length, 1);
    if (score < minScore) {
      minScore = score;
      bestMatch = music;
    }
  }
  return bestMatch;
}

export function getLevelFromDb(musicId, diffKey) {
  if (!musicId || !diffKey || !state.dbDiffs?.length) return null;
  const entry = state.dbDiffs.find((d) => d.musicId === musicId && d.musicDifficulty === diffKey);
  return entry ? entry.playLevel : null;
}

export function detectDifficultyFromText(text) {
  const t = normalizeText(text);
  if (/APPEND|\bAP+END\b/.test(t)) return "append";
  if (/MASTER/.test(t)) return "master";
  if (/EXPERT/.test(t)) return "expert";
  if (/HARD/.test(t)) return "hard";
  if (/NORMAL/.test(t)) return "normal";
  if (/EASY/.test(t)) return "easy";
  return "expert";
}

function parseCountBlock(text, labels) {
  const result = {};
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const upper = normalizeText(line);
    for (const [key, pattern] of labels) {
      if (result[key] !== undefined) continue;
      if (pattern.test(upper)) result[key] = toNumber(upper);
    }
  }

  return result;
}

function parseCombo(text) {
  const upper = normalizeText(text);
  const labeled = upper.match(/(\d[\d,]*)\s*(?:COMBO|CHAIN)/);
  if (labeled) return toNumber(labeled[1]);
  const nums = upper.match(/\d[\d,]*/g);
  if (nums && nums.length) return toNumber(nums[0]);
  return 0;
}

export async function cropImage(imageElement, crop, type = "filter-standard") {
  const { x, y, w, h } = crop || DEFAULT_CROP_SETTINGS.result;
  const canvas = document.createElement("canvas");
  const sourceW = imageElement.naturalWidth;
  const sourceH = imageElement.naturalHeight;
  const ctx = canvas.getContext("2d");

  if (type === "threshold-diff") {
    const scale = 1.5;
    canvas.width = Math.max(1, Math.floor(sourceW * w * scale));
    canvas.height = Math.max(1, Math.floor(sourceH * h * scale));
    ctx.drawImage(imageElement, sourceW * x, sourceH * y, sourceW * w, sourceH * h, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray > 180 ? 0 : 255;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    canvas.width = Math.max(1, Math.floor(sourceW * w));
    canvas.height = Math.max(1, Math.floor(sourceH * h));
    ctx.filter = "grayscale(100%) contrast(150%)";
    ctx.drawImage(imageElement, sourceW * x, sourceH * y, sourceW * w, sourceH * h, 0, 0, canvas.width, canvas.height);
  }

  return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function analyzeLoadedImage(imgElement, worker) {
  try {
    const settings = state.settings?.cropRegions || DEFAULT_CROP_SETTINGS;

    const diffBlob = await cropImage(imgElement, settings.diff, "threshold-diff");
    const diffRet = await worker.recognize(diffBlob, { lang: "eng" });
    const diffKey = detectDifficultyFromText(diffRet.data.text);
    const diffLabel = getDifficultyLabel(diffKey);

    const titleBlob = await cropImage(imgElement, settings.title, "filter-standard");
    const titleRet = await worker.recognize(titleBlob, { lang: "jpn" });
    const matchedMusic = findBestMatchMusic(titleRet.data.text);
    const title = matchedMusic ? matchedMusic.title : String(titleRet.data.text || "").replace(/\r?\n/g, " ").trim();
    const musicId = matchedMusic ? matchedMusic.id : null;

    let level = "";
    if (musicId) level = getLevelFromDb(musicId, diffKey) || "";

    const resultBlob = await cropImage(imgElement, settings.result, "filter-standard");
    const resultRet = await worker.recognize(resultBlob, { lang: "jpn" });
    const counts = parseCountBlock(resultRet.data.text, [
      ["perfect", /PERF(?:ECT)?/i],
      ["great", /GREAT/i],
      ["good", /G[O0QD]{2}D/i],
      ["bad", /BAD/i],
      ["miss", /MISS/i],
    ]);

    const perfect = counts.perfect || 0;
    const great = counts.great || 0;
    const good = counts.good || 0;
    const bad = counts.bad || 0;
    const missDetail = counts.miss || 0;
    const totalMiss = good + bad + missDetail;

    const comboBlob = await cropImage(imgElement, settings.combo, "filter-standard");
    const comboRet = await worker.recognize(comboBlob, { lang: "eng" });
    const combo = parseCombo(comboRet.data.text);

    return {
      title,
      level,
      diff: diffKey,
      diffLabel,
      perfect,
      great,
      good,
      bad,
      missDetail,
      totalMiss,
      combo,
      musicId,
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function createOcrWorker() {
  return await Tesseract.createWorker(["jpn", "eng"]);
}
