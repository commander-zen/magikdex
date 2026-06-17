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

// Pixel width of a carousel slot — mirrors the cardWidth CSS (min(96vw, 440px))
// plus the 4px gap between neighboring cards.
const getCardPx = () => Math.min(window.innerWidth * 0.96, 440) + 4;

export default function SwipeScreen({
  cards, pile, onPileChange,
  maybeboard, onMaybeboardChange,
  decklist = [], onDecklistChange,
  onGoToPile, onExit, onGoToSearch, onSearchMore, commanderCard, onCommanderCardChange,
  initialIndex, onIndexChange,
  swipeOrder = "name", swipeDir = "desc", onSortChange,
  onGoToBrews,
  onCardCommit, reconnecting,
  onDoubleTag,
  query, onInlineSearch,
}) {
  // Cards already sorted into a pile/decklist/maybeboard leave the carousel
  // entirely — decided cards never reappear when browsing back.
  const decidedIds = useMemo(() => {
    const ids = new Set();
    for (const c of pile)       if (!isStackable(c) && c.oracle_id) ids.add(c.oracle_id);
    for (const c of decklist)   if (!isStackable(c) && c.oracle_id) ids.add(c.oracle_id);
    for (const c of maybeboard) if (!isStackable(c) && c.oracle_id) ids.add(c.oracle_id);
    return ids;
  }, [pile, decklist, maybeboard]);

  const effectiveCards = useMemo(() => {
    const seen = new Set(decidedIds);
    const result = [];
    for (const c of cards) {
      if (isStackable(c)) { result.push(c); continue; }
      if (c.oracle_id && seen.has(c.oracle_id)) continue;
      if (c.oracle_id) seen.add(c.oracle_id);
      result.push(c);
    }
    return result;
  }, [cards, decidedIds]);

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
  const [searchOpen,   setSearchOpen]   = useState(false);
  const [searchText,   setSearchText]   = useState("");
  const [toast,        setToast]        = useState(null);

  const searchInputRef    = useRef(null);
  const toastTimerRef     = useRef(null);
  const didMountRef       = useRef(false);
  const dragStartRef      = useRef(null);
  const longPressTimerRef = useRef(null);
  const pendingRestoreRef = useRef(null);   // oracle_id awaiting re-insertion after undo
  const axisRef           = useRef(null);   // "x" | "y" once locked, null before
  const velRef            = useRef({ vx: 0, vy: 0 });
  const lastSampleRef     = useRef(null);

  const card = effectiveCards[idx] ?? null;
  const done = effectiveCards.length === 0 || idx >= effectiveCards.length;

  // Inject game-changer glow keyframe once into document head
  useEffect(() => {
    if (!document.getElementById("gc-style")) {
      const style = document.createElement("style");
      style.id = "gc-style";
      // Helix gold/amber breathing glow — single hue, the app's accent.
      style.textContent = `
        @keyframes gc-glow {
          0%, 100% { box-shadow: 0 0 16px 3px rgba(232,160,32,0.5), 0 0 36px 10px rgba(232,160,32,0.16); }
          50%      { box-shadow: 0 0 22px 6px rgba(232,160,32,0.78), 0 0 48px 14px rgba(232,160,32,0.22); }
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

  // Preload next 3 large images so advancing never shows a half-loaded image
  useEffect(() => {
    effectiveCards.slice(idx + 1, idx + 4).forEach(c => {
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

  // ── Actions ─────────────────────────────────────────────────────────────────

  // Horizontal is browsing only — it never sorts. The pile (and its undo
  // branch) stays plumbed but is unreachable by gesture for now.

  function browseNext() {
    if (animOut || animBrowse || done) return;
    setAnimBrowse("next");
    haptic(4);
    setOffset(-getCardPx());
    setTimeout(() => {
      setIdx(i => i + 1);
      setOffset(0); setOffsetY(0); setAnimBrowse(null);
    }, 300);
  }

  function browsePrev() {
    if (animOut || animBrowse || done || idx === 0) { setOffset(0); return; }
    setAnimBrowse("prev");
    haptic(4);
    setOffset(getCardPx());
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
      onCardCommit?.(cardEntry, "maybe", 1);
      // The card leaves the queue entirely — clamp idx so the track
      // centers the next card (or the new last card, if this was it).
      setIdx(i => Math.max(0, Math.min(i, effectiveCards.length - 2)));
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
      onCardCommit?.(cardEntry, "decklist", 1);
      setIdx(i => Math.max(0, Math.min(i, effectiveCards.length - 2)));
      setOffset(0); setOffsetY(0); setAnimOut(null);
    }, 285);
  }

  function doUndo() {
    if (history.length === 0 || animOut || animBrowse) return;
    const last = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    if (last.kept) {
      onPileChange(pile.filter(c => c.instanceId !== last.card.instanceId));
      onCardCommit?.(last.card, "pile", -1);
    } else if (last.maybe) {
      onMaybeboardChange(prev => prev.filter(c => c.instanceId !== last.card.instanceId));
      onCardCommit?.(last.card, "maybe", -1);
    } else if (last.decklist) {
      onDecklistChange?.(prev => prev.filter(c => c.instanceId !== last.card.instanceId));
      onCardCommit?.(last.card, "decklist", -1);
    }
    // Removing the id from its pile re-inserts the card into effectiveCards
    // at its original position; once that happens, jump idx to it.
    pendingRestoreRef.current = last.card.oracle_id ?? last.card.id;
    haptic([4, 20, 4]);
  }

  // Restore the carousel position of an undone card once it reappears
  // in effectiveCards (after its id is removed from decklist/maybeboard/pile).
  useEffect(() => {
    const oid = pendingRestoreRef.current;
    if (!oid) return;
    const i = effectiveCards.findIndex(c => (c.oracle_id ?? c.id) === oid);
    if (i !== -1) setIdx(i);
    pendingRestoreRef.current = null;
  }, [effectiveCards]);

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

  // Inline search in the bottom bar — expands over the gesture hint (never the
  // back button), pre-filled with the active query. Enter submits + re-seeds;
  // the right control cancels (returns the hint); the × clears the text.
  function openInlineSearch() {
    setSearchText(query ?? "");
    setSearchOpen(true);
    setTimeout(() => {
      const el = searchInputRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 0);
  }
  function toggleInlineSearch() {
    if (searchOpen) setSearchOpen(false);
    else openInlineSearch();
  }
  // Brief dimmed flash, mirroring the app's toast grammar — auto-clears.
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2400);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  async function submitInlineSearch() {
    const q = searchText.trim();
    if (!q) return;
    // A bad query used to re-seed into nothing and leave a dead stack — looked
    // like a bug. Await the re-seed and surface why it failed: invalid syntax
    // (echo Scryfall's reason if short) vs a valid-but-empty result.
    const result = await onInlineSearch?.(q);
    if (result && result.ok === false) {
      if (result.kind === "invalid") {
        const d = result.message;
        showToast(d && d.length <= 80 ? d : "invalid search");
      } else {
        showToast("no cards found");
      }
      return; // keep the field open so the query can be fixed
    }
    setSearchOpen(false);
  }

  // Reserve space for the header block (back button + tally + stack info)
  // and the bottom gesture legend — the card track centers in what's left.
  const topReserve      = "calc(env(safe-area-inset-top) + 92px)";
  const bottomReserve   = "calc(env(safe-area-inset-bottom) + 60px)";
  const availableHeight = `calc(100vh - ${topReserve} - ${bottomReserve})`;

  // The card fills the available vertical space (height-capped), width
  // following the printed MTG aspect ratio, capped so it doesn't balloon on
  // tablets. Neighbor slots sit one card-width + 4px gap away, so cards
  // overhang the screen edges and almost touch — a tight carousel track.
  const cardHeight = `min(calc(96vw * 1.4), calc(440px * 1.4), ${availableHeight})`;
  const cardWidth  = `min(96vw, 440px, calc(${cardHeight} / 1.4))`;
  // Horizontal distance from the current slot to slot `n` (negative = left).
  const slotShift = n => `calc((${cardWidth} + 4px) * ${n} + ${offset}px)`;

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
              : `translateX(${slotShift(i - idx)})`;
            return (
              <div
                key={c.id ?? i}
                style={{
                  position: "absolute",
                  top: topReserve, bottom: bottomReserve, left: 0, right: 0,
                  transform,
                  transition: isCurrent ? currentTransition : stripTransition,
                  opacity: isCurrent && animOut ? 0 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                {/* Frameless — a tight shadow lifts the card just off the background */}
                <div style={{
                  position: "relative", lineHeight: 0,
                  width: cardWidth,
                  height: cardHeight,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
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
                        // Scan-accuracy mask for the rounded physical card
                        // corners — matches the printed MTG corner ratio.
                        borderRadius: "5.5% / 4%",
                        overflow: "hidden",
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

                  {/* Game Changer indicator — the amber breathing glow draws the
                      eye; the "GAME CHANGER" tag names it so the term is
                      self-explanatory. Detection (isGameChanger) is unchanged. */}
                  {isCurrent && isGameChanger && (
                    <>
                      <div style={{
                        position: "absolute", inset: 0,
                        borderRadius: "5.5% / 4%",
                        animation: "gc-glow 1.5s ease-in-out infinite",
                        pointerEvents: "none",
                        zIndex: 3,
                      }} />
                      {/* Sharp dark plate, amber mono text, bottom-left corner
                          (clear of the card's rounded corner and the flip
                          button on the bottom-right). */}
                      <div style={{
                        position: "absolute",
                        left: 10, bottom: 10,
                        zIndex: 6,
                        background: "rgba(10,14,26,0.85)",
                        padding: "3px 6px",
                        pointerEvents: "none",
                      }}>
                        <span style={{
                          fontFamily: "'Noto Sans Mono', monospace",
                          fontSize: 10,
                          letterSpacing: "0.1em",
                          color: "#e8a020",
                        }}>
                          GAME CHANGER
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Flip button — double-faced cards only. One consistent
                    "flip" label that toggles either direction (front↔back),
                    not a face-specific FRONT/BACK. Dimmed mono, ≥44px target. */}
                {isCurrent && card?.card_faces?.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); setFlipped(f => !f); }}
                    aria-label="Flip card"
                    style={{
                      position: "absolute", bottom: 16, right: 16, zIndex: 5,
                      minHeight: 44, minWidth: 44,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(0,0,0,0.6)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 20,
                      padding: "6px 14px",
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 12, letterSpacing: "0.1em",
                      color: "rgba(255,255,255,0.55)",
                      cursor: "pointer",
                      pointerEvents: "auto",
                    }}
                  >flip</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Persistent header — legend anchor + running tally. Back/search
            moved to the bottom thumb-zone; the legend anchor stays (load-
            bearing per DESIGN_DOCTRINE). ── */}
      <div style={{
        position: "absolute",
        top: "env(safe-area-inset-top)",
        left: 0, right: 0,
        zIndex: 3,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 8px",
        background: "transparent",
      }}>
        <div style={{
          fontFamily: "'Zilla Slab', serif",
          fontSize: 14,
          color: "rgba(255,255,255,0.8)",
          letterSpacing: "0.02em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          padding: "0 8px",
          flex: 1,
        }}>
          {commanderName ?? ""}
        </div>

        <button
          onClick={onGoToPile}
          aria-label="Open review"
          style={{
            display: "flex", alignItems: "center", gap: 2,
            minHeight: 44,
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 12,
            color: "var(--muted)",
            background: "transparent", border: "none",
            padding: "0 8px",
            flexShrink: 0,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{ textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.2)" }}>
            {decklist.length} · {maybeboard.length}
          </span>
          <span
            className="material-symbols-rounded"
            style={{ fontSize: 14, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
          >
            chevron_right
          </span>
        </button>
      </div>

      {/* ── Stack info strip (top) ── */}
      <div style={{
        position: "absolute",
        top: "calc(env(safe-area-inset-top) + 40px)",
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
          {reconnecting && (
            <div style={{ marginTop: 2, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em" }}>
              reconnecting…
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}>
          {history.length > 0 && !animOut && (
            <button
              onClick={doUndo}
              style={{
                minHeight: 44, minWidth: 44,
                display: "flex", alignItems: "center", justifyContent: "center",
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
              minHeight: 44,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "3px 10px", borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.5)",
              color: "rgba(255,255,255,0.4)",
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 10, letterSpacing: 1, cursor: "pointer", lineHeight: 1,
            }}
          >
            {SORT_OPTIONS.find(o => o.value === swipeOrder)?.label ?? "SORT"}
            {/* EDHREC is a fixed rank — the asc/desc arrow only applies to
                NAME/CMC, where the user actually toggles direction. */}
            {swipeOrder !== "edhrec" && ` ${swipeDir === "asc" ? "↑" : "↓"}`}
          </button>
        </div>
      </div>

      {/* Sort dropdown */}
      {sortMenuOpen && (
        <div style={{
          position: "absolute",
          top: `calc(env(safe-area-inset-top) + 82px)`,
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
                  display: "flex", alignItems: "center", width: "100%",
                  minHeight: 44,
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

      {/* Search feedback — brief dimmed flash above the bottom controls so an
          invalid/empty query never fails silently. */}
      {toast && (
        <div style={{
          position: "absolute",
          left: "50%",
          bottom: "calc(env(safe-area-inset-bottom) + 64px)",
          transform: "translateX(-50%)",
          zIndex: 6,
          maxWidth: "84vw",
          background: "rgba(0,0,0,0.8)",
          color: "rgba(255,255,255,0.85)",
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 12,
          letterSpacing: "0.06em",
          lineHeight: 1.4,
          textAlign: "center",
          padding: "8px 14px",
          border: "1px solid rgba(255,255,255,0.15)",
          pointerEvents: "none",
        }}>
          {toast}
        </div>
      )}

      {/* ── Bottom controls — lock-screen grammar: BACK bottom-left, SEARCH
            bottom-right, gesture hint between. Tapping search expands a field
            over the hint (never over the back button). Back is always
            reachable, even in the done state. ── */}
      <div style={{
        position: "absolute",
        left: 0, right: 0,
        bottom: "calc(env(safe-area-inset-bottom) + 8px)",
        zIndex: 5,
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 8px",
      }}>
        {/* BACK — bottom-left, ≥44px, climbs the ladder (swipe → legend) */}
        <button
          onClick={onExit}
          aria-label="Back"
          style={{
            width: 44, height: 44, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.4)", border: "none", padding: 0,
            color: "rgba(255,255,255,0.75)",
            cursor: "pointer", WebkitTapHighlightColor: "transparent",
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 22 }}>arrow_back</span>
        </button>

        {/* Middle — gesture hint, or the expanded search field */}
        {!done && (searchOpen ? (
          <div style={{
            flex: 1, minWidth: 0,
            display: "flex", alignItems: "center",
            height: 44,
            background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.15)",
          }}>
            <input
              ref={searchInputRef}
              type="search"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitInlineSearch(); }}
              placeholder="scryfall query…"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              enterKeyHint="search"
              style={{
                flex: 1, minWidth: 0, height: "100%",
                background: "transparent", border: "none", outline: "none",
                color: "#fff",
                fontFamily: "var(--font-system)", fontSize: 16,
                padding: "0 10px",
              }}
            />
            {searchText && (
              <button
                onClick={() => { setSearchText(""); searchInputRef.current?.focus(); }}
                aria-label="Clear search"
                style={{
                  width: 44, height: 44, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "none", padding: 0,
                  color: "rgba(255,255,255,0.6)", cursor: "pointer",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
              </button>
            )}
          </div>
        ) : (
          <div style={{
            flex: 1, minWidth: 0,
            textAlign: "center",
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 11,
            color: "var(--muted)",
            whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
            pointerEvents: "none",
          }}>
            {"← browse →  ↑ mainboard  ↓ maybe"}
          </div>
        ))}

        {/* SEARCH — bottom-right, ≥44px. Opens the field; when open, cancels
            (returns the hint). Submit is on Enter. */}
        {!done && (
          <button
            onClick={toggleInlineSearch}
            aria-label={searchOpen ? "Close search" : "Search"}
            style={{
              width: 44, height: 44, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0.4)", border: "none", padding: 0,
              color: "rgba(255,255,255,0.75)",
              cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
              {searchOpen ? "close" : "search"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
