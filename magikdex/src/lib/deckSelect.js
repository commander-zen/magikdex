import { supabase } from "./supabase.js";

// Reading a legend's deck row, degrading one feature at a time.
//
// ⚠️ WHY A LADDER AT ALL. Ben applies migrations by hand, so a deployed client
// can be ahead of the database by one OR two migrations — and naming a column
// that does not exist fails the WHOLE select. Without this, a pending migration
// blanks the Box's detail pane for every deck rather than hiding one feature.
//
// Extracted from LegendIdentity so the print overlay can read the same row when
// it is opened from a screen that does not already have one (the brew screen
// knows only the legend id). Two copies of this ladder would drift the first
// time a migration lands, and the drift would be invisible until a user with a
// half-applied database hit the one that was not updated.
const VECTOR_COLS = "scrycheck_speed, scrycheck_consistency, scrycheck_interaction, scrycheck_mana_base, scrycheck_threats";
const LINK_COLS   = "url, platform, scrycheck_url, scrycheck_score, scrycheck_bracket, scrycheck_version, scrycheck_scored_at";
const SELF_COLS   = "self_game_style, self_play_style";

// Most complete first. Each rung drops exactly one migration's worth.
export const DECK_SELECTS = [
  `decks!decks_legend_id_fkey(id, status, build_name, ${VECTOR_COLS}, ${LINK_COLS}, ${SELF_COLS})`, // 034+035+036
  `decks!decks_legend_id_fkey(id, status, build_name, ${VECTOR_COLS}, ${LINK_COLS})`,               // 034 + 035
  `decks!decks_legend_id_fkey(id, status, build_name, ${VECTOR_COLS})`,                             // 034 only
  "decks!decks_legend_id_fkey(id, status, build_name)",                                             // neither
];

// 42703 is what a SELECT of an unknown column returns; PGRST204/PGRST202 are
// PostgREST's schema-cache misses. All three are matched so a stale cache
// degrades to "fewer features" rather than to an empty pane.
export const MISSING_COLUMN = new Set(["42703", "PGRST204", "PGRST202"]);

/**
 * The deck row for a legend, or null. Walks the ladder until one select works.
 * The FK is named on purpose — partner_legend_id (019) made a bare `decks(...)`
 * embed ambiguous, and that fails for every user.
 */
export async function fetchDeckForLegend(legendId, resolve) {
  if (!legendId) return null;
  for (const select of DECK_SELECTS) {
    const { data, error } = await supabase
      .from("legends").select(select).eq("id", legendId).single();
    if (error) {
      if (MISSING_COLUMN.has(error.code)) continue;   // try the next rung down
      return null;
    }
    if (data) return resolve ? resolve(data.decks) : data.decks;
    return null;
  }
  return null;
}
