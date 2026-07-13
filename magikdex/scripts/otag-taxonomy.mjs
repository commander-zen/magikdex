// otag-taxonomy.mjs — the curated Scryfall Tagger oracle-tag taxonomy.
//
// EVERY slug below was verified against the live api.scryfall.com search API
// on 2026-07-02 (`otag:<slug>` returned the recorded card count). Tag names
// are community-authored and CANNOT be guessed — of ~105 probed candidates,
// 81 were misses (e.g. the token concept is `repeatable-token-generator`,
// not any of token/tokens/token-generator/makes-tokens). Never add a slug
// here without a live probe.
//
// `otag:` searches ROLL UP the Tagger hierarchy: querying a parent tag also
// returns cards tagged with any descendant (verified: Krenko's leaf tag
// `repeatable-creature-tokens` is reachable via its ancestor
// `repeatable-token-generator`, 1,772 cards). So this list holds umbrella
// tags; their sub-tags come along for free.
//
// Known aliases (same tag, multiple slugs — keep exactly one):
//   sweeper = boardwipe = board-wipe = mass-removal
//   blink = flicker;  typal = tribal;  lifegain = life-gain

// `wrec` maps a tag to the WREC category it auto-suggests (the future
// auto-tagging session reads this). `plan` is NEVER auto-assigned — that tag
// stays at the user's discretion by standing rule — so it never appears here.
// `wrec: null` = theme tag: feeds stack relevance, suggests no WREC category.
export const TAXONOMY = [
  // ── WREC core ──────────────────────────────────────────────────────────
  { tag: "ramp",             wrec: "ramp",            cards: 2243 },
  { tag: "card-advantage",   wrec: "card-advantage",  cards: 6180 },
  { tag: "tutor",            wrec: "card-advantage",  cards: 1139 },
  { tag: "recursion",        wrec: "card-advantage",  cards: 2225 },
  { tag: "wheel",            wrec: "card-advantage",  cards: 139 },
  { tag: "removal",          wrec: "disruption",      cards: 6367 },
  { tag: "counterspell",     wrec: "disruption",      cards: 539 },
  { tag: "discard",          wrec: "disruption",      cards: 566 },
  { tag: "graveyard-hate",   wrec: "disruption",      cards: 415 },
  { tag: "theft",            wrec: "disruption",      cards: 707 },
  { tag: "sweeper",          wrec: "mass-disruption", cards: 925 },

  // ── Theme tags (stack relevance, no WREC suggestion) ───────────────────
  { tag: "burn",                       wrec: null, cards: 2989 },
  { tag: "repeatable-token-generator", wrec: null, cards: 1772 },
  { tag: "sacrifice-outlet",           wrec: null, cards: 1432 },
  { tag: "reanimate",                  wrec: null, cards: 1029 },
  { tag: "mill",                       wrec: null, cards: 1223 },
  { tag: "self-mill",                  wrec: null, cards: 995 },
  { tag: "blink",                      wrec: null, cards: 188 },
  { tag: "clone",                      wrec: null, cards: 69 },
  { tag: "copy",                       wrec: null, cards: 1003 },
  { tag: "extra-turn",                 wrec: null, cards: 58 },
  { tag: "extra-combat",               wrec: null, cards: 45 },
  { tag: "counters-matter",            wrec: null, cards: 1267 },
  { tag: "landfall",                   wrec: null, cards: 263 },
  { tag: "lands-matter",               wrec: null, cards: 504 },
  { tag: "anthem",                     wrec: null, cards: 432 },
  { tag: "evasion",                    wrec: null, cards: 5205 },
  { tag: "unblockable",                wrec: null, cards: 194 },
  { tag: "typal",                      wrec: null, cards: 2755 },
  { tag: "group-hug",                  wrec: null, cards: 390 },
  { tag: "group-slug",                 wrec: null, cards: 746 },
  { tag: "lifegain",                   wrec: null, cards: 2549 },
  { tag: "lifedrain",                  wrec: null, cards: 393 },
  { tag: "protection",                 wrec: null, cards: 1291 },
  { tag: "bounce",                     wrec: null, cards: 907 },
];

// Tagger page tags that are catalog noise, not gameplay themes — skipped when
// profiling a legend's own Tagger page (e.g. Krenko carries `cycle-m13-legend`
// and `filterout_commander`).
export const TAG_BLOCKLIST = [
  // bare `cycle` shows up as the ANCESTOR of every cycle-xyz tag — 8k+ rows
  // of pure catalog noise if it leaks through (caught in Krenko dry run)
  /^cycle(-|$)/,
  /^filterout/,
  /^activated-ability$/,
  /^triggered-ability$/,
  // flavor/catalog taxonomies, not deck themes (leaked via Captain America's
  // page on the first live run: "alliteration" alone is a 4,169-card tag of
  // cards whose NAMES alliterate)
  /^alliteration$/,
  /^card-names$/,
  /^personal-text$/,
  /^face-commander$/,
];

export function isBlockedTag(slug) {
  return TAG_BLOCKLIST.some(re => re.test(slug));
}
