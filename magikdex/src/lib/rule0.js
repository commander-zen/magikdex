// ── Rule 0 commanders ────────────────────────────────────────────────────────
// A CUSTOM commander: a leak that isn't on Scryfall yet, a homebrew, or any
// commander a table agrees to. It lives only on the user's own legends row
// (custom = true, migration 038) and is never written to the shared `cards`
// table, so that table stays a pure Scryfall mirror. The deck itself still
// draws only from commander-legal cards in the custom card's colours.
//
// Scope (Ben, 2026-11-17): custom only. No "pick any real card as commander"
// mode — live lookups write back to the cards cache, and that would pull
// non-legal cards into it.
//
// ⚠️ A custom legend must NEVER be resolved by name. Every identity heal in
// the app ends in a FUZZY Scryfall lookup, which would quietly replace a leak
// with the nearest real card (art, oracle text and colours all overwritten).
// Gate those paths on isCustomLegend().

export const WUBRG = ["W", "U", "B", "R", "G"];

export function isCustomLegend(legend) {
  return Boolean(legend?.custom);
}

// A legends row → the Scryfall card shape the rest of the app reads
// (getCardImage, partnerVariant, the commander overlay). No id / oracle_id on
// purpose: anything keyed on those (brew_stack, tag write-back) must see this
// as "not a real card" and fall back.
export function legendToCard(legend) {
  if (!legend) return null;
  const img = legend.image_uri || null;
  return {
    name: legend.name,
    type_line: legend.type_line ?? "",
    oracle_text: legend.oracle_text ?? "",
    mana_cost: legend.mana_cost ?? "",
    color_identity: legend.color_identity ?? [],
    image_uris: img ? { normal: img, art_crop: img } : undefined,
    custom: true,
  };
}

// Colour identity from a mana cost + rules text, the way the game derives it:
// every coloured symbol counts, hybrid counts both halves, reminder text
// (in parentheses) does not. The user can still override the toggles — this
// only pre-fills them so a pasted leak lands on the right colours.
export function deriveColorIdentity(manaCost = "", oracleText = "") {
  const text = `${manaCost} ${String(oracleText).replace(/\([^)]*\)/g, "")}`;
  const found = new Set();
  for (const [, sym] of text.matchAll(/\{([^}]+)\}/g)) {
    for (const c of WUBRG) if (sym.toUpperCase().includes(c)) found.add(c);
  }
  return WUBRG.filter(c => found.has(c));
}

// Only http(s) image links are stored — the value is rendered as an <img src>.
export function cleanImageUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}
