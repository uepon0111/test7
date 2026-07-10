/**
 * utils.js
 * ---------------------------------------------------------------------------
 * どの機能にも属さない汎用ユーティリティ関数群。
 * ---------------------------------------------------------------------------
 */
const Utils = (() => {

  function escapeHtml(t) {
    return t ? t.toString().replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m])) : '';
  }

  // 全角英数字→半角、小文字化、空白/ハイフン/アンダースコア除去（OCR結果と楽曲名の比較用）
  function normalizeString(str) {
    if (!str) return '';
    return str
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .toLowerCase()
      .replace(/[\s\-_]/g, '');
  }

  // レーベンシュタイン距離（編集距離）
  function levenshtein(s1, s2) {
    if (s1.length > s2.length) { const tmp = s1; s1 = s2; s2 = tmp; }
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
  }

  function uuid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function debounce(fn, wait) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function formatDateTime(tsOrIso) {
    if (!tsOrIso) return '-';
    const d = new Date(tsOrIso);
    if (isNaN(d.getTime())) return '-';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Driveのファイル名として安全な文字列に変換（改行/制御文字/パス区切り文字などを除去）
  function sanitizeForFileName(str) {
    if (!str) return '';
    return str.toString().replace(/[\r\n\t\\/:*?"<>|]/g, '').trim();
  }

  function toPercentStr(ratio, digits = 1) {
    const n = Number(ratio) * 100;
    if (isNaN(n)) return '0';
    return n.toFixed(digits);
  }

  return {
    escapeHtml, normalizeString, levenshtein, uuid, clamp, debounce,
    formatDateTime, sanitizeForFileName, toPercentStr,
  };
})();
