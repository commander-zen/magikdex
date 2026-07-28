import { supabase } from "./supabase.js";

// A deck's total = the MAINBOARD's card quantities + 1 for the commander
// (the commander itself is never written to deck_cards). UAT 2026-07-14 — the
// deck count is always just the main board: the maybeboard (and any pile rows)
// are excluded. Rows whose query didn't select `section` still count, so older
// callers keep their prior behavior.
export function deckTotal(deck) {
  const cardSum = (deck.deck_cards ?? [])
    .filter(dc => dc.section !== "maybe" && dc.section !== "pile")
    .reduce((sum, dc) => sum + (dc.quantity ?? 0), 0);
  // Commanders aren't deck_cards rows, so they're added here: 1, or 2 for a
  // partner deck (98 + 2 = 100, not 99 + 1). Reads as +0 when the caller's
  // query didn't select partner_legend_id, or before migration 019 is applied
  // — so every existing caller keeps its current behaviour.
  return cardSum + 1 + (deck.partner_legend_id ? 1 : 0);
}

// PostgREST embed shape for `decks(...)` off `legends` flips between an
// array and a single object/null depending on whether it infers the
// relationship as to-many or to-one — and it inferred to-one the moment the
// decks_legend_id_unique constraint landed (one-deck-per-legend). Every
// caller here still gets whatever shape a given query returned, so normalize
// before treating it as a list.
function toDeckArray(decks) {
  return Array.isArray(decks) ? decks : decks ? [decks] : [];
}

// The ONE definition of "this legend's deck" — every surface (the deck row,
// the brew button, Brew.jsx's session-init) must call this instead of
// inventing its own pick. One-deck-per-legend is the intended invariant
// (enforced at the schema level separately); this only has a decision to
// make when that invariant is violated — pre-constraint data, or a future
// bug forking a legend again. In that defensive case, picks the fullest
// deck deterministically, so two surfaces reading the same legend can never
// disagree about which row is "the" deck.
export function resolveLegendDeck(decks) {
  return toDeckArray(decks).reduce(
    (best, d) => (best === null || deckTotal(d) > deckTotal(best) ? d : best),
    null
  );
}

// One door for creating-or-matching a legend row. Names are unique PER USER
// after migration 013 (user_id defaults to auth.uid() server-side, so it's
// never sent from here); the legacy "name" conflict target is retried when
// the deployed code is ahead of the migration, so deploy order can't break
// add-legend.
export async function upsertLegend(fields) {
  let { data, error } = await supabase
    .from("legends")
    .upsert(fields, { onConflict: "user_id,name" })
    .select()
    .single();
  // Fall back ONLY when the failure is the conflict target itself not
  // existing yet (42703 unknown column / 42P10 no matching constraint —
  // i.e. code deployed ahead of migration 013). Any other error (RLS
  // denial, network) must surface as itself, not as the fallback's noise.
  if (error && (error.code === "42P10" || error.code === "42703")) {
    ({ data, error } = await supabase
      .from("legends")
      .upsert(fields, { onConflict: "name" })
      .select()
      .single());
  }
  if (error) throw error;
  return data;
}

// Deleting a legend removes it OUTRIGHT — the legend row, its deck, the
// deck's cards, and their tags all go; nothing survives in the Box. Deletes
// run child→parent because only deck_card_tags → deck_cards cascades at the
// schema level (migration 006): deck_cards first (tags cascade), then the
// decks row, then the legend itself. A deck-less legend passes deckId null
// and only the legend row is removed.
export async function deleteLegend(legendId, deckId) {
  if (deckId) {
    const { error: cardsError } = await supabase
      .from("deck_cards")
      .delete()
      .eq("deck_id", deckId);
    if (cardsError) throw cardsError;
    const { error: deckError } = await supabase
      .from("decks")
      .delete()
      .eq("id", deckId);
    if (deckError) throw deckError;
  }
  const { error: legendError } = await supabase
    .from("legends")
    .delete()
    .eq("id", legendId);
  if (legendError) throw legendError;
}

// Live lookup behind the resolver — the one query every surface shares
// instead of each re-deriving "this legend's deck" from whatever data it
// happens to already have in hand (a stale prop, a handed-in deckId, etc).
export async function fetchLegendDeck(legendId) {
  const { data, error } = await supabase
    .from("legends")
    // Names the FK deliberately: migration 019's partner_legend_id gave legends
    // a SECOND path to decks, so a bare `decks(...)` is ambiguous and errors.
    // This resolver wants the deck the legend commands, not ones it partners in.
    .select("decks!decks_legend_id_fkey(id, status, build_name, deck_cards(quantity, section))")
    .eq("id", legendId)
    .single();
  if (error) return null;
  return resolveLegendDeck(data?.decks);
}

// A deck's SECOND commander (partner mechanics), or null when it has none.
//
// Deliberately its own query rather than a column on fetchLegendDeck's select:
// migration 019 adds partner_legend_id and is applied by hand, so until it runs
// that column doesn't exist and naming it in the main select would break the
// whole deck lookup — i.e. the entire app — for every deck. Isolated here, a
// missing column just means "no partner", which is exactly right pre-migration.
// Any failure returns null for the same reason: a partner is an enhancement,
// never a reason to fail loading someone's deck.
export async function fetchDeckPartner(deckId) {
  if (!deckId) return null;
  try {
    const { data, error } = await supabase
      .from("decks")
      .select("partner_legend_id, partner:legends!decks_partner_legend_id_fkey(id, name, image_uri, color_identity)")
      .eq("id", deckId)
      .single();
    if (error || !data?.partner_legend_id) return null;
    // PostgREST returns an embedded to-one as an object, but hands back an
    // array in some shapes — normalise before use (same defensive read as
    // toDeckArray above).
    const partner = Array.isArray(data.partner) ? data.partner[0] : data.partner;
    return partner ?? null;
  } catch {
    return null; // column not there yet, or the embed name differs — no partner
  }
}

// The colour identity a deck must be built to: the UNION of its commanders'
// identities. Commander legality is judged against both, so a Rograkh (R) +
// Ardenn (W) deck is legal in RW — reading only the primary would hide every
// legal white card and offer illegal ones.
export function combinedColorIdentity(primary, partner) {
  return [...new Set([...(primary ?? []), ...(partner ?? [])])];
}
