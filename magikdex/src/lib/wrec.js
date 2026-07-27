// ── WREC Score (Wachel Reeks Effectiveness Coefficient) ───────────────────────
// Named after Commander content creator Rachel Weeks / @wachelreeks
// Measures how close a deck is to Rachel's recommended template.
// 1.000 is perfect — going over OR under is bad.

// `exportTag` used to live here too, carrying SPACED labels ("card advantage").
// Its only consumer was the removed duplicate exporter, and the format was
// wrong besides: the importer splits tags on whitespace, so a spaced tag can't
// round-trip. The live export emits these object KEYS instead, which is exactly
// what parseMoxfieldText reads back. Don't reintroduce a second spelling.
export const CATEGORY_META = {
  "ramp":            { label: "Ramp",           emoji: "🌱", target: 10 },
  "card-advantage":  { label: "Card Advantage",  emoji: "📖", target: 12 },
  "disruption":      { label: "Disruption",      emoji: "✂️", target: 12 },
  "mass-disruption": { label: "Mass Disruption", emoji: "💥", target: 6  },
  "mana-base":       { label: "Mana Base",       emoji: "🗺️", target: 38 },
  "plan":            { label: "Plan",            emoji: "📋", target: 30 },
};

export const CATEGORY_ORDER = [
  "ramp", "card-advantage", "disruption", "mass-disruption", "mana-base", "plan",
];

// Compute per-category counts from a pile of cards.
// Cards without a recognised _deckCategory fall into "plan".
export function computeCounts(pile) {
  const counts = {};
  for (const cat of CATEGORY_ORDER) counts[cat] = 0;
  for (const card of pile) {
    const cat = card._deckCategory ?? "plan";
    if (counts[cat] !== undefined) counts[cat]++;
    else counts["plan"]++;
  }
  return counts;
}

// ratio = count / target (uncapped — can exceed 1.000)
export function computeRatios(counts) {
  return CATEGORY_ORDER.map(cat => {
    const { target } = CATEGORY_META[cat];
    const count = counts[cat] ?? 0;
    const ratio = count / target;
    return { cat, count, target, ratio };
  });
}

// WREC = average of all 6 ratios
export function computeWREC(pile) {
  const counts = computeCounts(pile);
  const ratios = computeRatios(counts);
  const score  = ratios.reduce((s, r) => s + r.ratio, 0) / ratios.length;
  return { score, ratios, counts };
}

// Color coding: green within ±0.08 of 1.000, amber within ±0.20, red outside
export function ratioColor(ratio) {
  const diff = Math.abs(ratio - 1);
  if (diff <= 0.08) return "var(--success)";
  if (diff <= 0.20) return "var(--active)";
  return "var(--danger)";
}

// Display like a batting average: .847 (leading zero dropped when < 1)
export function formatScore(score) {
  if (score < 1) return score.toFixed(3).slice(1); // "0.847" → ".847"
  return score.toFixed(3);                          // "1.234"
}

// ▲ OVER / ▼ UNDER / ● ON
export function ratioIndicator(ratio) {
  const diff = Math.abs(ratio - 1);
  if (diff <= 0.08) return "● ON";
  if (ratio > 1)    return "▲ OVER";
  return "▼ UNDER";
}

// The export lives in ReviewScreen's buildMoxfieldExport, which emits the
// hyphenated WREC keys (#card-advantage) that parseMoxfieldText reads back.
// A second exporter here used CATEGORY_META.exportTag's SPACED labels
// (#card advantage) — those don't survive the round trip, since the importer
// splits tags on whitespace. It had no callers; removed rather than left as a
// trap. If an exporter ever belongs in this file again, it must emit the same
// hyphenated keys the importer accepts (WREC_TAGS in lib/deckTags.js).
