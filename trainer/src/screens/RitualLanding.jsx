import { useRef, useState } from "react";

// RITUAL — the first thing anyone sees.
//
// Ben's mock, built as drawn: a Y2K AIM window. Beveled title bar, beveled
// action bar, light chrome. The AIM reference is not decoration — it is the
// product thesis. This is a buddy list for people you have physically met, and
// the window says that before a word is read.
//
// ── Light window on the dark page, deliberately ──────────────────────────────
// The mock is light and the rest of the app is dark (#08090c). That is not a
// conflict to resolve, it is how AIM actually looked: a light chrome window
// sitting on whatever desktop was behind it. So the page ground stays the app's
// dark, and the window is light. Both mocks read correctly and nothing has to be
// restyled.
//
// ── Signed-out only ──────────────────────────────────────────────────────────
// Nothing is persisted about having seen this. A "seen it" flag would mean a
// returning signed-out visitor never sees the landing again — including Ben,
// two minutes after shipping it — and the cost of showing it is one tap.

const BLACK = "#111";
const PAPER = "#fdfdfb";
const CHROME_HI = "#fbfbf8";
const CHROME_LO = "#d8d5cc";

// The beveled bar, top and bottom. Two of these plus a border IS the AIM look;
// there is no border-radius anywhere else in this app and this is the exception
// the card object already established.
const bar = {
  background: `linear-gradient(${CHROME_HI}, ${CHROME_LO})`,
  border: `2px solid ${BLACK}`,
  borderRadius: 10,
  boxShadow: "inset 0 1px 0 #fff",
  padding: "6px 14px",
  display: "flex",
  alignItems: "center",
};

export default function RitualLanding({ onStart }) {
  const [leaving, setLeaving] = useState(false);
  const touch = useRef(null);

  function start() {
    if (leaving) return;
    setLeaving(true);
    // Let the press register visually before the screen swaps. Short enough that
    // it never feels like latency.
    setTimeout(() => onStart?.(), 140);
  }

  // "swipe to start" should accept an actual swipe, but a tap has to work too —
  // half of everyone will tap a thing that says swipe, and a control that only
  // responds to a gesture is a control some people cannot find.
  function onTouchStart(e) { touch.current = e.changedTouches[0]?.clientX ?? null; }
  function onTouchEnd(e) {
    if (touch.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touch.current;
    touch.current = null;
    if (dx < -40) start();
  }

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        minHeight: "100dvh", background: "#08090c",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 380,
        background: PAPER, border: `2px solid ${BLACK}`, borderRadius: 12,
        padding: 10, display: "flex", flexDirection: "column", gap: 12,
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        opacity: leaving ? 0.55 : 1, transition: "opacity 140ms ease",
      }}>

        <div style={{ ...bar, justifyContent: "center" }}>
          <h1 style={{
            fontFamily: "'UnifrakturMaguntia', 'Zilla Slab', serif",
            fontSize: 44, lineHeight: 1.15, color: BLACK,
            fontWeight: 400, letterSpacing: "0.02em", margin: 0,
          }}>
            Ritual
          </h1>
        </div>

        <div style={{ padding: "14px 12px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: BLACK }}>
            in life this is a daily practice<br />
            in our game this is a one time burst of resources
          </p>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: BLACK }}>
            ritual&rsquo;s goal is to assist with both
          </p>
        </div>

        <button
          onClick={start}
          disabled={leaving}
          style={{
            ...bar, width: "100%", justifyContent: "space-between",
            font: "inherit", fontSize: 15, color: BLACK,
            cursor: leaving ? "default" : "pointer",
            minHeight: 46, textAlign: "left",
          }}
        >
          <span>swipe to start</span>
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>
    </div>
  );
}
