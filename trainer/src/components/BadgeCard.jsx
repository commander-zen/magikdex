import { useState } from "react";

// The badge itself. ONE renderer, used by both the public page and the live
// preview in the editor — so what you see while editing is literally the same
// component a stranger loads, not an approximation of it.
//
// ⚠️ The flip is a 3D CSS transform and cannot be verified in a headless browser:
// it reports the transform as applied without compositing it. Property checks are
// necessary and never sufficient here. Device pass required.

const C = {
  ink: "#1C3A5E", line: "#2E7FC7", soft: "#B9DCF2", pale: "#DCEEFB",
  paler: "#F4FAFF", label: "#3C6E96", ghost: "#8FB4D1",
  hintBg: "#A9D6B0", hintInk: "#2C4A32", barFrom: "#4FA8E8", barTo: "#2E7FC7",
};
const slab = { fontFamily: "'Zilla Slab', serif" };
const mono = { fontFamily: "'Noto Sans Mono', monospace" };

export default function BadgeCard({ card, credentials = [] }) {
  const [flipped, setFlipped] = useState(false);

  const axis = card.identity_mode === "legends" ? card.favorite_legends : card.playstyle;
  const axisLabel = card.identity_mode === "legends" ? "legends" : "playstyle";
  const graded = credentials.length;

  return (
    <>
      <style>{`
        .scene { width: 360px; max-width: 100%; perspective: 1600px; }
        .card3d { position: relative; width: 100%; height: 500px;
          transform-style: preserve-3d;
          transition: transform .7s cubic-bezier(.2,.9,.25,1); cursor: pointer; }
        .card3d.flipped { transform: rotateY(180deg); }
        .face { position: absolute; inset: 0;
          -webkit-backface-visibility: hidden; backface-visibility: hidden;
          border: 3px solid ${C.ink}; border-radius: 20px;
          background: linear-gradient(180deg, ${C.pale} 0%, ${C.soft} 100%);
          overflow: hidden; box-shadow: 0 14px 30px rgba(0,0,0,.5);
          display: flex; flex-direction: column; }
        .face.back { transform: rotateY(180deg); }
        @media (prefers-reduced-motion: reduce) { .card3d { transition: none; } }
      `}</style>

      <div className="scene">
        <div
          className={`card3d${flipped ? " flipped" : ""}`}
          onClick={() => setFlipped(f => !f)}
          role="button"
          tabIndex={0}
          aria-label={flipped ? "Show front of card" : "Show back of card"}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
          }}
        >
          <div className="face front">
            <TitleBar>TRAINER BADGE</TitleBar>
            <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{
                border: `2px solid ${C.line}`, borderRadius: 10,
                background: `linear-gradient(180deg, ${C.paler} 0%, ${C.pale} 100%)`,
                height: 132, marginBottom: 12, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
              }}>
                {card.photo_url
                  ? <img src={card.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ ...slab, fontSize: 48, fontWeight: 700, color: C.soft }}>
                      {(card.display_name || card.handle || "?").slice(0, 1).toUpperCase()}
                    </span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", minHeight: 0 }}>
                <Row label="screen name">@{card.handle}</Row>
                <Row alt label="name" display>{card.display_name}</Row>
                {card.pronouns && <Row label="pronouns">{card.pronouns}</Row>}
                {card.home_region && <Row alt label="plays around">{card.home_region}</Row>}
                <Row label="decks graded">{graded}</Row>
                <Row alt label="trainer since">{monthYear(card.created_at)}</Row>
              </div>
            </div>
            <Hint>tap to see the back →</Hint>
          </div>

          <div className="face back">
            <TitleBar>DECK BADGES</TitleBar>
            <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
              <SectionLabel>
                badge case {graded === 0 ? "· nothing graded yet" : `· ${graded} graded`}
              </SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
                {credentials.map((cr, i) => (
                  <div key={i} style={{
                    aspectRatio: "1", border: `2px solid ${C.line}`, borderRadius: 12,
                    background: C.paler, position: "relative",
                    display: "flex", alignItems: "flex-end", padding: 6,
                  }}>
                    <span style={{ position: "absolute", top: 6, left: 6, ...mono, fontSize: 10, fontWeight: 700, color: C.line }}>
                      {badgeTag(cr)}
                    </span>
                    <span style={{ ...mono, fontSize: 8, color: C.label, lineHeight: 1.2 }}>{cr.issuer}</span>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, 6 - credentials.length) }).map((_, i) => (
                  <div key={`e${i}`} style={{
                    aspectRatio: "1", border: `2px dashed ${C.soft}`, borderRadius: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: i === 0 && credentials.length === 0 ? 1 : 0.5,
                  }}>
                    <span style={{ ...mono, fontSize: 9, color: C.ghost, textAlign: "center", lineHeight: 1.4 }}>
                      {i === 0 && credentials.length === 0 ? "no\ngrades" : ""}
                    </span>
                  </div>
                ))}
              </div>

              {axis?.length > 0 && (<><SectionLabel>{axisLabel}</SectionLabel><Chips values={axis} /></>)}
              {card.philosophy?.length > 0 && (
                <><div style={{ height: 12 }} /><SectionLabel>philosophy</SectionLabel><Chips values={card.philosophy} /></>
              )}
              {!axis?.length && !card.philosophy?.length && (
                <span style={{ ...mono, fontSize: 10, color: C.ghost, lineHeight: 1.6 }}>
                  nothing set yet
                </span>
              )}
              {card.bio && (
                <><div style={{ height: 14 }} /><SectionLabel>about</SectionLabel>
                  <span style={{ ...mono, fontSize: 10, color: C.label, lineHeight: 1.6 }}>{card.bio}</span></>
              )}
            </div>
            <Hint>← tap to flip back</Hint>
          </div>
        </div>
      </div>
    </>
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
      <span style={{ ...slab, color: "#fff", fontWeight: 700, fontSize: 16, letterSpacing: "0.02em" }}>{children}</span>
      <span style={{ color: C.pale, fontSize: 16 }}>›</span>
    </div>
  );
}

function Hint({ children }) {
  return (
    <div style={{
      background: C.hintBg, borderTop: `2px solid ${C.ink}`,
      padding: "10px 16px", marginTop: "auto", flexShrink: 0,
      ...mono, fontSize: 11, color: C.hintInk, textAlign: "center",
    }}>{children}</div>
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
      }}>{children}</span>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ ...mono, fontSize: 11, color: C.label, marginBottom: 8 }}>{children}</div>;
}

function Chips({ values }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {values.map(v => (
        <span key={v} style={{
          ...mono, fontSize: 10, padding: "5px 10px", borderRadius: 999,
          background: C.paler, border: `1px solid ${C.soft}`, color: C.label,
        }}>{v.replace(/_/g, " ")}</span>
      ))}
    </div>
  );
}

// A month is enough provenance for a badge; a full date is one more precise fact
// about a person than a public card needs.
function monthYear(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toLowerCase();
}

function badgeTag(cr) {
  const b = cr.payload?.bracket ?? cr.payload?.rank;
  if (b != null) return `b${b}`;
  if (cr.kind === "lgs_visit") return "lgs";
  if (cr.kind === "event_finish") return "evt";
  return "•";
}
