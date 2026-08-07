import { useEffect, useState } from "react";
import { t } from "../theme.js";
import { supabase } from "../lib/supabase.js";
import CardTab, { Segmented } from "./CardTab.jsx";
import PrivacyTab from "./PrivacyTab.jsx";
import BuddyList from "./BuddyList.jsx";
import GradesTab from "./GradesTab.jsx";
import {
  getSession, getMyProfile, claimHandle, getPublicCredentials,
  normalizeHandle, handleProblem,
} from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// Shell only: auth, screen-name claim, and which of the three surfaces is showing.
//
// THREE SURFACES, NOT ONE SCROLL. The previous version stacked identity, privacy,
// a verification tool, a 30-chip picker, four text inputs, a rate-limit notice and
// sign-out into a single column with no hierarchy. Those are three different
// decisions — what my card says, who can see it, who my people are — so they get
// three places.
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
  const [creds, setCreds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState("card");

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
        if (p?.handle) setCreds((await getPublicCredentials(p.handle)).credentials);
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
      // before believing the error; a real collision still surfaces, because then
      // the re-read comes back empty.
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
      <div style={{ width: "100%", maxWidth: 460, padding: "24px 20px 48px", display: "flex", flexDirection: "column", gap: 18 }}>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: t.dim }}>
            trainer
          </span>
          {profile && <span style={{ ...mono, fontSize: 11, color: t.accent }}>@{profile.handle}</span>}
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
              options={[["card", "CARD"], ["grades", "GRADES"], ["buddies", "BUDDIES"], ["privacy", "PRIVACY"]]}
              onChange={setTab}
            />

            {tab === "card"    && <CardTab profile={profile} credentials={creds} onSaved={setProfile} />}
            {tab === "privacy" && <PrivacyTab profile={profile} onSaved={setProfile} />}
            {tab === "grades"  && <GradesTab onChanged={refresh} />}
            {tab === "buddies" && <BuddyList />}

            {/* Sign-out belongs at the edge, not inline among the controls. */}
            <div style={{
              borderTop: `1px solid ${t.border}`, paddingTop: 14,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ ...mono, fontSize: 10, color: t.dim }}>{session.email}</span>
              <button onClick={() => supabase.auth.signOut()} style={{
                background: "transparent", border: "none", color: t.dim,
                ...mono, fontSize: 10, cursor: "pointer", padding: 6,
              }}>sign out</button>
            </div>
          </>
        )}
      </div>
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
      {/* One of only two pieces of standing help left in the app. It survives
          because the rule is genuinely surprising AND irreversible. */}
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
