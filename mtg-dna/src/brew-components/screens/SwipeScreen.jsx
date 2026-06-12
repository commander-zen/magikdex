import { useState, useEffect, useRef, useMemo } from "react";
import { getCardImage } from "../../lib/scryfall.js";
import { getSettings } from "../../lib/settings.js";
import { useDoubleTap } from "../../hooks/useDoubleTap.js";
import { useGameChangers } from "../../hooks/useGameChangers.js";

const isBasicLand = c => Boolean(c?.type_line?.includes("Basic Land"));
const isAnyNumber = c => Boolean(c?.oracle_text?.includes("A deck can have any number of cards named"));
const isStackable  = c => isBasicLand(c) || isAnyNumber(c);

// Carousel gesture model: horizontal browses, vertical decides.
const AXIS_LOCK_PX = 10;          // movement that locks the gesture axis
const SPACING_VW = 92;            // carousel slot width — neighbors peek at the edges
const BROWSE_COMMIT_RATIO = 0.2;  // fraction of viewport width to commit a browse
const BROWSE_VELOCITY = 0.5;      // px/ms — fast horizontal flick commits a browse
const FLICK_RATIO = 0.3;          // fraction of viewport height to commit a decision
const FLICK_VELOCITY = 0.6;       // px/ms — fast vertical flick commits a decision

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
  const [animBrowse,   setAnimBrowse]   = useState(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [imgError,     setImgError]     = useState(false);
  const [cardExpanded, setCardExpanded] = useState(false);
  const [flipped,      setFlipped]      = useState(false);

  const didMountRef       = useRef(false);
  const dragStartRef      = useRef(null);
  const saveTimerRef      = useRef(null);
  const longPressTimerRef = useRef(null);
  const axisRef           = useRef(null);   // "x" | "y" once locked, null before
  const velRef            = useRef({ vx: 0, vy: 0 });
  const lastSampleRef     = useRef(null);

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
    if (!didMountRef.current) { didMountRef.current = true; return; }
    onIndexChange?.(idx);
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") browseNext();
      if (e.key === "ArrowLeft")  browsePrev();
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

  // Horizontal is browsing only — it never sorts. The pile (and its undo
  // branch) stays plumbed but is unreachable by gesture for now.

  function browseNext() {
    if (animOut || animBrowse || done) return;
    setAnimBrowse("next");
    haptic(4);
    setOffset(-window.innerWidth * (SPACING_VW / 100));
    setTimeout(() => {
      setIdx(i => i + 1);
      setOffset(0); setOffsetY(0); setAnimBrowse(null);
    }, 300);
  }

  function browsePrev() {
    if (animOut || animBrowse || done || idx === 0) { setOffset(0); return; }
    setAnimBrowse("prev");
    haptic(4);
    setOffset(window.innerWidth * (SPACING_VW / 100));
    setTimeout(() => {
      setIdx(i => Math.max(0, i - 1));
      setOffset(0); setOffsetY(0); setAnimBrowse(null);
    }, 300);
  }

  // Flick down — maybe board
  function doMaybe() {
    if (!card || animOut || animBrowse || done) return;
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

  // Flick up — straight to the decklist (mainboard)
  function doDecklist() {
    if (!card || animOut || animBrowse || done) return;
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
    if (history.length === 0 || animOut || animBrowse) return;
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

  // ── Pointer events ───────────────────────────────────────────────────────────

  function onPointerDown(e) {
    if (animOut || animBrowse || done) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    axisRef.current = null;
    velRef.current = { vx: 0, vy: 0 };
    lastSampleRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
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

    const now = performance.now();
    const last = lastSampleRef.current;
    if (last && now > last.t) {
      velRef.current = {
        vx: (e.clientX - last.x) / (now - last.t),
        vy: (e.clientY - last.y) / (now - last.t),
      };
    }
    lastSampleRef.current = { x: e.clientX, y: e.clientY, t: now };

    // Axis lock: the first ~10px decide browse vs sort — a gesture can
    // never switch axes mid-drag.
    if (axisRef.current === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > AXIS_LOCK_PX) {
        axisRef.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
    if (axisRef.current === "x") setOffset(dx);
    else if (axisRef.current === "y") setOffsetY(dy);
  }

  // Horizontal browses (carousel), vertical decides: flick up = mainboard,
  // flick down = maybe. A vertical release before threshold springs back.
  function onPointerUp(e) {
    if (!dragging) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    setDragging(false);
    const start = dragStartRef.current;
    const dx = start !== null ? e.clientX - start.x : 0;
    const dy = start !== null ? e.clientY - start.y : 0;
    dragStartRef.current = null;
    const axis = axisRef.current;
    axisRef.current = null;
    const { vx, vy } = velRef.current;

    if (axis === "x") {
      const commitDist = window.innerWidth * BROWSE_COMMIT_RATIO;
      if (dx < 0 && (Math.abs(dx) > commitDist || vx < -BROWSE_VELOCITY)) browseNext();
      else if (dx > 0 && (Math.abs(dx) > commitDist || vx > BROWSE_VELOCITY)) browsePrev();
      else setOffset(0);
      return;
    }

    if (axis === "y") {
      const flickDist = window.innerHeight * FLICK_RATIO;
      if (dy < 0 && (Math.abs(dy) > flickDist || vy < -FLICK_VELOCITY)) doDecklist();
      else if (dy > 0 && (Math.abs(dy) > flickDist || vy > FLICK_VELOCITY)) doMaybe();
      else setOffsetY(0);
      return;
    }

    // No axis locked — treat as a tap
    setOffset(0);
    setOffsetY(0);
    if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) setCardExpanded(v => !v);
  }

  // ── Derived visuals ──────────────────────────────────────────────────────────

  const artUrl = card ? (flipped
    ? getCardImage({ ...card, image_uris: card.card_faces?.[1]?.image_uris }, "large")
    : getCardImage(card, "large") ?? getCardImage(card, "normal")
  ) : null;

  // Flat carousel motion — no rotation, the card's movement is the feedback.
  // The whole strip (current + peeking neighbors) shares one transition.
  const stripTransition = dragging
    ? "none"
    : animBrowse
      ? "transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)"
      : "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)";

  const currentTransition = animOut
    ? "transform 280ms ease-in, opacity 280ms ease-in"
    : stripTransition;

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

  // The card dominates the screen — ~92vw, capped so it doesn't balloon on
  // tablets, height follows the card aspect ratio with a viewport cap.
  const cardWidth  = "min(92vw, 420px)";
  const cardHeight = "min(calc(92vw * 1.4), calc(420px * 1.4), 70vh)";
  const hasPrev = idx > 0;
  const hasNext = idx < effectiveCards.length - 1;

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "var(--color-bg)",
      fontFamily: "'Noto Sans', sans-serif",
      overflow: "hidden",
    }}>

      {/* ── Carousel strip (the gesture layer) ── */}
      {!done && (
        <div
          style={{
            position: "absolute", inset: 0,
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
          {/* Prev / current / next — neighbors peek in from the edges */}
          {[idx - 1, idx, idx + 1].map(i => {
            const c = effectiveCards[i];
            if (!c) return null;
            const isCurrent = i === idx;
            const url = isCurrent
              ? artUrl
              : (getCardImage(c, "large") ?? getCardImage(c, "normal"));
            // Keying by card id keeps DOM nodes stable across the post-browse
            // index swap, so the strip never visually jumps.
            const transform = isCurrent
              ? (animOut === "up"   ? "translateY(-110vh)"
              :  animOut === "down" ? "translateY(110vh)"
              :  `translate(${offset}px, ${offsetY}px)`)
              : `translateX(calc(${(i - idx) * SPACING_VW}vw + ${offset}px))`;
            return (
              <div
                key={c.id ?? i}
                style={{
                  position: "absolute", inset: 0,
                  transform,
                  transition: isCurrent ? currentTransition : stripTransition,
                  opacity: isCurrent ? (animOut ? 0 : 1) : 0.45,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                {/* Frameless — the card art sits clean on the dark background */}
                <div style={{
                  position: "relative", lineHeight: 0,
                  width: cardWidth,
                  height: cardHeight,
                }}>
                  {url && !(isCurrent && imgError) ? (
                    <img
                      src={url}
                      alt={c.name}
                      draggable={false}
                      onError={isCurrent ? () => setImgError(true) : undefined}
                      style={{
                        display: "block",
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        pointerEvents: "none",
                      }}
                    />
                  ) : (
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{
                        fontFamily: "var(--font-system)",
                        fontSize: 28, color: "var(--color-text-primary)", letterSpacing: 2,
                        textAlign: "center", padding: "0 32px",
                      }}>{c.name}</span>
                    </div>
                  )}
                </div>

                {isCurrent && isGameChanger && (
                  <>
                    {/* Game Changer electric glow */}
                    <div style={{
                      position: "absolute", inset: 0,
                      animation: "gc-glow 1.5s ease-in-out infinite",
                      pointerEvents: "none",
                      zIndex: 3,
                    }} />
                    {/* Game Changer lightning badge */}
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
                  </>
                )}

                {/* Flip button — double-faced cards only */}
                {isCurrent && card?.card_faces?.length > 1 && (
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
                      pointerEvents: "auto",
                    }}
                  >{flipped ? "FRONT" : "BACK"}</button>
                )}
              </div>
            );
          })}

          {/* Edge peek — "there's more here" affordance. A card-back-colored
              sliver stands in for the neighbor; tracks the horizontal drag
              so the carousel reads as one continuous strip. */}
          {hasPrev && (
            <div style={{
              position: "absolute",
              left: 0, top: "50%",
              width: 16,
              height: cardHeight,
              transform: `translateY(-50%) translateX(${offset}px)`,
              transition: stripTransition,
              background: "var(--color-surface)",
              pointerEvents: "none",
            }} />
          )}
          {hasNext && (
            <div style={{
              position: "absolute",
              right: 0, top: "50%",
              width: 16,
              height: cardHeight,
              transform: `translateY(-50%) translateX(${offset}px)`,
              transition: stripTransition,
              background: "var(--color-surface)",
              pointerEvents: "none",
            }} />
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
            {pile.length} pile · {decklist.length} mainboard · {maybeboard.length} maybe
          </div>
          <button
            onClick={onGoToPile}
            style={{
              marginTop: 8, padding: "12px 28px", borderRadius: 10,
              border: "1px solid var(--primary)",
              background: "transparent",
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

      {/* ── Gesture legend — persistent while a card is shown ── */}
      {!done && (
        <div style={{
          position: "absolute",
          bottom: "calc(env(safe-area-inset-bottom) + 22px)",
          left: 0, right: 0, zIndex: 2,
          display: "flex", justifyContent: "center",
          pointerEvents: "none",
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 11,
          color: "var(--muted)",
          whiteSpace: "pre",
        }}>
          {"← browse →  ↑ mainboard  ↓ maybe"}
        </div>
      )}
    </div>
  );
}
