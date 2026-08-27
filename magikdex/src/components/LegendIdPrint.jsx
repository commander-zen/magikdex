import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { tokens as t } from "../theme/tokens.js";
import LegendIdCard from "./LegendIdCard.jsx";
import { fetchDeckForLegend } from "../lib/deckSelect.js";
import { resolveLegendDeck } from "../lib/legendDeck.js";

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

// CSS inches at the browser's fixed 96dpi. The sheet is authored in PHYSICAL
// units because that is what makes the print correct — but 2 × 3.5in is 672
// CSS px, and a phone is ~390px wide, so on screen it spilled off both edges.
const CARD_W_PX = 3.5 * 96;   // 336
const CARD_H_PX = 2.5 * 96;   // 240

/**
 * @param deck  the deck row, when the caller already has one (the Box detail).
 * @param legendId  fetch it instead — the brew screen knows only the legend id
 *                  (`deckKey` is `session.legend.id`), not the deck row.
 */
export default function LegendIdPrint({ open, onClose, legend, deck, legendId }) {
  const [count, setCount] = useState(PER_SHEET);
  const [fetched, setFetched] = useState(null);

  // Only fetch when the caller did NOT hand us a row, and only while open —
  // this overlay is mounted by screens that keep it closed most of the time.
  useEffect(() => {
    if (!open || deck || !legendId) return;
    let cancelled = false;
    fetchDeckForLegend(legendId, resolveLegendDeck)
      .then(row => { if (!cancelled) setFetched(row); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, deck, legendId]);

  // ── Fit the sheet to the screen, WITHOUT resizing the cards ────────────────
  // The cards stay 3.5 × 2.5in in the document; the whole sheet is scaled down
  // to fit the viewport for preview only, and the print rule above undoes it.
  // A transform does not affect layout, so the wrapper carries the scaled height
  // itself — otherwise the page would keep scrolling over empty space.
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const cols = count === 1 ? 1 : COLS;
  const rows = Math.ceil(count / cols);
  const sheetW = cols * CARD_W_PX;
  const sheetH = rows * CARD_H_PX;
  // Never scale UP — a sheet blown past 1:1 on a desktop would misrepresent it.
  const fit = Math.min(1, (vw - 32) / sheetW);

  const row = deck ?? fetched;
  if (!open) return null;

  return createPortal(
    <>
      <style>{`
        /* size:auto respects whatever paper is loaded; the grid above clears
           both Letter and A4 at this margin. */
        @page { size: auto; margin: 0.2in; }

        @media print {
          .lid-noprint { display: none !important; }

          /* ⚠️ HIDE THE APP. This overlay is portaled to document.body, so it is
             a SIBLING of #root, not a child — and #root comes first in document
             order. Without this the printer gets the deck screen on page 1 and
             the cards after it, which is exactly what Ben's iOS print preview
             showed. The trainer app never hit this because its print sheet was a
             whole route with nothing behind it.
             Safe when closed: this <style> lives inside the portal, so the rule
             only exists while the overlay is open. */
          #root { display: none !important; }

          /* The on-screen fit-to-phone scaling must not follow the sheet onto
             paper — there the cards are already exactly 3.5 × 2.5in. */
          .lid-fit { transform: none !important; width: auto !important; height: auto !important; }

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
        {/* Sticky: an 8-up sheet is several screens tall, and a way out that
            scrolls off the top is a way out only for the first screenful. */}
        <div className="lid-noprint" style={{
          position: "sticky", top: -18, zIndex: 1,
          background: t.base, paddingTop: 18, marginTop: -18,
          maxWidth: 460, margin: "-18px auto 18px", display: "flex",
          flexDirection: "column", gap: 12,
        }}>
          {/* A LABELLED WAY OUT, not just an ✕ in a corner. This overlay covers
              the whole app with a white sheet; the first ✕ here was easy to miss
              against it and Ben had no way back. A back arrow with the word
              "back" next to it is the affordance people actually look for. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <button onClick={onClose} aria-label="Back" style={{
              minHeight: 44, marginLeft: -8, padding: "0 8px",
              display: "flex", alignItems: "center", gap: 6,
              background: "transparent", border: "none",
              color: t.accent, fontSize: 14, cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>arrow_back</span>
              back
            </button>
            <span style={{ fontSize: 15, fontWeight: 600, color: t.white }}>print deck ID</span>
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

        {/* Outer box owns the SCALED height so the page scrolls the right
            amount; the inner box is the sheet at true size, scaled visually. */}
        {/* The outer box is the SCALED size and is what centres; the inner box
            is true size with a top-LEFT origin, so its visual footprint fills
            the outer exactly. Centring the inner instead does not work — a
            transform leaves layout width untouched, so a 672px sheet still
            overflows a 390px phone and drags the centring off with it. */}
        <div className="lid-fit" style={{
          width: sheetW * fit, height: sheetH * fit, margin: "0 auto",
        }}>
          <div
            className="lid-fit"
            style={{
              width: sheetW,
              transform: `scale(${fit})`,
              transformOrigin: "top left",
            }}
          >
            <div className="lid-sheet" style={{
              // One card should not sit in the left cell of an empty 2-wide grid.
              gridTemplateColumns: count === 1 ? "3.5in" : undefined,
            }}>
              {Array.from({ length: count }, (_, i) => (
                <div className="lid-cell" key={i}>
                  <LegendIdCard legend={legend} deck={row} width="3.5in" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
