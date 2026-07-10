/**
 * device-profiles.js
 * ---------------------------------------------------------------------------
 * OCR読み取り範囲の「機種プロファイル」をブラウザの localStorage に保存・管理する。
 * アップロード時は画像の解像度・アスペクト比から最適なプロファイルを自動選択する。
 *
 * プロファイル構造:
 * {
 *   id: string,
 *   name: string,               表示名（例: "iPhone14" など。設定は自由）
 *   refWidth: number,           校正に使ったサンプル画像の幅(px)
 *   refHeight: number,          校正に使ったサンプル画像の高さ(px)
 *   regions: {                  各読み取り範囲（比率 0〜1）
 *     title:      {x,y,w,h},
 *     difficulty: {x,y,w,h},
 *     breakdown:  {x,y,w,h},
 *     combo:      {x,y,w,h},
 *   },
 *   createdAt: number, updatedAt: number
 * }
 *
 * index.html / settings.html の両方から利用する。
 * ---------------------------------------------------------------------------
 */
const DeviceProfiles = (() => {

  function _defaultRegions() {
    return JSON.parse(JSON.stringify(Config.DEFAULT_REGIONS));
  }

  function _seedDefaultProfile() {
    const now = Date.now();
    return {
      id: 'default',
      name: 'デフォルト',
      refWidth: Config.DEFAULT_REF_RESOLUTION.width,
      refHeight: Config.DEFAULT_REF_RESOLUTION.height,
      regions: _defaultRegions(),
      createdAt: now,
      updatedAt: now,
    };
  }

  function _read() {
    try {
      const raw = localStorage.getItem(Config.LS_DEVICE_PROFILES);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.profiles) || parsed.profiles.length === 0) return null;
      return parsed;
    } catch (e) {
      console.error('DeviceProfiles read error', e);
      return null;
    }
  }

  function _write(data) {
    try {
      localStorage.setItem(Config.LS_DEVICE_PROFILES, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('DeviceProfiles write error', e);
      return false;
    }
  }

  function _ensureSeeded() {
    let data = _read();
    if (!data) {
      data = { profiles: [_seedDefaultProfile()], defaultProfileId: 'default' };
      _write(data);
    }
    return data;
  }

  function getAll() {
    return _ensureSeeded().profiles;
  }

  function getById(id) {
    if (!id) return null;
    return getAll().find((p) => p.id === id) || null;
  }

  // 新規追加または既存の上書き保存
  function upsert(profile) {
    const data = _ensureSeeded();
    const idx = data.profiles.findIndex((p) => p.id === profile.id);
    profile.updatedAt = Date.now();
    if (idx >= 0) {
      data.profiles[idx] = profile;
    } else {
      profile.createdAt = profile.createdAt || Date.now();
      data.profiles.push(profile);
    }
    _write(data);
    return profile;
  }

  // 最低1件は残す（全削除を防止）
  function remove(id) {
    const data = _ensureSeeded();
    if (data.profiles.length <= 1) return false;
    const next = data.profiles.filter((p) => p.id !== id);
    if (next.length === data.profiles.length) return false; // 対象が見つからなかった
    data.profiles = next;
    if (data.defaultProfileId === id) data.defaultProfileId = data.profiles[0].id;
    _write(data);
    return true;
  }

  function createBlank(name) {
    const now = Date.now();
    return {
      id: Utils.uuid(),
      name: name || '新しいプロファイル',
      refWidth: 0,
      refHeight: 0,
      regions: _defaultRegions(),
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 画素数・アスペクト比から最適なプロファイルを選択する。
   * 1) 解像度が完全一致するものを優先
   * 2) なければアスペクト比が最も近いものを選択
   */
  function findBestMatch(width, height) {
    const all = getAll();
    if (!all.length || !width || !height) return all[0] || null;

    const exact = all.find((p) => p.refWidth === width && p.refHeight === height);
    if (exact) return exact;

    const ratio = width / height;
    let best = null;
    let bestDiff = Infinity;
    for (const p of all) {
      if (!p.refWidth || !p.refHeight) continue;
      const pRatio = p.refWidth / p.refHeight;
      const diff = Math.abs(pRatio - ratio);
      if (diff < bestDiff) { bestDiff = diff; best = p; }
    }
    return best || all[0];
  }

  return {
    getAll, getById, upsert, remove, createBlank, findBestMatch,
    defaultRegions: _defaultRegions,
  };
})();
