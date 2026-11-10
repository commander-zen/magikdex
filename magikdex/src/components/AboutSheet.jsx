import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext";

// "What is magikdex?" — opened by tapping the wordmark on any root screen.
// Short on purpose: what it is, the three gestures, and what it isn't.
// Closes on Got it, a scrim tap, Escape, or dragging the sheet down.
export default function AboutSheet({ open, onClose }) {
  const { theme } = useTheme();
  const [dragY, setDragY] = useState(0);
  const startY = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function onPointerDown(e) { startY.current = e.clientY; }
  function onPointerMove(e) {
    if (startY.current === null) return;
    setDragY(Math.max(0, e.clientY - startY.current));
  }
  function onPointerUp() {
    if (startY.current === null) return;
    startY.current = null;
    if (dragY > 80) onClose();
    setDragY(0);
  }

  const body = { fontFamily: "'Noto Sans', sans-serif", fontSize: 15, lineHeight: 1.55, color: theme.white };
  const gesture = (glyph, text) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{
        width: 32, height: 32, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: theme.base, color: theme.accent,
        fontFamily: "'Noto Sans', sans-serif", fontSize: 18,
      }}>{glyph}</span>
      <span style={body}>{text}</span>
    </div>
  );

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="What is magikdex?"
      className="fade-in"
      style={{
        position: "fixed", inset: 0, zIndex: 400,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="sheet-up"
        style={{
          width: "100%", maxWidth: 480,
          background: theme.surface,
          borderTop: `1px solid ${theme.muted}`,
          padding: "10px 20px calc(env(safe-area-inset-bottom) + 20px)",
          display: "flex", flexDirection: "column", gap: 16,
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? "none" : "transform 200ms ease-out",
          touchAction: "none",
        }}
      >
        <div aria-hidden="true" style={{ width: 40, height: 4, background: theme.muted, margin: "0 auto 4px" }} />

        <div style={{ fontFamily: "'Zilla Slab', serif", fontSize: 24, color: theme.white, lineHeight: 1.2 }}>
          mag&#x0131;kdex is a swipe brewer
        </div>
        <div style={{ ...body, color: "#c3c8ce" }}>
          Build Commander decks the way you flip through a binder at 1am: one card at a time, keep what sparks something.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {gesture("←→", "Swipe to browse")}
          {gesture("↑", "Swipe up to keep a card")}
          {gesture("↓", "Swipe down to see your pile")}
        </div>

        <div style={{ ...body, color: "#c3c8ce" }}>
          Search any card with Scryfall syntax, or open your dex: one brew per legend, named however you like.
        </div>
        <div style={{ ...body, fontSize: 13, color: theme.dim }}>
          It isn&apos;t a Moxfield or Scryfall replacement. Finish, share, and print decks there.
        </div>

        <button
          onClick={onClose}
          className="press"
          style={{
            minHeight: 48,
            background: theme.muted, color: theme.white, border: "none",
            fontFamily: "'Noto Sans', sans-serif", fontSize: 16,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
