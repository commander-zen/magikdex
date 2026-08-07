import { useEffect, useState } from "react";
import { getPublicCard, getPublicCredentials } from "../lib/trainer.js";

// /t/<handle> — the badge a stranger sees after a scan, a shared link, or the
// physical card. No auth: this route works signed out, which is the point.
//
// Renders ONLY what get_trainer_card and get_trainer_credentials return. There is
// no second query and no fallback to a table read, so whatever the database
// withholds is withheld here. A private trainer produces the not-found state, and
// that state is deliberately IDENTICAL to a handle that never existed —
// distinguishing them would turn this page into an existence oracle.
//
// ⚠️ THE FLIP IS A 3D CSS TRANSFORM AND CANNOT BE VERIFIED IN THIS ENVIRONMENT.
// magikdex learned this the expensive way: a dead flip once shipped to production
// on the strength of DOM property checks, because the headless browser here
// reports transforms as applied without ever compositing them. Property checks
// are necessary and never sufficient — this needs a real device.

const C = {
  ink:      "#1C3A5E",
  line:     "#2E7FC7",
  soft:     "#B9DCF2",
  pale:     "#DCEEFB",
  paler:    "#F4FAFF",
  label:    "#3C6E96",
  ghost:    "#8FB4D1",
  hintBg:   "#A9D6B0",
  hintInk:  "#2C4A32",
  barFrom:  "#4FA8E8",
  barTo:    "#2E7FC7",
};

const slab = { fontFamily: "'Zilla Slab', serif" };
const mono = { fontFamily: "'Noto Sans Mono', monospace" };

export default function PublicCard({ handle }) {
  const [s, setS] = useState({ loading: true, card: null, creds: [], error: null });
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setS({ loading: true, card: null, creds: [], error: null });
      try {
        const { card, error } = await getPublicCard(handle);
        if (cancelled) return;
        // Credentials are a second call rather than part of the card, because the
        // database returns them individually by design — there is no aggregate,
        // no score, and no single "trust" number anywhere in this schema.
        let creds = [];
        if (card) {
          const r = await getPublicCredentials(handle);
          creds = r.credentials;
        }
        if (!cancelled) setS({ loading: false, card, creds, error });
      } catch (e) {
        if (!cancelled) {
          setS({ loading: false, card: null, creds: [], error: e?.message || "couldn't reach the server" });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  const page = {
    minHeight: "100dvh", background: "#000",
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "32px 16px 60px",
  };

  if (s.loading) {
    return <div style={page}><span style={{ ...mono, fontSize: 12, color: "#6B6B6E" }}>loading…</span></div>;
  }
  if (s.error) {
    return (
      <div style={page}>
        <span style={{ ...mono, fontSize: 12, color: "#e0555f", maxWidth: 340, lineHeight: 1.7, textAlign: "center" }}>
          {s.error}
        </span>
      </div>
    );
  }
  if (!s.card) {
    return (
      <div style={page}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ ...mono, fontSize: 13, color: "#EDEDED" }}>@{handle}</span>
          <span style={{ ...mono, fontSize: 12, color: "#6B6B6E" }}>no card here</span>
        </div>
      </div>
    );
  }

  const c = s.card;
  // identity_mode is a RENDER FLAG: both axes may hold data and exactly one is
  // shown. The database deliberately does not choose — it returns both plus the
  // flag, so this is the only place the decision gets made.
  const axis = c.identity_mode === "legends" ? c.favorite_legends : c.playstyle;
  const axisLabel = c.identity_mode === "legends" ? "legends" : "playstyle";
  const graded = s.creds.length;

  return (
    <div style={page}>
      {/* Scoped stylesheet: 3D flip needs real CSS classes — inline styles cannot
          express backface-visibility or preserve-3d reliably across engines. */}
      <style>{`
        .scene { width: 360px; max-width: 100%; perspective: 1600px; }
        .card3d {
          position: relative; width: 100%; height: 500px;
          transform-style: preserve-3d;
          transition: transform .7s cubic-bezier(.2,.9,.25,1);
          cursor: pointer;
        }
        .card3d.flipped { transform: rotateY(180deg); }
        .face {
          position: absolute; inset: 0;
          -webkit-backface-visibility: hidden; backface-visibility: hidden;
          border: 3px solid ${C.ink}; border-radius: 20px;
          background: linear-gradient(180deg, ${C.pale} 0%, ${C.soft} 100%);
          overflow: hidden; box-shadow: 0 14px 30px rgba(0,0,0,.5);
          display: flex; flex-direction: column;
        }
        .face.back { transform: rotateY(180deg); }
        @media (prefers-reduced-motion: reduce) { .card3d { transition: none; } }
      `}</style>

      <div className="scene">
        <div
          className={`card3d${flipped ? " flipped" : ""}`}
          onClick={() => setFlipped(f => !f)}
          role="button"
          tabIndex={0}
          aria-label={flipped ? "Show trainer details" : "Show deck badges"}
          // Keyboard parity: a div that behaves like a button has to answer to
          // Enter and Space, or the card is unreachable without a pointer.
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
          }}
        >
          {/* ── FRONT ─────────────────────────────────────────────────────── */}
          <div className="face front">
            <TitleBar>TRAINER BADGE</TitleBar>

            <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{
                border: `2px solid ${C.line}`, borderRadius: 10,
                background: `linear-gradient(180deg, ${C.paler} 0%, ${C.pale} 100%)`,
                height: 132, marginBottom: 12, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden",
              }}>
                {c.photo_url
                  ? <img src={c.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ ...slab, fontSize: 48, fontWeight: 700, color: C.soft }}>
                      {(c.display_name || c.handle).slice(0, 1).toUpperCase()}
                    </span>}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", minHeight: 0 }}>
                {/* The handle IS the id — a real, unique, public identifier. No
                    invented card number: a fake sequence implies a registry that
                    does not exist. */}
                <Row alt={false} label="handle">@{c.handle}</Row>
                <Row alt label="name" display>{c.display_name}</Row>
                {c.pronouns   && <Row alt={false} label="pronouns">{c.pronouns}</Row>}
                {c.home_region && <Row alt label="plays around">{c.home_region}</Row>}
                <Row alt={false} label="decks graded">{graded}</Row>
                <Row alt label="trainer since">{monthYear(c.created_at)}</Row>
              </div>
            </div>

            <Hint>tap card to view deck badges →</Hint>
          </div>

          {/* ── BACK ──────────────────────────────────────────────────────── */}
          <div className="face back">
            <TitleBar>DECK BADGES</TitleBar>

            <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
              <SectionLabel>
                badge case · {graded === 0 ? "nothing graded yet" : `${graded} graded`}
              </SectionLabel>

              <div style={{
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8, marginBottom: 16,
              }}>
                {/* Each credential is its own badge, with its own issuer and date.
                    Never summed, never averaged, never turned into a rank — the
                    schema has no function that could, and a test fails if one
                    appears. */}
                {s.creds.map((cr, i) => (
                  <div key={i} style={{
                    aspectRatio: "1", border: `2px solid ${C.line}`, borderRadius: 12,
                    background: C.paler, position: "relative",
                    display: "flex", alignItems: "flex-end", padding: 6,
                  }}>
                    <span style={{
                      position: "absolute", top: 6, left: 6,
                      ...mono, fontSize: 10, fontWeight: 700, color: C.line,
                    }}>
                      {badgeTag(cr)}
                    </span>
                    <span style={{ ...mono, fontSize: 8, color: C.label, lineHeight: 1.2 }}>
                      {cr.issuer}
                    </span>
                  </div>
                ))}
                {/* Empty slots are honest: an ungraded case should look like an
                    ungraded case, not like a feature that failed to load. */}
                {Array.from({ length: Math.max(0, 6 - s.creds.length) }).map((_, i) => (
                  <div key={`e${i}`} style={{
                    aspectRatio: "1", border: `2px dashed ${C.soft}`, borderRadius: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: i === 0 && s.creds.length === 0 ? 1 : 0.55,
                  }}>
                    <span style={{ ...mono, fontSize: 9, color: C.ghost, textAlign: "center", lineHeight: 1.4 }}>
                      {i === 0 && s.creds.length === 0 ? "no\ngrades" : ""}
                    </span>
                  </div>
                ))}
              </div>

              {axis?.length > 0 && (
                <>
                  <SectionLabel>{axisLabel}</SectionLabel>
                  <Chips values={axis} />
                </>
              )}

              {c.philosophy?.length > 0 && (
                <>
                  <div style={{ height: 12 }} />
                  <SectionLabel>philosophy</SectionLabel>
                  <Chips values={c.philosophy} />
                </>
              )}

              {!axis?.length && !c.philosophy?.length && (
                <span style={{ ...mono, fontSize: 10, color: C.ghost, lineHeight: 1.6 }}>
                  this trainer hasn&rsquo;t set a playstyle yet
                </span>
              )}

              {c.bio && (
                <>
                  <div style={{ height: 14 }} />
                  <SectionLabel>about</SectionLabel>
                  <span style={{ ...mono, fontSize: 10, color: C.label, lineHeight: 1.6 }}>{c.bio}</span>
                </>
              )}
            </div>

            <Hint>grading is always user-initiated · tap to flip back ←</Hint>
          </div>
        </div>
      </div>

      <div style={{ ...mono, fontSize: 10, color: "#6B6B6E", marginTop: 20, textAlign: "center" }}>
        tap the card to flip it.
      </div>
    </div>
  );
}

function TitleBar({ children }) {
  return (
    <div style={{
      background: `linear-gradient(180deg, ${C.barFrom} 0%, ${C.barTo} 100%)`,
      padding: "10px 14px", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: `2px solid ${C.ink}`,
    }}>
      <span style={{ color: C.pale, fontSize: 16 }}>‹</span>
      <span style={{ ...slab, color: "#fff", fontWeight: 700, fontSize: 16, letterSpacing: "0.02em" }}>
        {children}
      </span>
      <span style={{ color: C.pale, fontSize: 16 }}>›</span>
    </div>
  );
}

function Row({ label, children, alt, display }) {
  return (
    <div style={{
      border: `1px solid ${C.soft}`, borderRadius: 999, padding: "9px 16px",
      background: alt ? C.pale : C.paler,
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
    }}>
      <span style={{ ...mono, fontSize: 11, color: C.label, flexShrink: 0 }}>{label}</span>
      <span style={{
        ...(display ? slab : mono),
        fontSize: display ? 14 : 13, fontWeight: display ? 700 : 600, color: C.ink,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {children}
      </span>
    </div>
  );
}

// The green footer strip. `margin-top:auto` pins it to the bottom of the face
// regardless of how much content is above it, so a sparse card and a full one
// both end with the same band.
function Hint({ children }) {
  return (
    <div style={{
      background: C.hintBg, borderTop: `2px solid ${C.ink}`,
      padding: "10px 16px", marginTop: "auto", flexShrink: 0,
      ...mono, fontSize: 11, color: C.hintInk,
      textAlign: "center", letterSpacing: "0.02em",
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ ...mono, fontSize: 11, color: C.label, marginBottom: 8, letterSpacing: "0.02em" }}>
      {children}
    </div>
  );
}

function Chips({ values }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {values.map(v => (
        <span key={v} style={{
          ...mono, fontSize: 10, padding: "5px 10px", borderRadius: 999,
          background: C.paler, border: `1px solid ${C.soft}`, color: C.label,
        }}>
          {v.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

// "jan 2024" — a month is enough provenance for a badge, and a full date on a
// public card is one more precise fact about a person than the card needs.
function monthYear(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 7);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toLowerCase();
}

// A short tag for the badge corner. Derived from the credential's own kind and
// payload — never from a computed score.
function badgeTag(cr) {
  const bracket = cr.payload?.bracket ?? cr.payload?.rank;
  if (bracket != null) return `b${bracket}`;
  if (cr.kind === "lgs_visit") return "lgs";
  if (cr.kind === "event_finish") return "evt";
  return "•";
}
