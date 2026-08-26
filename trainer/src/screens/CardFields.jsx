import { useEffect, useState } from "react";
import { aimTheme as t, aimInput, aimBtn } from "../ui/aim.jsx";
import BadgeCard from "../components/BadgeCard.jsx";
import { searchCommanders } from "../lib/scryfall.js";
import {
  updateMyProfile, setCommander, myDecks, myLinks,
  PHILOSOPHY_CHOICES, BIO_MAX, PRONOUNS_MAX, REGION_MAX, regionProblem,
  FOUND_AT_MAX, foundAtProblem,
} from "../lib/trainer.js";

// Neutralised for the AIM window: these screens inherit the page sans now.
// Kept as a spread-in object rather than deleted so the ~20 call sites that
// spread it stay untouched.
const mono = {};

// Your card: LIVE PREVIEW on top, editor underneath. The preview renders from the
// DRAFT using the same component the public page uses, so it is literally what a
// stranger loads — no recall, no imagining, no separate check step.
//
// One save model: nothing persists until you press save, and discard is always
// available.
export default function CardFields({ profile, onSaved }) {
  const [d, setD] = useState(() => fromProfile(profile));
  const [decks, setDecks] = useState([]);
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // The preview needs the real decks and links — since 033 both render on the
  // card's back, and a preview missing them is not the card a stranger loads.
  useEffect(() => {
    myDecks(profile.id).then(r => setDecks(r.decks));
    myLinks(profile.id).then(r => setLinks(r.links));
  }, [profile.id]);

  const clean = fromProfile(profile);
  const dirty = JSON.stringify(d) !== JSON.stringify(clean);
  const regionErr = regionProblem(d.home_region);
  const foundErr = foundAtProblem(d.usually_found_at);
  const canSave = dirty && !busy && !regionErr && !foundErr;

  const patch = next => { setErr(null); setD(p => ({ ...p, ...next })); };

  function togglePhilosophy(v) {
    const has = d.philosophy.includes(v);
    // No cap — all four is a legitimate answer.
    patch({ philosophy: has ? d.philosophy.filter(x => x !== v) : [...d.philosophy, v] });
  }

  async function save() {
    if (!canSave) return;
    setBusy(true); setErr(null);
    const { profile: p, error } = await updateMyProfile(profile.id, {
      display_name: d.display_name.trim() || profile.handle,
      philosophy:   d.philosophy,
      pronouns:     d.pronouns.trim()    || null,
      home_region:  d.home_region.trim() || null,
      usually_found_at: d.usually_found_at.trim() || null,
      bio:          d.bio.trim()         || null,
    });
    setBusy(false);
    if (error) { setErr(error); return; }
    onSaved?.(p);
  }

  const preview = {
    ...profile,
    display_name: d.display_name || profile.handle,
    philosophy:   d.philosophy,
    pronouns:     d.pronouns.trim() || null,
    home_region:  d.home_region.trim() || null,
    usually_found_at: d.usually_found_at.trim() || null,
    bio:          d.bio.trim() || null,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* A compact preview, kept even though the editor now lives in a sheet:
          editing blind and imagining the result was the worst finding in the UX
          audit, and moving the form should not reintroduce it. */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <BadgeCard card={preview} decks={decks} links={links} width={230} />
      </div>
      {dirty && (
        <span style={{ ...mono, fontSize: 10, color: t.accent, textAlign: "center" }}>
          preview shows unsaved changes
        </span>
      )}

      <CommanderPicker profile={profile} onSaved={onSaved} />

      {/* Type line. All four words always render on the card; this picks which are
          lit. The card doubles as its own key that way — you can read what the
          axes are and where this person sits, at the same time. */}
      <Label>type line</Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {PHILOSOPHY_CHOICES.map(v => {
          const on = d.philosophy.includes(v);
          return (
            <button key={v} onClick={() => togglePhilosophy(v)} aria-pressed={on} style={{
              ...mono, fontSize: 11, minHeight: 40, padding: "0 14px",
              background: on ? t.accent : "transparent",
              color: on ? t.base : t.white,
              border: `1px solid ${on ? t.accent : t.muted}`,
              borderRadius: 999, cursor: "pointer",
            }}>{v === "cedh" ? "cEDH" : v.replace(/_/g, " ")}</button>
          );
        })}
      </div>

      <Label>display name</Label>
      <input value={d.display_name} onChange={e => patch({ display_name: e.target.value.slice(0, 40) })}
             placeholder={profile.handle} style={input} />

      <Label>pronouns</Label>
      <input value={d.pronouns} onChange={e => patch({ pronouns: e.target.value.slice(0, PRONOUNS_MAX) })}
             placeholder="they/them" style={input} />

      <Label>where you play</Label>
      <input value={d.home_region} onChange={e => patch({ home_region: e.target.value.slice(0, REGION_MAX) })}
             placeholder="Twin Cities" style={{ ...input, borderColor: regionErr ? t.red : t.muted }} />
      {regionErr && <span style={{ ...mono, fontSize: 10, color: t.red, marginTop: -12 }}>{regionErr}</span>}

      {/* FORWARD-LOOKING, and that is the whole distinction. "where you play" is
          your region; this is the standing answer to "so where do I find you
          again?" — the question that goes unanswered when someone dissolves into
          a Discord server after one good game.

          It is NOT where you met any particular person. That fact belongs to the
          buddy row and must not change when you move shops.

          Free text on purpose: no venue database, and autocompleting against
          shops you have already typed is a later step. A dropdown of real venues
          would need a list of real venues, which is a much bigger decision than
          this field is asking for. */}
      <Label>usually found at</Label>
      <input value={d.usually_found_at}
             onChange={e => patch({ usually_found_at: e.target.value.slice(0, FOUND_AT_MAX) })}
             placeholder="Games Corner, Thursdays · SpellTable / Discord"
             style={{ ...input, borderColor: foundErr ? t.red : t.muted }} />
      {foundErr && <span style={{ ...mono, fontSize: 10, color: t.red, marginTop: -12 }}>{foundErr}</span>}

      <Label>bio · {d.bio.length}/{BIO_MAX}</Label>
      <textarea value={d.bio} onChange={e => patch({ bio: e.target.value.slice(0, BIO_MAX) })}
                placeholder="what someone should know before sitting down with you" rows={3}
                style={{ ...input, minHeight: 78, padding: "10px 12px", resize: "vertical", lineHeight: 1.6 }} />

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={save} disabled={!canSave} style={btn(true, !canSave)}>
          {busy ? "saving…" : dirty ? "save card" : "saved"}
        </button>
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

// The art box. A commander rather than a photo: no uploads, no storage, no
// moderation queue, and no personal image on a public card. Across a table, "the
// Prossh guy" also reads faster than a face.
//
// Saves immediately rather than joining the draft — picking art is a single
// deliberate choice with its own confirmation (the card changes), not a field you
// edit alongside four others.
function CommanderPicker({ profile, onSaved }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return; }
    // Debounced: a request per keystroke is rude to a free API that asks for
    // roughly ten per second at most.
    const id = setTimeout(async () => {
      const { cards } = await searchCommanders(q);
      setHits(cards);
    }, 300);
    return () => clearTimeout(id);
  }, [q, open]);

  async function pick(c) {
    setBusy(true);
    const { profile: p } = await setCommander(profile.id, c);
    setBusy(false);
    setOpen(false); setQ(""); setHits([]);
    if (p) onSaved?.(p);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Label>signature commander</Label>
      {!open ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ ...mono, fontSize: 12, color: profile.commander_name ? t.white : t.dim, flex: 1 }}>
            {profile.commander_name ?? "none picked"}
          </span>
          <button onClick={() => setOpen(true)} style={{ ...btn(false, false), flex: "0 0 auto", padding: "0 16px" }}>
            {profile.commander_name ? "change" : "pick one"}
          </button>
        </div>
      ) : (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} autoFocus
                 placeholder="search a commander" autoCapitalize="off" spellCheck={false} style={input} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
            {hits.map(c => (
              <button key={c.scryfall_id} onClick={() => pick(c)} disabled={busy}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                        background: "transparent", border: `1px solid ${t.border}`,
                        padding: 6, cursor: "pointer", minHeight: 52,
                      }}>
                {c.art_url && (
                  <img src={c.art_url} alt="" style={{ width: 56, height: 40, objectFit: "cover", flexShrink: 0 }} />
                )}
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ ...mono, fontSize: 11, color: t.white }}>{c.name}</span>
                  <span style={{ ...mono, fontSize: 9, color: t.dim }}>art: {c.artist}</span>
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); setQ(""); }} style={btn(false, false)}>cancel</button>
        </>
      )}
      {/* The Fan Content Policy is the permission this operates under, and Scryfall
          asks that art be credited. Both are satisfied by the collector line on the
          card; this just says so out loud. */}
      <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.6 }}>
        art from scryfall, credited on the card. unofficial fan content.
      </span>
    </div>
  );
}

function fromProfile(p) {
  return {
    display_name: p.display_name ?? "",
    philosophy:   p.philosophy ?? [],
    pronouns:     p.pronouns ?? "",
    home_region:  p.home_region ?? "",
    usually_found_at: p.usually_found_at ?? "",
    bio:          p.bio ?? "",
  };
}

const input = aimInput;
const btn = aimBtn;

export function Label({ children }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: t.dim }}>
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
            ...mono, fontSize: 10,
          }}>{lbl}</button>
        );
      })}
    </div>
  );
}
