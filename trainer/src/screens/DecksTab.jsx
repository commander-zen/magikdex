import { useEffect, useState } from "react";
import { aimTheme as t, aimInput, aimBtn } from "../ui/aim.jsx";
import {
  myDecks, saveDeck, clearDeck,
  MAX_DECKS, DECK_NAME_LEN, RATING_MAX, SCRYCHECK_URL,
  deckUrlProblem, scrycheckProblem,
} from "../lib/trainer.js";

// Neutralised for the AIM window: these screens inherit the page sans now.
// Kept as a spread-in object rather than deleted so the ~20 call sites that
// spread it stay untouched.
const mono = {};

// The card's text box: three decks you chose to show.
//
// USER-SELECTED, NOT MOST-RECENT. A card is something you hand a stranger, not a
// log of what you did last. The three you'd actually want someone to see.
//
// The rating is typed by you, with the ScryCheck link right beside it. We do not
// scrape their page and do not call their API: a self-reported number next to a
// working link is verifiable in one tap, and there is nothing to break.
export default function DecksTab({ userId, onChanged }) {
  const [slots, setSlots] = useState(blank());
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [busy, setBusy] = useState(null);   // position currently saving
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const { decks, error } = await myDecks(userId);
      const next = blank();
      for (const d of decks) {
        next[d.position - 1] = {
          name: d.name ?? "", deck_url: d.deck_url ?? "",
          scrycheck_url: d.scrycheck_url ?? "", rating: d.rating ?? "",
          saved: true,
        };
      }
      setSlots(next); setLoadErr(error);
    } catch (e) {
      setLoadErr(e?.message || "couldn't reach the server");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  function patch(i, next) {
    setErr(null);
    setSlots(s => s.map((v, idx) => (idx === i ? { ...v, ...next, dirty: true } : v)));
  }

  async function save(i) {
    const s = slots[i];
    const problems = [deckUrlProblem(s.deck_url), scrycheckProblem(s.scrycheck_url)].filter(Boolean);
    if (!s.name.trim() || problems.length || busy !== null) { if (problems.length) setErr(problems[0]); return; }
    setBusy(i + 1); setErr(null);
    const { error } = await saveDeck(userId, i + 1, {
      name: s.name.trim(),
      // Empty strings become NULL: the columns are nullable and "" is not a URL,
      // and the CHECK on shape would reject it.
      deck_url:      s.deck_url.trim()      || null,
      scrycheck_url: s.scrycheck_url.trim() || null,
      rating:        s.rating.trim()        || null,
    });
    setBusy(null);
    if (error) { setErr(error); return; }
    await load(); onChanged?.();
  }

  async function remove(i) {
    setBusy(i + 1); setErr(null);
    const { error } = await clearDeck(userId, i + 1);
    setBusy(null);
    if (error) { setErr(error); return; }
    await load(); onChanged?.();
  }

  if (loading) return <span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {loadErr && (
        <div style={{ padding: 12, border: `1px solid ${t.red}`, ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>
          {loadErr}
        </div>
      )}

      <Label>your three decks</Label>

      {/* The link out IS the ScryCheck integration. No API, no scraping, no
          permission needed — just traffic to a site worth sending traffic to. */}
      <a href={SCRYCHECK_URL} target="_blank" rel="noopener noreferrer"
         style={{
           ...mono, fontSize: 11, color: t.accent, textDecoration: "none",
           border: `1px solid ${t.muted}`, minHeight: 44,
           display: "flex", alignItems: "center", justifyContent: "center",
         }}>
        grade a deck on scrycheck ↗
      </a>

      {slots.map((s, i) => {
        const urlErr = deckUrlProblem(s.deck_url);
        const scErr  = scrycheckProblem(s.scrycheck_url);
        const saving = busy === i + 1;
        return (
          <div key={i} style={{ border: `1px solid ${t.border}`, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ ...mono, fontSize: 9, letterSpacing: "0.16em", color: t.dim }}>
              SLOT {i + 1}
            </span>

            <input value={s.name} onChange={e => patch(i, { name: e.target.value.slice(0, DECK_NAME_LEN) })}
                   placeholder="deck name" style={input} />
            <input value={s.deck_url} onChange={e => patch(i, { deck_url: e.target.value })}
                   placeholder="moxfield / archidekt / magikdex link"
                   autoCapitalize="off" spellCheck={false}
                   style={{ ...input, borderColor: urlErr ? t.red : t.muted }} />
            <div style={{ display: "flex", gap: 8 }}>
              <input value={s.scrycheck_url} onChange={e => patch(i, { scrycheck_url: e.target.value })}
                     placeholder="scrycheck deck link" autoCapitalize="off" spellCheck={false}
                     style={{ ...input, flex: 2, borderColor: scErr ? t.red : t.muted }} />
              <input value={s.rating} onChange={e => patch(i, { rating: e.target.value.slice(0, RATING_MAX) })}
                     placeholder="rating" style={{ ...input, flex: 1, textAlign: "center" }} />
            </div>
            {(urlErr || scErr) && (
              <span style={{ ...mono, fontSize: 10, color: t.red }}>{urlErr || scErr}</span>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => save(i)}
                      disabled={saving || !s.name.trim() || !!urlErr || !!scErr || !s.dirty}
                      style={btn(true, saving || !s.name.trim() || !!urlErr || !!scErr || !s.dirty)}>
                {saving ? "saving…" : s.dirty ? "save slot" : "saved"}
              </button>
              {s.saved && (
                <button onClick={() => remove(i)} disabled={saving} style={btn(false, saving)}>
                  clear
                </button>
              )}
            </div>
          </div>
        );
      })}

      {err && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>}

      <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.6 }}>
        the rating is yours to type — the scrycheck link next to it is how anyone
        checks it.
      </span>
    </div>
  );
}

function blank() {
  return Array.from({ length: MAX_DECKS }, () => ({
    name: "", deck_url: "", scrycheck_url: "", rating: "", saved: false, dirty: false,
  }));
}

function Label({ children }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: t.dim }}>
      {children}
    </span>
  );
}
const input = aimInput;
const btn = aimBtn;
