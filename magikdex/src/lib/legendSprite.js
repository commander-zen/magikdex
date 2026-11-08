// Picks the Box-tray sprite for a legend from its stored type_line.
//
// Sprite ids match <symbol id="sprite-<id>"> in assets/sprites/legend-sprites.svg.
// COUNTS are how many legendary Commander-eligible creatures carry each type
// (Scryfall oracle_cards, 2026-11-08). A legend with several types shows its
// RAREST sprite-bearing type: a Human Wizard reads as Wizard, not Human — Human
// is on ~42% of legends, so as a tiebreaker it would say nothing.
const COUNTS = {
  human: 1444, warrior: 296, wizard: 280, hero: 279, noble: 177, soldier: 177, villain: 154, elf: 143,
  dragon: 133, mutant: 133, spirit: 132, rogue: 128, advisor: 98, artificer: 96, cleric: 94, god: 91,
  knight: 88, vampire: 86, ally: 79, shaman: 79, druid: 75, avatar: 73, phyrexian: 72, warlock: 71,
  elemental: 67, ninja: 64, goblin: 61, elder: 60, zombie: 60, angel: 59, assassin: 59, cat: 59,
  demon: 57, turtle: 50, dwarf: 49, scientist: 49, spider: 48, horror: 47, robot: 46, scout: 46,
  bird: 45, merfolk: 45, halfling: 42, dinosaur: 39, berserker: 33, monk: 33, detective: 31, beast: 30,
  bard: 29, lord: 29,
};

export const FALLBACK_SPRITE = "legend";

// Commander-eligible non-creatures get their own glyph. Checked before subtypes.
const EDGE_TYPES = [
  ["Planeswalker", "planeswalker"],
  ["Spacecraft", "spacecraft"],
  ["Vehicle", "vehicle"],
  ["Background", "background"],
];

export function legendSpriteId(typeLine) {
  if (!typeLine) return FALLBACK_SPRITE;
  // Commander eligibility is judged on the front face of a double-faced card.
  const front = typeLine.split(" // ")[0];

  for (const [word, id] of EDGE_TYPES) {
    if (front.includes(word)) return id;
  }

  const [, subs = ""] = front.split(" — ");
  const known = subs.split(" ")
    .map(s => s.toLowerCase())
    .filter(s => COUNTS[s] !== undefined);
  if (known.length === 0) return FALLBACK_SPRITE;
  return known.reduce((best, s) => (COUNTS[s] < COUNTS[best] ? s : best));
}
