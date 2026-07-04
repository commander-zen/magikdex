import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase";
import { fetchCardIdentity, getCardImage } from "../lib/scryfall.js";
import { deckTotal, deleteLegend, fetchLegendDeck, resolveLegendDeck, upsertLegend } from "../lib/legendDeck.js";
import AddLegendSheet from "./AddLegendSheet";

const DECK_GATE = 100;

// Fixed 4×2 box of slots, Pokémon-storage style — never scrolls; legends
// beyond one box page onto the next via the header chevrons.
const COLS = 4;
const ROWS = 2;
const PAGE_SIZE = COLS * ROWS;
const BOX_KEY = "magicdex-box";
const ORDER_KEY = "magicdex-box-order";

// The user's arranged slot order — an array of legend ids in localStorage,
// the same localStorage-now-column-later pattern as magicdex-last-legend (a
// legends.position column can back this when multi-device matters). Display
// order = saved ids that still exist, in saved order, then any unlisted
// legends in the alphabetical order the query returned — so new adds land
// after the arranged block. No saved order → pure alphabetical, exactly the
// pre-arrange behavior.
function applyBoxOrder(list) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "null"); } catch { saved = null; }
  if (!Array.isArray(saved) || saved.length === 0) return list;
  const byId = new Map(list.map(l => [l.id, l]));
  const ordered = [];
  for (const id of saved) {
    const legend = byId.get(id);
    if (legend) { ordered.push(legend); byId.delete(id); }
  }
  for (const legend of list) if (byId.has(legend.id)) ordered.push(legend);
  return ordered;
}

function saveBoxOrder(list) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(list.map(l => l.id))); }
  catch { /* storage full/disabled — arranging still works for this visit */ }
}

// Gated ("not yet a deck") slots are darkened with a SCRIM OVERLAY on top of
// the art — never a CSS filter on the image. Desaturating Scryfall art
// violates their image terms (see DATA_SOURCES.md); the img stays untouched.
const GATE_SCRIM = "rgba(10,14,26,0.55)";

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
  // Pokémon Move-mode adaptation, entered via LONG-PRESS (per Ben — the old
  // header "arrange" toggle is gone): long-press a slot → action sheet →
  // "move" picks the legend up (dashed ring), tapping another slot swaps the
  // two and exits the mode. While arranging, slot taps never change the
  // detail-pane selection.
  const [arranging, setArranging] = useState(false);
  const [pickedId, setPickedId] = useState(null);
  // Long-press action sheet — the pressed legend, plus the inline delete
  // confirm state (mirrors the deck view's two-step, no modal-on-modal).
  const [actionLegend, setActionLegend] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const attemptedRef = useRef(new Set());
  const toastTimer = useRef(null);
  // Long-press detection: 500ms hold, cancelled by >10px drift; the click
  // that fires after a completed hold is swallowed so it never selects.
  const pressTimer = useRef(null);
  const pressOrigin = useRef(null);
  const suppressClick = useRef(false);

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
    if (!error) setLegends(applyBoxOrder(data ?? []));
    setLoading(false);
  }

  // Swap the picked legend with the tapped one, persist the new order, and
  // EXIT the mode — long-press → move → place is one gesture arc, not a
  // sticky mode. Tapping the picked slot again cancels the move the same way.
  // Cross-box swaps work for free: the chevrons stay live while arranging,
  // and the swap is index-based on the one global list the pages window over.
  function handleArrangeTap(legend) {
    if (pickedId === legend.id) { setPickedId(null); setArranging(false); return; }
    const a = legends.findIndex(l => l.id === pickedId);
    const b = legends.findIndex(l => l.id === legend.id);
    setPickedId(null);
    setArranging(false);
    if (a === -1 || b === -1) return;
    const next = [...legends];
    [next[a], next[b]] = [next[b], next[a]];
    setLegends(next);
    saveBoxOrder(next);
  }

  // ── Long-press machinery ──────────────────────────────────────────────────
  function startPress(legend, e) {
    if (arranging) return; // in-mode taps are placement taps, never presses
    suppressClick.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      suppressClick.current = true;
      navigator.vibrate?.(10);
      setConfirmingDelete(false);
      setDeleteError(null);
      setActionLegend(legend);
    }, 500);
  }
  function movePress(e) {
    if (!pressOrigin.current) return;
    const dx = e.clientX - pressOrigin.current.x;
    const dy = e.clientY - pressOrigin.current.y;
    if (dx * dx + dy * dy > 100) endPress();
  }
  function endPress() {
    clearTimeout(pressTimer.current);
    pressOrigin.current = null;
  }
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  function closeActionSheet() {
    if (deleting) return;
    setActionLegend(null);
    setConfirmingDelete(false);
    setDeleteError(null);
  }

  // "move" from the sheet: enter arrange with the pressed legend already
  // picked up — the next slot tap places it and exits.
  function handleMoveAction() {
    setArranging(true);
    setPickedId(actionLegend.id);
    closeActionSheet();
  }

  // Delete OUTRIGHT from the Box, same one-door delete + local-key hygiene as
  // the deck view's delete row (Brew.jsx): legend + deck + cards + tags leave;
  // saved order, last-active, and the persisted brew session drop the id.
  async function handleDeleteAction() {
    const legend = actionLegend;
    if (!legend) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const deckId = resolveLegendDeck(legend.decks)?.id ?? null;
      await deleteLegend(legend.id, deckId);
      try {
        localStorage.removeItem(`magicdex-brew-session:${legend.id}`);
        const order = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "null");
        if (Array.isArray(order)) {
          localStorage.setItem(ORDER_KEY, JSON.stringify(order.filter(id => id !== legend.id)));
        }
        if (localStorage.getItem("magicdex-last-legend") === String(legend.id)) {
          localStorage.removeItem("magicdex-last-legend");
        }
      } catch { /* best-effort local cleanup */ }
      setDeleting(false);
      setActionLegend(null);
      setConfirmingDelete(false);
      await loadLegends();
    } catch (err) {
      setDeleting(false);
      setDeleteError(err?.message ?? "delete failed — try again");
    }
  }

  // Reload on mount and whenever the parent bumps reloadSignal — a brew
  // session ending refreshes deck totals across the box and the detail pane.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    try {
      await upsertLegend({ name: card.name, scryfall_id: card.id });
    } catch (err) {
      // Never fail mute — with RLS live, a missing session rejects the write
      // and a silent no-op here reads as "the app is broken".
      setAddOpen(false);
      showToast(err?.message ?? "couldn't add — sign-in failed?");
      return;
    }
    setAddOpen(false);
    setLoading(true);
    await loadLegends();
  }

  // Paste-import: upsert the legend → resolve its ONE deck (never insert a
  // second row for a legend that already has one — mirrors the guard
  // Brew.jsx's session-init uses via the same lib/legendDeck.js resolver) →
  // merge the resolved decklist + WREC tags into it. Left open so
  // AddLegendSheet can show the parse/commander UI and a result summary
  // before closing itself — this never closes the sheet or selects the
  // legend on its own.
  async function handleImportDeck(commanderName, lines) {
    const legend = await upsertLegend({ name: commanderName });

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

    // A legend can have at most one deck. Resolve the existing one (if any)
    // through the same shared lookup every other surface uses, and only
    // insert a fresh deck row when the legend truly has none yet.
    const existingDeck = await fetchLegendDeck(legend.id);
    let deckId = existingDeck?.id;
    if (!deckId) {
      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .insert({ legend: commanderName, legend_id: legend.id, status: "Active" })
        .select()
        .single();
      if (deckError) throw deckError;
      deckId = deck.id;
    }

    // Merge into the resolved deck: a card already present (by name) has its
    // quantity SET to the freshly-pasted total (re-importing reconciles
    // toward "this is my decklist now", not an additive stack-on-top — a
    // second paste of the same list must not double quantities). A card not
    // yet present is inserted. Cards already in the deck but absent from
    // this import are left untouched — merge only ever adds/updates here,
    // never deletes.
    const { data: existingRows, error: existingRowsError } = await supabase
      .from("deck_cards")
      .select("id, card_name, quantity")
      .eq("deck_id", deckId);
    if (existingRowsError) throw existingRowsError;
    const existingByName = new Map(existingRows.map(r => [r.card_name.toLowerCase(), r]));

    const toInsert = lines.filter(l => !existingByName.has(l.name.toLowerCase()));
    const toUpdate = lines.filter(l => existingByName.has(l.name.toLowerCase()));

    const insertedCards = [];
    for (let i = 0; i < toInsert.length; i += 100) {
      const rows = toInsert.slice(i, i + 100).map(l => ({
        deck_id: deckId, card_name: l.name, quantity: l.quantity, section: "decklist",
      }));
      const { data, error: cardError } = await supabase
        .from("deck_cards")
        .insert(rows)
        .select("id, card_name");
      if (cardError) throw cardError;
      insertedCards.push(...data);
    }

    for (const line of toUpdate) {
      const existing = existingByName.get(line.name.toLowerCase());
      const { error: updateError } = await supabase
        .from("deck_cards")
        .update({ quantity: line.quantity })
        .eq("id", existing.id);
      if (updateError) throw updateError;
    }

    // Tags union onto whichever deck_card_id each line resolved to — never
    // removed on re-import, only added. Idempotent via the (deck_card_id,
    // tag) unique constraint, so re-importing the same tag never errors.
    const tagRows = [];
    for (const inserted of insertedCards) {
      const line = lines.find(l => l.name === inserted.card_name);
      for (const tag of (line?.tags ?? [])) tagRows.push({ deck_card_id: inserted.id, tag });
    }
    for (const line of toUpdate) {
      const existing = existingByName.get(line.name.toLowerCase());
      for (const tag of (line.tags ?? [])) tagRows.push({ deck_card_id: existing.id, tag });
    }
    for (let i = 0; i < tagRows.length; i += 100) {
      const { error: tagError } = await supabase
        .from("deck_card_tags")
        .upsert(tagRows.slice(i, i + 100), { onConflict: "deck_card_id,tag" });
      if (tagError) throw tagError;
    }

    await loadLegends();
    return { cardCount: toInsert.length + toUpdate.length, taggedCount: tagRows.length };
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
      {/* Box header bar — pager, plus a "cancel" escape on the right while a
          move is in flight (arrange mode is entered by long-pressing a slot).
          The pager stays live while arranging so swaps can cross boxes. */}
      <div style={{
        position: "relative",
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
        {arranging && (
          <button
            onClick={() => { setArranging(false); setPickedId(null); }}
            style={{
              position: "absolute",
              right: 8, top: "50%", transform: "translateY(-50%)",
              minHeight: 44, minWidth: 44,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", padding: "0 6px",
              color: ringColor,
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 11,
              letterSpacing: "0.08em",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            cancel
          </button>
        )}
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
            const legendDeck = resolveLegendDeck(legend.decks);
            const highest = legendDeck ? deckTotal(legendDeck) : 0;
            const gated = highest < DECK_GATE;
            const art = legend.image_uri;
            const noIdentity = !art && identityFailed.has(legend.id);
            const isActive = legend.id === activeId;
            const isPicked = arranging && legend.id === pickedId;

            return (
              <button
                key={legend.id}
                onClick={() => {
                  // The click that trails a completed long-press must not select.
                  if (suppressClick.current) { suppressClick.current = false; return; }
                  if (arranging) handleArrangeTap(legend);
                  else onSelectLegend(legend);
                }}
                onPointerDown={(e) => startPress(legend, e)}
                onPointerMove={movePress}
                onPointerUp={endPress}
                onPointerCancel={endPress}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  ...slotBase,
                  display: "block",
                  border: "none",
                  background: slotBg,
                  cursor: "pointer",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                  touchAction: "manipulation",
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
                {isActive && !isPicked && (
                  <div style={{
                    position: "absolute", inset: 0,
                    border: `2px solid ${ringColor}`,
                    pointerEvents: "none",
                    zIndex: 2,
                  }} />
                )}

                {/* Picked-up cursor (arrange mode) — dashed, distinct from the
                    solid selection ring, so "held" never reads as "selected". */}
                {isPicked && (
                  <div style={{
                    position: "absolute", inset: 0,
                    border: `2px dashed ${ringColor}`,
                    pointerEvents: "none",
                    zIndex: 2,
                  }} />
                )}
              </button>
            );
          }

          // The add tile — first empty slot after the last legend. Dimmed and
          // inert while arranging: a mid-swap mistap must not open the sheet.
          if (g === legends.length) {
            return (
              <button
                key="add"
                onClick={arranging ? undefined : () => setAddOpen(true)}
                disabled={arranging}
                aria-label="Add legend"
                style={{
                  ...slotBase,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 2,
                  border: `1px dashed ${dimColor}`,
                  background: "transparent",
                  cursor: arranging ? "default" : "pointer",
                  opacity: arranging ? 0.3 : 1,
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

      {/* Long-press action sheet — move / delete for the pressed legend.
          Backdrop tap dismisses; delete confirms inline (two-step, no
          second modal), mirroring the deck view's destructive grammar. */}
      {actionLegend && (
        <div
          onClick={closeActionSheet}
          role="dialog"
          aria-modal="true"
          aria-label={`Actions for ${actionLegend.name}`}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 430,
              background: theme.base,
              borderTop: `1px solid ${borderColor}`,
              padding: "16px 20px calc(env(safe-area-inset-bottom) + 16px)",
              display: "flex", flexDirection: "column", gap: 12,
            }}
          >
            <div style={{
              fontFamily: "'Zilla Slab', serif",
              fontSize: 16,
              color: textColor,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {actionLegend.name}
            </div>
            {!confirmingDelete ? (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={handleMoveAction}
                  style={{
                    minHeight: 44, flex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    background: "transparent",
                    border: `1px solid ${dimColor}`,
                    color: textColor,
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 12, letterSpacing: "0.08em",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>open_with</span>
                  move
                </button>
                <button
                  onClick={() => setConfirmingDelete(true)}
                  style={{
                    minHeight: 44, flex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    background: "transparent",
                    border: `1px solid ${dimColor}`,
                    color: textColor,
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 12, letterSpacing: "0.08em",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>delete</span>
                  delete
                </button>
              </div>
            ) : (
              <>
                <div style={{
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 13, lineHeight: 1.5,
                  color: dimColor,
                }}>
                  Delete {actionLegend.name}? The legend, its deck, and all tags
                  leave the box. This can't be undone.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={closeActionSheet}
                    disabled={deleting}
                    style={{
                      minHeight: 44, flex: 1,
                      background: "transparent",
                      border: `1px solid ${dimColor}`,
                      color: textColor,
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 12, letterSpacing: "0.08em",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    cancel
                  </button>
                  <button
                    onClick={handleDeleteAction}
                    disabled={deleting}
                    style={{
                      minHeight: 44, flex: 1,
                      background: "transparent",
                      border: "1px solid #a04040",
                      color: "#a04040",
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 12, letterSpacing: "0.08em",
                      cursor: deleting ? "default" : "pointer",
                      opacity: deleting ? 0.6 : 1,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {deleting ? "deleting…" : "delete"}
                  </button>
                </div>
                {deleteError && (
                  <div style={{ fontSize: 12, color: "#a04040", lineHeight: 1.5 }}>
                    {deleteError}
                  </div>
                )}
              </>
            )}
          </div>
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
