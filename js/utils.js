// utils.js — small, generic helper functions shared across modules.

export function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Format a millisecond timestamp as "YYYY/MM/DD". */
export function formatDate(ts) {
  if (!ts && ts !== 0) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/** Format a millisecond timestamp as "YYYY/MM/DD HH:MM". */
export function formatDateTime(ts) {
  if (!ts && ts !== 0) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  const date = formatDate(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${date} ${h}:${min}`;
}

/** Format seconds as "M:SS". */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let toastTimer = null;
export function showToast(message) {
  const el = qs("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

// ---- Generic confirm dialog (used for the "leaving the site" warning) ----
let confirmResolve = null;

export function initConfirmDialog() {
  const dialog = qs("#confirmDialog");
  if (!dialog) return;
  qs("#confirmDialogCancelBtn", dialog).addEventListener("click", () => resolveConfirm(false));
  qs("#confirmDialogConfirmBtn", dialog).addEventListener("click", () => resolveConfirm(true));
  // Clicking the dimmed backdrop (not the card itself) cancels.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) resolveConfirm(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dialog.hidden) resolveConfirm(false);
  });
}

function resolveConfirm(result) {
  const dialog = qs("#confirmDialog");
  dialog.classList.remove("open");
  setTimeout(() => {
    dialog.hidden = true;
  }, 180);
  if (confirmResolve) {
    const r = confirmResolve;
    confirmResolve = null;
    r(result);
  }
}

/**
 * Shows a confirmation dialog and resolves to true/false.
 * @param {{title:string, message:string, confirmLabel?:string, cancelLabel?:string, danger?:boolean}} opts
 */
export function showConfirmDialog(opts) {
  const dialog = qs("#confirmDialog");
  qs("#confirmDialogTitle", dialog).textContent = opts.title || "";
  qs("#confirmDialogMessage", dialog).textContent = opts.message || "";
  qs("#confirmDialogConfirmBtn", dialog).textContent = opts.confirmLabel || "移動する";
  qs("#confirmDialogCancelBtn", dialog).textContent = opts.cancelLabel || "キャンセル";
  dialog.hidden = false;
  requestAnimationFrame(() => dialog.classList.add("open"));
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

export function createEl(tag, className, html) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html !== undefined) el.innerHTML = html;
  return el;
}
