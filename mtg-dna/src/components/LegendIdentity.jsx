import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase.js";
import { fetchCardByName, getCardImage, formatManaCost } from "../lib/scryfall.js";

const DECK_GATE = 100;

// A deck's total = sum of deck_cards quantities + 1 for the commander
// (the commander itself is never written to deck_cards).
function deckTotal(deck) {
  const cardSum = (deck.deck_cards ?? []).reduce((sum, dc) => sum + (dc.quantity ?? 0), 0);
  return cardSum + 1;
}

export default function LegendIdentity({ legend, onBack, onBrew }) {
  const { theme, mode } = useTheme();
  const [oracleCard, setOracleCard] = useState(null);
  const [decks, setDecks] = useState(legend.decks ?? []);
  const [brewPressed, setBrewPressed] = useState(false);

  const dimColor    = mode === "light" ? theme.muted : theme.dim;
  const textColor   = mode === "light" ? theme.ink   : theme.white;
  const ruleColor   = mode === "light" ? theme.gold  : theme.amber;
  const borderColor = mode === "light" ? theme.border : theme.muted;

  useEffect(() => {
    let cancelled = false;
    setOracleCard(null);
    fetchCardByName(legend.name)
      .then(card => { if (!cancelled) setOracleCard(card); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [legend.name]);

  // Re-fetch this legend's decks so counts reflect the latest save —
  // the `legend` prop carries the snapshot from when the Box tile was tapped.
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

  const highest = decks.reduce((max, d) => Math.max(max, deckTotal(d)), 0);
  const gated = highest < DECK_GATE;

  const art = legend.image_uri || (oracleCard ? getCardImage(oracleCard, "art_crop") : null);
  const typeLine = oracleCard?.type_line ?? "";
  const oracleText = oracleCard?.oracle_text ?? oracleCard?.card_faces?.[0]?.oracle_text ?? "";
  const manaCost = formatManaCost(oracleCard?.mana_cost ?? oracleCard?.card_faces?.[0]?.mana_cost);

  const inProgressDeck = decks.find(d => deckTotal(d) < DECK_GATE) ?? null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: theme.base,
      overflowY: "auto",
      WebkitOverflowScrolling: "touch",
    }}>
      <button
        onClick={onBack}
        aria-label="Back"
        style={{
          position: "fixed",
          top: 10, left: 10,
          zIndex: 51,
          width: 44, height: 44,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", padding: 0,
          color: textColor,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          className="material-symbols-rounded"
          style={{ fontSize: 22, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
        >
          arrow_back
        </span>
      </button>

      {/* Art */}
      <div style={{ width: "100%", aspectRatio: "5 / 2", background: theme.border }}>
        {art && (
          <img
            src={art}
            alt={legend.name}
            draggable={false}
            style={{
              width: "100%", height: "100%",
              objectFit: "cover",
              filter: gated ? (mode === "dark" ? "grayscale(1) brightness(1.45) contrast(0.95)" : "grayscale(1)") : "none",
            }}
          />
        )}
      </div>

      <div style={{ padding: "20px 20px 40px" }}>
        {/* Name block */}
        <div style={{ marginBottom: 32 }}>
          {typeLine && (
            <div style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "lowercase",
              color: dimColor,
              marginBottom: 4,
            }}>
              {typeLine.toLowerCase()}
            </div>
          )}
          <div style={{
            fontFamily: "'Zilla Slab', serif",
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: "0.02em",
            color: textColor,
            lineHeight: 1.1,
          }}>
            {legend.name}
          </div>
          <div style={{ width: 32, height: 1, background: ruleColor, marginTop: 10 }} />
        </div>

        {/* Oracle text + mana cost */}
        {(oracleText || manaCost) && (
          <div style={{ marginBottom: 32 }}>
            {manaCost && (
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 13,
                color: dimColor,
                marginBottom: 8,
              }}>
                {manaCost}
              </div>
            )}
            {oracleText && (
              <div style={{
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 14,
                fontWeight: 300,
                lineHeight: 1.7,
                color: textColor,
                whiteSpace: "pre-line",
              }}>
                {oracleText}
              </div>
            )}
          </div>
        )}

        {/* Decks list */}
        <div style={{ marginBottom: 32 }}>
          {decks.length === 0 ? (
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12,
              color: dimColor,
              opacity: 0.6,
            }}>
              no decks yet
            </div>
          ) : decks.map(deck => {
            const total = deckTotal(deck);
            const complete = total >= DECK_GATE;
            return (
              <div
                key={deck.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 0",
                  borderBottom: `1px solid ${borderColor}`,
                }}
              >
                <div style={{
                  flex: 1, minWidth: 0,
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 14,
                  color: textColor,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {deck.build_name || legend.name}
                </div>
                <div style={{
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 12,
                  color: complete ? ruleColor : dimColor,
                  flexShrink: 0,
                }}>
                  {complete ? DECK_GATE : `${total}/${DECK_GATE}`}
                </div>
                <div style={{
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 12,
                  color: dimColor,
                  flexShrink: 0,
                }}>
                  {deck.status}
                </div>
                <span
                  className="material-symbols-rounded"
                  style={{ fontSize: 16, color: dimColor, flexShrink: 0 }}
                >
                  chevron_right
                </span>
              </div>
            );
          })}
        </div>

        {/* Verbs */}
        <button
          onClick={() => onBrew(legend, inProgressDeck)}
          onPointerDown={() => setBrewPressed(true)}
          onPointerUp={() => setBrewPressed(false)}
          onPointerLeave={() => setBrewPressed(false)}
          style={{
            display: "block",
            width: "100%",
            height: 48,
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
