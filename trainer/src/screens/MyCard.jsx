import { useEffect, useState } from "react";
import { t } from "../theme.js";
import { supabase } from "../lib/supabase.js";
import BadgeCard from "../components/BadgeCard.jsx";
import BuddyList from "./BuddyList.jsx";
import SettingsSheet from "./SettingsSheet.jsx";
import { Segmented } from "./CardFields.jsx";
import {
  getSession, getMyProfile, claimHandle, myDecks, myLinks, updateMyProfile,
  normalizeHandle, handleProblem, readyNoteProblem, READY_NOTE_MAX,
} from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// TWO SURFACES AND A GEAR.
//
// You open this app to look at your card or to look at your people. Everything
// else — editing fields, listing decks, privacy, signing out — is configuration,
// and configuration goes behind the gear. Four peer tabs implied four
// destinations of equal standing; two of them were things you look at and two were
// things you set up once.
//
// EMAIL-ONLY SIGN-IN. Migration 028 enforces the same rule in the database, so
// this is the UI agreeing with the schema rather than guarding it: 027 reserves a
// released screen name forever, so one claimed from a browser-only account would
// be permanently consumed by an account nobody can sign into.
//
// A code, not a magic link — links bounce out of an installed PWA into the
// default browser and land the session in the wrong storage context.
export default function MyCard() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [decks, setDecks] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState("card");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState(null);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function refresh() {
    // try/finally so `loading` ALWAYS clears — a thrown failure must never leave
    // a spinner with no explanation and no way out.
    try {
      const s = await getSession();
      setSession(s);
      if (s.userId) {
        const { profile: p, error } = await getMyProfile(s.userId);
        setProfile(p);
        setLoadErr(error);
        // Decks and links both render on the card's BACK, so the card is not
        // complete without them — they load with it, not after. In parallel:
        // they are independent reads and serialising them is a visible wait.
        if (p) {
          const [d, l] = await Promise.all([myDecks(s.userId), myLinks(s.userId)]);
          setDecks(d.decks); setLinks(l.links);
        }
      } else {
        setProfile(null);
      }
    } catch (e) {
      setLoadErr(e?.message || "couldn't reach the server — check your connection");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());
    return () => sub.subscription.unsubscribe();
  }, []);

  async function sendCode() {
    const addr = email.trim();
    if (!addr || busy) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ email: addr });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setSent(true); setCode(""); setMsg("code sent — check your email");
  }

  async function verify() {
    if (code.trim().length < 6 || busy) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) {
      setMsg(error.code === "otp_expired" ? "that code expired — send a fresh one"
                                          : "that code didn't match — check the digits");
      return;
    }
    setSent(false); setCode(""); setMsg(null);
  }

  async function submitClaim() {
    const h = normalizeHandle(handle);
    if (handleProblem(h) || busy || !session?.userId) return;
    setBusy(true); setErr(null);
    const { profile: p, error } = await claimHandle(session.userId, h, displayName);
    if (error) {
      // A unique violation might mean somebody else has it — or that it is
      // already YOURS and this form should not have been on screen. Re-read
      // before believing the error; a real collision still surfaces, because the
      // re-read comes back empty.
      const { profile: existing } = await getMyProfile(session.userId);
      setBusy(false);
      if (existing) { setProfile(existing); setErr(null); return; }
      setErr(error); return;
    }
    setBusy(false); setProfile(p);
  }

  const normalized = normalizeHandle(handle);
  const problem = normalized ? handleProblem(normalized) : null;

  return (
    <div style={{ minHeight: "100dvh", background: t.base, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 460, padding: "22px 20px 44px", display: "flex", flexDirection: "column", gap: 16 }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: t.dim }}>
            trainer
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {profile && <span style={{ ...mono, fontSize: 11, color: t.accent }}>@{profile.handle}</span>}
            {session?.userId && (
              <button onClick={() => setSettingsOpen(true)} aria-label="Settings" style={{
                width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", padding: 0, marginRight: -10,
                color: `${t.white}80`, cursor: "pointer", fontSize: 19,
              }}>⚙</button>
            )}
          </div>
        </div>

        {loadErr && (
          <div style={{ padding: 12, border: `1px solid ${t.red}`, ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>
            {loadErr}
          </div>
        )}

        {loading ? (
          <span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span>

        ) : !session?.userId ? (
          <SignIn {...{ email, setEmail, code, setCode, sent, setSent, msg, setMsg, busy, sendCode, verify }} />

        ) : !profile ? (
          <Claim {...{ handle, setHandle, displayName, setDisplayName, normalized, problem, busy, submitClaim, err, setErr }} />

        ) : (
          <>
            <Segmented
              value={tab}
              options={[["card", "CARD"], ["buddies", "BUDDIES"]]}
              onChange={setTab}
            />

            {tab === "card" ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <BadgeCard card={profile} decks={decks} links={links} />
                <span style={{ ...mono, fontSize: 10, color: t.dim }}>
                  {location.host}/t/{profile.handle}
                </span>
                <ReadyToggle profile={profile} onSaved={refresh} />
              </div>
            ) : (
              <BuddyList />
            )}
          </>
        )}
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        profile={profile}
        session={session}
        // Re-read rather than trusting the patch we sent: the database may have
        // normalised or rejected part of it, and the decks may have changed too.
        onSaved={() => refresh()}
      />
    </div>
  );
}

// "ready to pod up" — ON THE CARD TAB, NOT BEHIND THE GEAR.
//
// The gear holds things you set up once. This is the opposite: a two-second
// answer about tonight, flipped while you are packing up, and burying it three
// taps deep would mean nobody ever turns it on — or worse, nobody ever turns it
// off. It sits under the card because it is a fact about you right now, the same
// way the card is.
//
// SAVES IMMEDIATELY, no draft and no save button. Matching the CommanderPicker
// rather than the CardFields form: a toggle whose effect you can see has nothing
// to confirm.
//
// IT NEVER EXPIRES ON ITS OWN. No timeout, no last-seen, no background job —
// anything that clears this automatically has to know when you were last active,
// and that is a presence system. So the honest copy says how it actually behaves
// ("stays on until you turn it off") instead of implying it lapses tonight.
function ReadyToggle({ profile, onSaved }) {
  const [note, setNote] = useState(profile.ready_note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const on = !!profile.ready_to_pod;
  const noteErr = readyNoteProblem(note);
  const noteDirty = note !== (profile.ready_note ?? "");

  async function write(patch) {
    setBusy(true); setErr(null);
    const { profile: p, error } = await updateMyProfile(profile.id, patch);
    setBusy(false);
    if (error) { setErr(error); return; }
    onSaved?.(p);
  }

  return (
    <div style={{
      width: "100%", border: `1px solid ${on ? t.accent : t.border}`,
      padding: 12, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <button
        onClick={() => write({ ready_to_pod: !on })}
        disabled={busy}
        aria-pressed={on}
        style={{
          minHeight: 46, background: "transparent",
          border: `1px solid ${busy ? t.muted : on ? t.accent : t.dim}`,
          color: busy ? t.dim : on ? t.accent : t.white,
          ...mono, fontSize: 12, cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.55 : 1,
        }}
      >
        {busy ? "…" : on ? "◆ ready to pod up" : "◇ not right now"}
      </button>

      {/* Free text, deliberately. A dropdown of formats would be matchable, and
          matchable is one step from ranked — which is the thing this product has
          removed twice already. */}
      {on && (
        <>
          <input
            value={note}
            onChange={e => { setErr(null); setNote(e.target.value.slice(0, READY_NOTE_MAX)); }}
            placeholder="looking for: cEDH · casual only tonight"
            style={{
              width: "100%", boxSizing: "border-box", minHeight: 44,
              background: "transparent", color: t.white, ...mono, fontSize: 12,
              border: `1px solid ${noteErr ? t.red : t.muted}`,
              padding: "0 12px", borderRadius: 0, outline: "none",
            }}
          />
          {noteErr && <span style={{ ...mono, fontSize: 10, color: t.red }}>{noteErr}</span>}
          {noteDirty && !noteErr && (
            <button onClick={() => write({ ready_note: note.trim() || null })} disabled={busy}
                    style={btn(true, busy)}>save note</button>
          )}
        </>
      )}

      <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.6 }}>
        {on
          ? "shows on your card and to your buddies. stays on until you turn it off."
          : "flip this when you're up for a game."}
      </span>
      {err && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>}
    </div>
  );
}

function SignIn({ email, setEmail, code, setCode, sent, setSent, msg, setMsg, busy, sendCode, verify }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 14, lineHeight: 1.65, color: t.white }}>
        your trainer card is a screen name other players can look up. sign in with
        an email to claim one.
      </span>
      {!sent ? (
        <>
          <input type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)}
                 autoCapitalize="off" spellCheck={false} autoComplete="email" style={input} />
          <button onClick={sendCode} disabled={busy || !email.trim()} style={btn(true, busy || !email.trim())}>
            {busy ? "sending…" : "send me a code"}
          </button>
        </>
      ) : (
        <>
          <input inputMode="numeric" autoComplete="one-time-code" placeholder="code" value={code}
                 onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                 style={{ ...input, fontSize: 20, letterSpacing: "0.4em", textAlign: "center" }} />
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={verify} disabled={busy || code.trim().length < 6}
                    style={btn(true, busy || code.trim().length < 6)}>verify</button>
            <button onClick={() => { setSent(false); setMsg(null); }} disabled={busy}
                    style={btn(false, busy)}>use another email</button>
          </div>
        </>
      )}
      {msg && <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>{msg}</span>}
    </div>
  );
}

function Claim({ handle, setHandle, displayName, setDisplayName, normalized, problem, busy, submitClaim, err, setErr }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 14, lineHeight: 1.65, color: t.white }}>
        pick your screen name. it&rsquo;s how other players look you up.
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...mono, fontSize: 16, color: t.dim }}>@</span>
        <input value={handle} onChange={e => { setErr(null); setHandle(normalizeHandle(e.target.value)); }}
               placeholder="screen name" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={input} />
      </div>
      <span style={{ ...mono, fontSize: 11, color: problem ? t.red : t.dim }}>
        {problem ? problem
          : normalized ? `${location.host}/t/${normalized}`
          : "3–20 characters: letters, numbers, _"}
      </span>
      <input value={displayName} onChange={e => setDisplayName(e.target.value.slice(0, 40))}
             placeholder="display name (optional)" style={input} />
      <button onClick={submitClaim} disabled={busy || !!problem || !normalized}
              style={btn(true, busy || !!problem || !normalized)}>
        {busy ? "claiming…" : "claim it"}
      </button>
      {/* One of only two pieces of standing help in the app. It survives because
          the rule is genuinely surprising AND irreversible. */}
      <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.6 }}>
        you can only change this once every 30 days. your card starts private.
      </span>
      {err && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>}
    </div>
  );
}

const input = {
  width: "100%", boxSizing: "border-box", minHeight: 46,
  background: "transparent", color: t.white, ...mono, fontSize: 13,
  border: `1px solid ${t.muted}`, padding: "0 12px", borderRadius: 0, outline: "none",
};
const btn = (primary, disabled) => ({
  minHeight: 46, flex: 1, background: "transparent",
  border: `1px solid ${disabled ? t.muted : primary ? t.accent : t.dim}`,
  color: disabled ? t.dim : primary ? t.accent : t.dim,
  ...mono, fontSize: 12,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
});
