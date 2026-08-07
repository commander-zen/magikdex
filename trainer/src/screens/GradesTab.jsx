import { useEffect, useState } from "react";
import { t } from "../theme.js";
import {
  myDeckGrades, addDeckGrade, revokeDeckGrade,
  SCRYCHECK_URL, MAX_GRADES, DECK_NAME_MAX, RATING_MAX,
} from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// Deck grades — the badge case on the back of your card.
//
// The only thing on a trainer card that isn't self-description. Everything else
// is what YOU say about you; a grade is a number a tool produced.
//
// SCRYCHECK IS NOT OURS AND WE DON'T CALL IT. You go there, grade a deck, come
// back and record what it said. We send them traffic and never touch their API.
//
// Which makes every badge honestly two facts at once: ScryCheck produced the
// rating, and nobody verified you typed it truthfully. The card states both,
// because kind and method are separate columns. At a kitchen table that is
// plenty — the social contract does the enforcement.
export default function GradesTab({ onChanged }) {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [deck, setDeck] = useState("");
  const [rating, setRating] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  async function load() {
    try {
      const { grades: g, error } = await myDeckGrades();
      setGrades(g); setLoadErr(error);
    } catch (e) {
      setLoadErr(e?.message || "couldn't reach the server");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const full = grades.length >= MAX_GRADES;

  async function add() {
    if (!deck.trim() || !rating.trim() || busy || full) return;
    setBusy(true); setErr(null);
    const { error } = await addDeckGrade(deck, rating);
    setBusy(false);
    if (error) { setErr(error); return; }
    setDeck(""); setRating("");
    await load(); onChanged?.();
  }

  async function revoke(id) {
    setBusy(true); setErr(null);
    const { error } = await revokeDeckGrade(id);
    setBusy(false);
    setConfirmId(null);
    if (error) { setErr(error); return; }
    await load(); onChanged?.();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {loadErr && (
        <div style={{ padding: 12, border: `1px solid ${t.red}`, ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>
          {loadErr}
        </div>
      )}

      <Label>badge case · {grades.length}/{MAX_GRADES}</Label>

      {loading ? (
        <span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span>
      ) : grades.length === 0 ? (
        <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
          nothing graded yet. the badge case is the only part of your card someone
          else had a hand in.
        </span>
      ) : grades.map(g => (
        <div key={g.id} style={{ border: `1px solid ${t.border}`, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ ...mono, fontSize: 13, color: t.white }}>{g.payload?.deck}</span>
              {/* Says who produced the number AND that nobody checked it. Both
                  facts, because a badge that hides the second one is a lie. */}
              <span style={{ ...mono, fontSize: 10, color: t.dim }}>
                {g.issuer} · self-reported · {String(g.issued_at).slice(0, 10)}
              </span>
            </span>
            <span style={{ ...mono, fontSize: 18, color: t.accent, flexShrink: 0 }}>
              {g.payload?.rating}
            </span>
          </div>
          {confirmId === g.id ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ ...mono, fontSize: 11, color: t.white }}>remove it?</span>
              <button onClick={() => revoke(g.id)} disabled={busy} style={small(t.red)}>yes</button>
              <button onClick={() => setConfirmId(null)} disabled={busy} style={small(t.dim)}>keep</button>
            </div>
          ) : (
            <button onClick={() => setConfirmId(g.id)} disabled={busy}
                    style={{ ...small(t.dim), alignSelf: "flex-start" }}>remove</button>
          )}
        </div>
      ))}

      <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <Label>add a grade</Label>

        {/* The link out IS the integration. No API, no scraping, no permission
            needed from them — just traffic. */}
        <a href={SCRYCHECK_URL} target="_blank" rel="noopener noreferrer"
           style={{
             ...mono, fontSize: 12, color: t.accent, textDecoration: "none",
             border: `1px solid ${t.muted}`, minHeight: 46,
             display: "flex", alignItems: "center", justifyContent: "center",
           }}>
          grade a deck on scrycheck ↗
        </a>

        <input value={deck} onChange={e => { setErr(null); setDeck(e.target.value.slice(0, DECK_NAME_MAX)); }}
               placeholder="deck name" disabled={full} style={input(full)} />
        <input value={rating} onChange={e => { setErr(null); setRating(e.target.value.slice(0, RATING_MAX)); }}
               placeholder="what scrycheck said" disabled={full} style={input(full)} />

        <button onClick={add} disabled={busy || full || !deck.trim() || !rating.trim()}
                style={btn(busy || full || !deck.trim() || !rating.trim())}>
          {busy ? "saving…" : full ? `badge case is full — remove one first` : "add to badge case"}
        </button>

        {err && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>}
      </div>
    </div>
  );
}

function Label({ children }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: t.dim }}>
      {children}
    </span>
  );
}
const input = disabled => ({
  width: "100%", boxSizing: "border-box", minHeight: 46,
  background: "transparent", color: t.white, ...mono, fontSize: 13,
  border: `1px solid ${t.muted}`, padding: "0 12px", borderRadius: 0, outline: "none",
  opacity: disabled ? 0.4 : 1,
});
const btn = disabled => ({
  minHeight: 48, background: "transparent",
  border: `1px solid ${disabled ? t.muted : t.accent}`,
  color: disabled ? t.dim : t.accent,
  ...mono, fontSize: 12,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
});
const small = color => ({
  minHeight: 38, padding: "0 12px", background: "transparent",
  border: `1px solid ${color}`, color, ...mono, fontSize: 11, cursor: "pointer",
});
