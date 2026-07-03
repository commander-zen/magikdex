import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import { getBrewDefaults, setBrewDefaults } from "../lib/brewDefaults.js";
import { supabase } from "../lib/supabase.js";

// Starting-state choices for a fresh swipe seed (per-session controls override).
const SORT_CHOICES = [
  { value: "edhrec", label: "EDHREC" },
  { value: "name",   label: "A–Z" },
  { value: "cmc",    label: "CMC ↑" },
];

// The Box surface's only chrome: a bottom sheet behind the gear glyph holding
// the theme toggle, the brew defaults, and the colophon.
export default function SettingsSheet({ open, onClose }) {
  const { theme, mode, toggleTheme } = useTheme();
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

  // Attach an email to the CURRENT (anonymous) account → Supabase sends a
  // confirmation link; once tapped, the account is permanent and this same
  // email can sign into it anywhere.
  async function linkEmail() {
    const addr = email.trim();
    if (!addr || emailBusy) return;
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.updateUser({ email: addr });
    setEmailBusy(false);
    // email_address_invalid renders an empty string for the address (seen
    // live against test domains) — say something human instead.
    setEmailMsg(error
      ? (error.code === "email_address_invalid"
          ? "that email doesn't look deliverable — try another"
          : error.message)
      : "confirmation sent — open the link and your box is backed up");
  }

  // Returning user on a new device: magic-link sign-in to the account that
  // email is linked to. shouldCreateUser:false so a typo can't silently
  // mint a fresh empty account.
  async function sendSignInLink() {
    const addr = email.trim();
    if (!addr || emailBusy) return;
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false },
    });
    setEmailBusy(false);
    setEmailMsg(error
      ? "no box is linked to that email — back this one up first"
      : "sign-in link sent — open it on this device");
  }

  function updateDefaults(patch) {
    setDefaults(setBrewDefaults(patch));
  }

  const textColor   = mode === "light" ? theme.ink   : theme.white;
  const dimColor    = mode === "light" ? theme.muted : theme.dim;
  const borderColor = mode === "light" ? theme.border : theme.muted;
  const accent      = mode === "light" ? theme.gold  : theme.amber;

  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    minHeight: 48,
    padding: "12px 0",
    borderBottom: `1px solid ${borderColor}`,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };
  const labelStyle = {
    fontFamily: "'Noto Sans', sans-serif",
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
        <div style={{
          width: "100%", maxWidth: 600,
          background: theme.base,
          borderTop: `1px solid ${borderColor}`,
          padding: "20px 20px calc(env(safe-area-inset-bottom) + 24px)",
        }}>
          {/* Header — one obvious dismiss (the close ×); the backdrop tap
              also closes. */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 12,
          }}>
            <span style={{
              fontFamily: "'Noto Sans', sans-serif",
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
              <span className="material-symbols-rounded" style={{ fontSize: 22 }}>close</span>
            </button>
          </div>

          {/* Theme toggle */}
          <div onClick={toggleTheme} style={rowStyle}>
            <span style={labelStyle}>theme</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: dimColor }}>
              <span style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12,
              }}>
                {mode}
              </span>
              <span
                className="material-symbols-rounded"
                style={{
                  fontSize: 18,
                  color: dimColor,
                  fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                }}
              >
                {mode === "dark" ? "light_mode" : "dark_mode"}
              </span>
            </span>
          </div>

          {/* ── Brew defaults — starting state of every fresh swipe seed ── */}
          <div style={{
            fontFamily: "'Noto Sans', sans-serif",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: dimColor,
            margin: "20px 0 8px",
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
                      fontFamily: "'Noto Sans Mono', monospace",
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
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.08em",
              color: defaults.excludeLands ? accent : dimColor,
            }}>
              {defaults.excludeLands ? "ON" : "OFF"}
            </span>
          </div>

          {/* ── Account ──────────────────────────────────────────────────── */}
          <div style={{
            fontFamily: "'Noto Sans', sans-serif",
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
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 11,
              maxWidth: "60%",
              textAlign: "right",
              color: idCopied ? accent : authError ? "#a04040" : dimColor,
            }}>
              {idCopied ? "copied" : userId ? `${userId.slice(0, 8)}…` : authError ?? "signing in…"}
            </span>
          </div>

          {/* Backup email — decks live on the account; an email makes the
              account recoverable anywhere (magic link), so clearing the
              browser can never eat a curated deck. The address is used for
              nothing else. */}
          {userEmail ? (
            <div style={{ ...rowStyle, cursor: "default" }}>
              <span style={labelStyle}>backed up to</span>
              <span style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 11,
                color: accent,
              }}>
                {userEmail}
              </span>
            </div>
          ) : (
            <div style={{ ...rowStyle, cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 10 }}>
              <span style={{
                fontFamily: "'Noto Sans', sans-serif",
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
                  fontFamily: "'Noto Sans Mono', monospace",
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
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 11, letterSpacing: "0.06em",
                    cursor: "pointer",
                    opacity: emailBusy || !email.trim() || !userId ? 0.5 : 1,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  back up this box
                </button>
                <button
                  onClick={sendSignInLink}
                  disabled={emailBusy || !email.trim()}
                  style={{
                    minHeight: 44, flex: 1,
                    background: "transparent",
                    border: `1px solid ${borderColor}`,
                    color: dimColor,
                    fontFamily: "'Noto Sans Mono', monospace",
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
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: dimColor,
                }}>
                  {emailMsg}
                </span>
              )}
            </div>
          )}

          {/* Colophon */}
          <a
            href="https://bsky.app/profile/commanderzen.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...rowStyle, textDecoration: "none" }}
          >
            <span style={labelStyle}>commander zen</span>
            <span style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 13,
              color: dimColor,
              letterSpacing: "0.01em",
            }}>
              @commanderzen.bsky.social
            </span>
          </a>

          <div style={{
            marginTop: 16,
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 11,
            color: dimColor,
            opacity: 0.6,
          }}>
            magicdex · v3
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
