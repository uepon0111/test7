
(() => {
  const { util } = window.PRSK;
  const STORAGE_KEYS = {
    profiles: 'prsk_profiles_v2',
    prefs: 'prsk_prefs_v2',
    manifest: 'prsk_manifest_cache_v2',
    selectedProfile: 'prsk_selected_profile_v2',
  };

  function defaultRegions() {
    return {
      title:   { x: 18, y: 1,  w: 34, h: 5 },
      diff:    { x: 20, y: 7,  w: 10, h: 4 },
      result:  { x: 8,  y: 52, w: 34, h: 26 },
      combo:   { x: 58, y: 32, w: 30, h: 10 },
    };
  }

  function createDefaultProfile(key = 'default') {
    return {
      key,
      name: '標準',
      samplePreview: '',
      sampleWidth: 0,
      sampleHeight: 0,
      regions: defaultRegions(),
      updatedAt: Date.now(),
    };
  }

  function normalizeProfile(profile) {
    const p = profile || createDefaultProfile();
    p.key = String(p.key || 'default');
    p.name = String(p.name || p.key);
    p.samplePreview = String(p.samplePreview || '');
    p.sampleWidth = Number(p.sampleWidth || 0);
    p.sampleHeight = Number(p.sampleHeight || 0);
    p.updatedAt = Number(p.updatedAt || Date.now());
    p.regions = p.regions || defaultRegions();
    for (const k of Object.keys(p.regions)) {
      const r = p.regions[k];
      p.regions[k] = {
        x: util.clamp(r.x, 0, 100),
        y: util.clamp(r.y, 0, 100),
        w: util.clamp(r.w, 1, 100),
        h: util.clamp(r.h, 1, 100),
      };
      if (p.regions[k].x + p.regions[k].w > 100) p.regions[k].w = 100 - p.regions[k].x;
      if (p.regions[k].y + p.regions[k].h > 100) p.regions[k].h = 100 - p.regions[k].y;
    }
    return p;
  }

  function loadProfiles() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.profiles);
      if (!raw) return { default: createDefaultProfile('default') };
      const parsed = JSON.parse(raw);
      const out = {};
      Object.entries(parsed || {}).forEach(([k, v]) => out[k] = normalizeProfile({ ...v, key: k }));
      if (!out.default) out.default = createDefaultProfile('default');
      return out;
    } catch {
      return { default: createDefaultProfile('default') };
    }
  }

  function saveProfiles(profiles) {
    localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(profiles));
  }

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.prefs) || '{}');
    } catch {
      return {};
    }
  }

  function savePrefs(prefs) {
    localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(prefs || {}));
  }

  function loadManifestCache() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.manifest) || '[]');
    } catch {
      return [];
    }
  }

  function saveManifestCache(records) {
    localStorage.setItem(STORAGE_KEYS.manifest, JSON.stringify(records || []));
  }

  function getSelectedProfileKey() {
    return localStorage.getItem(STORAGE_KEYS.selectedProfile) || 'default';
  }

  function setSelectedProfileKey(key) {
    localStorage.setItem(STORAGE_KEYS.selectedProfile, key || 'default');
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function profileMatchScore(profile, width, height) {
    const p = profile || {};
    const ratio = width && height ? width / height : 0;
    const pr = p.sampleWidth && p.sampleHeight ? p.sampleWidth / p.sampleHeight : ratio;
    const ratioDiff = Math.abs(ratio - pr);
    const sizeDiff = p.sampleWidth && p.sampleHeight
      ? Math.abs(width - p.sampleWidth) / Math.max(width, p.sampleWidth, 1) + Math.abs(height - p.sampleHeight) / Math.max(height, p.sampleHeight, 1)
      : 0.5;
    return ratioDiff * 3 + sizeDiff;
  }

  function chooseProfileKey(profiles, width, height) {
    const entries = Object.values(profiles || {});
    if (!entries.length) return 'default';
    let best = entries[0];
    let score = profileMatchScore(best, width, height);
    for (const p of entries.slice(1)) {
      const s = profileMatchScore(p, width, height);
      if (s < score) { score = s; best = p; }
    }
    return best.key || 'default';
  }

  window.PRSK.storage = {
    createDefaultProfile,
    normalizeProfile,
    loadProfiles,
    saveProfiles,
    loadPrefs,
    savePrefs,
    loadManifestCache,
    saveManifestCache,
    getSelectedProfileKey,
    setSelectedProfileKey,
    clone,
    chooseProfileKey,
    defaultRegions,
  };
})();
