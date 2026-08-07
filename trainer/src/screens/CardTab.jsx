import { useState } from "react";
import { t } from "../theme.js";
import BadgeCard from "../components/BadgeCard.jsx";
import {
  updateMyProfile,
  PLAYSTYLE_CHOICES, PHILOSOPHY_CHOICES,
  MAX_PLAYSTYLE, MAX_LEGENDS, LEGEND_MAX_LEN,
  BIO_MAX, PRONOUNS_MAX, REGION_MAX, regionProblem,
} from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// Your card: LIVE PREVIEW on top, editor underneath.
//
// The preview renders from the DRAFT, not from the saved row, and uses the same
// BadgeCard component the public page uses. So the thing you are looking at while
// you type is literally what a stranger will load — no recall, no imagining, no
// separate "check it" round trip.
//
// ONE SAVE MODEL across the whole app: nothing persists until you press save.
// The previous version saved visibility on tap while everything else needed a
// button, which taught two contradictory rules on one screen.
export default function CardTab({ profile, credentials, onSaved }) {
  const [d, setD] = useState(() => fromProfile(profile));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const clean = fromProfile(profile);
  const dirty = JSON.stringify(d) !== JSON.stringify(clean);
  const regionErr = regionProblem(d.home_region);
  const canSave = dirty && !busy && !regionErr;

  const patch = next => { setErr(null); setD(p => ({ ...p, ...next })); };

  function togglePlaystyle(v) {
    const has = d.playstyle.includes(v);
    if (!has && d.playstyle.length >= MAX_PLAYSTYLE) return;
    patch({ playstyle: has ? d.playstyle.filter(x => x !== v) : [...d.playstyle, v] });
  }
  function togglePhilosophy(v) {
    const has = d.philosophy.includes(v);
    patch({ philosophy: has ? d.philosophy.filter(x => x !== v) : [...d.philosophy, v] });
  }
  function setLegend(i, value) {
    const next = [...d.legends];
    next[i] = value.slice(0, LEGEND_MAX_LEN);
    patch({ legends: next });
  }

  async function save() {
    if (!canSave) return;
    setBusy(true); setErr(null);
    const { profile: p, error } = await updateMyProfile(profile.id, {
      display_name:     d.display_name.trim() || profile.handle,
      identity_mode:    d.identity_mode,
      playstyle:        d.playstyle,
      favorite_legends: d.legends.map(s => s.trim()).filter(Boolean),
      philosophy:       d.philosophy,
      pronouns:         d.pronouns.trim()    || null,
      home_region:      d.home_region.trim() || null,
      bio:              d.bio.trim()         || null,
    });
    setBusy(false);
    if (error) { setErr(error); return; }
    onSaved?.(p);
  }

  // The preview needs a card-shaped object. Draft fields override the saved row,
  // so unsaved edits show immediately.
  const preview = {
    ...profile,
    display_name: d.display_name || profile.handle,
    identity_mode: d.identity_mode,
    playstyle: d.playstyle,
    favorite_legends: d.legends.map(s => s.trim()).filter(Boolean),
    philosophy: d.philosophy,
    pronouns: d.pronouns.trim() || null,
    home_region: d.home_region.trim() || null,
    bio: d.bio.trim() || null,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <BadgeCard card={preview} credentials={credentials} />
      </div>

      {dirty && (
        <span style={{ ...mono, fontSize: 10, color: t.accent, textAlign: "center" }}>
          preview shows unsaved changes
        </span>
      )}

      <Label>what represents you</Label>
      <Segmented
        value={d.identity_mode}
        options={[["playstyle", "PLAYSTYLE"], ["legends", "LEGENDS"]]}
        onChange={v => patch({ identity_mode: v })}
      />

      {d.identity_mode === "legends" ? (
        <>
          <Label>favourite legends · up to {MAX_LEGENDS}</Label>
          {Array.from({ length: MAX_LEGENDS }).map((_, i) => (
            <input key={i} value={d.legends[i] ?? ""} onChange={e => setLegend(i, e.target.value)}
                   placeholder={i === 0 ? "Prossh, Skyraider of Kher" : "another legend"} style={input} />
          ))}
        </>
      ) : (
        <>
          <Label>playstyle · {d.playstyle.length}/{MAX_PLAYSTYLE}</Label>
          <Chips values={PLAYSTYLE_CHOICES} selected={d.playstyle}
                 onToggle={togglePlaystyle} capped={d.playstyle.length >= MAX_PLAYSTYLE} />
        </>
      )}

      <Label>philosophy</Label>
      <Chips values={PHILOSOPHY_CHOICES} selected={d.philosophy} onToggle={togglePhilosophy} capped={false} />

      <Label>display name</Label>
      <input value={d.display_name} onChange={e => patch({ display_name: e.target.value.slice(0, 40) })}
             placeholder={profile.handle} style={input} />

      <Label>pronouns</Label>
      <input value={d.pronouns} onChange={e => patch({ pronouns: e.target.value.slice(0, PRONOUNS_MAX) })}
             placeholder="they/them" style={input} />

      <Label>where you play</Label>
      <input value={d.home_region} onChange={e => patch({ home_region: e.target.value.slice(0, REGION_MAX) })}
             placeholder="Twin Cities" style={{ ...input, borderColor: regionErr ? t.red : t.muted }} />
      {/* One of only two pieces of standing help left. It survives because the
          rule is genuinely surprising: the column refuses coordinates outright. */}
      {regionErr && <Hint tone="error">{regionErr}</Hint>}

      <Label>bio · {d.bio.length}/{BIO_MAX}</Label>
      <textarea value={d.bio} onChange={e => patch({ bio: e.target.value.slice(0, BIO_MAX) })}
                placeholder="what someone should know before sitting down with you" rows={3}
                style={{ ...input, minHeight: 78, padding: "10px 12px", resize: "vertical", lineHeight: 1.6 }} />

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={save} disabled={!canSave} style={btn(true, !canSave)}>
          {busy ? "saving…" : dirty ? "save card" : "saved"}
        </button>
        {/* User control and freedom: an editor with no exit but "save" traps you
            in changes you have decided against. */}
        {dirty && (
          <button onClick={() => { setD(clean); setErr(null); }} disabled={busy} style={btn(false, busy)}>
            discard
          </button>
        )}
      </div>

      {err && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>}
    </div>
  );
}

function fromProfile(p) {
  return {
    display_name:  p.display_name ?? "",
    identity_mode: p.identity_mode ?? "playstyle",
    playstyle:     p.playstyle ?? [],
    legends:       pad(p.favorite_legends ?? [], MAX_LEGENDS),
    philosophy:    p.philosophy ?? [],
    pronouns:      p.pronouns ?? "",
    home_region:   p.home_region ?? "",
    bio:           p.bio ?? "",
  };
}
function pad(a, n) { const o = [...a]; while (o.length < n) o.push(""); return o.slice(0, n); }

const input = {
  width: "100%", boxSizing: "border-box", minHeight: 46,
  background: "transparent", color: t.white, ...mono, fontSize: 13,
  border: `1px solid ${t.muted}`, padding: "0 12px", borderRadius: 0, outline: "none",
};
const btn = (primary, disabled) => ({
  minHeight: 48, flex: 1, background: "transparent",
  border: `1px solid ${disabled ? t.muted : primary ? t.accent : t.dim}`,
  color: disabled ? t.dim : primary ? t.accent : t.dim,
  ...mono, fontSize: 12,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
});

export function Label({ children }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: t.dim }}>
      {children}
    </span>
  );
}
export function Hint({ children, tone }) {
  return (
    <span style={{ ...mono, fontSize: 10, lineHeight: 1.6, marginTop: -12, color: tone === "error" ? t.red : t.dim }}>
      {children}
    </span>
  );
}
export function Segmented({ value, options, onChange }) {
  return (
    <div style={{ display: "flex", border: `1px solid ${t.muted}` }}>
      {options.map(([v, lbl], i) => {
        const on = value === v;
        return (
          <button key={v} onClick={() => onChange(v)} style={{
            flex: 1, minHeight: 44, cursor: "pointer", border: "none",
            borderLeft: i ? `1px solid ${t.muted}` : "none",
            background: on ? t.accent : "transparent", color: on ? t.base : t.dim,
            ...mono, fontSize: 11,
          }}>{lbl}</button>
        );
      })}
    </div>
  );
}
function Chips({ values, selected, onToggle, capped }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      {values.map(v => {
        const on = selected.includes(v);
        // At the cap, unselected chips dim rather than vanish — the vocabulary is
        // fixed and seeing all of it is the point.
        const blocked = capped && !on;
        return (
          <button key={v} onClick={() => onToggle(v)} aria-pressed={on} style={{
            ...mono, fontSize: 11, minHeight: 38, padding: "0 12px",
            cursor: blocked ? "default" : "pointer",
            background: on ? t.accent : "transparent",
            color: on ? t.base : blocked ? t.muted : t.white,
            border: `1px solid ${on ? t.accent : t.muted}`,
            borderRadius: 999, opacity: blocked ? 0.45 : 1,
          }}>{v.replace(/_/g, " ")}</button>
        );
      })}
    </div>
  );
}
