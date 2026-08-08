import { createPortal } from "react-dom";
import { t } from "../theme.js";
import { supabase } from "../lib/supabase.js";
import CardFields from "./CardFields.jsx";
import DecksTab from "./DecksTab.jsx";
import LinksTab from "./LinksTab.jsx";
import PrivacyTab from "./PrivacyTab.jsx";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// Everything that isn't the card or your buddies.
//
// The app has TWO surfaces — your card, and your people. Those are the only two
// things you open it to look at. Editing fields, listing decks, choosing who can
// see it, signing out: all configuration, and configuration belongs behind a gear.
// Four peer tabs implied four destinations of equal standing, which is wrong: two
// of them were things you look at and two were things you set up once.
//
// Same shape as magikdex's SettingsSheet, deliberately — bottom-anchored,
// height-capped so the close button never scrolls out of reach, pinned header,
// scrolling body. Consistency across the two apps is free here and it means the
// gear behaves the way it already does in the other one.
export default function SettingsSheet({ open, onClose, profile, session, onSaved }) {
  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 220,
          background: "rgba(0,0,0,0.68)",
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
          width: "100%", maxWidth: 520, maxHeight: "88dvh",
          background: t.base, borderTop: `1px solid ${t.muted}`,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Pinned: the × is always reachable no matter how long the body gets. */}
          <div style={{
            flexShrink: 0, display: "flex", alignItems: "center",
            justifyContent: "space-between", padding: "18px 20px 10px",
          }}>
            <span style={cap}>settings</span>
            <button onClick={onClose} aria-label="Close" style={{
              width: 44, height: 44, margin: "-10px -10px -10px 0",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", padding: 0,
              color: t.dim, cursor: "pointer", ...mono, fontSize: 18,
            }}>✕</button>
          </div>

          <div style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            padding: "0 20px calc(env(safe-area-inset-bottom) + 28px)",
            display: "flex", flexDirection: "column", gap: 26,
          }}>
            {profile && (
              <>
                <Section title="your card">
                  <CardFields profile={profile} onSaved={onSaved} />
                </Section>

                <Section title="decks">
                  <DecksTab userId={profile.id} onChanged={onSaved ? () => onSaved(profile) : undefined} />
                </Section>

                <Section title="find me">
                  <LinksTab userId={profile.id} onChanged={onSaved ? () => onSaved(profile) : undefined} />
                </Section>

                <Section title="who can see it">
                  <PrivacyTab profile={profile} onSaved={onSaved} />
                </Section>

                {/* Two ways to have the card on you when someone asks, which is the
                    only moment it matters. Both are free and neither needs us. */}
                <Section title="keep it on you">
                  <a href="/print" style={rowLink}>print &amp; sleeve it ↗</a>
                  <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.7 }}>
                    prints at real card size — 63&thinsp;×&thinsp;88&nbsp;mm — so it fits a
                    sleeve and rides in your deck box.
                  </span>
                  <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.7 }}>
                    or add it to your home screen: <strong>share&nbsp;→ add to home
                    screen</strong>. it opens straight to your card, no browser.
                    better than a screenshot, which sinks under your camera roll.
                  </span>
                </Section>
              </>
            )}

            <Section title="account">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <span style={{ ...mono, fontSize: 11, color: t.dim, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {session?.email}
                </span>
                <button onClick={() => supabase.auth.signOut()} style={{
                  minHeight: 44, padding: "0 16px", background: "transparent",
                  border: `1px solid ${t.muted}`, color: t.dim,
                  ...mono, fontSize: 11, cursor: "pointer", flexShrink: 0,
                }}>sign out</button>
              </div>
            </Section>

            {/* Required verbatim by the Fan Content Policy — it is the permission
                this app displays card art under, same as magikdex. Not paraphrasable. */}
            <div style={{ ...mono, fontSize: 10, lineHeight: 1.7, color: t.dim }}>
              unofficial Fan Content permitted under the{" "}
              <a href="https://company.wizards.com/en/legal/fancontentpolicy"
                 target="_blank" rel="noopener noreferrer"
                 style={{ color: t.accent, textDecoration: "none" }}>
                Fan Content Policy
              </a>
              . Not approved/endorsed by Wizards. Portions of the materials used are
              property of Wizards of the Coast. ©Wizards of the Coast LLC. Card art
              and data from{" "}
              <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer"
                 style={{ color: t.accent, textDecoration: "none" }}>Scryfall</a>.
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

function Section({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...cap, borderBottom: `1px solid ${t.border}`, paddingBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const cap = {
  fontSize: 9, fontWeight: 500, letterSpacing: "0.18em",
  textTransform: "uppercase", color: t.dim,
};
const rowLink = {
  ...mono, fontSize: 11, color: t.accent, textDecoration: "none",
  border: `1px solid ${t.muted}`, minHeight: 44,
  display: "flex", alignItems: "center", justifyContent: "center",
};
