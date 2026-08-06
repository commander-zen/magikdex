import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import {
  getTrainerAccount, getMyProfile, claimHandle, updateMyProfile, getPublicCard,
  normalizeHandle, handleProblem, VISIBILITY_CHOICES,
} from "../lib/trainer.js";

// The trainer card — claim a handle, set what the world can see, and check what
// a stranger actually gets. Deliberately thin: no playstyle picker, no party, no
// credentials. Those columns exist in 025 and can be filled in later; this slice
// exists to prove the whole path works with a real account against real RLS.
//
// Same sheet shape as SettingsSheet: bottom-anchored, height-capped so the ×
// stays reachable, scrolling body.
export default function TrainerSheet({ open, onClose, onOpenSettings }) {
  const { theme } = useTheme();
  const [account, setAccount] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Two error slots, not one. A LOAD failure ("the database is behind the app")
  // and an ACTION failure ("that handle is taken") are different claims about the
  // world, and rendering both in the same place under the claim button made a
  // load error look like the button had produced it — and look permanent, since
  // nothing the user typed could clear it. Caught in UAT on production.
  const [loadErr, setLoadErr] = useState(null);
  const [err, setErr] = useState(null);

  // Claim form
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  // "what a stranger sees" — the public RPC's actual response, not a local
  // render of our own state. The only honest way to show a privacy setting is to
  // ask the public path what it returns.
  const [peek, setPeek] = useState(null);
  const [peekBusy, setPeekBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setLoadErr(null);
      setPeek(null);
      const acct = await getTrainerAccount();
      if (cancelled) return;
      setAccount(acct);
      if (acct.userId && !acct.isAnonymous) {
        const { profile: p, error } = await getMyProfile(acct.userId);
        if (cancelled) return;
        setProfile(p);
        if (error) setLoadErr(error);
      } else {
        setProfile(null);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

  async function submitClaim() {
    const h = normalizeHandle(handle);
    const problem = handleProblem(h);
    if (problem || busy || !account?.userId) return;
    setBusy(true);
    setErr(null);
    const { profile: p, error } = await claimHandle(account.userId, h, displayName);
    setBusy(false);
    if (error) { setErr(error); return; }
    setProfile(p);
  }

  async function setVisibility(v) {
    if (busy || !account?.userId || v === profile?.visibility) return;
    setBusy(true);
    setErr(null);
    const { profile: p, error } = await updateMyProfile(account.userId, { visibility: v });
    setBusy(false);
    if (error) { setErr(error); return; }
    setProfile(p);
    setPeek(null); // the answer just changed — force a fresh look
  }

  async function checkPublicCard() {
    if (!profile?.handle || peekBusy) return;
    setPeekBusy(true);
    const { card, error } = await getPublicCard(profile.handle);
    setPeekBusy(false);
    // A null card is the CORRECT answer for a private trainer, not a failure —
    // so it is rendered as a result, not as an error.
    setPeek({ card: card ?? null, error });
  }

  const textColor   = theme.white;
  const dimColor    = theme.dim;
  const borderColor = theme.muted;
  const accent      = theme.accent;

  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    minHeight: 48,
    padding: "12px 0",
    borderBottom: `1px solid ${borderColor}`,
    WebkitTapHighlightColor: "transparent",
  };
  const labelStyle = {
    fontFamily: "'Noto Sans', sans-serif",
    fontSize: 14,
    color: textColor,
  };
  const capStyle = {
    fontFamily: "'Noto Sans', sans-serif",
    fontSize: 10, fontWeight: 500,
    letterSpacing: "0.18em", textTransform: "uppercase",
    color: dimColor,
  };
  const monoStyle = {
    fontFamily: "'Noto Sans Mono', monospace",
    fontSize: 11, letterSpacing: "0.06em",
  };
  const inputStyle = {
    width: "100%", boxSizing: "border-box", minHeight: 44,
    background: "transparent", color: textColor,
    fontFamily: "'Noto Sans Mono', monospace", fontSize: 13,
    border: `1px solid ${borderColor}`,
    padding: "0 12px", borderRadius: 0, outline: "none",
  };
  const btn = (primary) => ({
    minHeight: 44, flex: 1,
    background: "transparent",
    border: `1px solid ${primary ? accent : borderColor}`,
    color: primary ? accent : dimColor,
    ...monoStyle,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  });

  const normalized = normalizeHandle(handle);
  const problem = normalized ? handleProblem(normalized) : null;

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
          width: "100%", maxWidth: 600, maxHeight: "85dvh",
          background: theme.base,
          borderTop: `1px solid ${borderColor}`,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Pinned header — the × never scrolls out of reach. */}
          <div style={{
            flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "20px 20px 12px",
          }}>
            <span style={capStyle}>trainer</span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 44, height: 44,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", padding: 0,
                margin: "-10px -10px -10px 0",
                color: dimColor, cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 22 }}>close</span>
            </button>
          </div>

          <div style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            padding: "0 20px calc(env(safe-area-inset-bottom) + 24px)",
          }}>

            {/* A load failure is about the PROJECT, not about anything the user
                did, so it gets its own banner at the top rather than sitting
                under the form's submit button pretending to be validation. */}
            {loadErr && (
              <div style={{
                marginBottom: 14, padding: 12,
                border: `1px solid ${theme.red}`,
                ...monoStyle, color: theme.red, lineHeight: 1.6,
              }}>
                {loadErr}
              </div>
            )}

            {loading ? (
              <div style={{ ...monoStyle, color: dimColor, padding: "24px 0" }}>
                loading…
              </div>

            /* ── Gate: an anonymous box cannot hold a public identity ──────
               A handle is public and permanent — 027 reserves a released handle
               forever so a stranger can't re-register it. Claimed from a
               browser-only account, clearing the browser consumes that handle
               for good, held by an account nobody can ever sign into. So the
               email comes first. This is the same durability argument as the
               deck backup nudge, with a harsher failure mode. */
            ) : account?.isAnonymous ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "8px 0 0" }}>
                <span style={{
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 13, lineHeight: 1.6, color: textColor,
                }}>
                  a trainer handle is public and permanent — it goes on your card
                  and in your QR code.
                </span>
                <span style={{
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 12, lineHeight: 1.6, color: dimColor,
                }}>
                  this box only exists in this browser right now. add an email
                  first, so clearing your browser can't take your handle with it —
                  once claimed, a handle can never be reissued.
                </span>
                <button
                  onClick={() => { onClose(); onOpenSettings?.(); }}
                  style={btn(true)}
                >
                  add an email
                </button>
              </div>

            /* ── Claim ─────────────────────────────────────────────────────── */
            ) : !profile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0 0" }}>
                <span style={{
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 13, lineHeight: 1.6, color: textColor,
                }}>
                  claim your handle. it's how other players find your card — and
                  you can only change it once every 30 days.
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ ...monoStyle, fontSize: 16, color: dimColor }}>@</span>
                  <input
                    value={handle}
                    // Clear any previous submit error on the next keystroke —
                    // "that handle is taken" must not still be on screen while
                    // the user types a different one.
                    onChange={e => { setErr(null); setHandle(normalizeHandle(e.target.value)); }}
                    placeholder="handle"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    style={inputStyle}
                  />
                </div>
                <span style={{ ...monoStyle, color: problem ? theme.red : dimColor }}>
                  {problem
                    ? problem
                    : normalized
                      ? `magikdex.app/t/${normalized}`
                      : "3–20 characters: letters, numbers, _"}
                </span>

                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value.slice(0, 40))}
                  placeholder="display name (optional)"
                  style={inputStyle}
                />

                <button
                  onClick={submitClaim}
                  disabled={busy || !!problem || !normalized}
                  style={{ ...btn(true), opacity: busy || !!problem || !normalized ? 0.5 : 1 }}
                >
                  {busy ? "claiming…" : "claim handle"}
                </button>

                <span style={{ ...monoStyle, color: dimColor, lineHeight: 1.6 }}>
                  your card starts PRIVATE — nothing is visible to anyone until
                  you change that below.
                </span>
              </div>

            /* ── The card ──────────────────────────────────────────────────── */
            ) : (
              <div style={{ display: "flex", flexDirection: "column", padding: "8px 0 0" }}>
                <div style={{ ...rowStyle, borderBottom: "none", paddingBottom: 4 }}>
                  <span style={{
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 20, letterSpacing: "0.02em", color: accent,
                  }}>
                    @{profile.handle}
                  </span>
                </div>
                <div style={{ ...rowStyle, paddingTop: 0 }}>
                  <span style={{ ...labelStyle, fontSize: 13, color: dimColor }}>
                    {profile.display_name}
                  </span>
                </div>

                <div style={{ ...capStyle, margin: "20px 0 8px" }}>who can see it</div>

                {VISIBILITY_CHOICES.map(c => {
                  const active = profile.visibility === c.value;
                  return (
                    <div
                      key={c.value}
                      onClick={() => setVisibility(c.value)}
                      style={{ ...rowStyle, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
                    >
                      <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ ...monoStyle, color: active ? accent : textColor }}>
                          {c.label}
                        </span>
                        <span style={{
                          fontFamily: "'Noto Sans', sans-serif",
                          fontSize: 11, color: dimColor,
                        }}>
                          {c.hint}
                        </span>
                      </span>
                      <span style={{
                        width: 8, height: 8, flexShrink: 0,
                        background: active ? accent : "transparent",
                        border: `1px solid ${active ? accent : borderColor}`,
                      }} />
                    </div>
                  );
                })}

                {/* ── What a stranger actually sees ──────────────────────────
                    Asks the public RPC and shows its real answer. A privacy
                    control you can't verify is a promise, not a setting — and a
                    null result for a private card is the CORRECT answer, so it
                    renders as a result rather than an error. */}
                <div style={{ ...capStyle, margin: "20px 0 8px" }}>check it</div>
                <button
                  onClick={checkPublicCard}
                  disabled={peekBusy}
                  style={{ ...btn(false), opacity: peekBusy ? 0.5 : 1 }}
                >
                  {peekBusy ? "checking…" : "what a stranger sees"}
                </button>

                {peek && (
                  <div style={{
                    marginTop: 12, padding: 12,
                    border: `1px dashed ${borderColor}`,
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    {peek.error ? (
                      <span style={{ ...monoStyle, color: theme.red, lineHeight: 1.6 }}>
                        {peek.error}
                      </span>
                    ) : peek.card ? (
                      <>
                        <span style={{ ...monoStyle, color: accent }}>
                          @{peek.card.handle}
                        </span>
                        <span style={{ ...monoStyle, color: textColor }}>
                          {peek.card.display_name}
                        </span>
                        <span style={{ ...monoStyle, color: dimColor, lineHeight: 1.6 }}>
                          visible as {peek.card.visibility} · no account id is
                          published with it
                        </span>
                      </>
                    ) : (
                      <span style={{ ...monoStyle, color: dimColor, lineHeight: 1.6 }}>
                        nothing — your card returns no data to anyone, even with
                        your exact handle
                      </span>
                    )}
                  </div>
                )}

                {/* Only rendered when the COLUMN exists, which means 027 is
                    applied and the 30-day rate limit is real. `in` rather than a
                    truthiness check: absent (no migration) and null (never
                    renamed) mean different things, and promising a rate limit
                    that isn't enforced yet would be a lie. */}
                {"handle_changed_at" in profile && (
                  <div style={{ ...rowStyle, marginTop: 20, borderBottom: "none" }}>
                    <span style={{ ...monoStyle, color: dimColor }}>
                      {profile.handle_changed_at
                        ? `handle last changed ${String(profile.handle_changed_at).slice(0, 10)}`
                        : "handle has never been changed"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {err && (
              <div style={{
                marginTop: 14,
                ...monoStyle, color: theme.red, lineHeight: 1.6,
              }}>
                {err}
              </div>
            )}

          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
