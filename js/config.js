
(() => {
  const diffMeta = {
    EASY:   { raw: 'EASY',   color: '#66DA7E', rank: 1, aliases: ['EASY', 'EZ', 'E'] },
    NORMAL: { raw: 'NORMAL', color: '#66C9F9', rank: 2, aliases: ['NORMAL', 'N', 'NO'] },
    HARD:   { raw: 'HARD',   color: '#F5CC44', rank: 3, aliases: ['HARD', 'H'] },
    EXPERT: { raw: 'EXPERT', color: '#EA5577', rank: 4, aliases: ['EXPERT', 'EX'] },
    MASTER: { raw: 'MASTER', color: '#BB40F5', rank: 5, aliases: ['MASTER', 'M'] },
    APPEND: { raw: 'APPEND', color: '#EE82E2', rank: 6, aliases: ['APPEND', 'A'] }
  };
  const diffAliasToRaw = {};
  Object.entries(diffMeta).forEach(([raw, meta]) => {
    meta.aliases.forEach(a => { diffAliasToRaw[String(a).toUpperCase()] = raw; });
  });

  function clamp(n, min, max) {
    n = Number(n);
    if (Number.isNaN(n)) n = min;
    return Math.min(max, Math.max(min, n));
  }

  function sanitizeFilePart(v) {
    return String(v ?? '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
  }

  function normalizeString(v) {
    return String(v ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ 　\-_・.,()［］【】\[\]／/\\]/g, '');
  }

  function levenshtein(a, b) {
    if (a.length > b.length) [a, b] = [b, a];
    let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let i = 0; i < b.length; i++) {
      const cur = [i + 1];
      for (let j = 0; j < a.length; j++) {
        cur.push(a[j] === b[i] ? prev[j] : 1 + Math.min(prev[j], prev[j + 1], cur[cur.length - 1]));
      }
      prev = cur;
    }
    return prev[prev.length - 1];
  }

  function difficultyLabelFromRaw(raw) {
    return diffMeta[raw]?.raw || raw || '';
  }

  function difficultyClass(raw) {
    return `difficulty-${String(raw || '').toLowerCase()}`;
  }

  function parseDifficultyToken(v) {
    const key = String(v ?? '').trim().toUpperCase();
    return diffAliasToRaw[key] || null;
  }

  function compareRecords(a, b, mode, direction = 'desc') {
    const sign = direction === 'asc' ? 1 : -1;
    const t = (a.title || '').localeCompare(b.title || '', 'ja');
    const levelDiff = (Number(a.level || 0) - Number(b.level || 0));
    const missDiff = (Number(a.totalMiss ?? a.missCount ?? 0) - Number(b.totalMiss ?? b.missCount ?? 0));
    const dateDiff = new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime();
    const diffRankA = diffMeta[a.difficultyRaw]?.rank || 0;
    const diffRankB = diffMeta[b.difficultyRaw]?.rank || 0;
    const diffDiff = diffRankA - diffRankB;

    const tuple = {
      title: [t, diffDiff, missDiff, dateDiff],
      level: [levelDiff, diffDiff, t, missDiff, dateDiff],
      miss: [missDiff, levelDiff, diffDiff, t, dateDiff],
      date: [dateDiff]
    }[mode] || [dateDiff];

    for (const part of tuple) {
      const p = typeof part === 'number' ? part : (part || 0);
      if (p !== 0) return p * sign;
    }
    return 0;
  }

  function makeRecordKey(rec) {
    return [
      normalizeString(rec.title),
      String(rec.level ?? ''),
      String(rec.difficultyRaw ?? ''),
    ].join('|');
  }

  function formatDateTime(v) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function isBetterRecord(candidate, currentBest) {
    if (!currentBest) return true;
    const c = candidate || {};
    const b = currentBest || {};
    const cm = Number(c.totalMiss ?? c.missCount ?? 0);
    const bm = Number(b.totalMiss ?? b.missCount ?? 0);
    if (cm !== bm) return cm < bm;
    const cc = Number(c.combo ?? 0), bc = Number(b.combo ?? 0);
    if (cc !== bc) return cc > bc;
    const cp = Number(c.perfect ?? 0), bp = Number(b.perfect ?? 0);
    if (cp !== bp) return cp > bp;
    const cg = Number(c.great ?? 0), bg = Number(b.great ?? 0);
    if (cg !== bg) return cg < bg;
    return new Date(c.addedAt || 0).getTime() > new Date(b.addedAt || 0).getTime();
  }

  function parseLegacyFolderTitle(folderName) {
    let m = String(folderName || '').match(/^(\d+)([AMEH])\s+(.+)$/i);
    if (m) {
      const map = { A: 'APPEND', M: 'MASTER', E: 'EXPERT', H: 'HARD' };
      return { level: parseInt(m[1], 10), difficultyRaw: map[m[2].toUpperCase()] || m[2].toUpperCase(), title: m[3].trim() };
    }
    m = String(folderName || '').match(/^(\d+)\s+(EASY|NORMAL|HARD|EXPERT|MASTER|APPEND)\s+(.+)$/i);
    if (m) return { level: parseInt(m[1], 10), difficultyRaw: m[2].toUpperCase(), title: m[3].trim() };
    m = String(folderName || '').match(/^(\d+)\s+(.+?)\s+(EASY|NORMAL|HARD|EXPERT|MASTER|APPEND)$/i);
    if (m) return { level: parseInt(m[1], 10), difficultyRaw: m[3].toUpperCase(), title: m[2].trim() };
    return null;
  }

  function parseDriveFileName(fileName) {
    const base = String(fileName || '').replace(/\.[^.]+$/, '');
    const parts = base.split('__');
    if (parts.length < 2) return null;
    const meta = {
      title: parts[0] || '',
      level: '',
      difficultyRaw: '',
      perfect: 0,
      great: 0,
      missCount: 0,
      combo: 0,
      deviceKey: '',
      addedAt: ''
    };
    for (const part of parts.slice(1)) {
      if (part.startsWith('L')) meta.level = parseInt(part.slice(1), 10) || '';
      else if (part.startsWith('D')) meta.difficultyRaw = part.slice(1).toUpperCase();
      else if (part.startsWith('M')) meta.missCount = parseInt(part.slice(1), 10) || 0;
      else if (part.startsWith('P')) meta.perfect = parseInt(part.slice(1), 10) || 0;
      else if (part.startsWith('G')) meta.great = parseInt(part.slice(1), 10) || 0;
      else if (part.startsWith('C')) meta.combo = parseInt(part.slice(1), 10) || 0;
      else if (part.startsWith('K')) meta.deviceKey = part.slice(1);
      else if (part.startsWith('T')) meta.addedAt = part.slice(1);
    }
    return meta;
  }

  function buildDriveFileName(rec) {
    const title = sanitizeFilePart(rec.title || 'untitled');
    const level = `L${rec.level ?? ''}`;
    const diff = `D${rec.difficultyRaw || ''}`;
    const miss = `M${Number(rec.totalMiss ?? rec.missCount ?? 0)}`;
    const perfect = `P${Number(rec.perfect ?? 0)}`;
    const great = `G${Number(rec.great ?? 0)}`;
    const combo = `C${Number(rec.combo ?? 0)}`;
    const device = `K${sanitizeFilePart(rec.deviceKey || 'auto')}`;
    const stamp = `T${rec.addedAt || Date.now()}`;
    return `${title}__${level}__${diff}__${miss}__${perfect}__${great}__${combo}__${device}__${stamp}`;
  }

  window.PRSK = window.PRSK || {};
  window.PRSK.config = {
    CLIENT_ID: '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com',
    API_KEY: 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0',
    DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    SCOPES: 'https://www.googleapis.com/auth/drive',
    ROOT_FOLDER: 'PRSK_RESULTS',
    RESULTS_FOLDER: 'results',
    MANIFEST_FILE: 'manifest.json',
    diffMeta,
    diffAliasToRaw,
  };
  window.PRSK.util = {
    clamp,
    sanitizeFilePart,
    escapeHtml,
    normalizeString,
    levenshtein,
    difficultyLabelFromRaw,
    difficultyClass,
    parseDifficultyToken,
    compareRecords,
    makeRecordKey,
    formatDateTime,
    isBetterRecord,
    parseLegacyFolderTitle,
    parseDriveFileName,
    buildDriveFileName,
  };
})();
