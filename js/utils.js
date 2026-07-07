export function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function deepMerge(target, source) {
  const base = deepClone(target) ?? {};
  if (!source || typeof source !== 'object') return base;

  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      base[key] = deepMerge(base[key] ?? {}, value);
    } else {
      base[key] = deepClone(value);
    }
  }
  return base;
}

export function clamp(value, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return min;
  return Math.min(max, Math.max(min, num));
}

export function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[match]);
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) {
    alert(message);
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  window.setTimeout(() => {
    toast.classList.remove('show');
    window.setTimeout(() => toast.remove(), 220);
  }, duration);
}

export function setLoading(visible, message = '') {
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loader-text');
  if (!loader) return;
  loader.style.display = visible ? 'flex' : 'none';
  if (loaderText && message) loaderText.textContent = message;
}

export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

export function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

export function getElement(id) {
  return document.getElementById(id);
}

export function toDataUrlFromBlob(blob) {
  return URL.createObjectURL(blob);
}
