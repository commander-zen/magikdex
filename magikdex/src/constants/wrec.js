export const WREC_CHIP = {
  "Ramp":            { label: "RAMP",     color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.35)" },
  "Card Advantage":  { label: "CARD ADV", color: "#5b8fff", bg: "rgba(91,143,255,0.12)",  border: "rgba(91,143,255,0.35)" },
  "Disruption":      { label: "DISRUPT",  color: "#ff4d6d", bg: "rgba(255,77,109,0.12)",  border: "rgba(255,77,109,0.35)" },
  "Mass Disruption": { label: "MASS DIS", color: "#f97316", bg: "rgba(249,115,22,0.12)",  border: "rgba(249,115,22,0.35)" },
  "Mana Base":       { label: "MANA",     color: "#34d399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)" },
  "Plan":            { label: "PLAN",     color: "#a78bfa", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.35)" },
};

export const WREC_TARGETS = {
  Ramp: 10,
  "Card Advantage": 12,
  Disruption: 12,
  "Mass Disruption": 6,
  "Mana Base": 38,
  Plan: 30,
};

export const WREC_CATEGORIES = Object.keys(WREC_TARGETS);

// Veggie qualification rules — anchor + at least one qualifier
export const VEGGIE_RULES = {
  Ramp: {
    anchor: "ramp",
    qualifiers: ["mana-rock", "land-ramp", "land-tutor", "mana-dork", "mana-acceleration"],
  },
  "Card Advantage": {
    anchor: "card-draw",
    qualifiers: ["draw-engine", "life-for-cards", "draw-1", "draw-x", "tutor"],
  },
  Disruption: {
    anchor: "interaction",
    qualifiers: ["removal", "counterspell", "exile-removal", "destroy-removal", "creature-removal"],
  },
  "Mass Disruption": {
    anchor: "board-wipe",
    qualifiers: ["mass-removal", "destroy-all", "mass-damage"],
  },
};

// Oracle tags not available from /cards/collection — detection uses oracle_text heuristics

export function autoDetectCategory(card) {
  // Mana Base: type_line check (reliable)
  if (card.type_line?.toLowerCase().includes("land")) return "Mana Base";

  const text     = (card.oracle_text ?? "").toLowerCase();
  const typeLine = (card.type_line ?? "").toLowerCase();

  // Ramp — "add" + mana symbol or "mana" on a non-land permanent or spell
  if (
    text.includes("add") && (text.includes("mana") || text.includes("{")) &&
    (typeLine.includes("artifact") || typeLine.includes("creature") ||
     typeLine.includes("enchantment") || typeLine.includes("sorcery") ||
     typeLine.includes("instant"))
  ) return "Ramp";

  // Card Advantage
  if (text.includes("draw") && (text.includes("card") || text.includes("cards"))) {
    return "Card Advantage";
  }

  // Mass Disruption — check before Disruption (more specific)
  if (
    text.includes("destroy all") || text.includes("exile all") ||
    text.includes("each creature") || text.includes("all creatures")
  ) return "Mass Disruption";

  // Disruption
  if (
    text.includes("destroy target") || text.includes("exile target") ||
    text.includes("counter target") || text.includes("counter spell")
  ) return "Disruption";

  return null;
}

export function calcWrecScore(wrecTags, pile = []) {
  // Collect oracle_ids of basic lands in pile for score-time Mana Base inclusion
  const basicOracleIds = new Set(
    pile.filter(c => c.type_line?.toLowerCase().includes("basic")).map(c => c.oracle_id).filter(Boolean)
  );

  const ratios = WREC_CATEGORIES.map(cat => {
    let count;
    if (cat === "Mana Base") {
      // Union of tagged Mana Base oracle_ids and basic land oracle_ids (no double-count)
      const union = new Set([...(wrecTags["Mana Base"] ?? []), ...basicOracleIds]);
      count = union.size;
    } else {
      count = (wrecTags[cat] ?? []).length;
    }
    const target = WREC_TARGETS[cat];
    return count / target;
  });
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return avg.toFixed(3);
}
