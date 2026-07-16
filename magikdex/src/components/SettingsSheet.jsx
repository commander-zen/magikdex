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
  //
  // emailRedirectTo pins the link back to the origin the user is ACTUALLY on.
  // Without it Supabase falls back to the dashboard's Site URL — and this app
  // answers on several Vercel origins (the bare alias, the team-scoped one,
  // preview deploys). Sessions and box state are per-origin, so a link that
  // lands on a different one signs you in somewhere your deck isn't. The
  // origin still has to be allow-listed in Auth → Redirect URLs.
  async function linkEmail() {
    const addr = email.trim();
    if (!addr || emailBusy) return;
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabase.auth.updateUser(
      { email: addr },
      { emailRedirectTo: window.location.origin },
    );
    setEmailBusy(false);
    // Human copy for the raw errors seen live: email_address_invalid renders
    // an empty address; the mailer rate limit reads like a user fault.
    setEmailMsg(error
      ? (error.code === "email_address_invalid"
          ? "that email doesn't look deliverable — try another"
          : error.code === "over_email_send_rate_limit"
            ? "email is busy right now — nothing is lost, try again in an hour"
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
      // shouldCreateUser:false so a typo can't mint an empty account;
      // emailRedirectTo so the link signs you in on the origin you're using,
      // not whatever the dashboard's Site URL happens to say (see linkEmail).
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    setEmailBusy(false);
    setEmailMsg(error
      ? "no box is linked to that email — back this one up first"
      : "sign-in link sent — open it on this device");
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

          {/* Scrolling body — everything below the pinned header. */}
          <div style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            padding: "0 20px calc(env(safe-area-inset-bottom) + 24px)",
          }}>

          {/* ── Brew defaults — starting state of every fresh swipe seed ── */}
          <div style={{
            fontFamily: "'Noto Sans', sans-serif",
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
              color: idCopied ? accent : authError ? theme.red : dimColor,
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

          {/* ── Credits ──────────────────────────────────────────────────────
              magikdex is built on other people's work: Scryfall serves every
              card object and image, EDHREC's rankings are what make the brew
              stack relevant rather than random. Crediting them is the point;
              the links are how someone finds them. */}
          <div style={{
            fontFamily: "'Noto Sans', sans-serif",
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
                fontFamily: "'Noto Sans', sans-serif",
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
            fontFamily: "'Noto Sans', sans-serif",
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
            fontFamily: "'Noto Sans Mono', monospace",
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
