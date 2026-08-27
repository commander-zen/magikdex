import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase.js";
import { SCRYCHECK_VECTORS, SCRYCHECK_MAX, SCRYCHECK_URL, readVectors } from "./ScryCheckRadar.jsx";
import { gradeDeck, isSupportedDeckUrl } from "../lib/scrycheck.js";
// The 24 otags with no WREC category of their own — the plan vocabulary.
import { PLAN_OTAGS } from "../lib/deckTags.js";

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

// MAX_PLAY mirrors the CHECK in migration 036. The database is the authority and
// rejects a fourth regardless; this exists so the UI stops you before a round
// trip, and because the cap is really the printed card's one-row line.
const MAX_PLAY = 3;

export default function ScryCheckSheet({ open, deck, deckName, oracleId, onClose, onSaved }) {
  const { theme } = useTheme();
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [deckUrl, setDeckUrl] = useState("");
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState(null);
  // The self-report (036): how YOU describe the deck, as opposed to how
  // ScryCheck scores it.
  const [gameStyle, setGameStyle] = useState("");
  // Chips + a query box rather than one comma-separated string: the values are
  // discrete and the database stores an array, so editing them as text meant
  // re-parsing on every save and hoping the user's commas matched ours.
  const [playList, setPlayList] = useState([]);
  const [playQuery, setPlayQuery] = useState("");
  const [themes, setThemes] = useState([]);
  // The plan (037), as otag slugs. Same shape as playstyle, different source:
  // these must be REAL otags or they can never match a card.
  const [planList, setPlanList] = useState([]);
  const [planQuery, setPlanQuery] = useState("");

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
    setPlayList(deck?.self_play_style ?? []);
    setPlayQuery("");
    setPlanList(deck?.self_plan ?? []);
    setPlanQuery("");
  }, [open, deck]);

  // ── EDHREC's own tags, for THIS commander ───────────────────────────────────
  // Ben: "we should have the information from EDHREC and we can use their tags.
  // its a lot but if we have it be a searchable field ... that is ideal."
  //
  // It is only "a lot" if you offer every theme in the game. legend_themes is
  // keyed by legend oracle id and carries EDHREC's own RANK, so the list here is
  // this commander's themes in the order EDHREC puts them — a short, relevant
  // list rather than 141k rows to search. Suggestions only: 036 deliberately
  // does not constrain the vocabulary, because "chair tribal" is a real answer
  // EDHREC will never list.
  useEffect(() => {
    if (!open || !oracleId) return;
    let cancelled = false;
    supabase
      .from("legend_themes")
      .select("theme_name, theme_slug, rank")
      .eq("legend_oracle_id", oracleId)
      .order("rank", { ascending: true })
      .limit(60)
      .then(({ data }) => {
        if (cancelled || !data) return;
        // theme_name is EDHREC's display text; the slug is the fallback when a
        // row predates the name column being populated.
        setThemes(data.map(r => r.theme_name || r.theme_slug).filter(Boolean));
      }, () => {});
    return () => { cancelled = true; };
  }, [open, oracleId]);

  const planFull = planList.length >= MAX_PLAY;
  const pq = planQuery.trim().toLowerCase();
  const planSuggestions = PLAN_OTAGS
    .filter(t => !planList.includes(t))
    .filter(t => !pq || t.includes(pq))
    .slice(0, 8);
  function addPlan(v) {
    const s = String(v ?? "").trim();
    if (!s || planFull || !PLAN_OTAGS.includes(s)) return;
    if (planList.includes(s)) { setPlanQuery(""); return; }
    setPlanList(l => [...l, s]);
    setPlanQuery("");
  }

  const playFull = playList.length >= MAX_PLAY;
  const q = playQuery.trim().toLowerCase();
  const suggestions = themes
    .filter(t => !playList.some(p => p.toLowerCase() === t.toLowerCase()))
    .filter(t => !q || t.toLowerCase().includes(q))
    .slice(0, 8);

  function addPlay(value) {
    const v = String(value ?? "").trim();
    if (!v || playFull) return;
    if (playList.some(p => p.toLowerCase() === v.toLowerCase())) { setPlayQuery(""); return; }
    setPlayList(list => [...list, v]);
    setPlayQuery("");
  }

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
    // Anything still sitting in the query box counts — nobody expects typed
    // text to evaporate because they hit save instead of enter.
    const play = [...playList, playQuery.trim()]
      .map(v => v.trim()).filter(Boolean).slice(0, MAX_PLAY);
    patch.self_play_style = play.length ? play : null;
    const planned = [...planList, planQuery.trim()]
      .map(v => v.trim()).filter(Boolean)
      // Only real otags survive: a typo here would print on the card and match
      // nothing, which is the one failure this field must not have.
      .filter(v => PLAN_OTAGS.includes(v))
      .slice(0, MAX_PLAY);
    patch.self_plan = planned.length ? planned : null;
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

            {/* ── YOUR OWN READING (036 + 037) ─────────────────────────────────
                FIRST in the sheet, and that placement is the fix for a real
                complaint: Ben could not find where to enter the plan. It was at
                the very bottom, under the five vector inputs and their hint, in
                a sheet reached by Box → swipe to page 2 → tap the radar. Four
                levels deep and below the fold is the same as absent.
                It also reads better this way: what YOU say about the deck comes
                before what ScryCheck computed about it, which is the same order
                the printed card uses — your line under their tag. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace", fontSize: 11,
                letterSpacing: "0.12em", textTransform: "uppercase", color: dimColor,
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

              {/* Chosen playstyles, as removable chips. */}
              {playList.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {playList.map(v => (
                    <button
                      key={v}
                      onClick={() => setPlayList(list => list.filter(x => x !== v))}
                      aria-label={`Remove ${v}`}
                      style={{
                        minHeight: 36, padding: "0 10px",
                        display: "flex", alignItems: "center", gap: 6,
                        background: "transparent",
                        border: `1px solid ${accent}`, borderRadius: 0,
                        color: accent,
                        fontFamily: "'Noto Sans Mono', monospace", fontSize: 12,
                        cursor: "pointer", WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {v}
                      <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
                    </button>
                  ))}
                </div>
              )}

              {!playFull && (
                <input
                  value={playQuery}
                  onChange={e => setPlayQuery(e.target.value)}
                  // Enter commits whatever is typed, which is what makes this a
                  // free-text field and not a closed dropdown.
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPlay(playQuery); } }}
                  placeholder={themes.length ? "search edhrec tags, or type your own" : "graveyard"}
                  autoCapitalize="off"
                  style={{
                    width: "100%", boxSizing: "border-box", minHeight: 44,
                    background: "transparent", color: textColor,
                    fontFamily: "'Noto Sans Mono', monospace", fontSize: 13,
                    border: `1px solid ${borderColor}`, borderRadius: 0,
                    padding: "0 12px", outline: "none",
                  }}
                />
              )}

              {!playFull && suggestions.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {suggestions.map(tName => (
                    <button
                      key={tName}
                      onClick={() => addPlay(tName)}
                      style={{
                        minHeight: 34, padding: "0 10px",
                        background: "transparent",
                        border: `1px solid ${borderColor}`, borderRadius: 0,
                        color: dimColor,
                        fontFamily: "'Noto Sans Mono', monospace", fontSize: 12,
                        cursor: "pointer", WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {tName}
                    </button>
                  ))}
                </div>
              )}

              {/* ── THE PLAN (037) ───────────────────────────────────────────
                  Otags, not free text, and that is the whole point: card_tags
                  already knows which cards carry each otag, so naming the plan
                  here also tells the WREC band which cards are your payoff.
                  A sentence could print but could never do that. */}
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace", fontSize: 11,
                letterSpacing: "0.12em", textTransform: "uppercase", color: dimColor,
                paddingTop: 6,
              }}>
                the plan
              </div>

              {planList.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {planList.map(v => (
                    <button key={v} onClick={() => setPlanList(l => l.filter(x => x !== v))}
                      aria-label={`Remove ${v}`}
                      style={{
                        minHeight: 36, padding: "0 10px",
                        display: "flex", alignItems: "center", gap: 6,
                        background: "transparent", border: `1px solid ${theme.red}`,
                        borderRadius: 0, color: theme.red,
                        fontFamily: "'Noto Sans Mono', monospace", fontSize: 12,
                        cursor: "pointer", WebkitTapHighlightColor: "transparent",
                      }}>
                      {v.replace(/-/g, " ")}
                      <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
                    </button>
                  ))}
                </div>
              )}

              {!planFull && (
                <input
                  value={planQuery}
                  onChange={e => setPlanQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPlan(planQuery.trim()); } }}
                  placeholder="search: reanimate, extra-turn, landfall…"
                  autoCapitalize="off"
                  style={{
                    width: "100%", boxSizing: "border-box", minHeight: 44,
                    background: "transparent", color: textColor,
                    fontFamily: "'Noto Sans Mono', monospace", fontSize: 13,
                    border: `1px solid ${borderColor}`, borderRadius: 0,
                    padding: "0 12px", outline: "none",
                  }}
                />
              )}

              {!planFull && planSuggestions.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {planSuggestions.map(t => (
                    <button key={t} onClick={() => addPlan(t)}
                      style={{
                        minHeight: 34, padding: "0 10px",
                        background: "transparent", border: `1px solid ${borderColor}`,
                        borderRadius: 0, color: dimColor,
                        fontFamily: "'Noto Sans Mono', monospace", fontSize: 12,
                        cursor: "pointer", WebkitTapHighlightColor: "transparent",
                      }}>
                      {t.replace(/-/g, " ")}
                    </button>
                  ))}
                </div>
              )}

              <div style={{
                fontFamily: "'Noto Sans Mono', monospace", fontSize: 10,
                color: dimColor, lineHeight: 1.5,
              }}>
                {planFull
                  ? "three is the limit. tap a chip to remove one."
                  : "prints on the card, and tags matching cards as your PLAN in WREC. pick from the list — a made-up tag would match nothing."}
              </div>

              <div style={{
                fontFamily: "'Noto Sans Mono', monospace", fontSize: 10,
                color: dimColor, lineHeight: 1.5,
              }}>
                {playFull
                  ? `three is the limit — that is the card's line length. tap a chip to remove it.`
                  : themes.length
                    ? `tags from edhrec for this commander, in their order. type anything else and press enter — “chair tribal” is a real answer they will never list.`
                    : `type a playstyle and press enter. up to three.`}
              </div>
            </div>

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
