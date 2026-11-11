import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import { getBrewDefaults, setBrewDefaults } from "../lib/brewDefaults.js";
import { supabase } from "../lib/supabase.js";
import Icon from "./Icon.jsx";

// Starting-state choices for a fresh swipe seed (per-session controls override).
const SORT_CHOICES = [
  { value: "edhrec", label: "EDHREC" },
  { value: "name",   label: "A–Z" },
  { value: "cmc",    label: "CMC ↑" },
];

// The Box surface's only chrome: a bottom sheet behind the gear glyph holding
// the brew defaults, the account controls, and the colophon.
export default function SettingsSheet({ open, onClose }) {
  const { theme } = useTheme();
  const [defaults, setDefaults] = useState(getBrewDefaults);
  // The account behind the invisible sign-in. userId/userEmail come from the
  // live session; authError surfaces WHY there's no session (e.g. the
  // anonymous provider being disabled) instead of a mute "not signed in".
  const [userId, setUserId] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [idCopied, setIdCopied] = useState(false);
  // Backup email flow — the durability answer: decks live on the account, so
  // linking an email makes the account (and every deck on it) recoverable on
  // any device via magic link. Without it, the account only lives in this
  // browser's storage.
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState(null);
  // Once a code is sent we swap the send buttons for a 6-digit entry. Magic
  // links can't come back to an iOS standalone PWA — the OS opens every https
  // link in the default browser, so the session lands in the wrong storage
  // context and never reaches the box. A code the user types stays in-app.
  // pendingFlow remembers which button sent it so verifyOtp uses the right type
  // ('email_change' for a new email attach, 'email' for signing back in).
  const [pendingFlow, setPendingFlow] = useState(null); // 'backup' | 'signin' | null
  const [code, setCode] = useState("");
  // Delete my data: a two-tap confirm, then the result or the error.
  const [wipe, setWipe] = useState("idle"); // idle | confirm | busy | error

  // Removes every deck and legend this account owns (their cards and tags go
  // with them), signs out, and reloads into a fresh empty account. Required by
  // App Store guideline 5.1.1(v); also simply the decent thing to offer.
  async function deleteMyData() {
    if (!userId) return;
    setWipe("busy");
    const decks = await supabase.from("decks").delete().eq("user_id", userId);
    const legends = decks.error ? decks : await supabase.from("legends").delete().eq("user_id", userId);
    if (legends.error) { setWipe("error"); return; }
    try {
      for (const k of Object.keys(localStorage)) if (/^magi[ck]dex/.test(k)) localStorage.removeItem(k);
    } catch { /* storage blocked: nothing to clear */ }
    await supabase.auth.signOut();
    window.location.reload();
  }

  useEffect(() => {
    if (!open) return;
    (async () => {
      let { data } = await supabase.auth.getSession();
      let session = data.session;
      if (!session) {
        // Retry the invisible sign-in here so opening settings self-heals a
        // failed boot attempt — and captures the real error if it can't.
        const res = await supabase.auth.signInAnonymously();
        if (res.error) setAuthError(res.error.message);
        session = res.data?.session ?? null;
      }
      setUserId(session?.user?.id ?? null);
      setUserEmail(session?.user?.email || null);
      if (session) setAuthError(null);
    })();
  }, [open]);

  async function copyUserId() {
    if (!userId) return;
    try {
      await navigator.clipboard?.writeText(userId);
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1800);
    } catch { /* clipboard denied — the id is still visible to transcribe */ }
  }

  // Attach an email to the CURRENT (anonymous) account → Supabase emails a
  // 6-digit code; entering it (verifyCode, type 'email_change') makes the
  // account permanent, and this same email can then sign into it anywhere.
  async function linkEmail() {
    const addr = email.trim();
    if (!addr || emailBusy) return;
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.updateUser({ email: addr });
    setEmailBusy(false);
    if (error) {
      // Already-registered email → it's the login for an existing box, not a
      // dead end. Pivot to the sign-in code flow so they land in that box
      // instead of staring at "already registered" with nowhere to go.
      if (error.code === "email_exists" || /already .*registered/i.test(error.message || "")) {
        await sendSignInCode();
        return;
      }
      // Human copy for the raw errors seen live: email_address_invalid renders
      // an empty address; the mailer rate limit reads like a user fault.
      setEmailMsg(error.code === "email_address_invalid"
        ? "that email doesn't look deliverable — try another"
        : error.code === "over_email_send_rate_limit"
          ? "email is busy right now — nothing is lost, try again in an hour"
          : error.message);
      return;
    }
    setCode("");
    setPendingFlow("backup");
    setEmailMsg("code sent — enter it from your email");
  }

  // Returning user on a new device: send a 6-digit sign-in code for the account
  // that email is linked to. shouldCreateUser:false so a typo can't silently
  // mint a fresh empty account.
  async function sendSignInCode() {
    const addr = email.trim();
    if (!addr || emailBusy) return;
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false },
    });
    setEmailBusy(false);
    if (error) {
      setEmailMsg("no box is linked to that email — back this one up first");
      return;
    }
    setCode("");
    setPendingFlow("signin");
    setEmailMsg("code sent — enter it from your email");
  }

  // Verify the emailed code in-app — no link, so it works inside the iOS PWA.
  // The OTP type differs by intent: attaching a new email is an 'email_change',
  // signing back into an existing box is 'email'.
  async function verifyCode() {
    const token = code.trim();
    const flow = pendingFlow;
    if (token.length < 6 || emailBusy || !flow) return;
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: flow === "backup" ? "email_change" : "email",
    });
    setEmailBusy(false);
    if (error) {
      setEmailMsg(error.code === "otp_expired"
        ? "that code expired — send a fresh one"
        : "that code didn't match — check the digits and retry");
      return;
    }
    // Re-read the session so the UI flips to the backed-up/signed-in state.
    const { data } = await supabase.auth.getSession();
    setUserId(data.session?.user?.id ?? null);
    setUserEmail(data.session?.user?.email || null);
    setPendingFlow(null);
    setCode("");
    setEmailMsg(flow === "backup"
      ? "backed up — your box now survives new devices"
      : "signed in — your box is here");
  }

  // Bail out of code entry back to the email step (wrong address, want a resend
  // from scratch, or changed their mind).
  function cancelCode() {
    setPendingFlow(null);
    setCode("");
    setEmailMsg(null);
  }

  function updateDefaults(patch) {
    setDefaults(setBrewDefaults(patch));
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
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };
  const labelStyle = {
    fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
    fontSize: 14,
    color: textColor,
  };

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
        {/* The sheet is anchored to the bottom and grows UPWARD, so without a
            height cap enough content pushes the header (and its ×) off the top
            of the screen while the sheet covers the whole backdrop — locking
            you in with no way out. Cap it and scroll the body instead; the
            header stays pinned so the × is always reachable, and the gap above
            keeps the backdrop tappable. Same shape as AddLegendSheet. */}
        <div style={{
          width: "100%", maxWidth: 600,
          maxHeight: "85dvh",
          background: theme.base,
          borderTop: `1px solid ${borderColor}`,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Header — one obvious dismiss (the close ×); the backdrop tap
              also closes. Pinned: never scrolls out of reach. */}
          <div style={{
            flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "20px 20px 12px",
          }}>
            <span style={{
              fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: dimColor,
            }}>
              settings
            </span>
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
              <Icon name="close" style={{ fontSize: 22 }} />
            </button>
          </div>

          {/* Scrolling body — everything below the pinned header. */}
          <div style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            padding: "0 20px calc(env(safe-area-inset-bottom) + 24px)",
          }}>

          {/* ── Brew defaults — starting state of every fresh swipe seed ── */}
          <div style={{
            fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: dimColor,
            margin: "0 0 8px",
          }}>
            brew defaults
          </div>

          {/* Default sort — segmented */}
          <div style={{ ...rowStyle, cursor: "default" }}>
            <span style={labelStyle}>default sort</span>
            <div style={{ display: "flex", border: `1px solid ${borderColor}` }}>
              {SORT_CHOICES.map((c, idx) => {
                const active = defaults.sort === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => updateDefaults({ sort: c.value })}
                    style={{
                      minHeight: 44,
                      padding: "0 12px",
                      border: "none",
                      borderLeft: idx > 0 ? `1px solid ${borderColor}` : "none",
                      background: active ? accent : "transparent",
                      color: active ? theme.base : dimColor,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      letterSpacing: "0.06em",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Exclude lands by default */}
          <div
            onClick={() => updateDefaults({ excludeLands: !defaults.excludeLands })}
            style={rowStyle}
          >
            <span style={labelStyle}>exclude lands</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.08em",
              color: defaults.excludeLands ? accent : dimColor,
            }}>
              {defaults.excludeLands ? "ON" : "OFF"}
            </span>
          </div>

          {/* ── Account ──────────────────────────────────────────────────── */}
          <div style={{
            fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: dimColor,
            margin: "20px 0 8px",
          }}>
            account
          </div>

          {/* The invisible sign-in's id — tap to copy (used for the one-time
              data claim). A failed sign-in shows the REAL error, not a mute
              "not signed in". */}
          <div onClick={copyUserId} style={{ ...rowStyle, cursor: userId ? "pointer" : "default" }}>
            <span style={labelStyle}>account id</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              maxWidth: "60%",
              textAlign: "right",
              color: idCopied ? accent : authError ? theme.red : dimColor,
            }}>
              {idCopied ? "copied" : userId ? `${userId.slice(0, 8)}…` : authError ?? "signing in…"}
            </span>
          </div>

          {/* Backup email — decks live on the account; an email makes the
              account recoverable anywhere via a 6-digit code, so clearing the
              browser can never eat a curated deck. A code (not a link) keeps
              sign-in inside the app — critical on iOS, where a link would bounce
              out to the default browser. The address is used for nothing else. */}
          {userEmail ? (
            <div style={{ ...rowStyle, cursor: "default" }}>
              <span style={labelStyle}>backed up to</span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: accent,
              }}>
                {userEmail}
              </span>
            </div>
          ) : pendingFlow ? (
            <div style={{ ...rowStyle, cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 10 }}>
              <span style={{
                fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
                fontSize: 12,
                lineHeight: 1.5,
                color: dimColor,
              }}>
                enter the code we emailed to {email.trim()}
              </span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="code"
                value={code}
                // Length is a Supabase setting (6–10 digits) — accept up to 10
                // rather than assuming 6, so a longer configured code isn't
                // silently truncated on entry.
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 44,
                  background: "transparent",
                  color: textColor,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 20,
                  letterSpacing: "0.4em",
                  textAlign: "center",
                  border: `1px solid ${borderColor}`,
                  padding: "0 12px",
                  borderRadius: 0,
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={verifyCode}
                  disabled={emailBusy || code.trim().length < 6}
                  style={{
                    minHeight: 44, flex: 1,
                    background: "transparent",
                    border: `1px solid ${accent}`,
                    color: accent,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11, letterSpacing: "0.06em",
                    cursor: "pointer",
                    opacity: emailBusy || code.trim().length < 6 ? 0.5 : 1,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  verify
                </button>
                <button
                  onClick={cancelCode}
                  disabled={emailBusy}
                  style={{
                    minHeight: 44, flex: 1,
                    background: "transparent",
                    border: `1px solid ${borderColor}`,
                    color: dimColor,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11, letterSpacing: "0.06em",
                    cursor: "pointer",
                    opacity: emailBusy ? 0.5 : 1,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  use another email
                </button>
              </div>
              {emailMsg && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: dimColor,
                }}>
                  {emailMsg}
                </span>
              )}
            </div>
          ) : (
            <div style={{ ...rowStyle, cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 10 }}>
              <span style={{
                fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
                fontSize: 12,
                lineHeight: 1.5,
                color: dimColor,
              }}>
                add an email so your decks survive new devices and cleared
                browsers — it's used for nothing else
              </span>
              <input
                type="email"
                placeholder="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 44,
                  background: "transparent",
                  color: textColor,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  border: `1px solid ${borderColor}`,
                  padding: "0 12px",
                  borderRadius: 0,
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={linkEmail}
                  disabled={emailBusy || !email.trim() || !userId}
                  style={{
                    minHeight: 44, flex: 1,
                    background: "transparent",
                    border: `1px solid ${accent}`,
                    color: accent,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11, letterSpacing: "0.06em",
                    cursor: "pointer",
                    opacity: emailBusy || !email.trim() || !userId ? 0.5 : 1,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  back up this box
                </button>
                <button
                  onClick={sendSignInCode}
                  disabled={emailBusy || !email.trim()}
                  style={{
                    minHeight: 44, flex: 1,
                    background: "transparent",
                    border: `1px solid ${borderColor}`,
                    color: dimColor,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11, letterSpacing: "0.06em",
                    cursor: "pointer",
                    opacity: emailBusy || !email.trim() ? 0.5 : 1,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  sign in to my box
                </button>
              </div>
              {emailMsg && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: dimColor,
                }}>
                  {emailMsg}
                </span>
              )}
            </div>
          )}

          {/* Delete my data — destructive, so it takes two taps and says
              exactly what goes. */}
          <div style={{ ...rowStyle, cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            {wipe === "idle" ? (
              <button
                onClick={() => setWipe("confirm")}
                disabled={!userId}
                style={{
                  minHeight: 44, background: "transparent", border: `1px solid ${borderColor}`,
                  color: theme.red, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  letterSpacing: "0.06em", cursor: "pointer", WebkitTapHighlightColor: "transparent",
                }}
              >
                delete my data
              </button>
            ) : (
              <>
                <span role="alert" style={{ fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif", fontSize: 13, lineHeight: 1.5, color: textColor }}>
                  {wipe === "error"
                    ? "That didn't work. Check your connection and try again."
                    : "This permanently deletes every brew and legend in your dex. It can't be undone."}
                </span>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={deleteMyData}
                    disabled={wipe === "busy"}
                    style={{
                      minHeight: 44, flex: 1, background: theme.red, border: "none", color: theme.base,
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
                      letterSpacing: "0.06em", cursor: "pointer", opacity: wipe === "busy" ? 0.6 : 1,
                    }}
                  >
                    {wipe === "busy" ? "deleting…" : "delete everything"}
                  </button>
                  <button
                    onClick={() => setWipe("idle")}
                    disabled={wipe === "busy"}
                    style={{
                      minHeight: 44, flex: 1, background: "transparent", border: `1px solid ${borderColor}`,
                      color: textColor, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                      letterSpacing: "0.06em", cursor: "pointer",
                    }}
                  >
                    keep my dex
                  </button>
                </div>
              </>
            )}
          </div>

          <a href="/privacy.html" target="_blank" rel="noopener" style={{ ...rowStyle, textDecoration: "none" }}>
            <span style={labelStyle}>privacy</span>
            <span style={{ fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif", fontSize: 13, color: dimColor }}>
              what magikdex stores
            </span>
          </a>

          {/* Colophon */}
          <a
            href="https://bsky.app/profile/commanderzen.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...rowStyle, textDecoration: "none" }}
          >
            <span style={labelStyle}>commander zen</span>
            <span style={{
              fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
              fontSize: 13,
              color: dimColor,
              letterSpacing: "0.01em",
            }}>
              @commanderzen.bsky.social
            </span>
          </a>

          {/* ── Credits ──────────────────────────────────────────────────────
              magikdex is built on other people's work: Scryfall serves every
              card object and image, EDHREC's rankings are what make the brew
              stack relevant rather than random. Crediting them is the point;
              the links are how someone finds them. */}
          <div style={{
            fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: dimColor,
            margin: "20px 0 8px",
          }}>
            built on
          </div>
          {[
            ["Scryfall", "card data & images", "https://scryfall.com"],
            ["EDHREC", "synergy & recommendations", "https://edhrec.com"],
            ["Archidekt", "deck import", "https://archidekt.com"],
            ["Moxfield", "deck import", "https://moxfield.com"],
          ].map(([name, what, href]) => (
            <a
              key={name}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...rowStyle, textDecoration: "none" }}
            >
              <span style={labelStyle}>{name}</span>
              <span style={{
                fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
                fontSize: 13,
                color: dimColor,
              }}>
                {what}
              </span>
            </a>
          ))}

          {/* The Fan Content notice is REQUIRED, verbatim, by Wizards' Fan
              Content Policy — it's the permission magikdex (and Scryfall's
              image/data service) operates under. Wording is quoted exactly as
              the policy specifies; do not paraphrase it. */}
          <div style={{
            marginTop: 20,
            fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
            fontSize: 11,
            lineHeight: 1.6,
            color: dimColor,
          }}>
            magikdex is unofficial Fan Content permitted under the{" "}
            <a
              href="https://company.wizards.com/en/legal/fancontentpolicy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: accent, textDecoration: "none" }}
            >
              Fan Content Policy
            </a>
            . Not approved/endorsed by Wizards. Portions of the materials used
            are property of Wizards of the Coast. ©Wizards of the Coast LLC.
          </div>

          <div style={{
            marginTop: 16,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: dimColor,
            opacity: 0.6,
          }}>
            magikdex · v3
          </div>

          </div>{/* /scrolling body */}
        </div>
      </div>
    </>,
    document.body
  );
}
