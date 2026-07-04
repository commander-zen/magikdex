import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase.js";
import { getCardData, getCardImage, formatManaCost } from "../lib/scryfall.js";
import { deckTotal, resolveLegendDeck } from "../lib/legendDeck.js";

const DECK_GATE = 100;

// The detail pane of the storage-box Home: the selected commander as a
// device readout. LEFT = the actual card image ("sprite"); RIGHT = stacked
// label/value fields; footer = brew button + the deck row. Fills its pane
// height with no internal scroll.
export default function LegendIdentity({ legend, onBrew }) {
  const { theme, mode } = useTheme();
  const [oracleCard, setOracleCard] = useState(null);
  const [decks, setDecks] = useState(legend.decks ?? []);
  const [brewPressed, setBrewPressed] = useState(false);

  const dimColor    = mode === "light" ? theme.muted : theme.dim;
  const textColor   = mode === "light" ? theme.ink   : theme.white;
  const ruleColor   = mode === "light" ? theme.gold  : theme.amber;
  const borderColor = mode === "light" ? theme.border : theme.muted;
  const plateBg     = mode === "light" ? theme.paper : theme.surface;

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

  // Re-fetch this legend's decks so counts/status reflect the latest save —
  // the `legend` prop carries the snapshot from when the slot was tapped.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("legends")
      .select("decks(id, status, build_name, deck_cards(quantity))")
      .eq("id", legend.id)
      .single()
      .then(({ data, error }) => {
        if (!cancelled && !error && data) setDecks(data.decks ?? []);
      });
    return () => { cancelled = true; };
  }, [legend.id]);

  const cardImage = oracleCard ? (getCardImage(oracleCard, "normal") ?? getCardImage(oracleCard, "large")) : null;
  const typeLine = oracleCard?.type_line ?? legend.type_line ?? "";
  // Every legal commander is a legendary creature, so "Legendary Creature — "
  // is dead weight eating horizontal space. Display-only: show the subtypes
  // after the em dash; fall back to the full type if it's not a creature
  // (e.g. a planeswalker/Background commander) so nothing reads blank.
  const displayType = (/creature/i.test(typeLine) && typeLine.includes("—"))
    ? (typeLine.split("—")[1]?.trim() || typeLine)
    : typeLine;
  const manaCost = formatManaCost(oracleCard?.mana_cost ?? oracleCard?.card_faces?.[0]?.mana_cost ?? legend.mana_cost);

  // ONE definition of "this legend's deck" — the deck row and the brew
  // button below both use this same resolved deck, so they can never again
  // point at different rows. See lib/legendDeck.js for the resolution rule.
  const deck = resolveLegendDeck(decks);
  const total = deck ? deckTotal(deck) : 0;
  const complete = total >= DECK_GATE;

  const field = (label, value, valueColor) => (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontFamily: "'Noto Sans Mono', monospace",
        fontSize: 9,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: dimColor,
        marginBottom: 1,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'Zilla Slab', serif",
        fontSize: 15,
        lineHeight: 1.15,
        color: valueColor ?? textColor,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {value || "—"}
      </div>
    </div>
  );

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

        {/* Readout — label/value fields, vertically centered */}
        <div style={{
          flex: 1, minWidth: 0,
          display: "flex", flexDirection: "column", justifyContent: "center",
          gap: 9,
        }}>
          {field("name", legend.name)}
          {field("type", displayType.toLowerCase())}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 9,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: dimColor,
              marginBottom: 1,
            }}>
              mana
            </div>
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 14,
              color: textColor,
            }}>
              {manaCost || "—"}
            </div>
          </div>
          {field("status", deck?.status)}
          {field("deck", `${total}/${DECK_GATE}`, complete ? ruleColor : textColor)}
        </div>
      </div>

      {/* Footer — deck row + brew button. The deck row is ALWAYS rendered so
          the footer height is constant: the sprite + readout never reflow or
          compress based on whether a deck exists. No deck → a dimmed
          "no deck yet" with 0/100 in the same footprint, non-interactive. */}
      <div style={{ flexShrink: 0, paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          onClick={deck ? () => onBrew(legend, deck, { startView: "review" }) : undefined}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            minHeight: 36,
            padding: "6px 0",
            borderTop: `1px solid ${borderColor}`,
            cursor: deck ? "pointer" : "default",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div style={{
            flex: 1, minWidth: 0,
            fontFamily: "'Noto Sans', sans-serif",
            fontSize: 13,
            color: deck ? textColor : dimColor,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {deck ? (deck.build_name || legend.name) : "no deck yet"}
          </div>
          <div style={{
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 11,
            color: complete ? ruleColor : dimColor,
            flexShrink: 0,
          }}>
            {complete ? DECK_GATE : `${total}/${DECK_GATE}`}
          </div>
          <span
            className="material-symbols-rounded"
            style={{ fontSize: 16, color: dimColor, flexShrink: 0, opacity: deck ? 1 : 0.35 }}
          >
            chevron_right
          </span>
        </div>

        <button
          onClick={() => onBrew(legend, deck)}
          onPointerDown={() => setBrewPressed(true)}
          onPointerUp={() => setBrewPressed(false)}
          onPointerLeave={() => setBrewPressed(false)}
          style={{
            display: "block",
            width: "100%",
            height: 44,
            background: brewPressed ? ruleColor : "transparent",
            border: `1px solid ${ruleColor}`,
            borderRadius: 0,
            padding: 0,
            fontFamily: "'Zilla Slab', serif",
            fontSize: 16,
            letterSpacing: "0.04em",
            textTransform: "lowercase",
            textAlign: "center",
            color: brewPressed ? theme.base : ruleColor,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          brew
        </button>
      </div>
    </div>
  );
}
