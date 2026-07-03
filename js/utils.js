// js/utils.js

export function generateId() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/** 全角→半角、空白・記号除去して小文字化 */
export function normalizeString(str) {
  if (!str) return '';
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .replace(/[\s\-_・　]/g, '');
}

/** レーベンシュタイン距離 */
export function levenshtein(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    const cur = [j];
    for (let i = 1; i <= a.length; i++) {
      cur.push(a[i-1] === b[j-1]
        ? prev[i-1]
        : 1 + Math.min(prev[i-1], prev[i], cur[i-1]));
    }
    prev = cur;
  }
  return prev[a.length];
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * GREAT/GOOD/BAD/MISSからミス数を計算
 * isAP: great+good+bad+miss=0（=全PERFECT）
 * isFC: good+bad+miss=0
 */
export function computeMissFields(data) {
  const g  = Number(data.great  || 0);
  const go = Number(data.good   || 0);
  const b  = Number(data.bad    || 0);
  const m  = Number(data.miss   || 0);
  const missAP      = g + go + b + m;
  const missContest = g * 1 + go * 2 + b * 3 + m * 3;
  const missFC      = go + b + m;
  return {
    ...data,
    missAP,
    missContest,
    missFC,
    isAP: missAP === 0,
    isFC: missFC === 0,
  };
}

export function getModeMiss(record, mode) {
  const map = { ap: 'missAP', contest: 'missContest', fc: 'missFC' };
  return record[map[mode]] ?? 0;
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

export function daysAgo(iso) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Blob → データURL */
export function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** 画像Blobからサムネイル(JPEG)を生成 */
export function createThumbnail(blob, maxW = 400) {
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, maxW / img.naturalWidth);
      const w = Math.round(img.naturalWidth  * r);
      const h = Math.round(img.naturalHeight * r);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(res, 'image/jpeg', 0.82);
    };
    img.src = url;
  });
}

/** 画像Blobを縦横比のまま圧縮 */
export function compressImage(blob, maxW = 1600, quality = 0.88) {
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, maxW / img.naturalWidth);
      const w = Math.round(img.naturalWidth  * r);
      const h = Math.round(img.naturalHeight * r);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(res, 'image/jpeg', quality);
    };
    img.src = url;
  });
}
