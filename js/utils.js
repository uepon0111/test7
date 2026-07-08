export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function round(n, digits = 2) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export function makeId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[ch]);
}

export function normalizeString(str) {
  if (!str) return '';
  return String(str)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .replace(/[\s\-_]/g, '');
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function deepMerge(target, source) {
  if (Array.isArray(source)) return source.slice();
  if (!source || typeof source !== 'object') return source;
  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? { ...target } : {};
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      out[key] = value.slice();
    } else if (value && typeof value === 'object') {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
