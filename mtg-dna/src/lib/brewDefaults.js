// Persisted "brew defaults" — the STARTING state of every fresh swipe seed.
// Per-session search/sort controls still override for that session; these only
// set where a new seed begins.
//
// Stored as a single object under one key so future prefs can be added without
// any migration: getBrewDefaults() merges stored values over the defaults, so
// keys absent from an older stored object simply fall back to their default.

const KEY = "magicdex-brew-defaults";

export const DEFAULT_BREW_DEFAULTS = {
  sort: "edhrec",       // "edhrec" | "name" | "cmc" — initial swipeOrder
  excludeLands: true,   // append -t:land to the seed query (matches prior behavior)

  // ── Future advanced options (placeholders — not built yet) ──
  // Add any of these to the object and read them in seedSwipeQueue; older
  // stored objects without the key fall back to the default automatically.
  // budgetCeiling: null,    // max USD per card
  // noUB: false,            // exclude Universes Beyond art/cards
  // printing: "any",        // printing / frame preference
  // scryfallSyntax: "",     // raw Scryfall syntax appended to the seed
  // seedSource: "edhrec",   // eventual ARBITER / ORACLE recommendation seed
};

export function getBrewDefaults() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULT_BREW_DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULT_BREW_DEFAULTS };
  }
}

// Merge a partial patch over the current defaults and persist. Returns the
// merged object so callers can mirror it into local component state.
export function setBrewDefaults(patch) {
  const next = { ...getBrewDefaults(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
