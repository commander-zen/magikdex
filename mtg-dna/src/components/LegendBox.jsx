import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";
import { fetchCardIdentity, getCardImage } from "../lib/scryfall.js";
import AddLegendSheet from "./AddLegendSheet";

const DECK_GATE = 100;

// Fixed 4×2 box of slots, Pokémon-storage style — never scrolls; legends
// beyond one box page onto the next via the header chevrons.
const COLS = 4;
const ROWS = 2;
const PAGE_SIZE = COLS * ROWS;
const BOX_KEY = "magicdex-box";

// Gated ("not yet a deck") slots are darkened with a SCRIM OVERLAY on top of
// the art — never a CSS filter on the image. Desaturating Scryfall art
// violates their image terms (see DATA_SOURCES.md); the img stays untouched.
const GATE_SCRIM = "rgba(10,14,26,0.55)";

// A deck's total = sum of deck_cards quantities + 1 for the commander
// (the commander itself is never written to deck_cards).
function deckTotal(deck) {
  const cardSum = (deck.deck_cards ?? []).reduce((sum, dc) => sum + (dc.quantity ?? 0), 0);
  return cardSum + 1;
}

export default function LegendBox({ onSelectLegend, onLegendsLoaded, reloadSignal, activeId }) {
  const { theme, mode } = useTheme();
  const [legends, setLegends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [identityFailed, setIdentityFailed] = useState(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [box, setBox] = useState(() => {
    const n = parseInt(localStorage.getItem(BOX_KEY) ?? "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const [toast, setToast] = useState(null);
  const attemptedRef = useRef(new Set());
  const toastTimer = useRef(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const dimColor    = mode === "light" ? theme.muted : theme.dim;
  const textColor   = mode === "light" ? theme.ink   : theme.white;
  const ringColor   = mode === "light" ? theme.gold  : theme.amber;
  const borderColor = mode === "light" ? theme.border : theme.muted;
  const slotBg      = theme.paper ?? theme.surface ?? "transparent";

  async function loadLegends() {
    const { data, error } = await supabase
      .from("legends")
      .select("id, name, scryfall_id, image_uri, type_line, color_identity, decks(id, status, deck_cards(quantity))")
      .order("name");
    if (!error) setLegends(data ?? []);
    setLoading(false);
  }

  // Reload on mount and whenever the parent bumps reloadSignal — a brew
  // session ending refreshes deck totals across the box and the detail pane.
  useEffect(() => {
    loadLegends();
  }, [reloadSignal]);

  // Keep the parent surface's legend list (and its detail pane) in sync
  // through loads, adds, and lazy identity healing.
  useEffect(() => {
    onLegendsLoaded?.(legends);
  }, [legends]); // eslint-disable-line react-hooks/exhaustive-deps

  // The add tile occupies the slot after the last legend, so the box count
  // includes it. Clamp the current page if legends shrank since last visit.
  const boxCount = Math.max(1, Math.ceil((legends.length + 1) / PAGE_SIZE));
  useEffect(() => {
    if (box > boxCount - 1) setBox(boxCount - 1);
  }, [box, boxCount]);
  useEffect(() => {
    localStorage.setItem(BOX_KEY, String(box));
  }, [box]);

  // Selecting a card in AddLegendSheet adds it (no deck) and refreshes the box
  // — unless it's already in the box. Match on scryfall id, never name: if it's
  // a duplicate, don't insert; just select the existing legend and flash a
  // notice. Newly added rows carry scryfall_id so this guard works immediately,
  // before the lazy identity heal runs.
  async function handleAddLegend(card) {
    const existing = legends.find(l => l.scryfall_id === card.id);
    if (existing) {
      setAddOpen(false);
      onSelectLegend?.(existing);
      showToast("already in the dex");
      return;
    }
    await supabase
      .from("legends")
      .upsert({ name: card.name, scryfall_id: card.id }, { onConflict: "name" });
    setAddOpen(false);
    setLoading(true);
    await loadLegends();
  }

  // Paste-import: upsert the legend → create its deck → bulk-insert the
  // resolved decklist + WREC tags (mirrors Brew.jsx's handleConfirmSave
  // legend/deck-creation pattern, but the cards/tags come pre-parsed from
  // moxfieldImport.js instead of an in-progress swipe session). Left open
  // so AddLegendSheet can show the parse/commander UI and a result summary
  // before closing itself — this never closes the sheet or selects the
  // legend on its own.
  async function handleImportDeck(commanderName, lines) {
    const { data: legend, error: legendError } = await supabase
      .from("legends")
      .upsert({ name: commanderName }, { onConflict: "name" })
      .select()
      .single();
    if (legendError) throw legendError;

    if (!legend.image_uri || !legend.type_line) {
      try {
        const card = await fetchCardIdentity(commanderName);
        if (card) {
          await supabase.from("legends").update({
            scryfall_id: card.id,
            image_uri: getCardImage(card, "art_crop"),
            type_line: card.type_line ?? null,
            oracle_text: card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? null,
            mana_cost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? null,
            color_identity: card.color_identity ?? [],
          }).eq("id", legend.id);
        }
      } catch { /* best-effort identity backfill */ }
    }

    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({ legend: commanderName, legend_id: legend.id, status: "Active" })
      .select()
      .single();
    if (deckError) throw deckError;

    const cardRows = lines.map(l => ({
      deck_id: deck.id, card_name: l.name, quantity: l.quantity, section: "decklist",
    }));

    const insertedCards = [];
    for (let i = 0; i < cardRows.length; i += 100) {
      const { data, error: cardError } = await supabase
        .from("deck_cards")
        .insert(cardRows.slice(i, i + 100))
        .select("id, card_name");
      if (cardError) throw cardError;
      insertedCards.push(...data);
    }

    const tagRows = [];
    for (const inserted of insertedCards) {
      const line = lines.find(l => l.name === inserted.card_name);
      for (const tag of (line?.tags ?? [])) tagRows.push({ deck_card_id: inserted.id, tag });
    }
    for (let i = 0; i < tagRows.length; i += 100) {
      const { error: tagError } = await supabase
        .from("deck_card_tags")
        .insert(tagRows.slice(i, i + 100));
      if (tagError) throw tagError;
    }

    await loadLegends();
    return { cardCount: cardRows.length, taggedCount: tagRows.length };
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

  const safeBox = Math.min(box, boxCount - 1);
  const atFirst = safeBox <= 0;
  const atLast  = safeBox >= boxCount - 1;

  const slotBase = {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    borderRadius: 0,
    overflow: "hidden",
    WebkitTapHighlightColor: "transparent",
  };

  const chevron = (dir, disabled, onClick) => (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Previous box" : "Next box"}
      style={{
        width: 44, height: 44,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none", padding: 0,
        color: dimColor,
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? "default" : "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
        {dir === "left" ? "chevron_left" : "chevron_right"}
      </span>
    </button>
  );

  return (
    <>
      {/* Box header bar — pager */}
      <div style={{
        flex: "0 0 auto",
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 16,
        padding: "6px 12px",
        borderBottom: `1px solid ${borderColor}`,
      }}>
        {chevron("left", atFirst, () => setBox(b => Math.max(0, b - 1)))}
        <span style={{
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 12,
          letterSpacing: "0.22em",
          color: dimColor,
          minWidth: 56,
          textAlign: "center",
        }}>
          BOX {safeBox + 1}
        </span>
        {chevron("right", atLast, () => setBox(b => Math.min(boxCount - 1, b + 1)))}
      </div>

      {/* Fixed 4×2 slot grid — fills the tray, no scroll */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        gap: 6,
        padding: "8px 10px 10px",
      }}>
        {Array.from({ length: PAGE_SIZE }).map((_, i) => {
          const g = safeBox * PAGE_SIZE + i;

          // Skeleton slot — legends still loading, never the bare box frame alone.
          if (loading) {
            return (
              <div
                key={`skeleton-${i}`}
                aria-hidden="true"
                style={{ ...slotBase, background: slotBg, opacity: 0.5 }}
              />
            );
          }

          // Filled slot — a legend.
          if (g < legends.length) {
            const legend = legends[g];
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
                    }}
                  />
                ) : (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: noIdentity ? textColor : theme.border,
                  }} />
                )}

                {/* Locked scrim — sits ON TOP of unaltered art (no filter). */}
                {gated && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: GATE_SCRIM,
                    pointerEvents: "none",
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

                {/* Selection cursor — overlaid so it paints over the art. */}
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
          }

          // The add tile — first empty slot after the last legend.
          if (g === legends.length) {
            return (
              <button
                key="add"
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
                <span className="material-symbols-rounded" style={{ fontSize: 22, color: dimColor }}>
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
            );
          }

          // Empty inset cell — non-interactive room to grow.
          return (
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
          );
        })}
      </div>

      {/* Brief dimmed flash when a duplicate add is redirected to select. */}
      {toast && (
        <div style={{
          position: "fixed",
          left: "50%",
          bottom: "calc(env(safe-area-inset-bottom) + 24px)",
          transform: "translateX(-50%)",
          zIndex: 300,
          background: "rgba(0,0,0,0.8)",
          color: "rgba(255,255,255,0.85)",
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 12,
          letterSpacing: "0.08em",
          padding: "8px 14px",
          border: `1px solid ${borderColor}`,
          pointerEvents: "none",
        }}>
          {toast}
        </div>
      )}

      <AddLegendSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSelect={handleAddLegend}
        onImport={handleImportDeck}
      />
    </>
  );
}
