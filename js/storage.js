
export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function mergeSettings(defaults, saved) {
  const result = deepClone(defaults);
  if (!saved || typeof saved !== 'object') return result;
  for (const [key, value] of Object.entries(saved)) {
    if (key === 'profiles' && Array.isArray(value)) {
      result.profiles = value;
    } else if (key in result) {
      result[key] = value;
    }
  }
  if (!Array.isArray(result.profiles) || result.profiles.length === 0) {
    result.profiles = deepClone(defaults.profiles);
  }
  return result;
}

export function nowIso() {
  return new Date().toISOString();
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
