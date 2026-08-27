import { useState } from "react";
import { createPortal } from "react-dom";
import { tokens as t } from "../theme/tokens.js";
import LegendIdCard from "./LegendIdCard.jsx";

// PRINT THE LEGEND / COMMANDER ID CARD.
//
// Ben: "just stick a print icon anywhere and have it print single or a full page."
//
// ── 2 × 4, and the arithmetic is the reason ──────────────────────────────────
// The card is 3.5in × 2.5in LANDSCAPE. Two across is 7in and four down is 10in.
// Letter at a 0.2in margin gives 8.1 × 10.6in of printable area; A4 gives
// 7.87 × 11.3in. Two across by four down is therefore the largest whole grid
// that clears BOTH papers — it is not a round number somebody liked.
//
// ⚠️ NEVER auto-fit the grid. The trainer app shipped `repeat(auto-fit, …)` for
// its proxy sheet, which sizes to the VIEWPORT — nine cards went four or five
// across on a desktop and the on-screen sheet did not match the page at all. A
// print preview that lies is worse than no preview.
const COLS = 2;
const PER_SHEET = 8;

export default function LegendIdPrint({ open, onClose, legend, deck }) {
  const [count, setCount] = useState(PER_SHEET);
  if (!open) return null;

  return createPortal(
    <>
      <style>{`
        /* size:auto respects whatever paper is loaded; the grid above clears
           both Letter and A4 at this margin. */
        @page { size: auto; margin: 0.2in; }

        @media print {
          .lid-noprint { display: none !important; }
          html, body, #root { background: #fff !important; }
          /* Without this, browsers strip background colours "helpfully" and the
             card prints as a white rectangle with a QR floating in it — no
             paper tone, no yellow spine, no filled bars. */
          .lid-sheet, .lid-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .lid-overlay { position: static !important; overflow: visible !important;
                         background: #fff !important; padding: 0 !important; }
          .lid-sheet { padding: 0 !important; }
          .lid-cell { outline: 0.2mm dashed #bbb !important; }
        }

        .lid-sheet {
          display: grid;
          grid-template-columns: repeat(${COLS}, 3.5in);
          justify-content: center;
          background: #fff;
        }
        /* Cards sit edge to edge: one cut serves two cards. */
        .lid-cell { width: 3.5in; height: 2.5in; outline: 0.2mm dashed #d6d6d6; }
      `}</style>

      <div className="lid-overlay" style={{
        position: "fixed", inset: 0, zIndex: 400, background: t.base,
        overflowY: "auto", padding: "18px 16px 40px",
      }}>
        <div className="lid-noprint" style={{
          maxWidth: 460, margin: "0 auto 18px", display: "flex",
          flexDirection: "column", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: t.white }}>print deck ID</span>
            <button onClick={onClose} aria-label="Close" style={{
              width: 44, height: 44, background: "transparent", border: "none",
              color: t.dim, cursor: "pointer", fontSize: 18, marginRight: -10,
            }}>✕</button>
          </div>

          <span style={{ fontSize: 13, lineHeight: 1.6, color: t.dim }}>
            prints at <strong style={{ color: t.white }}>3.5&thinsp;×&thinsp;2.5&nbsp;in</strong> — landscape,
            so it does not look like another card in the box. cut on the guides.
          </span>

          <div style={{ display: "flex", gap: 8 }}>
            {[1, PER_SHEET].map(n => (
              <button key={n} onClick={() => setCount(n)} style={{
                flex: 1, minHeight: 44, background: "transparent",
                border: `1px solid ${count === n ? t.accent : t.muted}`,
                color: count === n ? t.accent : t.dim,
                fontSize: 13, cursor: "pointer", borderRadius: 0,
              }}>
                {n === 1 ? "just one" : `${PER_SHEET} per sheet`}
              </button>
            ))}
          </div>

          <button onClick={() => window.print()} style={{
            minHeight: 46, background: "transparent",
            border: `1px solid ${t.accent}`, color: t.accent,
            fontSize: 14, cursor: "pointer", borderRadius: 0,
          }}>
            print
          </button>

          {/* Said once, because it is the one dialog setting that ruins the
              output and it is off by default in most browsers. */}
          <span style={{ fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
            in the print dialog turn ON &ldquo;background graphics&rdquo; and set scale to
            100% — otherwise the card prints blank and at the wrong size.
          </span>
        </div>

        <div className="lid-sheet" style={{
          // One card should not sit in the left cell of an empty 2-wide grid.
          gridTemplateColumns: count === 1 ? "3.5in" : undefined,
        }}>
          {Array.from({ length: count }, (_, i) => (
            <div className="lid-cell" key={i}>
              <LegendIdCard legend={legend} deck={deck} width="3.5in" />
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
