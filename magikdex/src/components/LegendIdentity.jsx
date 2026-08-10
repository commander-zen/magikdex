import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase.js";
import { getCardData, getCardImage } from "../lib/scryfall.js";
import { resolveLegendDeck } from "../lib/legendDeck.js";
import ScryCheckRadar, { readVectors } from "./ScryCheckRadar.jsx";
import ScryCheckSheet from "./ScryCheckSheet.jsx";

// The detail pane of the storage-box Home: the selected commander as a device
// readout. LEFT = the actual card image ("sprite"); RIGHT = the deck's
// self-reported ScryCheck power level as a radar. Fills its pane height with no
// internal scroll.
//
// ⚠️ THIS PANE USED TO SHOW THE WREC BARS. It doesn't any more, and the swap is
// the point rather than a redesign: WREC measures FUNCTIONAL COVERAGE and is a
// tool you use while building, so it belongs inside the deck on the brew page
// (ReviewScreen, where it still lives). The Box is the shelf you look at — what
// you want from a deck at a glance there is how hard it hits, which is power
// level. Two orthogonal axes, one per surface, never side by side.

// The five vector columns land in migration 034. Ben applies migrations by hand,
// so a deployed client can be ahead of the database — and naming a column that
// doesn't exist yet fails the WHOLE select (42703), which would blank the detail
// pane for every deck rather than just hiding the radar. Same hazard
// fetchDeckPartner isolates itself against in lib/legendDeck.js. Hence two
// selects and a fallback.
//
// deck_cards is deliberately NOT fetched any more: it was here only to count
// WREC tags. One deck per legend is a schema constraint (decks_legend_id_unique),
// so resolveLegendDeck has nothing to weigh and picks the single row regardless.
const DECK_SELECT_WITH_VECTORS =
  "decks!decks_legend_id_fkey(id, status, build_name, scrycheck_speed, scrycheck_consistency, scrycheck_interaction, scrycheck_mana_base, scrycheck_threats)";
const DECK_SELECT_BASE =
  "decks!decks_legend_id_fkey(id, status, build_name)";

export default function LegendIdentity({ legend }) {
  const { theme } = useTheme();
  const [oracleCard, setOracleCard] = useState(null);
  const [deck, setDeck] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const dimColor    = theme.dim;
  const textColor   = theme.white;
  const accentColor = theme.accent;
  const trackColor  = theme.muted;
  const plateBg     = theme.surface;

  // Cache-first (memoized) lookup — this used to hit live api.scryfall.com on
  // every legend select, which made the detail pane's sprite the slowest thing
  // on the Home surface. getCardData reads the local cards cache and only
  // falls to the live API on a true miss.
  useEffect(() => {
    let cancelled = false;
    // Clear the stale card immediately so the pane never shows the prior legend.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOracleCard(null);
    getCardData(legend.name)
      .then(card => { if (!cancelled && card) setOracleCard(card); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [legend.name]);

  // Re-fetch this legend's deck so the scores reflect the latest save — the
  // `legend` prop carries the snapshot from when the slot was tapped.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeck(null);
    (async () => {
      // FK named on purpose — see fetchLegendDeck: partner_legend_id (019) made
      // the bare `decks(...)` embed ambiguous and it fails for every user.
      let { data, error } = await supabase
        .from("legends").select(DECK_SELECT_WITH_VECTORS).eq("id", legend.id).single();
      // 42703 is what a SELECT of an unknown column returns; PGRST204/PGRST202
      // are PostgREST's schema-cache misses. Verified live: the select path
      // returns 42703, but both are matched so a stale schema cache degrades to
      // "no radar" rather than to an empty detail pane.
      if (error?.code === "42703" || error?.code === "PGRST204" || error?.code === "PGRST202") {
        ({ data, error } = await supabase
          .from("legends").select(DECK_SELECT_BASE).eq("id", legend.id).single());
      }
      if (cancelled || error || !data) return;
      setDeck(resolveLegendDeck(data.decks));
    })();
    return () => { cancelled = true; };
  }, [legend.id]);

  const cardImage = oracleCard ? (getCardImage(oracleCard, "normal") ?? getCardImage(oracleCard, "large")) : null;

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: "8px 16px 4px",
      overflow: "hidden",
    }}>
      {/* Sprite + readout */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14 }}>
        {/* Card image — a FIXED box every legend fills identically: the box
            height is the pane height and the width follows the MTG card ratio
            (63:88). The img is absolutely positioned so the source image's
            intrinsic size can never drive the box (otherwise an oversized- or
            old-frame art would render taller than a normal card). object-fit
            cover fills without distortion; corner mask unchanged. */}
        <div style={{
          position: "relative",
          height: "100%",
          aspectRatio: "63 / 88",
          flexShrink: 0,
          borderRadius: "4.8% / 3.4%",
          overflow: "hidden",
          background: plateBg,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}>
          {cardImage && (
            <img
              src={cardImage}
              alt={legend.name}
              draggable={false}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                objectFit: "cover", display: "block",
              }}
            />
          )}
        </div>

        {/* Readout — the ScryCheck radar, with its attribution under it. Tapping
            it opens the self-report sheet. A legend with no deck row has nothing
            to grade, so it gets the dashed placeholder instead of a chart that
            could never be filled in. */}
        <div style={{
          flex: 1, minWidth: 0, minHeight: 0,
          display: "flex", flexDirection: "column",
          padding: "2px 0",
        }}>
          {deck?.id ? (
            <ScryCheckRadar
              vectors={readVectors(deck)}
              accent={accentColor}
              text={textColor}
              dim={dimColor}
              track={trackColor}
              onEdit={() => setSheetOpen(true)}
            />
          ) : (
            <div style={{
              flex: 1, minHeight: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: `1px dashed ${trackColor}`,
              textAlign: "center", padding: 8,
            }}>
              <span style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 9,
                letterSpacing: "0.12em",
                lineHeight: 1.6,
                color: dimColor,
              }}>
                NO DECK YET
              </span>
            </div>
          )}
        </div>
      </div>

      <ScryCheckSheet
        open={sheetOpen}
        deck={deck}
        deckName={deck?.build_name || legend.name}
        onClose={() => setSheetOpen(false)}
        // Patch in place rather than re-running the select: the update already
        // succeeded, so a refetch would only be a slower way to learn what we
        // just wrote.
        onSaved={patch => setDeck(d => (d ? { ...d, ...patch } : d))}
      />
    </div>
  );
}
