import { useEffect, useState } from "react";
import { t } from "../theme.js";
import { supabase } from "../lib/supabase.js";
import CardEditor from "./CardEditor.jsx";
import {
  getSession, getMyProfile, claimHandle, updateMyProfile, getPublicCard,
  normalizeHandle, handleProblem, VISIBILITY_CHOICES,
} from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// The owner surface: sign in, claim a handle, choose who can see the card, and
// verify what a stranger actually gets.
//
// EMAIL-ONLY SIGN-IN, no anonymous accounts. Migration 028 enforces the same rule
// in the database (the insert policy rejects a session carrying is_anonymous), so
// this is the UI agreeing with the schema rather than guarding it. The reason is
// durability: 027 reserves a released handle FOREVER, so a handle claimed from a
// browser-only account would be permanently consumed by an account nobody can
// ever sign into.
//
// A code, not a magic link: links bounce out of an installed PWA into the default
// browser, landing the session in the wrong storage context.
export default function MyCard() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Load failures and action failures are different claims about the world and
  // get different slots — one shared slot made a project-level error look like
  // form validation nobody could clear.
  const [loadErr, setLoadErr] = useState(null);
  const [err, setErr] = useState(null);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState(null);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState(null);
  const [peekBusy, setPeekBusy] = useState(false);

  async function refresh() {
    // try/finally so `loading` ALWAYS clears — a thrown failure must not leave a
    // spinner with no explanation and no way out.
    try {
      const s = await getSession();
      setSession(s);
      if (s.userId) {
        const { profile: p, error } = await getMyProfile(s.userId);
        setProfile(p);
        setLoadErr(error);
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
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(), token: code.trim(), type: "email",
    });
    setBusy(false);
    if (error) {
      setMsg(error.code === "otp_expired"
        ? "that code expired — send a fresh one"
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
      // ALREADY YOURS and this form should not have been on screen. Re-read
      // before believing the error; a real collision still surfaces, because then
      // the re-read comes back empty.
      const { profile: existing } = await getMyProfile(session.userId);
      setBusy(false);
      if (existing) { setProfile(existing); setErr(null); return; }
      setErr(error);
      return;
    }
    setBusy(false); setProfile(p);
  }

  async function setVisibility(v) {
    if (busy || !session?.userId || v === profile?.visibility) return;
    setBusy(true); setErr(null);
    const { profile: p, error } = await updateMyProfile(session.userId, { visibility: v });
    setBusy(false);
    if (error) { setErr(error); return; }
    setProfile(p); setPeek(null); // the answer just changed — force a fresh look
  }

  async function checkCard() {
    if (!profile?.handle || peekBusy) return;
    setPeekBusy(true);
    const { card, error } = await getPublicCard(profile.handle);
    setPeekBusy(false);
    // A null card is the CORRECT answer for a private trainer, so it renders as a
    // result, not an error.
    setPeek({ card: card ?? null, error });
  }

  const input = {
    width: "100%", boxSizing: "border-box", minHeight: 46,
    background: "transparent", color: t.white,
    ...mono, fontSize: 13,
    border: `1px solid ${t.muted}`, padding: "0 12px", borderRadius: 0, outline: "none",
  };
  const btn = (primary, disabled) => ({
    minHeight: 46, flex: 1,
    background: "transparent",
    border: `1px solid ${primary ? t.accent : t.muted}`,
    color: primary ? t.accent : t.dim,
    ...mono, fontSize: 12,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  });
  const cap = {
    fontSize: 9, fontWeight: 500, letterSpacing: "0.18em",
    textTransform: "uppercase", color: t.dim,
  };

  const normalized = normalizeHandle(handle);
  const problem = normalized ? handleProblem(normalized) : null;

  return (
    <div style={{ minHeight: "100dvh", background: t.base, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 460, padding: "28px 20px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <span style={cap}>trainer</span>

        {loadErr && (
          <div style={{ padding: 12, border: `1px solid ${t.red}`, ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>
            {loadErr}
          </div>
        )}

        {loading ? (
          <span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span>

        /* ── Signed out ─────────────────────────────────────────────────── */
        ) : !session?.userId ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontSize: 14, lineHeight: 1.65, color: t.white }}>
              your trainer card is a handle other players can look up. sign in
              with an email to claim one.
            </span>
            {!sent ? (
              <>
                <input
                  type="email" placeholder="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoCapitalize="off" spellCheck={false} autoComplete="email"
                  style={input}
                />
                <button onClick={sendCode} disabled={busy || !email.trim()}
                        style={btn(true, busy || !email.trim())}>
                  {busy ? "sending…" : "send me a code"}
                </button>
              </>
            ) : (
              <>
                <input
                  inputMode="numeric" autoComplete="one-time-code" placeholder="code"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  style={{ ...input, fontSize: 20, letterSpacing: "0.4em", textAlign: "center" }}
                />
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

        /* ── Signed in, no handle yet ───────────────────────────────────── */
        ) : !profile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontSize: 14, lineHeight: 1.65, color: t.white }}>
              claim your handle. it's how other players find your card — and you
              can only change it once every 30 days.
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...mono, fontSize: 16, color: t.dim }}>@</span>
              <input
                value={handle}
                onChange={e => { setErr(null); setHandle(normalizeHandle(e.target.value)); }}
                placeholder="handle" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                style={input}
              />
            </div>
            <span style={{ ...mono, fontSize: 11, color: problem ? t.red : t.dim }}>
              {problem ? problem
                : normalized ? `${location.host}/t/${normalized}`
                : "3–20 characters: letters, numbers, _"}
            </span>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value.slice(0, 40))}
              placeholder="display name (optional)" style={input}
            />
            <button onClick={submitClaim} disabled={busy || !!problem || !normalized}
                    style={btn(true, busy || !!problem || !normalized)}>
              {busy ? "claiming…" : "claim handle"}
            </button>
            <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
              your card starts PRIVATE — nothing is visible to anyone until you
              change that.
            </span>
          </div>

        /* ── The card ───────────────────────────────────────────────────── */
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ ...mono, fontSize: 22, color: t.accent }}>@{profile.handle}</span>
              <span style={{ fontSize: 14, color: t.dim }}>{profile.display_name}</span>
            </div>

            <a href={`/t/${profile.handle}`}
               style={{ ...mono, fontSize: 11, color: t.dim, textDecoration: "none", borderBottom: `1px solid ${t.muted}`, paddingBottom: 6 }}>
              {location.host}/t/{profile.handle} →
            </a>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={cap}>who can see it</span>
              {VISIBILITY_CHOICES.map(c => {
                const active = profile.visibility === c.value;
                return (
                  <div key={c.value} onClick={() => setVisibility(c.value)}
                       style={{
                         display: "flex", alignItems: "center", justifyContent: "space-between",
                         minHeight: 50, padding: "10px 0",
                         borderBottom: `1px solid ${t.border}`,
                         cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                       }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ ...mono, fontSize: 12, color: active ? t.accent : t.white }}>{c.label}</span>
                      <span style={{ fontSize: 11, color: t.dim }}>{c.hint}</span>
                    </span>
                    <span style={{
                      width: 9, height: 9, flexShrink: 0,
                      background: active ? t.accent : "transparent",
                      border: `1px solid ${active ? t.accent : t.muted}`,
                    }} />
                  </div>
                );
              })}
            </div>

            {/* Asks the PUBLIC path and shows its real answer, including the empty
                one. A privacy control you cannot verify is a promise, not a
                setting. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={cap}>check it</span>
              <button onClick={checkCard} disabled={peekBusy} style={btn(false, peekBusy)}>
                {peekBusy ? "checking…" : "what a stranger sees"}
              </button>
              {peek && (
                <div style={{ padding: 12, border: `1px dashed ${t.muted}`, display: "flex", flexDirection: "column", gap: 6 }}>
                  {peek.error ? (
                    <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{peek.error}</span>
                  ) : peek.card ? (
                    <>
                      <span style={{ ...mono, fontSize: 12, color: t.accent }}>@{peek.card.handle}</span>
                      <span style={{ ...mono, fontSize: 11, color: t.white }}>{peek.card.display_name}</span>
                      <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
                        visible as {peek.card.visibility} · no account id is published with it
                      </span>
                    </>
                  ) : (
                    <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
                      nothing — your card returns no data to anyone, even with your
                      exact handle
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Rendered only when the COLUMN exists, i.e. 027 is applied and the
                rate limit is real. `in` rather than truthiness: absent (no
                migration) and null (never renamed) mean different things, and
                promising a limit that isn't enforced would be a lie. */}
            {/* Everything else on the card. Placed after visibility on purpose:
                decide who can see it, then decide what they see. */}
            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 18 }}>
              <CardEditor
                profile={profile}
                // The saved row is authoritative — the database may have
                // normalised or rejected part of the patch, so the editor reseeds
                // from what came back rather than from what was sent.
                onSaved={p => { setProfile(p); setPeek(null); }}
              />
            </div>

            {"handle_changed_at" in profile && (
              <span style={{ ...mono, fontSize: 10, color: t.dim }}>
                {profile.handle_changed_at
                  ? `handle last changed ${String(profile.handle_changed_at).slice(0, 10)}`
                  : "handle has never been changed"}
              </span>
            )}

            <button onClick={() => supabase.auth.signOut()} style={{ ...btn(false, false), marginTop: 6 }}>
              sign out
            </button>
          </div>
        )}

        {err && (
          <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>
        )}
      </div>
    </div>
  );
}
