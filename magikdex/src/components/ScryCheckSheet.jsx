import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase.js";
import { SCRYCHECK_VECTORS, SCRYCHECK_MAX, SCRYCHECK_URL, readVectors } from "./ScryCheckRadar.jsx";
import { gradeDeck, isSupportedDeckUrl } from "../lib/scrycheck.js";

// Manual entry for the five self-reported ScryCheck vectors.
//
// A bottom sheet because that is this app's one overlay grammar (SettingsSheet,
// AddLegendSheet) — backdrop, slide-up, a single × dismiss. There was no
// existing deck-metadata editor to copy: build_name and status are written once
// at import (Brew.jsx) and never edited, so this is the first one.
//
// You grade the deck AT SCRYCHECK and type what you were shown. The link out is
// therefore part of the form, not a footnote: it is the only way to get the
// numbers this form wants.

// The DB stores nothing outside 0–100 (migration 034, one CHECK per column), so
// the form refuses the same range rather than letting the round-trip fail with a
// Postgres error string. Empty is legal and means "not graded" — that is null,
// not zero. Zero is a real ScryCheck reading ("virtually absent").
//
// ⚠️ The error text must never READ THE SAME AS THE HINT. Caught in live
// testing: an over-range value first reported `0–100`, which is character for
// character what the field already says when it is fine. The only difference
// was the colour, so the field looked identical to a working one and the SAVE
// button just went dead with no stated reason.
function parseVector(raw) {
  const v = raw.trim();
  if (v === "") return { value: null, error: null };
  if (!/^\d{1,3}$/.test(v)) return { value: null, error: "whole numbers only" };
  const n = Number(v);
  if (n > SCRYCHECK_MAX) return { value: null, error: `too high — max ${SCRYCHECK_MAX}` };
  return { value: n, error: null };
}

export default function ScryCheckSheet({ open, deck, deckName, onClose, onSaved }) {
  const { theme } = useTheme();
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [deckUrl, setDeckUrl] = useState("");
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState(null);
  // The self-report (036): how YOU describe the deck, as opposed to how
  // ScryCheck scores it. Stored as a comma-separated string while editing —
  // splitting on save is simpler than managing chip state for three values.
  const [gameStyle, setGameStyle] = useState("");
  const [playStyle, setPlayStyle] = useState("");

  const textColor   = theme.white;
  const dimColor    = theme.dim;
  const borderColor = theme.border;
  const accent      = theme.accent;

  // Reload from the deck every time the sheet opens, so an abandoned edit is
  // discarded rather than lingering as a phantom unsaved state.
  useEffect(() => {
    if (!open) return;
    const v = readVectors(deck) ?? {};
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFields(Object.fromEntries(
      SCRYCHECK_VECTORS.map(x => [x.key, v[x.key] === null || v[x.key] === undefined ? "" : String(v[x.key])])
    ));
    setSaveError(null);
    setDeckUrl(deck?.url ?? "");
    setGradeError(null);
    setGameStyle(deck?.self_game_style ?? "");
    setPlayStyle((deck?.self_play_style ?? []).join(", "));
  }, [open, deck]);

  const parsed = Object.fromEntries(
    SCRYCHECK_VECTORS.map(x => [x.key, parseVector(fields[x.key] ?? "")])
  );
  const hasError = SCRYCHECK_VECTORS.some(x => parsed[x.key].error);
  const canSave = Boolean(deck?.id) && !hasError && !busy;

  const trimmedUrl = deckUrl.trim();
  const urlProblem = trimmedUrl && !isSupportedDeckUrl(trimmedUrl)
    ? "Moxfield or Archidekt links only"
    : null;
  const canGrade = Boolean(deck?.id) && Boolean(trimmedUrl) && !urlProblem && !grading && !busy;

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

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setSaveError(null);
    const patch = Object.fromEntries(
      SCRYCHECK_VECTORS.map(x => [x.column, parsed[x.key].value])
    );
    // 036's two columns ride along on the same save. Capped at three to match
    // the CHECK — and to match the card, which has one row for this line.
    patch.self_game_style = gameStyle || null;
    const play = playStyle.split(",").map(v => v.trim()).filter(Boolean).slice(0, 3);
    patch.self_play_style = play.length ? play : null;
    const { error } = await supabase.from("decks").update(patch).eq("id", deck.id);
    setBusy(false);
    if (error) {
      // NEVER swallow a failure on a primary control. A save button that does
      // nothing on tap reads as a broken app, and the row would silently keep
      // the old numbers while the radar showed the new ones.
      // ⚠️ A WRITE to a column PostgREST doesn't know about comes back as
      // PGRST204 ("could not find the column ... in the schema cache"), NOT as
      // Postgres's 42703 — that one is what a SELECT of an unknown column
      // returns. Verified live against the hosted project before 034 was
      // applied; the first version of this mapping only checked 42703 and
      // leaked the raw schema-cache string to the user. Both are matched here
      // because the two paths genuinely return different codes for the same
      // underlying cause.
      const missingColumn = error.code === "PGRST204" || error.code === "42703";
      setSaveError(
        missingColumn
          ? "this box is running ahead of its database — migration 034 or 036 hasn't been applied yet"
          : error.code === "23514"
            ? `every score has to be 0–${SCRYCHECK_MAX}`
            : error.message
      );
      return;
    }
    onSaved?.(patch);
    onClose();
  }

  // Clearing is the way back to ungraded. Without it a mistyped grading would be
  // permanent, since blanking the inputs and saving is exactly this — the
  // button just makes it findable.
  function clearAll() {
    setFields(Object.fromEntries(SCRYCHECK_VECTORS.map(x => [x.key, ""])));
    setSaveError(null);
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

            <div style={{
              borderTop: `1px solid ${borderColor}`,
              paddingTop: 12,
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 10, letterSpacing: "0.14em",
              color: dimColor,
            }}>
              OR ENTER THEM YOURSELF
            </div>

            {/* Grade on the site by hand, then type what you were shown. */}
            <a
              href={SCRYCHECK_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                minHeight: 44,
                display: "flex", alignItems: "center",
                borderBottom: `1px solid ${borderColor}`,
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, letterSpacing: "0.06em",
                color: accent,
                textDecoration: "none",
              }}
            >
              open scrycheck.com ↗
            </a>

            {SCRYCHECK_VECTORS.map(v => {
              const err = parsed[v.key].error;
              return (
                <div key={v.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{
                    display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10,
                  }}>
                    <label
                      htmlFor={`sc-${v.key}`}
                      style={{
                        fontFamily: "'Zilla Slab', serif",
                        fontSize: 14,
                        color: textColor,
                      }}
                    >
                      {v.full}
                    </label>
                    <span style={{
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 9, letterSpacing: "0.08em",
                      color: err ? theme.red : dimColor,
                      flexShrink: 0,
                    }}>
                      {err ?? `0–${SCRYCHECK_MAX}`}
                    </span>
                  </div>
                  <input
                    id={`sc-${v.key}`}
                    type="text"
                    // Numeric keypad without type="number": that type brings
                    // spinners, accepts "1e3", and on iOS silently drops the
                    // value when it can't parse — none of which a 0–100 field
                    // wants. The regex in parseVector is the real gate.
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={3}
                    value={fields[v.key] ?? ""}
                    onChange={e => setFields(f => ({ ...f, [v.key]: e.target.value }))}
                    placeholder="—"
                    autoComplete="off" autoCorrect="off" spellCheck={false}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "transparent",
                      color: textColor,
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 16, // 16 or iOS zooms the whole sheet on focus
                      border: "none",
                      borderBottom: `1px solid ${err ? theme.red : borderColor}`,
                      borderRadius: 0,
                      padding: "8px 0",
                      outline: "none",
                    }}
                  />
                  <span style={{
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 10,
                    color: dimColor,
                  }}>
                    {v.hint}
                  </span>
                </div>
              );
            })}

            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 10,
              color: dimColor,
              lineHeight: 1.5,
            }}>
              leave a field blank for “not graded”. the radar draws only when all
              five are filled — a missing vertex would read as a zero, and zero is
              a real score.
            </div>

            {/* ── YOUR OWN READING (036) ───────────────────────────────────────
                Deliberately below the vectors and visibly separate: everything
                above is ScryCheck's computed analysis, this is the owner's claim
                about how the deck actually plays. The printed ID card keeps the
                same split — their tag, then your line. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace", fontSize: 11,
                letterSpacing: "0.12em", textTransform: "uppercase", color: dimColor,
                borderTop: `1px solid ${borderColor}`, paddingTop: 14,
              }}>
                your own read
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[["jank", "jank"], ["casual", "casual"], ["trash_magic", "trash magic"], ["cedh", "cEDH"]].map(([v, lbl]) => {
                  const on = gameStyle === v;
                  return (
                    <button
                      key={v}
                      // Tapping the active one clears it — a single-value field
                      // with no way back to "unset" is a trap.
                      onClick={() => setGameStyle(on ? "" : v)}
                      style={{
                        minHeight: 40, padding: "0 14px",
                        background: on ? accent : "transparent",
                        border: `1px solid ${on ? accent : borderColor}`,
                        borderRadius: 0,
                        color: on ? theme.base : dimColor,
                        fontFamily: "'Noto Sans Mono', monospace", fontSize: 12,
                        cursor: "pointer", WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>

              <input
                value={playStyle}
                onChange={e => setPlayStyle(e.target.value)}
                placeholder="graveyard, combo"
                autoCapitalize="off"
                style={{
                  width: "100%", boxSizing: "border-box", minHeight: 44,
                  background: "transparent", color: textColor,
                  fontFamily: "'Noto Sans Mono', monospace", fontSize: 13,
                  border: `1px solid ${borderColor}`, borderRadius: 0,
                  padding: "0 12px", outline: "none",
                }}
              />
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace", fontSize: 10,
                color: dimColor, lineHeight: 1.5,
              }}>
                {/* Free text on purpose — the vocabulary of Commander playstyles
                    is not ours to close. Three is the card's line length. */}
                comma separated, up to three. free text — “lands matter” and
                “chair tribal” are both real answers.
              </div>
            </div>

            {saveError && (
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 11,
                color: theme.red,
                lineHeight: 1.5,
              }}>
                {saveError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={clearAll}
                disabled={busy}
                style={{
                  flex: "0 0 auto", minHeight: 44, padding: "0 14px",
                  background: "transparent",
                  border: `1px solid ${borderColor}`,
                  borderRadius: 0,
                  color: dimColor,
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                  cursor: busy ? "default" : "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                clear
              </button>
              <button
                onClick={save}
                disabled={!canSave}
                style={{
                  flex: 1, minHeight: 44,
                  background: canSave ? textColor : "transparent",
                  color: canSave ? theme.base : dimColor,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 0,
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                  cursor: canSave ? "pointer" : "default",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {busy ? "saving…" : "save"}
              </button>
            </div>

            {/* Attribution again, here, because this sheet is where the numbers
                are entered and the credit belongs next to the claim. */}
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
