import { fetchFirstPage } from "./scryfall.js";

// ── Partner mechanics ────────────────────────────────────────────────────────
// Commander lets some decks run TWO commanders. There are five separate
// mechanics that allow it and they NEVER combine with each other — two cards
// can only pair if they use the same one. Everything here is derived from a
// card's oracle text / type line, because that's what the cards cache stores
// (CARD_CACHE_COLS has oracle_text and type_line but not `keywords`).
//
// Scryfall queries below were each verified against the live API 2026-07-27;
// the result counts matched the published card counts for every variant, so
// these are the right filters and not lookalikes.

export const PARTNER_VARIANTS = {
  // Any two cards that both have plain "Partner". 82 of them.
  partner: {
    label: "Partner",
    prompt: "Pick any commander with Partner",
    query: 'is:commander keyword:partner -o:"partner with"',
  },
  // "Partner with <name>" — bonded to one specific card, so there is exactly
  // one legal choice and the query is built from the extracted name instead.
  partnerWith: {
    label: "Partner with",
    prompt: "This commander has one specific partner",
    query: null,
  },
  // Any two that both have it. 7 cards (a Stranger Things Secret Lair).
  friendsForever: {
    label: "Friends forever",
    prompt: "Pick another commander with Friends forever",
    query: 'o:"friends forever"',
  },
  // A creature that says "Choose a Background" + a legendary Background
  // enchantment. Note the partner side is an ENCHANTMENT, not a creature.
  background: {
    label: "Choose a Background",
    prompt: "Pick a Background",
    query: "t:background",
  },
  // A card with "Doctor's companion" pairs with a Time Lord Doctor…
  doctorsCompanion: {
    label: "Doctor's companion",
    prompt: "Pick a Doctor",
    query: 't:"time lord doctor"',
  },
  // …and a Doctor pairs with a companion. Same mechanic, opposite side.
  timeLordDoctor: {
    label: "Doctor",
    prompt: "Pick a companion",
    query: "o:\"doctor's companion\"",
  },
};

// "Partner with Thrasios, Triton Hero (When this creature enters…)" → the name.
// Reminder text follows in parentheses, so cut at the first "(" or newline.
function extractPartnerWithName(oracle) {
  const m = /partner with ([^(\n]+)/i.exec(oracle ?? "");
  return m ? m[1].trim().replace(/[.,]$/, "") : null;
}

// Which partner mechanic (if any) this card can use, and — for "Partner with"
// — the one card it's bonded to. Returns null when the card can't partner.
//
// ORDER MATTERS: "Partner with X" contains the word "partner", so it has to be
// tested before plain Partner or every bonded card would read as free-pairing.
export function partnerVariant(card) {
  const oracle = (card?.oracle_text ?? card?.card_faces?.[0]?.oracle_text ?? "").toLowerCase();
  const type = (card?.type_line ?? "").toLowerCase();

  if (oracle.includes("partner with ")) {
    return { kind: "partnerWith", partnerName: extractPartnerWithName(oracle) };
  }
  if (/\bpartner\b/.test(oracle))          return { kind: "partner" };
  if (oracle.includes("friends forever"))  return { kind: "friendsForever" };
  if (oracle.includes("choose a background")) return { kind: "background" };
  if (oracle.includes("doctor's companion")) return { kind: "doctorsCompanion" };
  if (type.includes("time lord doctor"))   return { kind: "timeLordDoctor" };
  return null;
}

// The cards that can legally partner with this one.
//
// Deliberately NOT filtered by colour identity: a partner's colours are added
// to the deck's, they don't have to fit inside the primary's. Filtering here
// would hide most legal pairings (Rograkh is mono-red; Ardenn is white).
//
// Returns [] rather than throwing — an empty picker is a survivable outcome,
// a crashed deck view is not.
export async function fetchPartnerCandidates(card) {
  const variant = partnerVariant(card);
  if (!variant) return [];

  // A bonded "Partner with" card has exactly one legal choice: look it up by
  // name instead of listing a pool.
  const query = variant.kind === "partnerWith"
    ? (variant.partnerName ? `!"${variant.partnerName}"` : null)
    : PARTNER_VARIANTS[variant.kind]?.query;
  if (!query) return [];

  try {
    const cards = await fetchFirstPage(query);
    // Never offer the card itself (plain Partner and Friends forever both match
    // their own pool) — a deck can't be commanded by the same card twice.
    return cards.filter(c => c.name !== card?.name);
  } catch {
    return [];
  }
}
