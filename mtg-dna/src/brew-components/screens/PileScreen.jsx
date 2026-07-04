import { useState, useEffect, useRef } from "react";
import { getCardImage } from "../../lib/scryfall.js";
import PileSwipeScreen from "../PileSwipeScreen.jsx";
import CommanderModal from "../CommanderModal.jsx";
import CommanderSearchSheet from "../CommanderSearchSheet.jsx";
import WrecCategoryButtons from "../WrecCategoryButtons.jsx";
const NAV_HEIGHT = 60;
import { WREC_CHIP } from "../../constants/wrec.js";
import { useGameChangers } from "../../hooks/useGameChangers.js";
import { getSettings } from "../../lib/settings.js";

// ── Card-type helpers ─────────────────────────────────────────────────────────
const isBasicLand = c => Boolean(c?.type_line?.includes("Basic Land"));
const isAnyNumber = c => Boolean(c?.oracle_text?.includes("A deck can have any number of cards named"));
const isStackable = c => isBasicLand(c) || isAnyNumber(c);

// ── Export ────────────────────────────────────────────────────────────────────
function buildExportText(displayPile, commander, rawPile) {
  const cmdCard = commander ? rawPile.find(c => c.instanceId === commander) : null;
  const rows = cmdCard
    ? displayPile.filter(c => c.name !== cmdCard.name)
    : displayPile;
  const lines = rows.map(c => `${c.qty ?? 1} ${c.name}`).join("\n");
  return cmdCard ? `Commander: ${cmdCard.name}\n\n${lines}` : lines;
}

// ── Display pile ──────────────────────────────────────────────────────────────
function buildDisplayPile(pile, commanderInstanceId) {
  const seenStackable    = new Map();
  const seenNonStackable = new Set();
  const result           = [];

  if (commanderInstanceId) {
    const cmd = pile.find(c => c.instanceId === commanderInstanceId);
    if (cmd && !isStackable(cmd)) {
      seenNonStackable.add(cmd.id ?? cmd.name);
      result.push(cmd);
    }
  }

  for (const card of pile) {
    if (commanderInstanceId && card.instanceId === commanderInstanceId) continue;
    if (isStackable(card)) {
      if (seenStackable.has(card.name)) {
        const i = seenStackable.get(card.name);
        result[i] = { ...result[i], qty: result[i].qty + (card.qty ?? 1) };
      } else {
        seenStackable.set(card.name, result.length);
        result.push({ ...card, qty: card.qty ?? 1 });
      }
    } else {
      const key = card.id ?? card.name;
      if (!seenNonStackable.has(key)) {
        seenNonStackable.add(key);
        result.push(card);
      }
    }
  }
  return result;
}

function totalCount(pile) {
  return pile.reduce((sum, c) => sum + (c.qty ?? 1), 0);
}

function dedupeByOracleId(cards) {
  const seen = new Set();
  const duplicates = [];
  const result = [];
  for (const card of cards) {
    const key = card.oracle_id ?? card.id ?? card.name;
    if (seen.has(key)) { duplicates.push(card.name); }
    else { seen.add(key); result.push(card); }
  }
  if (duplicates.length > 0) console.warn("Duplicate oracle_ids removed from pile review:", duplicates);
  return result;
}

// ── WREC score ────────────────────────────────────────────────────────────────
// ── Icons ─────────────────────────────────────────────────────────────────────
function ImageIcon({ color }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5" fill={color} stroke="none"/>
      <polyline points="21,15 16,10 5,21"/>
    </svg>
  );
}

function ListIcon({ color }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}

function ConsiderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  );
}

function MoveToDeckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  );
}

// ── SwipeableRow ──────────────────────────────────────────────────────────────
// Wraps a list row with horizontal swipe-to-action gesture handling.
// leftAction / rightAction: { bg, label, icon }
// onSwipeLeft / onSwipeRight: callback fired after fly-off animation
function SwipeableRow({ onSwipeLeft, onSwipeRight, leftAction, rightAction, children }) {
  const [offset,   setOffset]   = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flying,   setFlying]   = useState(null); // "left" | "right" | null

  const startRef        = useRef(null); // { x, y }
  const capturingRef    = useRef(false);
  const dragOccurredRef = useRef(false);

  function onPD(e) {
    if (e.target.closest("button")) return;
    startRef.current     = { x: e.clientX, y: e.clientY };
    capturingRef.current = false;
  }

  function onPM(e) {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;

    if (!capturingRef.current) {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        // Clearly vertical — abandon
        startRef.current = null;
        return;
      }
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        capturingRef.current    = true;
        dragOccurredRef.current = true;
        setDragging(true);
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
      }
      return;
    }

    setOffset(dx);
  }

  function onPU(e) {
    if (!startRef.current) return;
    const finalDx = capturingRef.current ? (e.clientX - startRef.current.x) : 0;
    startRef.current     = null;
    capturingRef.current = false;
    setDragging(false);

    if (finalDx > 60 && onSwipeRight) {
      try { if (getSettings().haptics) navigator.vibrate(25); } catch { /* haptics unsupported */ }
      setFlying("right");
      setTimeout(() => onSwipeRight(), 200);
    } else if (finalDx < -60 && onSwipeLeft) {
      try { if (getSettings().haptics) navigator.vibrate(25); } catch { /* haptics unsupported */ }
      setFlying("left");
      setTimeout(() => onSwipeLeft(), 200);
    } else {
      setOffset(0);
    }
  }

  function onPCancel() {
    startRef.current     = null;
    capturingRef.current = false;
    setDragging(false);
    setOffset(0);
  }

  const transform = flying === "right" ? "translateX(110%)"
    : flying === "left" ? "translateX(-110%)"
    : `translateX(${offset}px)`;

  const transition = flying   ? "transform 200ms ease-in"
    : dragging ? "none"
    : "transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)";

  const showLeftDrawer  = (offset < -20 || flying === "left")  && leftAction;
  const showRightDrawer = (offset > 20  || flying === "right") && rightAction;

  return (
    <div
      style={{ position: "relative", overflow: "hidden" }}
      onClickCapture={e => {
        if (dragOccurredRef.current) {
          dragOccurredRef.current = false;
          e.stopPropagation();
        }
      }}
    >
      {/* Action revealed by left swipe (card slides left, drawer on right) */}
      {showLeftDrawer && (
        <div style={{
          position: "absolute", right: 0, top: 0, bottom: 0,
          display: "flex", alignItems: "center", gap: 6,
          padding: "0 20px",
          background: leftAction.bg,
          minWidth: 90,
          color: "#fff",
        }}>
          {leftAction.icon}
          <span style={{
            fontFamily: "'Noto Sans', sans-serif",
            fontSize: 11, letterSpacing: 2, fontWeight: 600,
          }}>{leftAction.label}</span>
        </div>
      )}

      {/* Action revealed by right swipe (card slides right, drawer on left) */}
      {showRightDrawer && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          display: "flex", alignItems: "center", gap: 6,
          padding: "0 20px",
          background: rightAction.bg,
          minWidth: 90,
          color: "#fff",
        }}>
          {rightAction.icon}
          <span style={{
            fontFamily: "'Noto Sans', sans-serif",
            fontSize: 11, letterSpacing: 2, fontWeight: 600,
          }}>{rightAction.label}</span>
        </div>
      )}

      {/* Sliding card content */}
      <div
        onPointerDown={onPD}
        onPointerMove={onPM}
        onPointerUp={onPU}
        onPointerCancel={onPCancel}
        style={{
          transform,
          transition,
          position: "relative",
          zIndex: 1,
          background: "#000",
          touchAction: "pan-y",
          userSelect: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────
// NAV_HEIGHT (60) + STACK & SWIPE button (~52px) + gap (18px)
const FAB_CLEARANCE = NAV_HEIGHT + 52 + 18;

const WREC_INFO = [
  { cat: "Ramp",            target: 10, desc: "Cards that increase your mana production" },
  { cat: "Card Advantage",  target: 12, desc: "Cards that draw or generate extra cards" },
  { cat: "Disruption",      target: 12, desc: "Single-target interaction and removal" },
  { cat: "Mass Disruption", target: 6,  desc: "Board wipes and mass removal" },
  { cat: "Mana Base",       target: 38, desc: "Lands and mana sources" },
  { cat: "Plan",            target: 30, desc: "Cards that execute your commander's strategy" },
];

// ── PileScreen ────────────────────────────────────────────────────────────────
export default function PileScreen({
  pile, onPileChange, onClearPile,
  commander, onCommanderChange,
  commanderCard, onCommanderCardChange,
  maybeboard, onMaybeboardChange,
  initialTab,
  decks = [],
  activeDeckId = null,
  onSave,
  onAssignTag,
  wrecTags = {},
}) {
  const [deckViewMode,   setDeckViewMode]   = useState("list");
  const [maybeViewMode,  setMaybeViewMode]  = useState("list");
  const [activeTab,      setActiveTab]      = useState(initialTab ?? "deck");
  const [reviewMode,     setReviewMode]     = useState(null);
  const [reviewCards,    setReviewCards]    = useState([]);
  const [reviewStartIdx, setReviewStartIdx] = useState(0);
  const [copied,         setCopied]         = useState(false);
  const [cmdModalOpen,   setCmdModalOpen]   = useState(false);
  const [cmdSearchOpen,  setCmdSearchOpen]  = useState(false);
  const [detailCard,     setDetailCard]     = useState(null);
  const [wrecSheetOpen,  setWrecSheetOpen]  = useState(false);

  const { gameChangerIds } = useGameChangers();

  const scrollPos = useRef({ deck: 0, maybe: 0 });
  useEffect(() => {
    scrollPos.current[activeTab] = window.scrollY;
    // Sync the tab when the parent hands us a new initialTab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab(initialTab ?? "deck");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);
  useEffect(() => {
    window.scrollTo(0, scrollPos.current[activeTab] ?? 0);
  }, [activeTab]);

  const lpTimerRef = useRef(null);
  const lpFiredRef = useRef(false);

  const reviewCommanderCard =
    commanderCard ??
    (commander ? pile.find(c => c.instanceId === commander) : null);

  const commanderName = reviewCommanderCard?.name ?? null;
  const hasCommander  = Boolean(reviewCommanderCard);

  // ── Display piles ──────────────────────────────────────────────────────────
  const displayPile       = buildDisplayPile(pile, commander);
  const displayMaybeboard = buildDisplayPile(maybeboard, null);

  const activeCards       = activeTab === "deck" ? displayPile       : displayMaybeboard;
  const activeCardsRawLen = activeTab === "deck" ? totalCount(pile)  : totalCount(maybeboard);
  const viewMode          = activeTab === "deck" ? deckViewMode : maybeViewMode;

  const bottomPad = `calc(max(18px, env(safe-area-inset-bottom)) + ${FAB_CLEARANCE}px + 40px)`;
  const fabBottom  = `calc(max(10px, env(safe-area-inset-bottom)) + ${NAV_HEIGHT}px + 8px)`;

  // ── Review entry ───────────────────────────────────────────────────────────
  function enterReview(mode) {
    const raw     = mode === "deck" ? pile : maybeboard;
    const deduped = dedupeByOracleId(raw);
    setReviewCards(deduped);
    setReviewStartIdx(0);
    setReviewMode(mode);
  }

  // ── Card interactions ──────────────────────────────────────────────────────
  function handleRemove(instanceId, e) {
    e?.stopPropagation();
    const newPile = pile.filter(c => c.instanceId !== instanceId);
    onPileChange(newPile);
    onSave?.(newPile, maybeboard);
    if (commander === instanceId) onCommanderChange(null);
  }

  function handleRemoveMaybe(instanceId, e) {
    e?.stopPropagation();
    const newMaybe = maybeboard.filter(c => c.instanceId !== instanceId);
    onMaybeboardChange(newMaybe);
    onSave?.(pile, newMaybe);
  }

  function handleMoveToMaybe(card) {
    const newPile  = pile.filter(c => c.instanceId !== card.instanceId);
    const newMaybe = [...maybeboard, card];
    onPileChange(newPile);
    onMaybeboardChange(newMaybe);
    onSave?.(newPile, newMaybe);
    if (commander === card.instanceId) onCommanderChange(null);
  }

  function handleMoveToPile(card) {
    const newMaybe = maybeboard.filter(c => c.instanceId !== card.instanceId);
    const newPile  = [...pile, card];
    onMaybeboardChange(newMaybe);
    onPileChange(newPile);
    onSave?.(newPile, newMaybe);
  }

  function handleStackableQtyChange(displayCard, delta) {
    const entries = pile.filter(c => c.name === displayCard.name);
    if (entries.length === 0) return;
    let newPile;
    if (entries.length === 1) {
      const entry   = entries[0];
      const current = entry.qty ?? 1;
      const next    = current + delta;
      if (next <= 0) {
        newPile = pile.filter(c => c.name !== displayCard.name);
      } else {
        newPile = pile.map(c => c.name === displayCard.name ? { ...c, qty: next } : c);
      }
    } else {
      if (delta > 0) {
        const template = entries[0];
        const clone    = { ...template, instanceId: crypto.randomUUID(), qty: undefined };
        newPile = [...pile, clone];
      } else {
        const lastId = entries[entries.length - 1].instanceId;
        newPile = pile.filter(c => c.instanceId !== lastId);
      }
    }
    onPileChange(newPile);
    onSave?.(newPile, maybeboard);
  }

  function onCardPointerDown(card) {
    lpFiredRef.current = false;
    lpTimerRef.current = setTimeout(() => {
      lpFiredRef.current = true;
      onCommanderChange(commander === card.instanceId ? null : card.instanceId);
    }, 500);
  }

  function onCardPointerUp() { clearTimeout(lpTimerRef.current); }

  function getWrecCategories(oracleId) {
    if (!oracleId) return [];
    return Object.entries(wrecTags)
      .filter(([, ids]) => (ids ?? []).includes(oracleId))
      .map(([cat]) => cat);
  }

  function handleCardClick(oracleId, card) {
    if (lpFiredRef.current) { lpFiredRef.current = false; return; }
    setDetailCard(card);
  }

  // ── Review handlers ────────────────────────────────────────────────────────
  function handleReviewKeep(card) {
    if (reviewMode !== "deck") {
      const newMaybe = maybeboard.filter(c => c.instanceId !== card.instanceId);
      const newPile  = [...pile, card];
      onMaybeboardChange(newMaybe);
      onPileChange(newPile);
      onSave?.(newPile, newMaybe);
    }
  }

  function handleReviewPass(card) {
    if (reviewMode === "deck") {
      const newPile  = pile.filter(c => c.instanceId !== card.instanceId);
      const newMaybe = [...maybeboard, card];
      onPileChange(newPile);
      onMaybeboardChange(newMaybe);
      onSave?.(newPile, newMaybe);
    } else {
      const newMaybe = maybeboard.filter(c => c.instanceId !== card.instanceId);
      onMaybeboardChange(newMaybe);
      onSave?.(pile, newMaybe);
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  function handleCopy() {
    const text = buildExportText(displayPile, commander, pile);
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleMoxfield() {
    navigator.clipboard?.writeText(buildExportText(displayPile, commander, pile));
    window.open("https://www.moxfield.com/import", "_blank", "noopener,noreferrer");
  }

  // ── Renders ────────────────────────────────────────────────────────────────

  function renderListRow(card, isCommander, onRemove, dimName = false) {
    const basic       = isBasicLand(card);
    const stackable   = isStackable(card);
    const mana        = !stackable
      ? (card.mana_cost?.replace(/\{([^}]+)\}/g, "$1 ").trim() ?? "")
      : "";
    const rowOracleId = card.oracle_id ?? card.id;
    const wrecCats    = !stackable ? getWrecCategories(rowOracleId) : [];
    const isGC        = !isCommander && gameChangerIds.has(rowOracleId ?? "");

    return (
      <div
        key={card.instanceId}
        style={{
          display: "flex", alignItems: "center",
          padding: "8px 14px",
          paddingLeft: isGC ? 11 : 14,
          background: "var(--color-surface)",
          borderStyle: "solid",
          borderWidth: "2px",
          borderTopColor: "var(--bevel-light)",
          borderLeftColor: isGC ? "var(--gc-gold)" : "var(--bevel-light)",
          borderBottomColor: "var(--bevel-dark)",
          borderRightColor: "var(--bevel-dark)",
          borderRadius: 0,
          marginBottom: "var(--space-1)",
          cursor: stackable ? "default" : "pointer",
        }}
        onClick={() => !stackable && handleCardClick(card.oracle_id ?? card.id, card)}
      >
        {isCommander && (
          <span style={{ fontSize: 12, marginRight: 6, flexShrink: 0 }}>👑</span>
        )}

        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-base)",
            color: isCommander ? "gold" : dimName ? "var(--color-text-secondary)" : "var(--color-text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontWeight: isCommander ? 500 : 400,
          }}>
            {card.name}
          </span>
          {isGC && (
            <span style={{ color: "var(--gc-gold)", fontSize: 11, flexShrink: 0 }}>⚡</span>
          )}
          {!stackable && rowOracleId && !isCommander && (
            <>
              {wrecCats.length === 0 ? (
                <span style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "1px 6px", borderRadius: 4,
                  border: "1px dashed rgba(255,255,255,0.18)",
                  background: "transparent", color: "var(--muted)",
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 9, letterSpacing: 0.5, lineHeight: "14px",
                  flexShrink: 0,
                }}>UNTAG</span>
              ) : wrecCats.map(cat => {
                const chip = WREC_CHIP[cat];
                return chip ? (
                  <span key={cat} style={{
                    display: "inline-flex", alignItems: "center",
                    padding: "1px 6px", borderRadius: 4,
                    border: `1px solid ${chip.border}`,
                    background: chip.bg, color: chip.color,
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 9, letterSpacing: 0.5, lineHeight: "14px",
                    flexShrink: 0,
                  }}>{chip.label}</span>
                ) : null;
              })}
            </>
          )}
        </div>

        {basic && (
          <div
            style={{ display: "flex", alignItems: "center", flexShrink: 0, marginLeft: 8, marginRight: 4 }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={e => { e.stopPropagation(); handleStackableQtyChange(card, -1); }}
              style={{
                width: 26, height: 26,
                background: "var(--color-chrome)",
                color: "var(--color-text-chrome)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "var(--bevel-light)",
                borderLeftColor: "var(--bevel-light)",
                borderBottomColor: "var(--bevel-dark)",
                borderRightColor: "var(--bevel-dark)",
                cursor: "pointer", lineHeight: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 0,
              }}
            >−</button>
            <div style={{
              minWidth: 28, height: 26,
              borderStyle: "solid",
              borderWidth: "2px",
              borderTopColor: "var(--bevel-dark)",
              borderLeftColor: "var(--bevel-dark)",
              borderBottomColor: "var(--bevel-light)",
              borderRightColor: "var(--bevel-light)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12, color: "var(--color-text-primary)",
              background: "var(--color-bg)",
              paddingInline: 4,
            }}>
              {card.qty ?? 1}
            </div>
            <button
              onClick={e => { e.stopPropagation(); handleStackableQtyChange(card, +1); }}
              style={{
                width: 26, height: 26,
                background: "var(--color-chrome)",
                color: "var(--color-text-chrome)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "var(--bevel-light)",
                borderLeftColor: "var(--bevel-light)",
                borderBottomColor: "var(--bevel-dark)",
                borderRightColor: "var(--bevel-dark)",
                cursor: "pointer", lineHeight: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 0,
              }}
            >+</button>
          </div>
        )}

        {!stackable && mana && (
          <span style={{
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-secondary)",
            flexShrink: 0, marginLeft: 8, marginRight: 8,
          }}>
            {mana}
          </span>
        )}

        <button
          onClick={e => { e.stopPropagation(); onRemove(card.instanceId, e); }}
          style={{
            background: "#800000",
            color: "#ffffff",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-sm)",
            borderStyle: "solid",
            borderWidth: "2px",
            borderTopColor: "#ffffff",
            borderLeftColor: "#ffffff",
            borderBottomColor: "#400000",
            borderRightColor: "#400000",
            padding: "var(--space-1) var(--space-3)",
            cursor: "pointer",
            borderRadius: 0,
            flexShrink: 0, lineHeight: 1,
            minWidth: 44, minHeight: 44,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >✕</button>
      </div>
    );
  }

  function renderGridCard(card, isCommander, onRemove) {
    const imgUrl = getCardImage(card, "art_crop");
    const isGC   = !isCommander && gameChangerIds.has(card.oracle_id ?? "");
    return (
      <div
        key={card.instanceId}
        onPointerDown={() => activeTab === "deck" && onCardPointerDown(card)}
        onPointerUp={onCardPointerUp}
        onPointerCancel={onCardPointerUp}
        onClick={() => handleCardClick(card.oracle_id ?? card.id, card)}
        style={{
          position: "relative", aspectRatio: "4/3",
          borderRadius: 12, overflow: "hidden", cursor: "pointer",
          background: "#0d0d0f",
          outline: isCommander ? "2px solid gold" : isGC ? "2px solid var(--gc-gold)" : "none",
          outlineOffset: (isCommander || isGC) ? 2 : 0,
        }}
      >
        {imgUrl ? (
          <img src={imgUrl} alt={card.name} draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
        ) : (
          <div style={{
            width: "100%", height: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, color: "rgba(255,255,255,0.4)", padding: 8, textAlign: "center",
          }}>{card.name}</div>
        )}
        {isCommander && (
          <div style={{ position: "absolute", top: 4, left: 5, fontSize: 14, lineHeight: 1, pointerEvents: "none",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))" }}>👑</div>
        )}
        {isStackable(card) && (card.qty ?? 1) > 1 && (
          <div style={{
            position: "absolute", bottom: 5, left: 5,
            background: "rgba(0,0,0,0.78)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 4, padding: "1px 5px",
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 11, color: "var(--text)", lineHeight: "16px",
            pointerEvents: "none",
          }}>
            {card.qty}×
          </div>
        )}
        {!isCommander && (() => {
          const cats  = getWrecCategories(card.oracle_id ?? card.id);
          const chips = cats.map(c => WREC_CHIP[c]).filter(Boolean);
          if (chips.length === 0) return null;
          const pct = 100 / chips.length;
          const gradient = chips.map((ch, i) =>
            `${ch.color} ${i * pct}%, ${ch.color} ${(i + 1) * pct}%`
          ).join(", ");
          return (
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              height: 4,
              background: `linear-gradient(to right, ${gradient})`,
              borderRadius: "0 0 6px 6px",
              pointerEvents: "none",
            }} />
          );
        })()}
        {isGC && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "3px 6px",
            background: "rgba(0,0,0,0.72)",
            borderTop: "1px solid rgba(201,168,76,0.5)",
            display: "flex", alignItems: "center", gap: 3,
            pointerEvents: "none",
          }}>
            <span style={{ color: "var(--gc-gold)", fontSize: 9 }}>⚡</span>
            <span style={{
              color: "var(--gc-gold)",
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 8, letterSpacing: 0.5,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>GAME CHANGER</span>
          </div>
        )}
        <button
          onClick={e => { e.stopPropagation(); onRemove(card.instanceId, e); }}
          style={{
            position: "absolute", top: -6, right: -6,
            padding: 11,
            background: "#800000",
            color: "#ffffff",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-sm)",
            borderStyle: "solid",
            borderWidth: "2px",
            borderTopColor: "#ffffff",
            borderLeftColor: "#ffffff",
            borderBottomColor: "#400000",
            borderRightColor: "#400000",
            cursor: "pointer",
            borderRadius: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >✕</button>
      </div>
    );
  }

  // ── List row with swipe wrapper ────────────────────────────────────────────
  function renderSwipeableListRow(card, isCommander, tab) {
    const row = renderListRow(
      card,
      isCommander,
      tab === "deck" ? handleRemove : (id, e) => handleRemoveMaybe(id, e),
      tab === "maybe",
    );

    const deckActions = {
      leftAction:  { bg: "rgba(239,68,68,0.92)",    label: "CUT",          icon: <TrashIcon /> },
      rightAction: { bg: "rgba(180,140,60,0.92)",   label: "CONSIDER",     icon: <ConsiderIcon /> },
      onSwipeLeft:  () => handleRemove(card.instanceId),
      onSwipeRight: () => handleMoveToMaybe(card),
    };

    const maybeActions = {
      leftAction:  { bg: "rgba(239,68,68,0.92)",    label: "REMOVE",       icon: <TrashIcon /> },
      rightAction: { bg: "rgba(52,211,153,0.92)",   label: "MOVE TO DECK", icon: <MoveToDeckIcon /> },
      onSwipeLeft:  () => handleRemoveMaybe(card.instanceId),
      onSwipeRight: () => handleMoveToPile(card),
    };

    const actions = tab === "deck" ? deckActions : maybeActions;

    return (
      <SwipeableRow
        key={card.instanceId}
        leftAction={actions.leftAction}
        rightAction={actions.rightAction}
        onSwipeLeft={actions.onSwipeLeft}
        onSwipeRight={actions.onSwipeRight}
      >
        {row}
      </SwipeableRow>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#000", color: "var(--text)", fontFamily: "'Noto Sans', sans-serif" }}>

      {/* ── WREC info bottom sheet ── */}
      {wrecSheetOpen && (
        <>
          <div
            onClick={() => setWrecSheetOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 399, background: "rgba(0,0,0,0.6)" }}
          />
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 401,
            maxWidth: 600, margin: "0 auto",
            background: "var(--color-surface)",
            borderStyle: "solid",
            borderWidth: "2px",
            borderTopColor: "var(--bevel-light)",
            borderLeftColor: "var(--bevel-light)",
            borderBottomColor: "var(--bevel-dark)",
            borderRightColor: "var(--bevel-dark)",
            borderRadius: 0,
            padding: "0 20px",
            paddingBottom: "calc(max(20px, env(safe-area-inset-bottom)) + 20px)",
            maxHeight: "85dvh", overflowY: "auto",
            fontFamily: "'Noto Sans', sans-serif",
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)", margin: "14px auto 20px" }} />
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: 2, color: "var(--text)", marginBottom: 10 }}>
              WHAT IS WREC?
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.6, margin: "0 0 20px" }}>
              WREC is a Commander deckbuilding framework by Rachel Weeks that scores your deck like a batting average — 1.000 is perfect, deviation in either direction is bad.
            </p>
            {WREC_INFO.map(({ cat, target, desc }) => (
              <div key={cat} style={{
                padding: "10px 0",
                borderBottom: "0.5px solid rgba(255,255,255,0.07)",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <div style={{ flexShrink: 0, width: 32 }}>
                  <span style={{
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 13, color: "var(--primary)", fontWeight: 600,
                  }}>{target}</span>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, marginBottom: 2 }}>{cat}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{desc}</div>
                </div>
              </div>
            ))}
            <button
              onClick={() => setWrecSheetOpen(false)}
              style={{
                marginTop: 24, width: "100%",
                background: "var(--color-chrome)",
                color: "var(--color-text-chrome)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "var(--bevel-light)",
                borderLeftColor: "var(--bevel-light)",
                borderBottomColor: "var(--bevel-dark)",
                borderRightColor: "var(--bevel-dark)",
                padding: "var(--space-1) var(--space-3)",
                cursor: "pointer",
                borderRadius: 0,
                letterSpacing: 2,
              }}
            >CLOSE</button>
          </div>
        </>
      )}

      {/* ── Card detail sheet ── */}
      {detailCard && (() => {
        const dc         = detailCard;
        const oracleId   = dc.oracle_id ?? dc.id;
        const mana       = dc.mana_cost?.replace(/\{([^}]+)\}/g, "$1 ").trim() ?? "";
        const currentTags = getWrecCategories(oracleId);

        return (
          <>
            <div
              onClick={() => setDetailCard(null)}
              style={{ position: "fixed", inset: 0, zIndex: 398, background: "rgba(0,0,0,0.55)" }}
            />
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 400,
              maxWidth: 600, margin: "0 auto",
              background: "var(--color-surface)",
              borderStyle: "solid",
              borderWidth: "2px",
              borderTopColor: "var(--bevel-light)",
              borderLeftColor: "var(--bevel-light)",
              borderBottomColor: "var(--bevel-dark)",
              borderRightColor: "var(--bevel-dark)",
              borderRadius: 0,
              padding: "0 16px calc(max(20px, env(safe-area-inset-bottom)) + 6px)",
              fontFamily: "'Noto Sans', sans-serif",
              maxHeight: "85dvh", overflowY: "auto",
            }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)", margin: "14px auto 16px" }} />
              <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text)", marginBottom: 2 }}>
                  {dc.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{dc.type_line ?? ""}</span>
                  {mana && (
                    <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'Noto Sans Mono', monospace" }}>{mana}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 8, lineHeight: 1.5 }}>
                  {(dc.oracle_text ?? "").split("\n").map((line, i, arr) => (
                    <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                  ))}
                </div>
              </div>
              <WrecCategoryButtons
                currentTags={currentTags}
                onToggle={cat => onAssignTag?.(oracleId, cat)}
              />
            </div>
          </>
        );
      })()}

      {/* PileSwipeScreen overlay */}
      {reviewMode && (
        <PileSwipeScreen
          cards={reviewCards}
          startIndex={reviewStartIdx}
          mode={reviewMode}
          commanderCard={reviewCommanderCard}
          onKeep={handleReviewKeep}
          onPass={handleReviewPass}
          onDone={() => setReviewMode(null)}
        />
      )}

      {/* ── Sticky header ── */}
      <div style={{
        position: "sticky", top: "env(safe-area-inset-top)", zIndex: 100,
        maxWidth: 600, margin: "0 auto", width: "100%",
        background: "rgba(0,0,0,0.97)",
        backdropFilter: "blur(12px)",
        borderBottom: "0.5px solid rgba(255,255,255,0.06)",
      }}>
        {/* Top row */}
        <div style={{
          display: "flex", alignItems: "center",
          padding: "0 10px 0 16px", height: 52, gap: 8,
        }}>
          {reviewCommanderCard ? (
            <>
              {getCardImage(reviewCommanderCard, "art_crop") && (
                <img
                  src={getCardImage(reviewCommanderCard, "art_crop")}
                  alt={commanderName}
                  draggable={false}
                  onClick={() => setCmdModalOpen(true)}
                  style={{
                    width: 40, height: 28, objectFit: "cover", borderRadius: 4, flexShrink: 0,
                    cursor: "pointer",
                  }}
                />
              )}
              <span
                onClick={() => setCmdModalOpen(true)}
                style={{
                  flex: 1,
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 18, letterSpacing: 3, color: "var(--text)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {commanderName}
              </span>
            </>
          ) : (
            <span style={{
              flex: 1,
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 18, letterSpacing: 4, color: "#c0c0c0",
            }}>
              {activeTab === "deck" ? "BREW" : "CONSIDERING"}
            </span>
          )}

          <span style={{
            fontSize: 12, color: "var(--muted)",
            fontFamily: "'Noto Sans Mono', monospace",
            flexShrink: 0,
          }}>
            {activeCardsRawLen}
          </span>

          <button
            onClick={() => {
              if (activeTab === "deck") setDeckViewMode(v => v === "list" ? "grid" : "list");
              else setMaybeViewMode(v => v === "list" ? "grid" : "list");
            }}
            style={{
              background: "var(--color-chrome)",
              color: "var(--color-text-chrome)",
              fontFamily: "var(--font-system)",
              fontSize: "var(--font-size-sm)",
              borderStyle: "solid",
              borderWidth: "2px",
              borderTopColor: "var(--bevel-light)",
              borderLeftColor: "var(--bevel-light)",
              borderBottomColor: "var(--bevel-dark)",
              borderRightColor: "var(--bevel-dark)",
              padding: "var(--space-1) var(--space-3)",
              cursor: "pointer",
              borderRadius: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              minWidth: 44, minHeight: 44,
            }}
            title={viewMode === "list" ? "Switch to grid" : "Switch to list"}
          >
            {viewMode === "list" ? <ImageIcon color="var(--color-text-chrome)" /> : <ListIcon color="var(--color-text-chrome)" />}
          </button>

          {activeTab === "deck" && pile.length > 0 && (
            <button
              onClick={handleCopy}
              style={{
                background: "var(--color-chrome)",
                color: copied ? "var(--success)" : "var(--color-text-chrome)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "var(--bevel-light)",
                borderLeftColor: "var(--bevel-light)",
                borderBottomColor: "var(--bevel-dark)",
                borderRightColor: "var(--bevel-dark)",
                padding: "var(--space-1) var(--space-3)",
                cursor: "pointer",
                borderRadius: 0,
                flexShrink: 0,
                minWidth: 44, minHeight: 44,
                display: "flex", alignItems: "center", justifyContent: "center",
                letterSpacing: 1.5,
              }}
            >
              {copied ? "✓" : "COPY"}
            </button>
          )}
        </div>

        {/* SET COMMANDER banner */}
        {!hasCommander && pile.length > 0 && activeTab === "deck" && onCommanderCardChange && (
          <button
            onClick={() => setCmdSearchOpen(true)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%",
              background: "var(--color-titlebar)",
              color: "var(--color-titlebar-text)",
              fontFamily: "var(--font-system)",
              fontSize: "var(--font-size-sm)",
              borderStyle: "solid",
              borderWidth: "2px",
              borderTopColor: "#ffffff",
              borderLeftColor: "#ffffff",
              borderBottomColor: "#000040",
              borderRightColor: "#000040",
              padding: "var(--space-1) var(--space-3)",
              cursor: "pointer",
              borderRadius: 0,
              letterSpacing: 3,
            }}
          >
            <span style={{ fontSize: 14 }}>👑</span>
            SET COMMANDER
          </button>
        )}
      </div>

      {/* ── Card list / grid ── */}
      <div style={{
        maxWidth: 600, margin: "0 auto", width: "100%",
        padding: viewMode === "grid" ? "10px 10px" : "0",
        paddingBottom: bottomPad,
      }}>

        {activeCards.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "72px 20px",
            color: "rgba(255,255,255,0.35)", fontSize: 14,
          }}>
            {activeTab === "deck" ? "Your brew is empty" : "Your maybeboard is empty"}
            <br />
            <span style={{ opacity: 0.6, fontSize: 12, marginTop: 6, display: "block" }}>
              {activeTab === "deck"
                ? "Swipe right on the Stack to add cards here"
                : "Swipe left while reviewing your deck to send cards here"}
            </span>
          </div>
        ) : viewMode === "list" ? (
          activeTab === "deck"
            ? displayPile.map(card => renderSwipeableListRow(card, commander === card.instanceId, "deck"))
            : displayMaybeboard.map(card => renderSwipeableListRow(card, false, "maybe"))
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {activeTab === "deck"
              ? displayPile.map(card => renderGridCard(card, commander === card.instanceId, handleRemove))
              : displayMaybeboard.map(card => renderGridCard(card, false, (id, e) => handleRemoveMaybe(id, e)))
            }
          </div>
        )}

        {activeTab === "deck" && pile.length > 0 && (
          <div style={{ padding: "14px 16px 0" }}>
            <button
              onClick={handleMoxfield}
              style={{
                width: "100%",
                background: "var(--color-chrome)",
                color: "var(--color-text-chrome)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "var(--bevel-light)",
                borderLeftColor: "var(--bevel-light)",
                borderBottomColor: "var(--bevel-dark)",
                borderRightColor: "var(--bevel-dark)",
                padding: "var(--space-1) var(--space-3)",
                cursor: "pointer",
                borderRadius: 0,
                letterSpacing: 2,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              OPEN IN MOXFIELD ↗
            </button>
          </div>
        )}

        {activeTab === "deck" && pile.length > 0 && (
          <div style={{ padding: "8px 16px 0" }}>
            <button
              onClick={onClearPile}
              style={{
                width: "100%",
                background: "#800000",
                color: "#ffffff",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "#ffffff",
                borderLeftColor: "#ffffff",
                borderBottomColor: "#400000",
                borderRightColor: "#400000",
                padding: "var(--space-1) var(--space-3)",
                cursor: "pointer",
                borderRadius: 0,
                letterSpacing: 2,
              }}
            >
              CLEAR PILE
            </button>
          </div>
        )}
      </div>

      {/* ── STACK & SWIPE FAB ── */}
      {activeCards.length > 0 && (
        <div style={{
          position: "fixed",
          bottom: fabBottom,
          left: 0, right: 0,
          maxWidth: 600, margin: "0 auto",
          padding: "0 14px",
          zIndex: 80,
          pointerEvents: "auto",
        }}>
          <button
            onClick={() => enterReview(activeTab)}
            style={{
              width: "100%",
              background: "var(--color-titlebar)",
              color: "var(--color-titlebar-text)",
              fontFamily: "var(--font-system)",
              fontSize: "var(--font-size-sm)",
              borderStyle: "solid",
              borderWidth: "2px",
              borderTopColor: "#ffffff",
              borderLeftColor: "#ffffff",
              borderBottomColor: "#000040",
              borderRightColor: "#000040",
              padding: "14px 20px",
              cursor: "pointer",
              borderRadius: 0,
              letterSpacing: 3,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 3l14 9-14 9V3z"/>
            </svg>
            STACK &amp; SWIPE
          </button>
        </div>
      )}

      {/* ── Commander modal ── */}
      <CommanderModal
        card={cmdModalOpen ? reviewCommanderCard : null}
        onClose={() => setCmdModalOpen(false)}
      />

      {/* ── Commander search sheet ── */}
      <CommanderSearchSheet
        open={cmdSearchOpen}
        onClose={() => setCmdSearchOpen(false)}
        onSelect={card => {
          onCommanderCardChange?.(card);
          setCmdSearchOpen(false);
        }}
        decks={decks}
        excludeDeckId={activeDeckId}
      />
    </div>
  );
}
