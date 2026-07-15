import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase.js";
import { getCardData, getCardImage } from "../lib/scryfall.js";
import { resolveLegendDeck } from "../lib/legendDeck.js";
import { fetchDeckCardsWithTags } from "../lib/deckTags.js";
import { WREC_CHIPS } from "./WrecBand.jsx";
import { CATEGORY_META } from "../lib/wrec.js";

// The detail pane of the storage-box Home: the selected commander as a
// device readout. LEFT = the actual card image ("sprite"); RIGHT = the deck's
// WREC composition as bars filling toward Rachel Weeks' recommended targets
// (Change v4 — replaces the old name/type/mana/deck field stack). Fills its
// pane height with no internal scroll.
export default function LegendIdentity({ legend }) {
  const { theme } = useTheme();
  const [oracleCard, setOracleCard] = useState(null);
  const [decks, setDecks] = useState(legend.decks ?? []);
  // WREC composition of the selected deck — the readout IS the deck's role
  // coverage now. Fetched per selected deck; untagged/empty decks read zeros.
  const [tagRows, setTagRows] = useState([]);

  const dimColor    = theme.dim;
  const textColor   = theme.white;
  const ruleColor   = theme.accent;
  const trackColor  = theme.surface;
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

  // Re-fetch this legend's decks so counts reflect the latest save —
  // the `legend` prop carries the snapshot from when the slot was tapped.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("legends")
      .select("decks(id, status, build_name, deck_cards(quantity, section))")
      .eq("id", legend.id)
      .single()
      .then(({ data, error }) => {
        if (!cancelled && !error && data) setDecks(data.decks ?? []);
      });
    return () => { cancelled = true; };
  }, [legend.id]);

  // Load the resolved deck's WREC tags whenever the deck changes (select/reload).
  useEffect(() => {
    const d = resolveLegendDeck(decks);
    // Reset when the selected legend has no deck — a plain sync clear, not a
    // cascade (matches the codebase's other guarded reset effects).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!d?.id) { setTagRows([]); return; }
    let cancelled = false;
    fetchDeckCardsWithTags(d.id)
      .then(rows => { if (!cancelled) setTagRows(rows ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [decks]);

  const cardImage = oracleCard ? (getCardImage(oracleCard, "normal") ?? getCardImage(oracleCard, "large")) : null;

  // Vault UAT item 5 — this pane has room for full category names; the band's
  // mobile abbreviations (CARD-ADV, MASS-DIS) read as truncation here.
  const FULL_LABEL = {
    "card-advantage":  "CARD-ADVANTAGE",
    "mass-disruption": "MASS-DISRUPTION",
  };

  // WREC bars — count each category by card quantity (multi-tag can sum past
  // the deck size; it's a composition readout, not a partition), then measure
  // it against Rachel Weeks' recommended target. ratio caps the fill at 1 but
  // is kept uncapped so an OVER-target category can be marked (accent count).
  const wrecBars = WREC_CHIPS.map(({ tag, label }) => {
    let n = 0;
    for (const r of tagRows) if (r.tags?.includes(tag)) n += (r.quantity ?? 1);
    const target = CATEGORY_META[tag]?.target ?? 0;
    const ratio = target ? n / target : 0;
    return { tag, label, n, target, ratio };
  });

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

        {/* Readout — WREC composition bars, vertically centered. Each bar fills
            toward its Rachel Weeks target; a category at/over target reads in the
            accent (a full gold bar + gold count is the "covered" tell), a zero
            reads dimmed (the dump-stat tell). No name/type/mana/deck fields — the
            card art already carries the identity, and the box tile carries the
            name; this pane is now purely "how is this deck composed". */}
        <div style={{
          flex: 1, minWidth: 0,
          // UAT batch 2, item 10 — five rows split the card-frame height
          // EVENLY (each row flexes; no fixed gaps to clip the last bar).
          display: "flex", flexDirection: "column",
          padding: "2px 0",
        }}>
          {wrecBars.map(({ tag, label, n, target, ratio }) => {
            const met = ratio >= 1;
            const empty = n === 0;
            return (
              <div key={tag} style={{
                flex: 1, minWidth: 0, minHeight: 0,
                display: "flex", flexDirection: "column", justifyContent: "center",
              }}>
                <div style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between",
                  gap: 8, marginBottom: 3,
                }}>
                  <span style={{
                    // Tighter tracking + nowrap/ellipsis so CARD-ADVANTAGE and
                    // MASS-DISRUPTION never wrap to a second line (item 10).
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    color: dimColor,
                    minWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {FULL_LABEL[tag] ?? label}
                  </span>
                  <span style={{
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 11,
                    color: empty ? dimColor : met ? ruleColor : textColor,
                    flexShrink: 0,
                  }}>
                    {n}/{target}
                  </span>
                </div>
                {/* Track + fill. Fill caps at 100% even when over target; the
                    accent color + accent count above signal the overflow. */}
                <div style={{ height: 4, background: trackColor, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(1, ratio) * 100}%`,
                    background: empty ? "transparent" : ruleColor,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
