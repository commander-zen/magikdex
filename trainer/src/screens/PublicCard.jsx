import { useEffect, useState } from "react";
import BadgeCard from "../components/BadgeCard.jsx";
import {
  getPublicCard, getPublicDecks, getPublicLinks,
  getSession, getMyProfile, myBuddies, addBuddy,
} from "../lib/trainer.js";

// /t/<handle> — what a stranger gets after a scan, a link, or the physical card.
// No auth. Renders only what the two public RPCs return.
//
// NOT-FOUND AND PRIVATE ARE IDENTICAL, deliberately. Distinguishing them would
// make this page an oracle for which handles exist.
const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

const page = {
  minHeight: "100dvh", background: "#000",
  display: "flex", flexDirection: "column", alignItems: "center",
  padding: "32px 16px 60px",
};

// The palette this page already used, plus the accent. Kept literal rather than
// imported so the public page stays self-contained — it is the one screen a
// stranger loads, and it should not pull in the app's modules to render.
const INK = "#EDEDED", DIM = "#6B6B6E", MUTED = "#2a3138", ACCENT = "#38bdf8", RED = "#e0555f";

// WHAT HAPPENS AFTER A SCAN — the whole point of the QR, and until now the page
// ended without it. Someone scanned a card, looked at it, and had nothing to tap.
//
// THE LOAD-BEARING FACT: the person scanning almost certainly does NOT have an
// account here. That is the normal case, not the edge case. And the signup path is
// the worst possible thing to hand them at that moment — 028 requires a real email
// account and 027 pins the handle to one change per 30 days, so a stranger would
// have to choose their permanent gamertag while somebody waits for them at a table
// at 11pm. Nobody does that. They say "yeah cool" and close the tab.
//
// So the two paths are deliberately unequal in what they ask:
//
//   HAS A CARD  → one tap. add_buddy, done, no confirmation step.
//   NO ACCOUNT  → ask for NOTHING. They already have what they need — the URL is
//                 in their hands the moment they scan. The job is only to stop it
//                 evaporating into browser history. Share sheet, or copy.
//
// The buddy list is the UPGRADE, never the toll gate. Someone who never signs up
// can still keep the card, still read the Discord and Moxfield on the back, and
// still turn up next Thursday — which is the actual goal. And if they do sign up
// later, add_buddy takes a handle, so the connection closes from either side at
// any time. Nothing has to happen at the table.
function AfterScan({ handle, displayName }) {
  // 'loading' | 'me' | 'buddy' | 'can_add' | 'no_card' | 'anon'
  const [state, setState] = useState("loading");
  const [metCount, setMetCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [shared, setShared] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSession();
        if (cancelled) return;
        if (!s.userId) { setState("anon"); return; }

        const { profile } = await getMyProfile(s.userId);
        if (cancelled) return;
        if (!profile) { setState("no_card"); return; }
        if (profile.handle?.toLowerCase() === handle.toLowerCase()) { setState("me"); return; }

        // Already saved? Asked BEFORE offering the button, because add_buddy is an
        // upsert that bumps met_count — an accidental double tap would silently
        // claim you played someone twice.
        const { buddies } = await myBuddies();
        if (cancelled) return;
        const existing = buddies.find(b => b.handle?.toLowerCase() === handle.toLowerCase());
        if (existing) { setMetCount(existing.met_count ?? 1); setState("buddy"); }
        else setState("can_add");
      } catch {
        // A failure here must not break the card. The card is the product; this
        // block is an affordance on top of it.
        if (!cancelled) setState("anon");
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  async function add() {
    setBusy(true); setErr(null);
    // No venue, no date, no mode — "scan and add in 2 seconds, review later" is the
    // actual behaviour at a table. Everything else is editable on the buddy list
    // afterwards, and add_buddy defaults the date to today server-side.
    const { error } = await addBuddy(handle);
    setBusy(false);
    if (error) { setErr(error); return; }
    setMetCount(c => c + 1);
    setState("buddy");
  }

  // Share sheet where it exists — it is the one control that can put this on a
  // home screen, in Messages, or in someone's notes without an account.
  //
  // ⚠️ IT ALWAYS REVEALS THE URL, whether the copy succeeds or not. An earlier
  // version only attempted share-then-clipboard and swallowed the failure, which
  // made this button DO NOTHING VISIBLE when the clipboard was refused — verified
  // in-browser, `NotAllowedError: Write permission denied`.
  //
  // That is not an exotic case. A QR scan frequently opens inside Instagram's or
  // Discord's in-app browser, where clipboard permissions are restricted, and this
  // is the single most important button in the product for the single most likely
  // visitor. A dead control there is worse than no control, because they tap it,
  // nothing happens, and they conclude the card is broken.
  //
  // So the fallback is not an error message — it is the URL itself, selected and
  // ready to long-press. That works in every browser with no permission at all.
  async function keep() {
    const url = location.href;
    setRevealed(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: `@${handle} — trainer card`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true); setTimeout(() => setShared(false), 1800);
    } catch { /* refused or dismissed — the revealed URL above is the answer */ }
  }

  if (state === "loading" || state === "me") return null;

  return (
    <div style={{
      width: "100%", maxWidth: 340, marginTop: 24,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      {state === "buddy" && (
        <>
          <div style={{
            border: `1px solid ${ACCENT}`, padding: "14px 12px",
            ...mono, fontSize: 12, color: ACCENT, textAlign: "center", lineHeight: 1.7,
          }}>
            ◆ @{handle} is on your buddy list
            {metCount > 1 ? ` · met ${metCount}×` : ""}
          </div>
          {/* Re-adding is a REAL event — met_count means "we played this many
              times" — so it stays available, just not as the primary control. */}
          <button onClick={add} disabled={busy} style={btn(false, busy)}>
            {busy ? "…" : "we played again"}
          </button>
        </>
      )}

      {state === "can_add" && (
        <button onClick={add} disabled={busy} style={btn(true, busy)}>
          {busy ? "adding…" : `add @${handle}`}
        </button>
      )}

      {(state === "anon" || state === "no_card") && (
        <>
          {/* The copy states the true thing first. Someone who just met a stranger
              should not be told they need to sign up to remember them. */}
          <span style={{ ...mono, fontSize: 11, color: INK, lineHeight: 1.75, textAlign: "center" }}>
            you don&rsquo;t need an account to keep this.
          </span>
          <button onClick={keep} style={btn(true, false)}>
            {shared ? "link copied" : `save ${displayName ? displayName : `@${handle}`}`}
          </button>

          {/* The guaranteed path. readOnly so a tap selects the whole thing rather
              than dropping a caret mid-string, and it never depends on a
              permission the browser can refuse. */}
          {revealed && (
            <input
              readOnly
              value={location.href}
              onFocus={e => e.target.select()}
              onClick={e => e.target.select()}
              aria-label="link to this card"
              style={{
                width: "100%", boxSizing: "border-box", minHeight: 44,
                background: "transparent", color: INK, ...mono, fontSize: 11,
                border: `1px solid ${MUTED}`, padding: "0 10px",
                borderRadius: 0, outline: "none", textAlign: "center",
              }}
            />
          )}

          <span style={{ ...mono, fontSize: 10, color: DIM, lineHeight: 1.75, textAlign: "center" }}>
            or <strong>share&nbsp;→ add to home screen</strong>. their discord and
            decks are on the back of the card.
          </span>
          <a href="/" style={{
            ...mono, fontSize: 11, color: DIM, textDecoration: "none",
            border: `1px solid ${MUTED}`, minHeight: 44, marginTop: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {state === "no_card" ? "finish your own card" : "make your own card"}
          </a>
        </>
      )}

      {err && (
        <span style={{ ...mono, fontSize: 11, color: RED, lineHeight: 1.7, textAlign: "center" }}>
          {err}
        </span>
      )}
    </div>
  );
}

const btn = (primary, disabled) => ({
  minHeight: 48, background: "transparent",
  border: `1px solid ${disabled ? MUTED : primary ? ACCENT : DIM}`,
  color: disabled ? DIM : primary ? ACCENT : DIM,
  ...mono, fontSize: 12,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
});

export default function PublicCard({ handle }) {
  const [s, setS] = useState({ loading: true, card: null, decks: [], links: [], error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setS({ loading: true, card: null, decks: [], links: [], error: null });
      try {
        const { card, error } = await getPublicCard(handle);
        if (cancelled) return;
        // Decks and links both live on the BACK, which is one tap away — but they
        // load with the card rather than after it, because a back that pops in
        // half-empty after the flip reads as broken. Fetched in parallel: they are
        // independent, and two round trips in series is a visible wait on a phone
        // in a game store.
        let decks = [], links = [];
        if (card) {
          const [d, l] = await Promise.all([getPublicDecks(handle), getPublicLinks(handle)]);
          decks = d.decks; links = l.links;
        }
        if (!cancelled) setS({ loading: false, card, decks, links, error });
      } catch (e) {
        if (!cancelled) setS({ loading: false, card: null, decks: [], links: [], error: e?.message || "couldn't reach the server" });
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  if (s.loading) return <div style={page}><span style={{ ...mono, fontSize: 12, color: "#6B6B6E" }}>loading…</span></div>;

  if (s.error) {
    return (
      <div style={page}>
        <span style={{ ...mono, fontSize: 12, color: "#e0555f", maxWidth: 340, lineHeight: 1.7, textAlign: "center" }}>
          {s.error}
        </span>
      </div>
    );
  }

  if (!s.card) {
    return (
      <div style={page}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ ...mono, fontSize: 13, color: "#EDEDED" }}>@{handle}</span>
          <span style={{ ...mono, fontSize: 12, color: "#6B6B6E" }}>no card here</span>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <BadgeCard card={s.card} decks={s.decks} links={s.links} />
      <span style={{ ...mono, fontSize: 10, color: "#6B6B6E", marginTop: 20 }}>tap the card to flip it.</span>
      <AfterScan handle={handle} displayName={s.card.display_name} />
    </div>
  );
}
