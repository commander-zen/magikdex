import { useEffect, useRef, useState } from "react";
import { Window, Field, Slashed, bevel, INK, SUBTLE } from "../ui/aim.jsx";
import { myBuddies, updateMyProfile, READY_NOTE_MAX } from "../lib/trainer.js";

// RITUAL, signed in — the swipeable stack.
//
// Ben: "then i see these as swipe-able cards once a user is signed in."
//
// So that is what this is: one horizontal rail of AIM windows, one card per
// surface, snapped. Not tabs. Tabs were the old two-destination model and they
// are why the app looked like a settings screen with a card in it.
//
// ── Native scroll-snap, not a carousel library ───────────────────────────────
// A rail with `scroll-snap-type: x mandatory` is a real scroller: it takes touch
// swipes, trackpad swipes, keyboard, and a screen reader's focus order for free,
// and it cannot get out of sync with its own index the way a hand-rolled
// transform carousel does. The dots below read the scroll position rather than
// owning it, so the scroller stays the single source of truth.

const railStyle = {
  display: "flex",
  overflowX: "auto",
  scrollSnapType: "x mandatory",
  gap: 14,
  // Momentum on iOS, and no visible bar on desktop — the dots are the affordance.
  WebkitOverflowScrolling: "touch",
  scrollbarWidth: "none",
  padding: "0 4px 6px",
};

const slideStyle = {
  flex: "0 0 100%",
  scrollSnapAlign: "center",
  scrollSnapStop: "always",
  minWidth: 0,
};

// The mock reads "casual // trash magic // cEDH". The vocabularies are stored
// snake_case (PHILOSOPHY_CHOICES / PLAYSTYLE_CHOICES in trainer.js, mirroring the
// CHECK constraints in 025), so the underscore swap gets most of it — but cEDH is
// a proper noun with a lowercase c and no naive transform produces it.
const SPECIAL = { cedh: "cEDH", plus_one_counters: "+1/+1 counters" };
const label = (s) => SPECIAL[s] ?? String(s ?? "").replace(/_/g, " ");

export default function RitualDeck({ profile, decks, onOpenSettings, onManageBuddies, onSaved, banner }) {
  const rail = useRef(null);
  const [i, setI] = useState(0);
  const [buddies, setBuddies] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { buddies: b } = await myBuddies();
      if (!cancelled) setBuddies(b ?? []);
    })();
    return () => { cancelled = true; };
  }, []);

  // The dots follow the rail rather than driving it. Reading the index off
  // scrollLeft means a swipe, a keyboard scroll and a dot tap all end up in the
  // same place with no state to reconcile.
  function onScroll() {
    const el = rail.current;
    if (!el) return;
    const w = el.clientWidth + 14;
    setI(Math.round(el.scrollLeft / w));
  }

  function go(n) {
    const el = rail.current;
    if (!el) return;
    el.scrollTo({ left: n * (el.clientWidth + 14), behavior: "smooth" });
  }

  const cards = [
    { key: "player", node: <PlayerId profile={profile} decks={decks} onSaved={onSaved} /> },
    ...decks.map((d, n) => ({ key: `deck-${n}`, node: <CommanderId deck={d} /> })),
    { key: "buddies", node: <Buddies buddies={buddies} onManage={onManageBuddies} /> },
    { key: "lgs", node: <Lgs /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100dvh", padding: "14px 0 10px", boxSizing: "border-box" }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", flex: "none" }}>
        <span style={{ fontFamily: "'UnifrakturMaguntia', serif", fontSize: 26, color: "#e8eaed" }}>Ritual</span>
        <button onClick={onOpenSettings} aria-label="Settings" style={{
          width: 44, height: 44, background: "transparent", border: "none",
          color: "#e8eaed99", cursor: "pointer", fontSize: 19, marginRight: -10,
        }}>⚙</button>
      </div>

      {/* Transient prompts (a parked scan) sit above the rail rather than on a
          card — they are about the session, not about any one surface. */}
      {banner && <div style={{ padding: "0 14px", flex: "none" }}>{banner}</div>}

      <div ref={rail} onScroll={onScroll} style={{ ...railStyle, flex: 1, minHeight: 0 }}>
        {cards.map(c => (
          <div key={c.key} style={slideStyle}>{c.node}</div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flex: "none" }}>
        {cards.map((c, n) => (
          <button key={c.key} onClick={() => go(n)} aria-label={`card ${n + 1}`} style={{
            width: 9, height: 9, padding: 0, borderRadius: 9, cursor: "pointer",
            background: n === i ? "#e8eaed" : "transparent",
            border: `1px solid ${n === i ? "#e8eaed" : "#5a6672"}`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ── player-id ritual ─────────────────────────────────────────────────────────
function PlayerId({ profile, decks, onSaved }) {
  return (
    <Window title={`@${profile.handle}`}>
      <Field label="game style:">
        <Slashed items={(profile.philosophy ?? []).map(label)} empty="not set yet" />
      </Field>
      <Field label="play style:">
        <Slashed items={(profile.playstyle ?? []).map(label)} empty="not set yet" />
      </Field>
      <Field label="legends:">
        {decks.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {decks.map((d, n) => <div key={n}>{d.name}</div>)}
          </div>
        ) : <span style={{ color: SUBTLE }}>no decks yet</span>}
      </Field>

      <ReadyRow profile={profile} onSaved={onSaved} />
    </Window>
  );
}

// "ready to pod up" — a fact about you RIGHT NOW, so it lives on your own card
// rather than behind the gear. It is manual and never expires: anything that
// cleared it automatically would have to know when you were last active, and
// that is a presence system, which this schema has spent four migrations
// refusing to build. It is also what fills the (ready/total) counts on the
// buddy list, so it is load-bearing, not a toy.
function ReadyRow({ profile, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(profile.ready_note ?? "");
  const on = !!profile.ready_to_pod;

  async function write(patch) {
    setBusy(true);
    const { error } = await updateMyProfile(profile.id, patch);
    setBusy(false);
    if (!error) onSaved?.();
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => write({ ready_to_pod: !on })} disabled={busy}
        style={{ ...bevel, width: "100%", padding: "10px 14px", font: "inherit", fontSize: 15,
                 color: INK, cursor: busy ? "default" : "pointer",
                 justifyContent: "space-between", opacity: busy ? 0.6 : 1 }}>
        <span>{on ? "◆ ready to pod up" : "◇ not right now"}</span>
        <span style={{ color: SUBTLE, fontSize: 13 }}>{on ? "tap to turn off" : "tap to turn on"}</span>
      </button>

      {on && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input value={note} onChange={e => setNote(e.target.value.slice(0, READY_NOTE_MAX))}
            placeholder="looking for: cEDH · casual only tonight"
            style={{ flex: 1, minWidth: 0, minHeight: 40, boxSizing: "border-box",
                     border: `2px solid ${INK}`, borderRadius: 8, padding: "0 10px",
                     font: "inherit", fontSize: 14, background: "#fff", color: INK }} />
          {note !== (profile.ready_note ?? "") && (
            <button onClick={() => write({ ready_note: note.trim() || null })} disabled={busy}
              style={{ ...bevel, padding: "0 14px", font: "inherit", fontSize: 14, color: INK, cursor: "pointer" }}>
              save
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── commander-id ritual ──────────────────────────────────────────────────────
// The lightweight ScryCheck summary.
//
// ⚠️ THE FIVE BARS CANNOT BE FILLED FROM THIS APP YET, and drawing them at zero
// would be a lie. The vectors live on magikdex's public.decks (migration 034);
// trainer.deck holds only name, the two URLs and the overall rating. Reading
// them here needs an RPC and a migration, not a client change. Until then a
// vector reads "—", which is the same rule the radar and the printed card
// follow: null means NOT GRADED and is a different fact from zero.
const VECTORS = ["speed", "consistency", "threats", "mana base", "interaction"];

function CommanderId({ deck }) {
  return (
    <Window title={deck.name}>
      {deck.rating && (
        <div style={{ ...bevel, padding: "8px 14px", marginBottom: 16, justifyContent: "space-between" }}>
          <span style={{ fontSize: 15 }}>scrycheck power level</span>
          <strong style={{ fontSize: 20 }}>{deck.rating}</strong>
        </div>
      )}

      <div style={{ fontSize: 15, color: INK, marginBottom: 8, borderBottom: `2px solid ${INK}`, paddingBottom: 6 }}>
        play profile
      </div>

      {VECTORS.map(v => (
        <div key={v} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
          <span style={{ flex: "0 0 108px", fontSize: 13, textTransform: "uppercase" }}>{v}</span>
          <span style={{ flex: 1, height: 12, background: "#e1dacb" }} />
          <span style={{ flex: "0 0 30px", textAlign: "right", fontSize: 15, color: SUBTLE }}>—</span>
        </div>
      ))}

      <p style={{ fontSize: 13, color: SUBTLE, lineHeight: 1.6, marginTop: 14 }}>
        the five vectors live on magikdex, not here yet — needs a migration to read across.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        {deck.deck_url && <A href={deck.deck_url}>decklist ↗</A>}
        {deck.scrycheck_url && <A href={deck.scrycheck_url}>scrycheck ↗</A>}
      </div>
    </Window>
  );
}

const A = ({ href, children }) => (
  <a href={href} target="_blank" rel="noreferrer noopener"
     style={{ ...bevel, padding: "8px 14px", fontSize: 14, color: INK, textDecoration: "none" }}>
    {children}
  </a>
);

// ── buddy list ───────────────────────────────────────────────────────────────
// Grouped the way the mock groups them, on REAL data: met_venue is the group,
// and the count is (ready to pod / total) — which is exactly AIM's online/total,
// and the only "who is around" signal this schema has. ready_to_pod is manual
// and never expires, so this is a claim the person made, not presence inferred
// from activity. That distinction is the whole reason there is no presence
// system here.
function Buddies({ buddies, onManage }) {
  const groups = new Map();
  for (const b of buddies) {
    const g = b.met_venue?.trim() || (b.met_mode === "online" ? "online" : "IRL");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(b);
  }

  return (
    <Window title="buddy list" footer={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span style={{ fontSize: 13, color: SUBTLE }}>
          {buddies.length} {buddies.length === 1 ? "buddy" : "buddies"}
        </span>
        {/* Adding by handle, notes, removing and blocking all still live in the
            full list. This card is the AIM VIEW of it, not a replacement. */}
        <button onClick={onManage} style={{ background: "transparent", border: "none", font: "inherit", fontSize: 14, color: INK, cursor: "pointer", textDecoration: "underline" }}>
          manage
        </button>
      </div>
    }>
      {!buddies.length && (
        <p style={{ fontSize: 15, color: SUBTLE, lineHeight: 1.6 }}>
          nobody yet. scan someone&rsquo;s card after a game and they land here.
        </p>
      )}

      {[...groups.entries()].map(([name, list]) => {
        const ready = list.filter(b => b.ready_to_pod).length;
        return (
          <div key={name} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 15, color: INK, marginBottom: 4 }}>
              &gt; {name} <span style={{ color: SUBTLE }}>({ready}/{list.length})</span>
            </div>
            {list.map(b => (
              <div key={b.handle} style={{ paddingLeft: 22, fontSize: 16, lineHeight: 1.5, color: b.ready_to_pod ? INK : SUBTLE }}>
                {b.ready_to_pod ? "◆ " : ""}{b.handle}
                {b.met_count > 1 && <span style={{ color: SUBTLE, fontSize: 13 }}> · {b.met_count}×</span>}
              </div>
            ))}
          </div>
        );
      })}
    </Window>
  );
}

// ── LGS ──────────────────────────────────────────────────────────────────────
// Ben's "LGS Yelp", built to the mock's shape but honest about having no data.
//
// ⚠️ NOT A REVIEW SITE, and the name is the only part importing that baggage.
// Ben was explicit: he does not want to star-rate stores. He wants two
// verifiable facts — does this store run a night for a format, and when. The
// chips are a VERIFICATION STATE, not a score, which is what keeps this clear of
// the standing "no aggregate score, rank or power level anywhere" rule.
//
// No schema exists. Rather than invent store rows, this shows the real structure
// with an empty state — fabricating "Game Universe · Success" would be inventing
// a fact about a real business.
const CHIPS = [
  ["confirmed", "#dff3e4", "#1e7a3c"],
  ["needs a check", "#dde9fb", "#1e4f8a"],
  ["unconfirmed", "#fdf2d0", "#8a6a10"],
];

function Lgs() {
  return (
    <Window title="local game stores">
      <p style={{ fontSize: 15, color: INK, lineHeight: 1.6, marginBottom: 14 }}>
        two facts per store: does it run a night for your format, and when.
        no stars, no reviews.
      </p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {CHIPS.map(([text, bg, fg]) => (
          <span key={text} style={{
            background: bg, color: fg, border: `1px solid ${fg}33`,
            borderRadius: 5, padding: "3px 9px", fontSize: 12,
          }}>{text}</span>
        ))}
      </div>

      <p style={{ fontSize: 14, color: SUBTLE, lineHeight: 1.6 }}>
        no stores yet — this needs a table and a way to confirm a night without
        turning it into a rating. that is the next decision, not the next commit.
      </p>
    </Window>
  );
}
