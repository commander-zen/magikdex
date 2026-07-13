const STORAGE_KEY = "helixbrew_settings";

export const DEFAULT_SETTINGS = {
  haptics:               true,
  swipeAnimations:       true,
  fullLoadingAnimation:  true,
  rawQueryMode:          false,
};

export function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateSetting(key, value) {
  const current = getSettings();
  const next = { ...current, [key]: value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  catch (err) { console.warn("Settings write failed:", err); }
  return next;
}
