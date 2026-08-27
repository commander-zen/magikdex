import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import { SCRYCHECK_URL } from "./ScryCheckRadar.jsx";
import { gradeDeck, isSupportedDeckUrl } from "../lib/scrycheck.js";

// ONE JOB: hand ScryCheck a deck URL and let it grade.
//
// Ben, 2026-08-27: "tapping the radar should only open up an option to drop in
// your moxfield or archidekt URL that would fire to scrycheck." So that is all
// this is now.
//
// ── What used to be here, and where it went ─────────────────────────────────
// MANUAL VECTOR ENTRY — deleted. ScryCheck grades from a URL; a deck that only
//   lives inside magikdex simply stays ungraded, and the card already draws
//   that honestly as em dashes rather than zeroes.
// THE SELF-REPORT (game style / playstyle / plan) — moved to the print sheet,
//   see DeckSelfReport.jsx. It was unfindable four levels deep in here.
//
// A bottom sheet because that is this app's one overlay grammar (SettingsSheet,
// AddLegendSheet) — backdrop, slide-up, a single × dismiss.

export default function ScryCheckSheet({ open, deck, deckName, onClose, onSaved }) {
  const { theme } = useTheme();
  const [deckUrl, setDeckUrl] = useState("");
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState(null);

  const textColor   = theme.white;
  const dimColor    = theme.dim;
  const borderColor = theme.border;
  const accent      = theme.accent;

  // Reload from the deck every time the sheet opens, so an abandoned edit is
  // discarded rather than lingering as a phantom unsaved state.
  useEffect(() => {
    if (!open) return;
    // Clearing stale state when the sheet REOPENS is this rule's legitimate
    // case: without it the box would still hold the previous deck's URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeckUrl(deck?.url ?? "");
    setGradeError(null);
  }, [open, deck]);

  const trimmedUrl = deckUrl.trim();
  const urlProblem = trimmedUrl && !isSupportedDeckUrl(trimmedUrl)
    ? "Moxfield or Archidekt links only"
    : null;
  const canGrade = Boolean(deck?.id) && Boolean(trimmedUrl) && !urlProblem && !grading;

  // One tap: analyse the deck at that URL and write every score back, including
  // the link to its graded page on ScryCheck. The sheet closes on success —
  // there is nothing left to type.
  async function grade() {
    if (!canGrade) return;
    setGrading(true);
    setGradeError(null);
    try {
      const { patch } = await gradeDeck(deck.id, trimmedUrl);
      onSaved?.(patch);
      onClose();
    } catch (err) {
      setGradeError(err.message ?? "grading failed");
    } finally {
      setGrading(false);
    }
  }

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 220,
          background: "rgba(0,0,0,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.28s",
        }}
      />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 221,
        display: "flex", justifyContent: "center",
        transform: open ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        pointerEvents: open ? "auto" : "none",
      }}>
        <div style={{
          width: "100%", maxWidth: 600,
          maxHeight: "80dvh",
          background: theme.base,
          borderTop: `1px solid ${borderColor}`,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}>
          {/* Header — same grammar as the other sheets: an eyebrow and one ×. */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 8px 0 20px",
          }}>
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: dimColor,
            }}>
              scrycheck scores
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 44, height: 44,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", padding: 0,
                color: dimColor, cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 22 }}>close</span>
            </button>
          </div>

          <div style={{
            flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
            padding: "4px 20px 20px",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            {deckName && (
              <div style={{
                fontFamily: "'Zilla Slab', serif",
                fontSize: 16,
                color: textColor,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {deckName}
              </div>
            )}

            {/* ── THE ONE-TAP PATH ──────────────────────────────────────────
                Paste the deck's Moxfield/Archidekt link and ScryCheck grades it
                for you — this is the link Ben asked for, and the reason the
                manual fields below exist at all is that it can't always apply:
                ScryCheck analyses a deck FROM A URL, so a deck that only lives
                inside magikdex has nothing to send. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                htmlFor="sc-deck-url"
                style={{ fontFamily: "'Zilla Slab', serif", fontSize: 14, color: textColor }}
              >
                Deck link
              </label>
              <input
                id="sc-deck-url"
                type="url"
                value={deckUrl}
                onChange={e => { setDeckUrl(e.target.value); setGradeError(null); }}
                placeholder="moxfield.com/decks/… or archidekt.com/decks/…"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "transparent",
                  color: textColor,
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 16, // 16 or iOS zooms the sheet on focus
                  border: "none",
                  borderBottom: `1px solid ${urlProblem ? theme.red : borderColor}`,
                  borderRadius: 0,
                  padding: "8px 0",
                  outline: "none",
                }}
              />
              <button
                onClick={grade}
                disabled={!canGrade}
                style={{
                  minHeight: 44,
                  background: canGrade ? accent : "transparent",
                  color: canGrade ? theme.base : dimColor,
                  border: `1px solid ${canGrade ? accent : borderColor}`,
                  borderRadius: 0,
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                  cursor: canGrade ? "pointer" : "default",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {grading ? "grading…" : "grade with scrycheck"}
              </button>
              <span style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 10, lineHeight: 1.5,
                color: gradeError ? theme.red : dimColor,
              }}>
                {gradeError
                  ?? urlProblem
                  ?? "ScryCheck grades a deck from its Moxfield or Archidekt page — it can't read a list. No link? Type the scores below."}
              </span>
            </div>

            {/* The ScryCheck credit. Migration 034 records that Adam approved
                showing these numbers WITH attribution and a link back, so this
                is a licence term, not decoration — it stays even though the
                manual entry it used to sit under is gone. */}
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 10,
              color: dimColor,
              lineHeight: 1.5,
            }}>
              power level data via{" "}
              <a href={SCRYCHECK_URL} target="_blank" rel="noopener noreferrer"
                 style={{ color: accent, textDecoration: "none" }}>
                ScryCheck ↗
              </a>
              {" "}— scores are self-reported, not verified.
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
