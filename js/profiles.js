import { DEFAULT_REGIONS, REGION_KEYS, cloneRegions, makeId } from './config.js';

export function cloneDefaultProfile(width = 0, height = 0, name = '') {
  return {
    id: makeId('profile'),
    name: name || `未設定 ${width || '?'}×${height || '?'}`,
    width,
    height,
    regions: cloneRegions(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function profileAspectRatio(profile) {
  if (!profile || !profile.width || !profile.height) return 0;
  return profile.width / profile.height;
}

export function detectProfileByDimensions(width, height, profiles) {
  if (!width || !height || !Array.isArray(profiles) || profiles.length === 0) return null;
  const ratio = width / height;
  let best = null;
  let bestScore = Infinity;

  for (const profile of profiles) {
    if (!profile.width || !profile.height) continue;
    const pr = profile.width / profile.height;
    const ratioDelta = Math.abs(pr - ratio);
    const widthDelta = Math.abs(profile.width - width) / Math.max(width, profile.width);
    const heightDelta = Math.abs(profile.height - height) / Math.max(height, profile.height);
    const score = ratioDelta * 3 + widthDelta + heightDelta;
    if (score < bestScore) {
      bestScore = score;
      best = profile;
    }
  }

  return bestScore <= 0.35 ? best : null;
}

export function ensureProfileDefaults(profile) {
  const base = cloneDefaultProfile(profile?.width || 0, profile?.height || 0, profile?.name || '');
  return {
    ...base,
    ...(profile || {}),
    regions: {
      diff: ensureRegion(profile?.regions?.diff || DEFAULT_REGIONS.diff),
      title: ensureRegion(profile?.regions?.title || DEFAULT_REGIONS.title),
      result: ensureRegion(profile?.regions?.result || DEFAULT_REGIONS.result),
      combo: ensureRegion(profile?.regions?.combo || DEFAULT_REGIONS.combo),
    },
  };
}

export function ensureRegion(region) {
  return {
    x: clamp01(Number(region?.x) || 0),
    y: clamp01(Number(region?.y) || 0),
    w: clamp01(Number(region?.w) || 0),
    h: clamp01(Number(region?.h) || 0),
  };
}

export function cloneRegionsForProfile(profile) {
  return {
    diff: { ...ensureRegion(profile?.regions?.diff || DEFAULT_REGIONS.diff) },
    title: { ...ensureRegion(profile?.regions?.title || DEFAULT_REGIONS.title) },
    result: { ...ensureRegion(profile?.regions?.result || DEFAULT_REGIONS.result) },
    combo: { ...ensureRegion(profile?.regions?.combo || DEFAULT_REGIONS.combo) },
  };
}

export function regionToPixels(region, width, height) {
  return {
    x: Math.round((region?.x || 0) * width),
    y: Math.round((region?.y || 0) * height),
    w: Math.round((region?.w || 0) * width),
    h: Math.round((region?.h || 0) * height),
  };
}

export function pixelsToRegion(regionPx, width, height) {
  return {
    x: clamp01(regionPx.x / width),
    y: clamp01(regionPx.y / height),
    w: clamp01(regionPx.w / width),
    h: clamp01(regionPx.h / height),
  };
}

export function clampRegion(regionPx, imageWidth, imageHeight) {
  const out = {
    x: Math.max(0, Math.min(regionPx.x, imageWidth - 1)),
    y: Math.max(0, Math.min(regionPx.y, imageHeight - 1)),
    w: Math.max(1, Math.min(regionPx.w, imageWidth - regionPx.x)),
    h: Math.max(1, Math.min(regionPx.h, imageHeight - regionPx.y)),
  };
  if (out.x + out.w > imageWidth) out.w = imageWidth - out.x;
  if (out.y + out.h > imageHeight) out.h = imageHeight - out.y;
  return out;
}

export function createProfileFromSample(sampleWidth, sampleHeight, name = '') {
  const profile = cloneDefaultProfile(sampleWidth, sampleHeight, name || `新しい機種 ${sampleWidth}×${sampleHeight}`);
  return profile;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function regionKeys() {
  return REGION_KEYS.slice();
}
