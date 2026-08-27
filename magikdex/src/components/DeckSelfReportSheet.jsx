import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { tokens as t } from "../theme/tokens.js";
import { fetchDeckForLegend } from "../lib/deckSelect.js";
import { resolveLegendDeck } from "../lib/legendDeck.js";
import DeckSelfReport from "./DeckSelfReport.jsx";

// The self-report, opened from an icon in the deck header.
//
// ── Third home, and this one is Ben's choice rather than mine ───────────────
// It started in the ScryCheck sheet (unfindable, four levels deep), then moved
// to the print sheet (findable, but "still not a good spot ... it should live
// in the deck editor page"). Ben picked this shape himself when asked, against
// his own constraint — "i need to ensure that doesnt get cluttered":
//
//   one small icon in the header row, next to the export arrow.
//   Nothing added to the scrolling deck list. Nothing new when it is closed.
//
// A bottom sheet because that is the app's one overlay grammar (SettingsSheet,
// AddLegendSheet, ScryCheckSheet) — backdrop, slide-up, a single dismiss.
//
// ⚠️ It fetches its OWN deck row. ReviewScreen knows only `deckKey`, which is
// session.legend.id — the LEGEND id, not the deck id — the same reason
// LegendIdPrint takes a legendId. Both go through the shared select ladder so a
// half-applied database degrades identically in both places.
export default function DeckSelfReportSheet({ open, onClose, legendId, oracleId, deckName }) {
  const [row, setRow] = useState(null);

  useEffect(() => {
    if (!open || !legendId) return;
    let cancelled = false;
    fetchDeckForLegend(legendId, resolveLegendDeck)
      .then(d => { if (!cancelled) setRow(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, legendId]);

  if (!open) return null;

  return createPortal(
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.65)",
      }} />
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 321,
        display: "flex", justifyContent: "center",
      }}>
        <div style={{
          width: "100%", maxWidth: 460, maxHeight: "88dvh",
          background: t.base, borderTop: `1px solid ${t.muted}`,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Pinned, so the dismiss is reachable however long the list gets. */}
          <div style={{
            flexShrink: 0, display: "flex", alignItems: "center",
            justifyContent: "space-between", padding: "16px 18px 8px",
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: t.white }}>
              play style
            </span>
            <button onClick={onClose} aria-label="Close" style={{
              width: 44, height: 44, margin: "-10px -10px -10px 0",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none",
              color: t.dim, cursor: "pointer", fontSize: 18,
            }}>✕</button>
          </div>

          <div style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            padding: "0 18px calc(env(safe-area-inset-bottom) + 24px)",
          }}>
            <div style={{ fontSize: 12, color: t.dim, lineHeight: 1.6, marginBottom: 14 }}>
              prints under the ScryCheck tag on {deckName ? `${deckName}'s` : "this deck's"} ID card.
            </div>

            {row?.id
              ? <DeckSelfReport deck={row} oracleId={oracleId} theme={t} onSaved={p => setRow(r => ({ ...r, ...p }))} />
              : <div style={{ fontSize: 13, color: t.dim }}>loading…</div>}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
