import { useState, useEffect, useRef, useMemo } from "react";
import { getCardImage, getCardData } from "../../lib/scryfall.js";
import { getSettings } from "../../lib/settings.js";
import { useDoubleTap } from "../../hooks/useDoubleTap.js";
import { useGameChangers } from "../../hooks/useGameChangers.js";
import { WREC_CHIPS, WrecIcon, WREC_CHIP_COLORS, LABEL_BY_TAG } from "../../components/WrecBand.jsx";

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
  try { navigator.vibrate(pattern); } catch { /* haptics unsupported */ }
}

// Pixel width of a carousel slot — mirrors the cardWidth CSS (min(96vw, 440px))
// plus the 4px gap between neighboring cards.
const getCardPx = () => Math.min(window.innerWidth * 0.96, 440) + 4;

export default function SwipeScreen({
  cards, pile, onPileChange,
  maybeboard, onMaybeboardChange,
  decklist = [], onDecklistChange,
  onGoToPile, onSearchMore, commanderCard,
  initialIndex, onIndexChange,
  swipeOrder = "name", swipeDir = "desc", onSortChange,
  onCardCommit, reconnecting,
  onDoubleTag,
  stackOrigin,
  stackNarrow = "", onClearFilter, onSearchAll,
  onEditQuery,
  handMode = false, onHandCut, onHandMaybe, onHandUncut, onHandUnmaybe,
  cardTags, onToggleTag,
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
    // Hand mode: the stack IS the deck. Show each unique decklist card once; a
    // card leaves the stack the moment it's cut or maybe-boarded (decklist state
    // updates and drops it). This is the inverse of brew's decided-set dedup —
    // there decided cards are hidden; here the deck itself is what you flip.
    if (handMode) {
      const inDeck = new Set(decklist.map(c => c.name));
      const seen = new Set();
      const result = [];
      for (const c of cards) {
        if (!inDeck.has(c.name) || seen.has(c.name)) continue;
        seen.add(c.name);
        result.push(c);
      }
      return result;
    }
    const seen = new Set(decidedIds);
    const result = [];
    for (const c of cards) {
      if (isStackable(c)) { result.push(c); continue; }
      if (c.oracle_id && seen.has(c.oracle_id)) continue;
      if (c.oracle_id) seen.add(c.oracle_id);
      result.push(c);
    }
    return result;
  }, [handMode, cards, decklist, decidedIds]);

  const [idx,          setIdx]          = useState(initialIndex ?? 0);
  const [history,      setHistory]      = useState([]);
  const [offset,       setOffset]       = useState(0);
  const [offsetY,      setOffsetY]      = useState(0);
  const [dragging,     setDragging]     = useState(false);
  const [animOut,      setAnimOut]      = useState(null);
  const [animBrowse,   setAnimBrowse]   = useState(null);
  // UAT batch 2, items 18/19 — the top-right spyglass opens ONE panel that
  // folds the old editable-query chip and the sort dropdown together: a
  // full-width search field with the sort chips beneath it.
  const [searchOpen,   setSearchOpen]   = useState(false);
  const [imgError,     setImgError]     = useState(false);
  const [flipped,      setFlipped]      = useState(false);
  // UAT 8/9 — how many swipe gestures (browse or decide) this session; the
  // gesture reminder fades for good at 5, when the hands have learned it.
  const [swipeCount,   setSwipeCount]   = useState(0);

  const didMountRef       = useRef(false);
  const dragStartRef      = useRef(null);
  const longPressTimerRef = useRef(null);
  const pendingRestoreRef = useRef(null);   // oracle_id awaiting re-insertion after undo
  const axisRef           = useRef(null);   // "x" | "y" once locked, null before
  const velRef            = useRef({ vx: 0, vy: 0 });
  const lastSampleRef     = useRef(null);

  const card = effectiveCards[idx] ?? null;
  const done = effectiveCards.length === 0 || idx >= effectiveCards.length;

  // UAT batch 3, item 3 — only TRUE double-faced cards (a distinct back-face
  // image) get the flip control. Split / aftermath / adventure cards share one
  // image, so "flip" showed nothing there; they're read by rotating the phone.
  const hasBackFace = Boolean(card?.card_faces?.[1]?.image_uris);

  // One quiet line under the commander name (UAT 10): the legend name never
  // repeats itself and the stack counts are gone — "review" names the flip
  // mode, reconnection still surfaces, brew swiping needs no status at all.
  const subline = reconnecting
    ? "reconnecting…"
    : handMode
      ? (done ? "deck flipped" : "review")
      : "";

  // Inject game-changer glow keyframe once into document head
  useEffect(() => {
    if (!document.getElementById("gc-style")) {
      const style = document.createElement("style");
      style.id = "gc-style";
      // Steel-storm breathing glow — single hue, the app's accent (#38bdf8).
      style.textContent = `
        @keyframes gc-glow {
          0%, 100% { box-shadow: 0 0 16px 3px rgba(56,189,248,0.5), 0 0 36px 10px rgba(56,189,248,0.16); }
          50%      { box-shadow: 0 0 22px 6px rgba(56,189,248,0.78), 0 0 48px 14px rgba(56,189,248,0.22); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Reset per-card visual state whenever a new card becomes current.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgError(false);
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
    setSwipeCount(c => c + 1);
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
    setSwipeCount(c => c + 1);
    setAnimBrowse("prev");
    haptic(4);
    setOffset(getCardPx());
    setTimeout(() => {
      setIdx(i => Math.max(0, i - 1));
      setOffset(0); setOffsetY(0); setAnimBrowse(null);
    }, 300);
  }

  // Hand mode (Change 4): same "up = resolve out of the stack, down = maybe"
  // grammar as brew, but the stack is your DECK — so ↑ cuts the card OUT of the
  // deck and ↓ moves it to the maybeboard. Brew owns the deck writes (all copies
  // at once); the existing history/UNDO reverses either (4a). handCut takes the
  // quantity back from Brew so UNDO can restore the right number of copies.
  function handCut() {
    if (!card || animOut || animBrowse || done) return;
    const acted = card;
    setAnimOut("up");
    haptic(14);
    setTimeout(() => {
      const quantity = onHandCut?.(acted) ?? 1;
      setHistory(h => [...h, { card: acted, hand: "cut", quantity }]);
      setIdx(i => Math.max(0, Math.min(i, effectiveCards.length - 2)));
      setOffset(0); setOffsetY(0); setAnimOut(null);
    }, 285);
  }
  function handMaybe() {
    if (!card || animOut || animBrowse || done) return;
    const acted = card;
    setAnimOut("down");
    haptic(8);
    setTimeout(() => {
      onHandMaybe?.(acted);
      setHistory(h => [...h, { card: acted, hand: "maybe" }]);
      setIdx(i => Math.max(0, Math.min(i, effectiveCards.length - 2)));
      setOffset(0); setOffsetY(0); setAnimOut(null);
    }, 260);
  }

  // Flick down — maybe board
  function doMaybe() {
    if (!card || animOut || animBrowse || done) return;
    setSwipeCount(c => c + 1);
    if (handMode) return handMaybe();
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
    setSwipeCount(c => c + 1);
    if (handMode) return handCut();
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
    if (last.hand === "cut") {
      onHandUncut?.(last.card, last.quantity);   // restore cut copies to the deck
    } else if (last.hand === "maybe") {
      onHandUnmaybe?.(last.card);                 // move maybe copies back to the deck
    } else if (last.kept) {
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

  // Scryfall's game_changer flag when present, hook's oracle-id set as fallback
  const { gameChangerIds } = useGameChangers();
  const isGameChanger = card?.game_changer === true ||
    Boolean(card?.oracle_id && gameChangerIds.has(card.oracle_id));
  const commanderName    = commanderCard?.name ?? null;
  const commanderArt     = commanderCard?.art ?? null;

  // Tap the commander bar to re-read the card: full card image fetched
  // cache-first on first open (null = loading, undefined = lookup failed).
  const [showCommander, setShowCommander] = useState(false);
  const [commanderFull, setCommanderFull] = useState(null);

  // Zero-results escape hatch (Change 3): when a stack filter matches nothing,
  // "search all cards" re-runs the same query through the global-search path and
  // swaps in a bigger, search-derived stack — all without leaving the swipe. On
  // success the parent hands new `cards` (and clears the filter), so `done`
  // clears on its own; only a failed search returns control here for the message.
  const [escapeBusy, setEscapeBusy] = useState(false);
  const [escapeMsg, setEscapeMsg]   = useState(null);
  async function handleSearchAll() {
    if (escapeBusy) return;
    setEscapeBusy(true);
    setEscapeMsg(null);
    const res = await onSearchAll?.(stackNarrow);
    if (res && !res.ok) {
      setEscapeMsg(res.message);
      setEscapeBusy(false);
    }
  }

  // Search-the-stack (Change 10, reworked in batch 2 items 18/19) — the spyglass
  // opens a full-width field seeded with the current stack's query; submitting
  // runs a fresh Scryfall search (onEditQuery → the parent's global search,
  // which still ANDs commander-legality + this deck's color identity). The
  // synergy default just starts that query from empty. Legend sessions only
  // (onEditQuery); never in the deck-flip review mode.
  const searchStack = stackOrigin?.type === "search";
  const [queryDraft, setQueryDraft]     = useState("");
  const [queryBusy, setQueryBusy]       = useState(false);
  const [queryMsg, setQueryMsg]         = useState(null);

  function openSearch() {
    setQueryDraft(searchStack ? stackOrigin.query : "");
    setQueryMsg(null);
    setSearchOpen(true);
  }
  function closeSearch() {
    setSearchOpen(false);
    setQueryMsg(null);
  }
  async function submitQuery() {
    const q = queryDraft.trim();
    if (!q || queryBusy) return;
    setQueryBusy(true);
    setQueryMsg(null);
    const res = await onEditQuery?.(q);
    setQueryBusy(false);
    if (res && !res.ok) { setQueryMsg(res.message); return; }
    // Success: the parent swapped in the new stack — collapse the panel.
    setSearchOpen(false);
    setQueryMsg(null);
  }

  async function openCommander() {
    if (!commanderName) return;
    setShowCommander(true);
    if (commanderFull == null) {
      const full = await getCardData(commanderName);
      setCommanderFull(full ?? undefined);
    }
  }

  // Double-tap flips double-faced cards (single tap still toggles expand)
  const handleDoubleTap = useDoubleTap(() => {
    if (hasBackFace) setFlipped(f => !f);
  });

  // Current card's WREC tags (device UAT — tag while flipping the deck in
  // review). Keyed decklist:<name>, since hand mode flips the mainboard.
  const tagKey        = card ? `decklist:${card.name}` : null;
  const showTagChips  = handMode && Boolean(onToggleTag) && !done && Boolean(card);
  const cardTagList   = tagKey ? (cardTags?.[tagKey]?.tags ?? []) : [];
  const cardAutoTags  = tagKey ? (cardTags?.[tagKey]?.autoTags ?? []) : [];

  // Reserve space for the header block (back button + tally + stack info)
  // and the bottom controls — the card track centers in what's left. Hand
  // mode reserves extra room for the WREC tag chip row above the back/done bar.
  const topReserve      = "calc(env(safe-area-inset-top) + 92px)";
  const bottomReserve   = showTagChips
    ? "calc(env(safe-area-inset-bottom) + 116px)"
    : "calc(env(safe-area-inset-bottom) + 60px)";
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
                          color: "#38bdf8",
                        }}>
                          GAME CHANGER
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Flip button — TRUE double-faced cards only (a real back-face
                    image; item 3). One consistent "flip" label toggling either
                    direction, not a face-specific FRONT/BACK. ≥44px target. */}
                {isCurrent && hasBackFace && (
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

      {/* ── Header — the commander anchor + controls, OR (items 18/19) the
            expanded search: the top-right spyglass swaps the whole bar for a
            full-width search field (commander hidden) with the sort chips
            beneath it. UNDO stays; DONE lives in the bottom bar. ── */}
      <div style={{
        position: "absolute",
        top: "env(safe-area-inset-top)",
        left: 0, right: 0,
        zIndex: 3,
        display: "flex", flexDirection: "column", gap: 8,
        padding: "6px 8px",
        background: searchOpen ? "rgba(0,0,0,0.6)" : "transparent",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {searchOpen && onEditQuery ? (
            // Item 18 — full-width search field in place of the commander bar.
            <div style={{
              flex: 1, minWidth: 0,
              display: "flex", alignItems: "stretch",
              background: "rgba(0,0,0,0.75)",
              border: "1px solid var(--primary)",
            }}>
              <input
                type="text"
                value={queryDraft}
                autoFocus
                onChange={e => setQueryDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") submitQuery();
                  if (e.key === "Escape") closeSearch();
                }}
                placeholder="name or scryfall syntax"
                autoComplete="off" autoCorrect="off" spellCheck={false}
                readOnly={queryBusy}
                style={{
                  flex: 1, minWidth: 0, boxSizing: "border-box", minHeight: 44,
                  background: "transparent",
                  color: "rgba(255,255,255,0.9)",
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 16,
                  border: "none", padding: "0 10px", outline: "none",
                }}
              />
              <button
                onClick={submitQuery}
                disabled={queryBusy || !queryDraft.trim()}
                aria-label="Run search"
                style={{
                  flexShrink: 0, width: 44, minHeight: 44,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "none",
                  borderLeft: "1px solid rgba(56,189,248,0.4)",
                  color: queryDraft.trim() ? "var(--primary)" : "var(--muted)",
                  cursor: queryDraft.trim() ? "pointer" : "default",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 20 }}>{queryBusy ? "hourglass_empty" : "search"}</span>
              </button>
              <button
                onClick={closeSearch}
                aria-label="Close search"
                style={{
                  flexShrink: 0, width: 44, minHeight: 44,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "none",
                  borderLeft: "1px solid rgba(56,189,248,0.4)",
                  color: "var(--muted)",
                  cursor: "pointer", WebkitTapHighlightColor: "transparent",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 20 }}>close</span>
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={openCommander}
                aria-label="Show commander card"
                style={{
                  flex: 1, minWidth: 0, minHeight: 44,
                  display: "flex", alignItems: "center", gap: 8,
                  background: "transparent", border: "none",
                  padding: "0 4px", textAlign: "left",
                  cursor: "pointer", WebkitTapHighlightColor: "transparent",
                }}
              >
                {commanderArt && (
                  <img
                    src={commanderArt}
                    alt=""
                    style={{
                      width: 34, height: 34, objectFit: "cover",
                      // corner mask matches the swipe card / review anchor
                      borderRadius: "5.5% / 4%", flexShrink: 0,
                    }}
                  />
                )}
                <span style={{ minWidth: 0 }}>
                  <span style={{
                    display: "block",
                    fontFamily: "'Zilla Slab', serif",
                    fontSize: 14,
                    color: "rgba(255,255,255,0.85)",
                    letterSpacing: "0.02em",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {commanderName ?? ""}
                  </span>
                  {subline && (
                    <span style={{
                      display: "block",
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 10, letterSpacing: "0.1em",
                      color: "rgba(255,255,255,0.3)",
                      textTransform: "uppercase",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {subline}
                    </span>
                  )}
                </span>
              </button>

              {history.length > 0 && !animOut && (
                <button
                  onClick={doUndo}
                  style={{
                    minHeight: 44, minWidth: 44, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: "none",
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: "'Noto Sans', sans-serif",
                    fontSize: 11, letterSpacing: 2, cursor: "pointer",
                    padding: "2px 6px",
                  }}
                >UNDO</button>
              )}
              {/* Items 18/19 — the spyglass opens the search+sort panel. */}
              {!handMode && (onEditQuery || onSortChange) && (
                <button
                  onClick={openSearch}
                  aria-label="Search and sort the stack"
                  style={{
                    minHeight: 44, minWidth: 44, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 0, border: "none",
                    background: "transparent",
                    color: "rgba(255,255,255,0.5)",
                    cursor: "pointer", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 20 }}>search</span>
                </button>
              )}
            </>
          )}
        </div>

        {/* Sort chips (item 19) — appear beneath the search field: NAME / CMC /
            EDHREC, active one highlighted with its direction arrow; tapping the
            active chip flips direction, tapping another switches order. */}
        {searchOpen && !handMode && onSortChange && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SORT_OPTIONS.map(opt => {
              const active = swipeOrder === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => onSortChange?.(opt.value, active ? (swipeDir === "asc" ? "desc" : "asc") : swipeDir)}
                  style={{
                    minHeight: 44, padding: "0 12px",
                    display: "flex", alignItems: "center", gap: 4,
                    background: "transparent",
                    border: `1px solid ${active ? "var(--primary)" : "rgba(255,255,255,0.18)"}`,
                    color: active ? "var(--primary)" : "rgba(255,255,255,0.55)",
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 11, letterSpacing: "0.08em",
                    cursor: "pointer", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {opt.label}
                  {active && (
                    <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                      {swipeDir === "asc" ? "arrow_upward" : "arrow_downward"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Search error/why, under the chips. */}
        {searchOpen && queryMsg && (
          <div style={{
            background: "rgba(0,0,0,0.55)",
            padding: "3px 8px",
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 11, lineHeight: 1.4,
            color: "rgba(255,255,255,0.7)",
          }}>
            {queryMsg}
          </div>
        )}
      </div>

      {/* Persistent filter chip (Change 3) — gold-bordered, names the active
          in-stack filter and clears it via ✕. Sits just under the header row,
          in the gap above the card, parallel to the card's own corner plates.
          The matching/total count lives in the header subline above. */}
      {stackNarrow && (
        <div style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top) + 48px)",
          left: 8, zIndex: 4,
          maxWidth: "calc(100% - 16px)",
          minHeight: 44,
          display: "flex", alignItems: "center", gap: 4,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid var(--primary)",
          paddingLeft: 10,
        }}>
          <span style={{
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 10, letterSpacing: "0.08em",
            color: "var(--primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            filtering: {stackNarrow}
          </span>
          <button
            onClick={onClearFilter}
            aria-label="Clear filter"
            style={{
              minWidth: 44, minHeight: 44, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", padding: 0,
              color: "var(--primary)",
              fontFamily: "'Noto Sans', sans-serif", fontSize: 16, lineHeight: 1,
              cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}
          >×</button>
        </div>
      )}

      {/* Gesture reminder (UAT 8/9; batch 2 item 16 centers it) — lives above
          the card, horizontally centered (it hides while the search panel is
          open). Fades for good after 5 swipe gestures this session — trained
          hands don't need it. */}
      {!done && !searchOpen && (
        <div style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top) + 48px)",
          left: 0, right: 0, zIndex: 3,
          minHeight: 44,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 11,
          color: "var(--muted)",
          pointerEvents: "none",
          opacity: swipeCount >= 5 ? 0 : 1,
          transition: "opacity 600ms ease",
        }}>
          {handMode ? "← browse →  ↑ cut  ↓ maybe" : "← browse →  ↑ deck  ↓ maybe"}
        </div>
      )}

      {/* ── Done state ── */}
      {/* A filter that emptied the stack is NOT "you've seen everything" — it's a
          dead end, so it gets its own escape hatch (Change 3): re-run the same
          query across all cards and swap in the bigger stack, staying on the
          swipe. Clearing the filter (header chip ✕) is the other way out. */}
      {done && stackNarrow && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16, padding: "0 32px", textAlign: "center",
        }}>
          <div style={{
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 13, letterSpacing: "0.06em", lineHeight: 1.5,
            color: "var(--color-text-secondary)",
          }}>nothing in this stack matches</div>
          <button
            onClick={handleSearchAll}
            disabled={escapeBusy}
            style={{
              minHeight: 44, padding: "0 24px",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid var(--primary)",
              background: "transparent",
              color: "var(--primary)",
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 13, letterSpacing: "0.1em",
              borderRadius: 0,
              cursor: escapeBusy ? "default" : "pointer",
              opacity: escapeBusy ? 0.6 : 1,
              WebkitTapHighlightColor: "transparent",
            }}
          >{escapeBusy ? "searching…" : "search all cards →"}</button>
          {escapeMsg && (
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12, lineHeight: 1.5,
              color: "var(--color-text-secondary)",
            }}>{escapeMsg}</div>
          )}
        </div>
      )}

      {done && !stackNarrow && !handMode && (
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
          {/* UAT batch 3, item 7 — the pile is dead: no "0 pile ·" count, no
              VIEW PILE. Just the two boards that exist, and VIEW DECK. */}
          <div style={{ fontFamily: "var(--font-system)", fontSize: 14, color: "var(--color-text-secondary)" }}>
            {decklist.length} mainboard · {maybeboard.length} maybe
          </div>
          <button
            onClick={onGoToPile}
            style={{
              marginTop: 8, padding: "12px 28px", borderRadius: 0,
              border: "1px solid var(--primary)",
              background: "transparent",
              color: "var(--primary)",
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 16, letterSpacing: 3, cursor: "pointer",
            }}
          >VIEW DECK</button>
          <button
            onClick={onSearchMore}
            style={{
              padding: "12px 28px", borderRadius: 0,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "rgba(255,255,255,0.45)",
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 16, letterSpacing: 3, cursor: "pointer",
            }}
          >SEARCH MORE</button>
        </div>
      )}

      {/* Hand-mode done — reached the end of the deck (or cut it all). No
          "search more"; the only move is back to the deck list. */}
      {done && handMode && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16, padding: "0 32px", textAlign: "center",
        }}>
          <div style={{
            fontFamily: "var(--font-system)",
            fontSize: 26, letterSpacing: 3, color: "var(--color-text-primary)",
          }}>THAT'S THE DECK</div>
          <div style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 12, color: "var(--color-text-secondary)" }}>
            you've flipped through every card
          </div>
          <button
            onClick={onGoToPile}
            style={{
              marginTop: 8, minHeight: 44, padding: "0 24px",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid var(--primary)",
              background: "transparent",
              color: "var(--primary)",
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 13, letterSpacing: "0.1em",
              borderRadius: 0, cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}
          >back to deck →</button>
        </div>
      )}

      {/* WREC tag chips (device UAT) — tag the current card WHILE flipping the
          deck in review, the same icon vocabulary as the list/band. Applied =
          filled category color (solid = user, dashed = auto-suggested);
          unapplied = dim. Hand mode only — brew-swipe cards aren't in the deck
          yet, so they have no row to tag. Sits above the back/done bar. */}
      {showTagChips && (
        <div style={{
          position: "absolute",
          left: 0, right: 0,
          bottom: "calc(env(safe-area-inset-bottom) + 58px)",
          zIndex: 5,
          display: "flex", justifyContent: "center", gap: 6,
          padding: "0 8px",
          pointerEvents: "none",
        }}>
          {WREC_CHIPS.map(({ tag, label }) => {
            const active = cardTagList.includes(tag);
            const auto = active && cardAutoTags.includes(tag);
            const c = WREC_CHIP_COLORS[tag];
            return (
              <button
                key={tag}
                onClick={() => onToggleTag(card.name, "decklist", tag)}
                aria-label={`${active ? "Remove" : "Add"} ${LABEL_BY_TAG[tag] ?? tag}`}
                style={{
                  flex: "1 1 0", minWidth: 0, maxWidth: 92, minHeight: 44,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 2,
                  pointerEvents: "auto",
                  border: `1px ${auto ? "dashed" : "solid"} ${active ? (c?.stroke ?? "var(--primary)") : "rgba(255,255,255,0.18)"}`,
                  background: active ? (c?.bg ?? "transparent") : "rgba(0,0,0,0.45)",
                  opacity: active ? 1 : 0.6,
                  color: active ? (c?.stroke ?? "var(--primary)") : "rgba(255,255,255,0.55)",
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 8, letterSpacing: "0.06em",
                  cursor: "pointer", WebkitTapHighlightColor: "transparent",
                }}
              >
                <WrecIcon tag={tag} size={16} />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Bottom controls (Change 11 / UAT 7) — BACK bottom-left (→ the deck
            list, the swipe's parent in the ladder), DONE bottom-right (also →
            the deck list; the one "I'm finished here" verb, both modes). Home
            is gone: the back-ladder (swipe → deck list → Box) replaces it. The
            old filter button is gone too — filtering is now the editable query
            chip (Change 10). ── */}
      <div style={{
        position: "absolute",
        left: 0, right: 0,
        bottom: "calc(env(safe-area-inset-bottom) + 8px)",
        zIndex: 5,
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 8px",
      }}>
        {/* BACK — bottom-left, ≥44px, to the deck list */}
        <button
          onClick={onGoToPile}
          aria-label="Back to deck list"
          style={{
            minHeight: 44, flexShrink: 0,
            display: "flex", alignItems: "center", gap: 5,
            background: "rgba(0,0,0,0.4)", border: "none",
            padding: "0 10px",
            color: "rgba(255,255,255,0.75)",
            cursor: "pointer", WebkitTapHighlightColor: "transparent",
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 20 }}>arrow_back</span>
          <span style={{
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 11, letterSpacing: "0.08em",
          }}>back</span>
        </button>

        <div style={{ flex: 1 }} />

        {/* DONE — bottom-right (UAT 7/9): exits the swipe back to the deck
            list, in brew and review/flip mode alike. No counts. The gesture
            reminder moved above the card (UAT 8). */}
        <button
          onClick={onGoToPile}
          aria-label="Done — back to deck list"
          style={{
            minHeight: 44, flexShrink: 0,
            display: "flex", alignItems: "center",
            background: "rgba(0,0,0,0.4)", border: "none",
            padding: "0 12px",
            color: "var(--primary)",
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 12, letterSpacing: "0.08em",
            cursor: "pointer", WebkitTapHighlightColor: "transparent",
          }}
        >done</button>
      </div>

      {/* ── Commander card overlay — tap the commander bar to open, tap
            anywhere to dismiss. Unaltered full card image (Scryfall terms). ── */}
      {showCommander && (
        <div
          onClick={() => setShowCommander(false)}
          role="dialog"
          aria-modal="true"
          aria-label={commanderName ? `${commanderName} card` : "Commander card"}
          style={{
            position: "absolute", inset: 0, zIndex: 30,
            background: "rgba(0,0,0,0.82)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {commanderFull ? (
            <img
              src={getCardImage(commanderFull, "normal")}
              alt={commanderName ?? "Commander card"}
              style={{
                width: "min(88vw, 400px)",
                maxHeight: "82vh",
                objectFit: "contain",
                borderRadius: "5.5% / 4%",
                boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
              }}
            />
          ) : (
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12, letterSpacing: "0.1em",
              color: "rgba(255,255,255,0.5)",
            }}>
              {commanderFull === undefined ? "card unavailable" : "loading…"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
