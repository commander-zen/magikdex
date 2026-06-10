import { useState, useEffect, useRef, useMemo } from "react";
import { getCardImage } from "../../lib/scryfall.js";
import { getSettings } from "../../lib/settings.js";
import { useDoubleTap } from "../../hooks/useDoubleTap.js";
import { useGameChangers } from "../../hooks/useGameChangers.js";
const NAV_HEIGHT = 60;

const isBasicLand = c => Boolean(c?.type_line?.includes("Basic Land"));
const isAnyNumber = c => Boolean(c?.oracle_text?.includes("A deck can have any number of cards named"));
const isStackable  = c => isBasicLand(c) || isAnyNumber(c);

const SWIPE_THRESHOLD = 80;
const TIP_KEY = "helixbrew_swipe_hint_shown";

const SORT_OPTIONS = [
  { value: "name",   label: "NAME" },
  { value: "cmc",    label: "CMC" },
  { value: "edhrec", label: "EDHREC" },
];

function haptic(pattern = 10) {
  if (!getSettings().haptics) return;
  try { navigator.vibrate(pattern); } catch {}
}

export default function SwipeScreen({
  cards, pile, onPileChange,
  maybeboard, onMaybeboardChange,
  decklist = [], onDecklistChange,
  onGoToPile, onGoToSearch, onSearchMore, commanderCard, onCommanderCardChange,
  initialIndex, onIndexChange,
  swipeOrder = "name", swipeDir = "desc", onSortChange,
  onGoToBrews,
  activeDeckId, onSavePile,
  onDoubleTag,
}) {
  const effectiveCards = useMemo(() => {
    const pileIds = new Set(pile.filter(c => !isStackable(c) && c.oracle_id).map(c => c.oracle_id));
    const seen = new Set(pileIds);
    const result = [];
    for (const c of cards) {
      if (isStackable(c)) { result.push(c); continue; }
      if (c.oracle_id && seen.has(c.oracle_id)) continue;
      if (c.oracle_id) seen.add(c.oracle_id);
      result.push(c);
    }
    return result;
  }, [cards, pile]);

  const [idx,          setIdx]          = useState(initialIndex ?? 0);
  const [history,      setHistory]      = useState([]);
  const [offset,       setOffset]       = useState(0);
  const [offsetY,      setOffsetY]      = useState(0);
  const [dragging,     setDragging]     = useState(false);
  const [animOut,      setAnimOut]      = useState(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [imgError,     setImgError]     = useState(false);
  const [showTip,      setShowTip]      = useState(false);
  const [cardExpanded, setCardExpanded] = useState(false);
  const [flipped,      setFlipped]      = useState(false);

  const didMountRef       = useRef(false);
  const dragStartRef      = useRef(null);
  const saveTimerRef      = useRef(null);
  const longPressTimerRef = useRef(null);

  const card = effectiveCards[idx] ?? null;
  const done = idx >= effectiveCards.length;

  // Inject game-changer glow keyframe once into document head
  useEffect(() => {
    if (!document.getElementById("gc-style")) {
      const style = document.createElement("style");
      style.id = "gc-style";
      style.textContent = `
        @keyframes gc-glow {
          0%, 100% { box-shadow: 0 0 22px 6px #00cfff, 0 0 48px 16px rgba(0,207,255,0.25); }
          50%       { box-shadow: 0 0 22px 6px #7b2fff, 0 0 48px 16px rgba(123,47,255,0.25); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    setImgError(false);
    setCardExpanded(false);
    setFlipped(false);
    clearTimeout(longPressTimerRef.current);
  }, [idx]);

  // Preload next 4 large images
  useEffect(() => {
    effectiveCards.slice(idx + 1, idx + 5).forEach(c => {
      const url = getCardImage(c, "large");
      if (url) { const img = new Image(); img.src = url; }
    });
  }, [idx, effectiveCards]);

  useEffect(() => {
    if (!localStorage.getItem(TIP_KEY)) setShowTip(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    onIndexChange?.(idx);
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") doResolve(true);
      if (e.key === "ArrowLeft")  doResolve(false);
      if (e.key === "ArrowUp")    doDecklist();
      if (e.key === "ArrowDown")  doMaybe();
      if (e.key === "z" || e.key === "Z") doUndo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  useEffect(() => {
    if (!activeDeckId) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => onSavePile?.(pile), 1000);
    return () => clearTimeout(saveTimerRef.current);
  }, [pile, activeDeckId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ─────────────────────────────────────────────────────────────────

  function doResolve(keep) {
    if (!card || animOut || done) return;
    dismissTipForever();
    setAnimOut(keep ? "right" : "left");
    haptic(keep ? 12 : 6);
    setTimeout(() => {
      if (keep) {
        const alreadyInPile = !isStackable(card) && card.oracle_id &&
          pile.some(c => c.oracle_id === card.oracle_id);
        if (!alreadyInPile) {
          const cardEntry = { ...card, instanceId: crypto.randomUUID() };
          setHistory(h => [...h, { card: cardEntry, kept: true, maybe: false }]);
          onPileChange(prev => [...prev, cardEntry]);
        }
      } else {
        setHistory(h => [...h, { card, kept: false, maybe: false }]);
      }
      setIdx(i => i + 1);
      setOffset(0); setOffsetY(0); setAnimOut(null);
    }, 285);
  }

  // Swipe down — maybe board
  function doMaybe() {
    if (!card || animOut || done) return;
    dismissTipForever();
    setAnimOut("down");
    haptic(8);
    setTimeout(() => {
      const cardEntry = { ...card, instanceId: crypto.randomUUID() };
      setHistory(h => [...h, { card: cardEntry, kept: false, maybe: true }]);
      onMaybeboardChange(prev => [...prev, cardEntry]);
      setIdx(i => i + 1);
      setOffset(0); setOffsetY(0); setAnimOut(null);
    }, 260);
  }

  // Swipe up — straight to the decklist
  function doDecklist() {
    if (!card || animOut || done) return;
    dismissTipForever();
    setAnimOut("up");
    haptic(14);
    setTimeout(() => {
      const cardEntry = { ...card, instanceId: crypto.randomUUID() };
      setHistory(h => [...h, { card: cardEntry, kept: false, maybe: false, decklist: true }]);
      onDecklistChange?.(prev => [...prev, cardEntry]);
      setIdx(i => i + 1);
      setOffset(0); setOffsetY(0); setAnimOut(null);
    }, 285);
  }

  function doUndo() {
    if (history.length === 0 || animOut) return;
    const last = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    if (last.kept) {
      onPileChange(pile.filter(c => c.instanceId !== last.card.instanceId));
    } else if (last.maybe) {
      onMaybeboardChange(prev => prev.filter(c => c.instanceId !== last.card.instanceId));
    } else if (last.decklist) {
      onDecklistChange?.(prev => prev.filter(c => c.instanceId !== last.card.instanceId));
    }
    setIdx(i => Math.max(0, i - 1));
    haptic([4, 20, 4]);
  }

  function dismissTipForever() {
    localStorage.setItem(TIP_KEY, "1");
    setShowTip(false);
  }

  // ── Pointer events ───────────────────────────────────────────────────────────

  function onPointerDown(e) {
    if (animOut || done) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    const pressedCard = card;
    longPressTimerRef.current = setTimeout(() => {
      onDoubleTag?.(pressedCard?.oracle_id);
    }, 400);
  }

  function onPointerMove(e) {
    if (!dragging || dragStartRef.current === null) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset(dx);
    setOffsetY(dy);
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // Four-direction map: left = pass, right = keep (pile),
  // up = decklist, down = maybe. Dominant axis wins.
  function onPointerUp(e) {
    if (!dragging) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    setDragging(false);
    const dx = dragStartRef.current !== null ? e.clientX - dragStartRef.current.x : 0;
    const dy = dragStartRef.current !== null ? e.clientY - dragStartRef.current.y : 0;
    dragStartRef.current = null;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal && dx > SWIPE_THRESHOLD)        doResolve(true);
    else if (horizontal && dx < -SWIPE_THRESHOLD)  doResolve(false);
    else if (!horizontal && dy < -SWIPE_THRESHOLD) doDecklist();
    else if (!horizontal && dy > SWIPE_THRESHOLD)  doMaybe();
    else {
      setOffset(0);
      setOffsetY(0);
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) setCardExpanded(v => !v);
    }
  }

  // ── Derived visuals ──────────────────────────────────────────────────────────

  const artUrl = card ? (flipped
    ? getCardImage({ ...card, image_uris: card.card_faces?.[1]?.image_uris }, "large")
    : getCardImage(card, "large") ?? getCardImage(card, "normal")
  ) : null;

  // Rotation: capped at ±15deg during drag; ±30deg on fly-out
  const rotation = animOut === "right" ? 30
    : animOut === "left" ? -30
    : Math.max(-15, Math.min(15, offset * 0.08));

  const artTransform =
      animOut === "up"    ? "translateY(-110vh)"
    : animOut === "down"  ? "translateY(110vh)"
    : animOut === "right" ? `translateX(110vw) rotate(30deg)`
    : animOut === "left"  ? `translateX(-110vw) rotate(-30deg)`
    : `translate(${offset}px, ${offsetY}px) rotate(${rotation}deg)`;

  const artOpacity = animOut ? 0 : 1;

  const artTransition = animOut
    ? "transform 280ms ease-in, opacity 280ms ease-in"
    : dragging
      ? "none"
      : "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)";

  // Colored tint overlay: 0 until |drag|>20, maxes at 0.35 at threshold (80px).
  // Dominant axis picks the color: green/red horizontal, blue/amber vertical.
  const verticalDrag = Math.abs(offsetY) > Math.abs(offset);
  const driveOffset  = verticalDrag ? offsetY : offset;
  const tintOpacity = Math.min(1, Math.max(0, (Math.abs(driveOffset) - 20) / 60)) * 0.35;
  const tintColor = verticalDrag
    ? (offsetY < 0 ? "#5b8fff" : "#f59e0b")
    : (offset >= 0 ? "#6BFF9E" : "#FF6B6B");

  function isCommanderEligible(c) {
    const type = c?.type_line ?? "";
    const oracle = c?.oracle_text ?? "";
    return (
      (type.includes("Legendary") && type.includes("Creature")) ||
      (type.includes("Legendary") && type.includes("Vehicle")) ||
      oracle.includes("can be your commander")
    );
  }
  // Scryfall's game_changer flag when present, hook's oracle-id set as fallback
  const { gameChangerIds } = useGameChangers();
  const isGameChanger = card?.game_changer === true ||
    Boolean(card?.oracle_id && gameChangerIds.has(card.oracle_id));
  const commanderName    = commanderCard?.name ?? null;

  // Double-tap flips double-faced cards (single tap still toggles expand)
  const handleDoubleTap = useDoubleTap(() => {
    if (card?.card_faces?.length > 1) setFlipped(f => !f);
  });

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "var(--color-bg)",
      fontFamily: "'Noto Sans', sans-serif",
      overflow: "hidden",
    }}>

      {/* ── Art layer (the draggable) ── */}
      {!done && (
        <div
          style={{
            position: "absolute", inset: 0,
            transform: artTransform,
            transition: artTransition,
            opacity: artOpacity,
            cursor: dragging ? "grabbing" : "grab",
            touchAction: "none", userSelect: "none",
            zIndex: 0,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onTouchStart={handleDoubleTap}
        >
          {/* Art image — centered, naturally sized so overlays are tight to card bounds */}
          {artUrl && !imgError ? (
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
            }}>
              <div style={{
                position: "relative", lineHeight: 0,
                width: "88vw",
                height: "calc(88vw * 1.4)",
                maxHeight: "62vh",
                background: "var(--color-surface)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "var(--bevel-light)",
                borderLeftColor: "var(--bevel-light)",
                borderBottomColor: "var(--bevel-dark)",
                borderRightColor: "var(--bevel-dark)",
                borderRadius: 0,
                boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
              }}>
                <img
                  src={artUrl}
                  alt={card?.name}
                  draggable={false}
                  onError={() => setImgError(true)}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    pointerEvents: "none",
                  }}
                />
                {/* Drag intent tint — scoped to card image only */}
                <div style={{
                  position: "absolute", inset: 0,
                  background: tintColor,
                  opacity: tintOpacity,
                  pointerEvents: "none",
                  transition: dragging ? "none" : "opacity 0.15s ease",
                }} />
              </div>
            </div>
          ) : (
            <div style={{
              position: "absolute", inset: 0,
              background: "var(--color-surface)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{
                fontFamily: "var(--font-system)",
                fontSize: 28, color: "var(--color-text-primary)", letterSpacing: 2,
                textAlign: "center", padding: "0 32px",
              }}>{card?.name}</span>
            </div>
          )}

          {/* Gradient overlay */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.6) 75%, rgba(0,0,0,0.92) 100%)",
            pointerEvents: "none",
          }} />

          {/* Game Changer electric glow */}
          {isGameChanger && (
            <div style={{
              position: "absolute", inset: 0,
              animation: "gc-glow 1.5s ease-in-out infinite",
              pointerEvents: "none",
              zIndex: 3,
            }} />
          )}

          {/* Drag intent labels — opacity driven by offset/animOut */}
          <div style={{
            position: "absolute", top: "50%", left: "50%", zIndex: 5,
            transform: "translate(-50%, -50%) rotate(-15deg)",
            opacity: animOut === "right" ? 0.9 : animOut ? 0 :
                     verticalDrag ? 0 : Math.min(0.85, Math.max(0, (offset - 20) / 60)),
            padding: "var(--space-2) var(--space-4)",
            border: "4px solid #00aa00",
            borderRadius: 0,
            color: "#00aa00",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-xl)",
            fontWeight: "bold",
            background: "transparent",
            pointerEvents: "none",
            transition: dragging ? "none" : "opacity 0.15s ease",
          }}>KEEP</div>
          <div style={{
            position: "absolute", top: "50%", left: "50%", zIndex: 5,
            transform: "translate(-50%, -50%) rotate(15deg)",
            opacity: animOut === "left" ? 0.9 : animOut ? 0 :
                     verticalDrag ? 0 : Math.min(0.85, Math.max(0, (-offset - 20) / 60)),
            padding: "var(--space-2) var(--space-4)",
            border: "4px solid #cc0000",
            borderRadius: 0,
            color: "#cc0000",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-xl)",
            fontWeight: "bold",
            background: "transparent",
            pointerEvents: "none",
            transition: dragging ? "none" : "opacity 0.15s ease",
          }}>PASS</div>
          <div style={{
            position: "absolute", top: "50%", left: "50%", zIndex: 5,
            transform: "translate(-50%, -50%)",
            opacity: animOut === "up" ? 0.9 : animOut ? 0 :
                     !verticalDrag ? 0 : Math.min(0.85, Math.max(0, (-offsetY - 20) / 60)),
            padding: "var(--space-2) var(--space-4)",
            border: "4px solid #5b8fff",
            borderRadius: 0,
            color: "#5b8fff",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-xl)",
            fontWeight: "bold",
            background: "transparent",
            pointerEvents: "none",
            transition: dragging ? "none" : "opacity 0.15s ease",
          }}>DECKLIST</div>
          <div style={{
            position: "absolute", top: "50%", left: "50%", zIndex: 5,
            transform: "translate(-50%, -50%)",
            opacity: animOut === "down" ? 0.9 : animOut ? 0 :
                     !verticalDrag ? 0 : Math.min(0.85, Math.max(0, (offsetY - 20) / 60)),
            padding: "var(--space-2) var(--space-4)",
            border: "4px solid #f59e0b",
            borderRadius: 0,
            color: "#f59e0b",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-xl)",
            fontWeight: "bold",
            background: "transparent",
            pointerEvents: "none",
            transition: dragging ? "none" : "opacity 0.15s ease",
          }}>MAYBE</div>

          {/* Game Changer lightning badge */}
          {isGameChanger && (
            <div style={{
              position: "absolute",
              top: "calc(env(safe-area-inset-top) + 52px)",
              left: 14,
              zIndex: 6,
              pointerEvents: "none",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#00cfff">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
          )}

          {/* Flip button — double-faced cards only */}
          {card?.card_faces?.length > 1 && (
            <button
              onClick={e => { e.stopPropagation(); setFlipped(f => !f); }}
              style={{
                position: "absolute", bottom: 16, right: 16, zIndex: 5,
                background: "rgba(0,0,0,0.6)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 20,
                padding: "6px 14px",
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 13, letterSpacing: 2,
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
              }}
            >{flipped ? "FRONT" : "BACK"}</button>
          )}
        </div>
      )}

      {/* ── Stack info strip (top) ── */}
      <div style={{
        position: "absolute",
        top: "env(safe-area-inset-top)",
        left: 0, right: 0,
        zIndex: 2,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px",
        pointerEvents: "none",
      }}>
        <div style={{
          fontSize: 11, color: "rgba(255,255,255,0.3)",
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>
          {done
            ? `${pile.length} KEPT`
            : `${effectiveCards.length - idx} IN STACK${commanderName ? ` · ${commanderName.toUpperCase()}` : ""}`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}>
          {history.length > 0 && !animOut && (
            <button
              onClick={doUndo}
              style={{
                background: "transparent", border: "none",
                color: "rgba(255,255,255,0.4)",
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 11, letterSpacing: 2, cursor: "pointer",
                padding: "2px 6px",
              }}
            >UNDO</button>
          )}
          <button
            onClick={e => { e.stopPropagation(); setSortMenuOpen(o => !o); }}
            style={{
              padding: "3px 8px", borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.5)",
              color: "rgba(255,255,255,0.4)",
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 10, letterSpacing: 1, cursor: "pointer", lineHeight: 1,
            }}
          >
            {SORT_OPTIONS.find(o => o.value === swipeOrder)?.label ?? "SORT"}{" "}
            {swipeDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      {/* Sort dropdown */}
      {sortMenuOpen && (
        <div style={{
          position: "absolute",
          top: `calc(env(safe-area-inset-top) + 42px)`,
          right: 20, zIndex: 10,
          background: "#111",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10, overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.9)",
          minWidth: 120,
        }}>
          {SORT_OPTIONS.map(opt => {
            const active = swipeOrder === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => {
                  onSortChange?.(opt.value, active ? (swipeDir === "asc" ? "desc" : "asc") : swipeDir);
                  setSortMenuOpen(false);
                }}
                style={{
                  display: "block", width: "100%",
                  padding: "10px 14px",
                  background: active ? "rgba(255,255,255,0.08)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  color: active ? "#ffffff" : "rgba(255,255,255,0.5)",
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 12, letterSpacing: 2,
                  cursor: "pointer", textAlign: "left",
                }}
              >{opt.label}</button>
            );
          })}
        </div>
      )}

      {/* ── Done state ── */}
      {done && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16,
        }}>
          <div style={{
            fontFamily: "var(--font-system)",
            fontSize: 32, letterSpacing: 4, color: "var(--color-text-primary)",
          }}>ALL CARDS SEEN</div>
          <div style={{ fontFamily: "var(--font-system)", fontSize: 14, color: "var(--color-text-secondary)" }}>
            {pile.length} pile · {decklist.length} decklist · {maybeboard.length} maybe
          </div>
          <button
            onClick={onGoToPile}
            style={{
              marginTop: 8, padding: "12px 28px", borderRadius: 10,
              border: "1px solid rgba(91,143,255,0.5)",
              background: "rgba(91,143,255,0.12)",
              color: "var(--primary)",
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 16, letterSpacing: 3, cursor: "pointer",
            }}
          >VIEW PILE</button>
          <button
            onClick={onSearchMore}
            style={{
              padding: "12px 28px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "rgba(255,255,255,0.45)",
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 16, letterSpacing: 3, cursor: "pointer",
            }}
          >SEARCH MORE</button>
        </div>
      )}

      {/* ── First-run swipe hint (subtle arrow) ── */}
      {showTip && !done && idx === 0 && !dragging && !animOut && (
        <div style={{
          position: "absolute",
          bottom: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom) + 32px)`,
          left: 0, right: 0, zIndex: 4,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <style>{`
            @keyframes swipeHint {
              0%   { transform: translateX(-18px); opacity: 0.35; }
              50%  { transform: translateX(18px);  opacity: 0.75; }
              100% { transform: translateX(-18px); opacity: 0.35; }
            }
          `}</style>
          <div style={{
            animation: "swipeHint 1.8s ease-in-out infinite",
            fontSize: 26, color: "rgba(255,255,255,0.65)",
            fontFamily: "'Noto Sans', sans-serif",
            letterSpacing: 4,
          }}>← ↑ ↓ →</div>
        </div>
      )}
    </div>
  );
}
