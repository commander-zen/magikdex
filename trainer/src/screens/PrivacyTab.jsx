import { useState } from "react";
import { t } from "../theme.js";
import { updateMyProfile, getPublicCard, VISIBILITY_CHOICES } from "../lib/trainer.js";
import { Label } from "./CardTab.jsx";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// Who can see your card, on its own surface — it is a different decision from
// what the card says, and mixing them was most of why the old screen felt like a
// wall of controls.
//
// EXPLICIT SAVE, matching the card editor. This used to persist on tap while the
// editor below it required a button, which taught two contradictory rules on one
// screen.
export default function PrivacyTab({ profile, onSaved }) {
  const [choice, setChoice] = useState(profile.visibility);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [peek, setPeek] = useState(null);
  const [peekBusy, setPeekBusy] = useState(false);

  const dirty = choice !== profile.visibility;

  async function save() {
    if (!dirty || busy) return;
    setBusy(true); setErr(null);
    const { profile: p, error } = await updateMyProfile(profile.id, { visibility: choice });
    setBusy(false);
    if (error) { setErr(error); return; }
    setPeek(null); // the answer just changed — a stale check would mislead
    onSaved?.(p);
  }

  async function check() {
    if (peekBusy) return;
    setPeekBusy(true);
    const { card, error } = await getPublicCard(profile.handle);
    setPeekBusy(false);
    // A null card is the CORRECT answer for a private trainer, so it renders as a
    // result rather than an error.
    setPeek({ card: card ?? null, error });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Label>who can see your card</Label>

      {VISIBILITY_CHOICES.map(c => {
        const on = choice === c.value;
        return (
          <div key={c.value} onClick={() => { setErr(null); setChoice(c.value); }}
               style={{
                 display: "flex", alignItems: "center", justifyContent: "space-between",
                 minHeight: 54, padding: "10px 12px",
                 border: `1px solid ${on ? t.accent : t.border}`,
                 cursor: "pointer",
               }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ ...mono, fontSize: 12, color: on ? t.accent : t.white }}>{c.label}</span>
              <span style={{ fontSize: 11, color: t.dim }}>{c.hint}</span>
            </span>
            <span style={{
              width: 10, height: 10, flexShrink: 0,
              background: on ? t.accent : "transparent",
              border: `1px solid ${on ? t.accent : t.muted}`,
            }} />
          </div>
        );
      })}

      {dirty && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} disabled={busy} style={btn(true, busy)}>
            {busy ? "saving…" : "save"}
          </button>
          <button onClick={() => { setChoice(profile.visibility); setErr(null); }}
                  disabled={busy} style={btn(false, busy)}>
            discard
          </button>
        </div>
      )}

      {err && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>}

      <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <Label>check it</Label>
        <button onClick={check} disabled={peekBusy || dirty} style={btn(false, peekBusy || dirty)}>
          {peekBusy ? "checking…" : dirty ? "save first, then check" : "what a stranger sees"}
        </button>
        {peek && (
          <div style={{ padding: 12, border: `1px dashed ${t.muted}`, display: "flex", flexDirection: "column", gap: 6 }}>
            {peek.error ? (
              <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{peek.error}</span>
            ) : peek.card ? (
              <>
                <span style={{ ...mono, fontSize: 12, color: t.accent }}>@{peek.card.handle}</span>
                <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
                  visible as {peek.card.visibility} · no account id is published with it
                </span>
              </>
            ) : (
              <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
                nothing — your card returns no data to anyone, even with your exact handle
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const btn = (primary, disabled) => ({
  minHeight: 48, flex: 1, background: "transparent",
  border: `1px solid ${disabled ? t.muted : primary ? t.accent : t.dim}`,
  color: disabled ? t.dim : primary ? t.accent : t.dim,
  ...mono, fontSize: 12,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
});
