import { useEffect, useState } from "react";
import { t } from "../theme.js";
import { supabase } from "../lib/supabase.js";
import BuddyList from "./BuddyList.jsx";
import SettingsSheet from "./SettingsSheet.jsx";
import RitualLanding from "./RitualLanding.jsx";
import RitualDeck from "./RitualDeck.jsx";
import {
  getSession, getMyProfile, claimHandle, myDecks,
  normalizeHandle, handleProblem, myBuddies, addBuddy,
} from "../lib/trainer.js";
import { pendingScans, forgetScan } from "../lib/pendingScan.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// THE ROUTER FOR "/" — three states, and this file now only owns the two you
// pass THROUGH.
//
//   signed out, not started  → RitualLanding, full screen
//   signed in, no handle yet → Claim
//   signed in and set up     → RitualDeck, the swipeable AIM stack
//
// The old CARD / BUDDIES tab screen is gone. Configuration — editing fields,
// decks, links, privacy, signing out — still lives behind the gear, which the
// deck carries in its own header.
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
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The landing owns the whole screen, so it renders BEFORE the app chrome
  // rather than inside it — a signed-out visitor should not see a "TRAINER"
  // header and a settings gear behind the front door.
  const [started, setStarted] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

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
        // Decks feed the player-id card and one commander-id card each.
        //
        // Links are NOT fetched here any more: this screen no longer renders the
        // BadgeCard that displayed them. They are still edited in settings and
        // still shown publicly on /t/<handle>, which fetches its own — so
        // nothing is lost and this is one less query on every load.
        if (p) {
          const { decks: d } = await myDecks(s.userId);
          setDecks(d);
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

  // The front door. Signed out and not yet started → the landing, full screen.
  // Gated on `!loading` so it cannot flash up for half a second in front of a
  // signed-in user while the session is still being read.
  if (!loading && !session?.userId && !started) {
    return <RitualLanding onStart={() => setStarted(true)} />;
  }

  // SIGNED IN AND SET UP → RITUAL, the swipeable stack. This REPLACES the old
  // two-tab card/buddies screen, which is what made the app read as a settings
  // page with a card in it. Editing, privacy and sign-out all still exist and
  // all still live behind the gear, which the deck carries in its header.
  if (!loading && session?.userId && profile) {
    return (
      <>
        <RitualDeck
          profile={profile}
          decks={decks}
          onOpenSettings={() => setSettingsOpen(true)}
          onManageBuddies={() => setManageOpen(true)}
          onSaved={() => refresh()}
          banner={<PendingBuddies myHandle={profile.handle} />}
        />

        {/* The full buddy list — add by handle, notes, remove, block. Still the
            dark styling; the AIM card is the view, this is the workbench. */}
        {manageOpen && (
          <div style={{
            position: "fixed", inset: 0, background: t.base, zIndex: 40,
            overflowY: "auto", padding: "18px 20px 44px",
          }}>
            <div style={{ maxWidth: 460, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
              <button onClick={() => { setManageOpen(false); refresh(); }} style={{
                alignSelf: "flex-start", background: "transparent", border: "none",
                ...mono, fontSize: 11, color: t.dim, cursor: "pointer", padding: "10px 0",
              }}>← back to ritual</button>
              <BuddyList />
            </div>
          </div>
        )}
        <SettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          profile={profile}
          session={session}
          onSaved={() => refresh()}
        />
      </>
    );
  }

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

        ) : (
          // Signed in, no handle claimed yet. The signed-in-WITH-profile case
          // never reaches here — it returns RitualDeck further up.
          <Claim {...{ handle, setHandle, displayName, setDisplayName, normalized, problem, busy, submitClaim, err, setErr }}
                 pendingHandle={pendingScans().at(-1) ?? null} />
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

// THE OTHER HALF OF THE SCAN.
//
// Someone scanned a card at a table, had no account, and tapped through to make
// one. Three screens later — email, code, screen name — they arrive here, and
// until now the person they had just met was simply gone. They would have had to
// remember a stranger's handle through a sign-up flow and go type it in.
//
// pendingScan.js parked the handle on their device on the way out. This offers it
// back. It is the step that makes the product's own promise true: the buddy list
// is an upgrade you can take later, not a toll gate at the table.
//
// ONE TAP, NEVER AUTOMATIC. Adding somebody to your social graph is not a thing
// to do on a user's behalf because a URL was once open on their phone — and
// add_buddy bumps met_count, so a silent add would also assert a game that may
// not have happened. It asks, and "not now" is a real answer that stops asking.
function PendingBuddies({ myHandle }) {
  const [handles, setHandles] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const parked = pendingScans().filter(h => h !== myHandle?.toLowerCase());
      if (!parked.length) return;
      try {
        // Filter against the real list first. Offering to add someone who is
        // already a buddy would, if tapped, silently claim a second game.
        const { buddies } = await myBuddies();
        if (cancelled) return;
        const have = new Set((buddies ?? []).map(b => b.handle?.toLowerCase()));
        const fresh = parked.filter(h => !have.has(h));
        // Anything already on the list is answered — stop parking it.
        for (const h of parked) if (have.has(h)) forgetScan(h);
        setHandles(fresh);
      } catch {
        // A failed read must not hide the prompt; the add itself re-checks.
        if (!cancelled) setHandles(parked);
      }
    })();
    return () => { cancelled = true; };
  }, [myHandle]);

  async function add(h) {
    setBusy(h); setErr(null);
    const { error } = await addBuddy(h);
    setBusy(null);
    if (error) { setErr(error); return; }
    forgetScan(h);
    setHandles(list => list.filter(x => x !== h));
  }

  function dismiss(h) {
    forgetScan(h);
    setErr(null);
    setHandles(list => list.filter(x => x !== h));
  }

  if (!handles.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {handles.map(h => (
        <div key={h} style={{
          border: `1px solid ${t.accent}`, padding: 12,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <span style={{ ...mono, fontSize: 11, color: t.accent, lineHeight: 1.7 }}>
            ◆ you kept @{h}&rsquo;s card
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => add(h)} disabled={busy === h} style={btn(true, busy === h)}>
              {busy === h ? "adding…" : "add to buddies"}
            </button>
            <button onClick={() => dismiss(h)} disabled={busy === h} style={btn(false, busy === h)}>
              not now
            </button>
          </div>
        </div>
      ))}
      {err && (
        <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>
      )}
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

function Claim({ handle, setHandle, displayName, setDisplayName, normalized, problem, busy, submitClaim, err, setErr, pendingHandle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* THE HARDEST MOMENT IN THE PRODUCT: choosing a permanent screen name,
          often standing at a table while somebody waits. It cannot be skipped —
          buddy.trainer_id is a foreign key to profile, so there is no adding
          anyone without a handle — but it can at least say what it is FOR.
          Arriving from a scan, the reason is a specific person, so name them. */}
      <span style={{ fontSize: 14, lineHeight: 1.65, color: t.white }}>
        {pendingHandle
          ? <>pick your screen name and we&rsquo;ll add <strong>@{pendingHandle}</strong> to your buddies. it&rsquo;s how other players look <em>you</em> up.</>
          : <>pick your screen name. it&rsquo;s how other players look you up.</>}
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
