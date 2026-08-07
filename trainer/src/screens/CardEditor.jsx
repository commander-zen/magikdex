import { useState } from "react";
import { t } from "../theme.js";
import {
  updateMyProfile,
  PLAYSTYLE_CHOICES, PHILOSOPHY_CHOICES,
  MAX_PLAYSTYLE, MAX_LEGENDS, LEGEND_MAX_LEN,
  BIO_MAX, PRONOUNS_MAX, REGION_MAX, regionProblem,
} from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// Everything on the card except the handle. Kept out of MyCard because that file
// already owns four states (signed out, code entry, claiming, claimed) and this
// is a fifth concern with its own draft lifecycle.
//
// DRAFT + EXPLICIT SAVE, not save-on-tap. Three reasons: the caps are only
// checkable across a whole selection, a chip grid would otherwise fire a request
// per tap, and a half-built identity should not be visible to strangers between
// taps while the card is public.
export default function CardEditor({ profile, onSaved }) {
  const [d, setD] = useState(() => fromProfile(profile));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(d) !== JSON.stringify(fromProfile(profile));
  const regionErr = regionProblem(d.home_region);
  const canSave = dirty && !busy && !regionErr;

  function patch(next) {
    setSaved(false);
    setErr(null);
    setD(prev => ({ ...prev, ...next }));
  }

  function togglePlaystyle(v) {
    const has = d.playstyle.includes(v);
    if (!has && d.playstyle.length >= MAX_PLAYSTYLE) return; // cap, silently
    patch({ playstyle: has ? d.playstyle.filter(x => x !== v) : [...d.playstyle, v] });
  }

  function togglePhilosophy(v) {
    const has = d.philosophy.includes(v);
    // No cap here on purpose — a trainer can honestly claim all four.
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
    // Empty strings become NULL: the columns are nullable and "" is not a
    // pronoun. Arrays drop blanks and are sent as [] rather than null so the
    // card's `?.length` checks stay simple.
    const { profile: p, error } = await updateMyProfile(profile.id, {
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
    setSaved(true);
    onSaved?.(p);
  }

  const showingLegends = d.identity_mode === "legends";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Label>what represents you</Label>

      {/* identity_mode is a RENDER FLAG, not a constraint: both axes keep their
          data and only one is shown. Saying so out loud stops it reading as
          "switching will erase what I typed". */}
      <div style={{ display: "flex", border: `1px solid ${t.muted}` }}>
        {[["playstyle", "PLAYSTYLE"], ["legends", "LEGENDS"]].map(([v, lbl], i) => {
          const on = d.identity_mode === v;
          return (
            <button
              key={v}
              onClick={() => patch({ identity_mode: v })}
              style={{
                flex: 1, minHeight: 44, cursor: "pointer",
                border: "none", borderLeft: i ? `1px solid ${t.muted}` : "none",
                background: on ? t.accent : "transparent",
                color: on ? t.base : t.dim,
                ...mono, fontSize: 11,
              }}
            >
              {lbl}
            </button>
          );
        })}
      </div>
      <Note>
        only this one shows on your card. the other keeps whatever you put in it.
      </Note>

      {showingLegends ? (
        <>
          <Label>favourite legends · up to {MAX_LEGENDS}</Label>
          {Array.from({ length: MAX_LEGENDS }).map((_, i) => (
            <input
              key={i}
              value={d.legends[i] ?? ""}
              onChange={e => setLegend(i, e.target.value)}
              placeholder={i === 0 ? "e.g. Prossh, Skyraider of Kher" : "another legend"}
              style={inputStyle}
            />
          ))}
          <Note>free text — any commander, including ones printed next week.</Note>
        </>
      ) : (
        <>
          <Label>
            playstyle · {d.playstyle.length}/{MAX_PLAYSTYLE}
          </Label>
          <ChipGrid
            values={PLAYSTYLE_CHOICES}
            selected={d.playstyle}
            onToggle={togglePlaystyle}
            capped={d.playstyle.length >= MAX_PLAYSTYLE}
          />
          <Note>
            a fixed list, so every card reads the same way. three is the card&rsquo;s budget.
          </Note>
        </>
      )}

      <Label>philosophy</Label>
      <ChipGrid
        values={PHILOSOPHY_CHOICES}
        selected={d.philosophy}
        onToggle={togglePhilosophy}
        capped={false}
      />
      <Note>no limit — claim all four if that&rsquo;s honest.</Note>

      <Label>pronouns</Label>
      <input
        value={d.pronouns}
        onChange={e => patch({ pronouns: e.target.value.slice(0, PRONOUNS_MAX) })}
        placeholder="they/them"
        style={inputStyle}
      />

      <Label>where you play</Label>
      <input
        value={d.home_region}
        onChange={e => patch({ home_region: e.target.value.slice(0, REGION_MAX) })}
        placeholder="Twin Cities · north side · your LGS"
        style={{ ...inputStyle, borderColor: regionErr ? t.red : t.muted }}
      />
      {/* The database refuses coordinates outright, so catching it here turns a
          constraint violation into a sentence. */}
      <Note tone={regionErr ? "error" : "dim"}>
        {regionErr ?? "a place, not an address — this is on a public card."}
      </Note>

      <Label>bio · {d.bio.length}/{BIO_MAX}</Label>
      <textarea
        value={d.bio}
        onChange={e => patch({ bio: e.target.value.slice(0, BIO_MAX) })}
        placeholder="what someone should know before sitting down with you"
        rows={3}
        style={{ ...inputStyle, minHeight: 78, padding: "10px 12px", resize: "vertical", lineHeight: 1.6 }}
      />

      <button
        onClick={save}
        disabled={!canSave}
        style={{
          minHeight: 48, marginTop: 4,
          background: "transparent",
          border: `1px solid ${canSave ? t.accent : t.muted}`,
          color: canSave ? t.accent : t.dim,
          ...mono, fontSize: 12,
          cursor: canSave ? "pointer" : "default",
          opacity: canSave ? 1 : 0.55,
        }}
      >
        {busy ? "saving…" : saved && !dirty ? "saved ✓" : dirty ? "save card" : "no changes"}
      </button>

      {err && (
        <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>
      )}
    </div>
  );
}

// Arrays can come back null from columns that are nullable, so every read is
// defended — a null playstyle must become [] here, not crash the map below.
function fromProfile(p) {
  return {
    identity_mode: p.identity_mode ?? "playstyle",
    playstyle:     p.playstyle ?? [],
    legends:       padTo(p.favorite_legends ?? [], MAX_LEGENDS),
    philosophy:    p.philosophy ?? [],
    pronouns:      p.pronouns ?? "",
    home_region:   p.home_region ?? "",
    bio:           p.bio ?? "",
  };
}

function padTo(arr, n) {
  const out = [...arr];
  while (out.length < n) out.push("");
  return out.slice(0, n);
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", minHeight: 46,
  background: "transparent", color: t.white,
  ...mono, fontSize: 13,
  border: `1px solid ${t.muted}`, padding: "0 12px", borderRadius: 0, outline: "none",
};

function Label({ children }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 500, letterSpacing: "0.18em",
      textTransform: "uppercase", color: t.dim,
    }}>
      {children}
    </span>
  );
}

function Note({ children, tone = "dim" }) {
  return (
    <span style={{
      ...mono, fontSize: 10, lineHeight: 1.6, marginTop: -10,
      color: tone === "error" ? t.red : t.dim,
    }}>
      {children}
    </span>
  );
}

function ChipGrid({ values, selected, onToggle, capped }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      {values.map(v => {
        const on = selected.includes(v);
        // At the cap, unselected chips dim rather than vanish: the vocabulary is
        // fixed and seeing the whole list is the point — hiding options would
        // read as a loading bug.
        const blocked = capped && !on;
        return (
          <button
            key={v}
            onClick={() => onToggle(v)}
            aria-pressed={on}
            style={{
              ...mono, fontSize: 11,
              minHeight: 38, padding: "0 12px",
              cursor: blocked ? "default" : "pointer",
              background: on ? t.accent : "transparent",
              color: on ? t.base : blocked ? t.muted : t.white,
              border: `1px solid ${on ? t.accent : t.muted}`,
              borderRadius: 999,
              opacity: blocked ? 0.45 : 1,
            }}
          >
            {v.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}
