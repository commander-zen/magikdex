import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";
import { fetchCardIdentity, getCardImage } from "../lib/scryfall.js";
import AddLegendSheet from "./AddLegendSheet";

const DECK_GATE = 100;

// Gated (grayscale) art reads as a near-dead screen in dark mode without a
// brightness lift; scoped to dark since the lift glows oddly on light paper.
const GATED_FILTER = {
  dark:  "grayscale(1) brightness(1.45) contrast(0.95)",
  light: "grayscale(1)",
};

// A deck's total = sum of deck_cards quantities + 1 for the commander
// (the commander itself is never written to deck_cards).
function deckTotal(deck) {
  const cardSum = (deck.deck_cards ?? []).reduce((sum, dc) => sum + (dc.quantity ?? 0), 0);
  return cardSum + 1;
}

// Slots per row in the box tray — uniform square cells, Pokémon-box style.
const COLS = 4;

export default function LegendBox({ onSelectLegend, onLegendsLoaded, reloadSignal, activeId }) {
  const { theme, mode } = useTheme();
  const [legends, setLegends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [identityFailed, setIdentityFailed] = useState(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const attemptedRef = useRef(new Set());

  const dimColor    = mode === "light" ? theme.muted : theme.dim;
  const textColor   = mode === "light" ? theme.ink   : theme.white;
  const ringColor   = mode === "light" ? theme.gold  : theme.amber;
  const borderColor = mode === "light" ? theme.border : theme.muted;
  const slotBg      = theme.paper ?? theme.surface ?? "transparent";
  const gatedFilter = mode === "dark" ? GATED_FILTER.dark : GATED_FILTER.light;

  async function loadLegends() {
    const { data, error } = await supabase
      .from("legends")
      .select("id, name, scryfall_id, image_uri, type_line, color_identity, decks(id, status, deck_cards(quantity))")
      .order("name");
    if (!error) setLegends(data ?? []);
    setLoading(false);
  }

  // Reload on mount and whenever the parent bumps reloadSignal — a brew
  // session ending refreshes deck totals across the grid and the top block.
  useEffect(() => {
    loadLegends();
  }, [reloadSignal]);

  // Keep the parent surface's legend list (and its last-active top block) in
  // sync through loads, adds, and lazy identity healing.
  useEffect(() => {
    onLegendsLoaded?.(legends);
  }, [legends]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecting a card in AddLegendSheet upserts it (no deck) and refreshes the grid.
  async function handleAddLegend(card) {
    await supabase
      .from("legends")
      .upsert({ name: card.name }, { onConflict: "name" });
    setAddOpen(false);
    setLoading(true);
    await loadLegends();
  }

  // Lazily heal legends saved without Scryfall identity (no art_crop/oracle
  // data) — one lookup per legend, persisted onto the legends row so it
  // doesn't repeat on future loads.
  useEffect(() => {
    const missing = legends.filter(l =>
      !attemptedRef.current.has(l.id) && (!l.image_uri || !l.type_line)
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const legend of missing) {
        attemptedRef.current.add(legend.id);
        const card = await fetchCardIdentity(legend.name);
        if (cancelled) return;
        if (!card) {
          setIdentityFailed(prev => new Set(prev).add(legend.id));
          continue;
        }
        const patch = {
          scryfall_id: card.id,
          image_uri: getCardImage(card, "art_crop"),
          type_line: card.type_line ?? null,
          oracle_text: card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? null,
          mana_cost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? null,
          color_identity: card.color_identity ?? [],
        };
        await supabase.from("legends").update(patch).eq("id", legend.id);
        if (!cancelled) {
          setLegends(prev => prev.map(l => l.id === legend.id ? { ...l, ...patch } : l));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [legends]);

  if (loading) return null;

  // The add tile occupies the first empty slot; after the filled slots + add
  // tile, pad the current row and show one full extra row so the box visibly
  // has room to grow.
  const occupied   = legends.length + 1;
  const rows       = Math.ceil(occupied / COLS);
  const emptyCount = (rows + 1) * COLS - occupied;

  const slotBase = {
    position: "relative",
    width: "100%",
    aspectRatio: "1 / 1",
    padding: 0,
    borderRadius: 0,
    overflow: "hidden",
    WebkitTapHighlightColor: "transparent",
  };

  return (
    <>
      {/* Box header bar */}
      <div style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: `1px solid ${borderColor}`,
      }}>
        <span style={{
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 12,
          letterSpacing: "0.22em",
          color: dimColor,
        }}>
          BOX
        </span>
        <span style={{
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 12,
          color: dimColor,
        }}>
          {legends.length}
        </span>
      </div>

      {/* Slots — the tray scrolls internally; the top detail pane stays fixed. */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        padding: "12px 16px calc(env(safe-area-inset-bottom) + 16px)",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gap: 8,
        }}>
          {legends.map(legend => {
            const highest = (legend.decks ?? []).reduce(
              (max, d) => Math.max(max, deckTotal(d)), 0
            );
            const gated = highest < DECK_GATE;
            const art = legend.image_uri;
            const noIdentity = !art && identityFailed.has(legend.id);
            const isActive = legend.id === activeId;

            return (
              <button
                key={legend.id}
                onClick={() => onSelectLegend(legend)}
                style={{
                  ...slotBase,
                  display: "block",
                  border: "none",
                  background: slotBg,
                  cursor: "pointer",
                }}
              >
                {art ? (
                  <img
                    src={art}
                    alt={legend.name}
                    draggable={false}
                    style={{
                      position: "absolute", inset: 0,
                      width: "100%", height: "100%",
                      objectFit: "cover",
                      filter: gated ? gatedFilter : "none",
                    }}
                  />
                ) : (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: noIdentity ? textColor : theme.border,
                  }} />
                )}

                {gated && (
                  <div style={{
                    position: "absolute",
                    top: 3, right: 4,
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 9,
                    color: "rgba(255,255,255,0.75)",
                    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                  }}>
                    {highest}/{DECK_GATE}
                  </div>
                )}

                <div style={{
                  position: "absolute",
                  left: 0, right: 0, bottom: 0,
                  padding: "3px 5px",
                  background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
                  fontFamily: "'Zilla Slab', serif",
                  fontSize: 11,
                  color: "#ffffff",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textAlign: "left",
                }}>
                  {legend.name}
                </div>

                {/* Selected-slot ring — overlaid so it paints over the art. */}
                {isActive && (
                  <div style={{
                    position: "absolute", inset: 0,
                    border: `2px solid ${ringColor}`,
                    pointerEvents: "none",
                    zIndex: 2,
                  }} />
                )}
              </button>
            );
          })}

          {/* Add tile — the first empty slot */}
          <button
            onClick={() => setAddOpen(true)}
            aria-label="Add legend"
            style={{
              ...slotBase,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 2,
              border: `1px dashed ${dimColor}`,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            <span
              className="material-symbols-rounded"
              style={{ fontSize: 20, color: dimColor }}
            >
              add
            </span>
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 9,
              color: dimColor,
            }}>
              add
            </span>
          </button>

          {/* Visible empty slots — non-interactive room to grow */}
          {Array.from({ length: emptyCount }).map((_, i) => (
            <div
              key={`empty-${i}`}
              aria-hidden="true"
              style={{
                ...slotBase,
                border: `1px dashed ${borderColor}`,
                background: "transparent",
                pointerEvents: "none",
              }}
            />
          ))}
        </div>
      </div>

      <AddLegendSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSelect={handleAddLegend}
      />
    </>
  );
}
