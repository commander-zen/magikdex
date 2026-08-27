import { supabase } from "./supabase.js";
import { TAXONOMY } from "../../scripts/otag-taxonomy.mjs";

// The fixed five-value WREC tag set (mirrors the wrec_tag enum in
// migration 006). A card in a deck can carry zero or more of these.
export const WREC_TAGS = [
  "ramp",
  "card-advantage",
  "disruption",
  "mass-disruption",
  "plan",
];

// otag → the WREC category it auto-suggests, straight from the ingest
// taxonomy (the scripts import the same file, so app and pipeline can't
// drift). `plan` never appears HERE, and that is still deliberate: it is not
// derivable from a card's own tags.
//
// ⚠️ NARROWED 2026-08-27, NOT ABANDONED. plan CAN now be suggested — but only
// once the deck's OWNER has named the plan as otags (decks.self_plan, migration
// 037). That is still the user exercising discretion, just once for the deck
// instead of ninety-nine times, and the write goes through applyAutoTags with
// source 'auto', which never overwrites a manual row. Read 037 before
// "restoring" this rule: it was a decision, not a drift.
const OTAG_TO_WREC = new Map(
  TAXONOMY.filter(t => t.wrec).map(t => [t.tag, t.wrec]),
);

// The otags that carry NO WREC category — 24 of the 35 — which is exactly the
// plan vocabulary: reanimate, mill, blink, extra-turn, landfall, burn and so
// on. Offered as the plan picker's options because tagging a card that is
// already ramp as "your plan" is not what the field is for.
export const PLAN_OTAGS = TAXONOMY.filter(t => !t.wrec).map(t => t.tag);

// Inverse view for category-seeded stacks: WREC category → its otags.
export const WREC_TO_OTAGS = {};
for (const [otag, cat] of OTAG_TO_WREC) {
  (WREC_TO_OTAGS[cat] ??= []).push(otag);
}

// The WREC categories a card's community oracle-tags suggest (card_tags,
// populated by the ingest scripts). One batched query for any number of
// cards; returns Map(oracle_id → category[]). Cards with no WREC-core tag
// simply don't appear.
export async function autoWrecTags(oracleIds, planOtags = []) {
  const map = new Map();
  const ids = (oracleIds ?? []).filter(Boolean);
  if (ids.length === 0) return map;
  // The deck's own plan otags fold into the SAME lookup, so this stays one
  // query however the plan is set.
  const plan = (planOtags ?? []).filter(Boolean);
  const wanted = [...new Set([...OTAG_TO_WREC.keys(), ...plan])];
  const { data, error } = await supabase
    .from("card_tags")
    .select("oracle_id, tag")
    .in("oracle_id", ids)
    .in("tag", wanted);
  if (error) throw error;
  const planSet = new Set(plan);
  for (const row of data ?? []) {
    // A named plan otag wins over its taxonomy category when it has both: the
    // owner calling it their plan is the more specific statement.
    const cat = planSet.has(row.tag) ? "plan" : OTAG_TO_WREC.get(row.tag);
    if (!cat) continue;
    const list = map.get(row.oracle_id) ?? [];
    if (!list.includes(cat)) list.push(cat);
    map.set(row.oracle_id, list);
  }
  return map;
}

// Write auto-suggested tags (source 'auto', migration 009). ignoreDuplicates
// so an existing row for the same (card, tag) keeps whatever source it has —
// auto never overwrites a manual tag.
export async function applyAutoTags(deckCardId, tags) {
  if (!tags?.length) return;
  const rows = tags.map(tag => ({ deck_card_id: deckCardId, tag, source: "auto" }));
  const { error } = await supabase
    .from("deck_card_tags")
    .upsert(rows, { onConflict: "deck_card_id,tag", ignoreDuplicates: true });
  if (error) throw error;
}

// A tag is a write — flick-is-a-write extends to tagging, no save step.
// Idempotent via the (deck_card_id, tag) unique constraint.
export async function tagCard(deckCardId, tag) {
  const { error } = await supabase
    .from("deck_card_tags")
    .upsert({ deck_card_id: deckCardId, tag }, { onConflict: "deck_card_id,tag" });
  if (error) throw error;
}

export async function untagCard(deckCardId, tag) {
  const { error } = await supabase
    .from("deck_card_tags")
    .delete()
    .eq("deck_card_id", deckCardId)
    .eq("tag", tag);
  if (error) throw error;
}

// The board-mover died with the maybeboard (device UAT 2026-07-14): the deck is
// the only board, so there's nowhere to move a card to — it's in or it's cut.

// A deck's cards WITH their tag arrays: each row is a deck_cards row plus
// `tags: string[]` (all WREC tags, possibly empty) and `autoTags: string[]`
// (the subset that was auto-suggested, for distinct rendering). The nested
// select rides the deck_card_tags → deck_cards foreign key.
export async function fetchDeckCardsWithTags(deckId) {
  const { data, error } = await supabase
    .from("deck_cards")
    .select("id, card_name, quantity, section, deck_card_tags(tag, source)")
    .eq("deck_id", deckId);
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id,
    card_name: row.card_name,
    quantity: row.quantity,
    section: row.section,
    tags: (row.deck_card_tags ?? []).map(t => t.tag),
    autoTags: (row.deck_card_tags ?? []).filter(t => t.source === "auto").map(t => t.tag),
  }));
}
