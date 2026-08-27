import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { PLAN_OTAGS } from "../lib/deckTags.js";

// HOW YOU DESCRIBE THE DECK — game style, playstyle, and the plan (036 + 037).
//
// ── Why it lives in the PRINT sheet ─────────────────────────────────────────
// It started inside the ScryCheck sheet, which was convenient and wrong twice
// over. Ben could not find it (bottom of a sheet reached by Box → swipe to page
// 2 → tap the radar), and then: "tapping the radar should only open up an
// option to drop in your moxfield or archidekt URL". So the radar sheet is now
// exactly that, and this moved here — to the surface where you are already
// looking at the card these three lines print on. You set them at the moment
// you care about them.
//
// ── The split this component embodies ───────────────────────────────────────
// Everything ScryCheck computes (the five vectors, the power level, the
// bracket) arrives from THEIR analysis of your decklist. Everything here is
// YOUR claim about the deck. The printed card keeps the same split — their
// yellow tag, then your lines underneath — and so does the editing.

const MAX = 3;   // mirrors the CHECKs in 036 and 037, and the card's one row

const GAME_STYLES = [
  ["jank", "jank"], ["casual", "casual"],
  ["trash_magic", "trash magic"], ["cedh", "cEDH"],
];

export default function DeckSelfReport({ deck, oracleId, onSaved, theme }) {
  const [gameStyle, setGameStyle] = useState("");
  // ONE list, not two. Ben: "play style and the plan are the same thing in my
  // eyes" — and he is right, it was the same question asked twice. They are
  // still stored in two columns because only an OTAG can match a card and feed
  // the WREC plan tag; an EDHREC theme like "Aristocrats" cannot. That split is
  // an implementation detail and is resolved on save, not shown to the user.
  const [tags, setTags] = useState([]);
  const [query, setQuery] = useState("");
  const [themes, setThemes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const t = theme;

  // Reload from the deck whenever it changes, so an abandoned edit is discarded
  // rather than lingering as a phantom unsaved state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGameStyle(deck?.self_game_style ?? "");
    // Recombined for editing in the order the card prints them: plan first.
    setTags([...(deck?.self_plan ?? []), ...(deck?.self_play_style ?? [])]);
    setQuery(""); setErr(null); setSaved(false);
  }, [deck]);

  // EDHREC's tags for THIS commander, in EDHREC's own rank order — a short
  // relevant list rather than every theme in the game. Suggestions only: 036
  // deliberately does not close the vocabulary, because "chair tribal" is a
  // real answer they will never list.
  useEffect(() => {
    if (!oracleId) return;
    let cancelled = false;
    supabase
      .from("legend_themes")
      .select("theme_name, theme_slug, rank")
      .eq("legend_oracle_id", oracleId)
      .order("rank", { ascending: true })
      .limit(60)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setThemes(data.map(r => r.theme_name || r.theme_slug).filter(Boolean));
      }, () => {});
    return () => { cancelled = true; };
  }, [oracleId]);

  const full = tags.length >= MAX;
  const q = query.trim().toLowerCase();

  // Otags first and flagged, because they do something extra — they tag cards.
  // Themes after, as plain labels. One list, two origins, ranked by usefulness.
  const suggestions = [
    ...PLAN_OTAGS.map(t => ({ value: t, label: t.replace(/-/g, " "), wrec: true })),
    ...themes.map(t => ({ value: t, label: t, wrec: false })),
  ]
    .filter(x => !tags.some(v => v.toLowerCase() === x.value.toLowerCase()))
    .filter(x => !q || x.label.toLowerCase().includes(q))
    .slice(0, 10);

  function add(v) {
    const s = String(v ?? "").trim();
    if (!s || full) return;
    if (tags.some(x => x.toLowerCase() === s.toLowerCase())) { setQuery(""); return; }
    setTags(l => [...l, s]); setQuery("");
  }

  async function save() {
    if (!deck?.id || busy) return;
    setBusy(true); setErr(null);
    // Anything still sitting in a query box counts — nobody expects typed text
    // to evaporate because they hit save instead of enter.
    const all = [...tags, query.trim()].map(v => v.trim()).filter(Boolean).slice(0, MAX);
    // THE SPLIT HAPPENS HERE, once, invisibly: anything that is a real otag goes
    // to self_plan so it can tag cards; everything else is a label and goes to
    // self_play_style. The user picked from one list and never sees this.
    const plan = all.filter(v => PLAN_OTAGS.includes(v));
    const play = all.filter(v => !PLAN_OTAGS.includes(v));
    const patch = {
      self_game_style: gameStyle || null,
      self_play_style: play.length ? play : null,
      self_plan: plan.length ? plan : null,
    };
    const { error } = await supabase.from("decks").update(patch).eq("id", deck.id);
    setBusy(false);
    if (error) {
      // A write to a column PostgREST does not know about returns PGRST204, not
      // Postgres's 42703 — that one is what a SELECT of an unknown column gives.
      const missing = error.code === "PGRST204" || error.code === "42703";
      setErr(missing
        ? "this box is running ahead of its database — migration 036 or 037 hasn't been applied"
        : error.message);
      return;
    }
    setTags([...plan, ...play]); setQuery("");
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    onSaved?.(patch);
  }

  const chip = (on, colour) => ({
    minHeight: 36, padding: "0 10px",
    display: "flex", alignItems: "center", gap: 6,
    background: on ? colour : "transparent",
    border: `1px solid ${on ? colour : t.border}`,
    borderRadius: 0, color: on ? t.base : t.dim,
    fontSize: 13, cursor: "pointer", WebkitTapHighlightColor: "transparent",
  });
  const input = {
    width: "100%", boxSizing: "border-box", minHeight: 44,
    background: "transparent", color: t.white, fontSize: 14,
    border: `1px solid ${t.border}`, borderRadius: 0, padding: "0 12px", outline: "none",
  };
  const cap = { fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: t.dim };
  const help = { fontSize: 11, color: t.dim, lineHeight: 1.5 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={cap}>game style</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {GAME_STYLES.map(([v, lbl]) => (
          // Tapping the active one clears it — a single-value field with no way
          // back to unset is a trap.
          <button key={v} onClick={() => setGameStyle(gameStyle === v ? "" : v)}
                  style={chip(gameStyle === v, t.accent)}>{lbl}</button>
        ))}
      </div>

      <div style={{ ...cap, paddingTop: 6 }}>play style / the plan</div>
      {tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tags.map(v => (
            <button key={v} onClick={() => setTags(l => l.filter(x => x !== v))}
                    aria-label={`Remove ${v}`}
                    style={chip(true, PLAN_OTAGS.includes(v) ? t.red : t.accent)}>
              {v.replace(/-/g, " ")}
              <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
            </button>
          ))}
        </div>
      )}
      {!full && (
        <input value={query} onChange={e => setQuery(e.target.value)}
               onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(query); } }}
               placeholder="reanimate, tokens, landfall…"
               autoCapitalize="off" style={input} />
      )}
      {!full && suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {suggestions.map(x => (
            // Red marks the ones that also tag cards in WREC. The colour is the
            // only hint given — explaining the otag/theme split in the UI would
            // be explaining our storage to someone who asked one question.
            <button key={x.value} onClick={() => add(x.value)}
                    style={chip(false, x.wrec ? t.red : t.accent)}>
              {x.label}
            </button>
          ))}
        </div>
      )}
      <div style={help}>
        up to three. the red ones also tag matching cards as your PLAN in WREC.
      </div>

      <button onClick={save} disabled={busy || !deck?.id}
              style={{
                minHeight: 46, background: "transparent",
                border: `1px solid ${saved ? t.accent : t.muted}`,
                color: saved ? t.accent : t.white,
                fontSize: 14, cursor: busy ? "default" : "pointer",
                borderRadius: 0, opacity: busy ? 0.6 : 1, marginTop: 4,
              }}>
        {busy ? "saving…" : saved ? "saved — reprint to see it" : "save"}
      </button>
      {err && <div style={{ fontSize: 12, color: t.red, lineHeight: 1.5 }}>{err}</div>}
    </div>
  );
}
