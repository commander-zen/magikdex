import { useState } from "react";
import { PHILOSOPHY_CHOICES } from "../lib/trainer.js";

// The trainer card, built on the Magic frame — because it will live in a deck box
// and get pulled out next to real cards. True 63:88 proportions, and the same
// vertical rhythm: title bar, art, type line, text box, collector line.
//
// ONE renderer for the public page and the live editor preview, so what you see
// while editing is literally what a stranger loads.
//
// The frame is dark rather than a colour: on a real card the border colour comes
// from colour identity, which this card does not have. Letting the commander's art
// supply all the colour keeps every card consistent and stops the frame competing
// with the artwork.

const C = {
  edge:    "#0a0a0c",  // black border, like a modern card
  frame:   "#1a1d24",
  panel:   "#12151a",
  bar:     "#232833",
  ink:     "#e8eaed",
  dim:     "#8892a0",
  faint:   "#5a6672",
  accent:  "#38bdf8",
  line:    "#2a3138",
};
const slab = { fontFamily: "'Zilla Slab', serif" };
const mono = { fontFamily: "'Noto Sans Mono', monospace" };

export default function BadgeCard({ card, decks = [], width = 340 }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <>
      <style>{`
        .tc-scene { width: ${width}px; max-width: 100%; perspective: 1800px; }
        /* 63mm x 88mm. The proportion is the point — it has to sit in a deck box
           next to real cards without looking wrong. */
        .tc-card { position: relative; width: 100%; aspect-ratio: 63 / 88;
          transform-style: preserve-3d;
          transition: transform .7s cubic-bezier(.2,.9,.25,1); cursor: pointer; }
        .tc-card.flipped { transform: rotateY(180deg); }
        .tc-face { position: absolute; inset: 0;
          -webkit-backface-visibility: hidden; backface-visibility: hidden;
          background: ${C.edge}; border-radius: 15px; padding: 9px;
          box-shadow: 0 16px 34px rgba(0,0,0,.55);
          display: flex; flex-direction: column; }
        .tc-face.back { transform: rotateY(180deg); }
        .tc-inner { flex: 1; min-height: 0; background: ${C.frame};
          border-radius: 8px; overflow: hidden;
          display: flex; flex-direction: column; }
        @media (prefers-reduced-motion: reduce) { .tc-card { transition: none; } }
      `}</style>

      <div className="tc-scene">
        <div
          className={`tc-card${flipped ? " flipped" : ""}`}
          onClick={() => setFlipped(f => !f)}
          role="button" tabIndex={0}
          aria-label={flipped ? "Show front of card" : "Show back of card"}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
          }}
        >
          {/* ── FRONT ─────────────────────────────────────────────────────── */}
          <div className="tc-face front">
            <div className="tc-inner">
              {/* Title bar — screen name only. No mana cost: the Magic card is a
                  model for size and rhythm here, not a system to reimplement. */}
              <Bar>
                <span style={{ ...slab, fontSize: 17, fontWeight: 600, color: C.ink }}>
                  @{card.handle}
                </span>
              </Bar>

              {/* Art box */}
              <div style={{
                flex: "0 0 43%", position: "relative", overflow: "hidden",
                borderTop: `1px solid ${C.edge}`, borderBottom: `1px solid ${C.edge}`,
                background: C.panel,
              }}>
                {card.commander_art_url ? (
                  <img src={card.commander_art_url} alt=""
                       style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{
                    width: "100%", height: "100%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    ...mono, fontSize: 10, color: C.faint, textAlign: "center", padding: 16,
                  }}>
                    pick a signature commander
                  </div>
                )}
              </div>

              {/* Type line — ALWAYS all four words. It doubles as the key: you can
                  read what the axes are and where this person sits, at once. Lit
                  means claimed. */}
              <Bar tight>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "baseline" }}>
                  {PHILOSOPHY_CHOICES.map((v, i) => {
                    const on = card.philosophy?.includes(v);
                    return (
                      <span key={v} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                        {i > 0 && <span style={{ ...mono, fontSize: 9, color: C.line }}>//</span>}
                        <span style={{
                          ...slab, fontSize: 12,
                          fontWeight: on ? 700 : 400,
                          color: on ? C.accent : C.faint,
                        }}>
                          {label(v)}
                        </span>
                      </span>
                    );
                  })}
                </span>
              </Bar>

              {/* Text box — the three decks. */}
              <div style={{
                flex: 1, minHeight: 0, background: C.panel, padding: "8px 10px",
                display: "flex", flexDirection: "column", gap: 6, overflowY: "auto",
              }}>
                {decks.length === 0 ? (
                  <span style={{ ...mono, fontSize: 10, color: C.faint, lineHeight: 1.6 }}>
                    no decks listed yet
                  </span>
                ) : decks.map(d => <DeckRow key={d.position} deck={d} />)}
              </div>

              {/* Collector line — the artist credit lives here, exactly where a
                  real card puts it. Scryfall asks for it and the frame wants it. */}
              <div style={{
                flex: "0 0 auto", background: C.edge, padding: "5px 10px",
                display: "flex", justifyContent: "space-between", gap: 8,
                ...mono, fontSize: 8, color: C.faint,
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {card.display_name}
                </span>
                <span style={{ flexShrink: 0 }}>
                  {card.commander_artist ? `art: ${card.commander_artist}` : "magikdex"}
                </span>
              </div>
            </div>
          </div>

          {/* ── BACK ──────────────────────────────────────────────────────── */}
          <div className="tc-face back">
            <div className="tc-inner">
              <Bar>
                <span style={{ ...slab, fontSize: 15, fontWeight: 600, color: C.ink }}>
                  {card.display_name}
                </span>
              </Bar>

              <div style={{
                flex: 1, minHeight: 0, background: C.panel, padding: "12px 12px",
                display: "flex", flexDirection: "column", gap: 12, overflowY: "auto",
              }}>
                {card.pronouns   && <Field label="pronouns">{card.pronouns}</Field>}
                {card.home_region && <Field label="plays around">{card.home_region}</Field>}
                {card.commander_name && <Field label="signature">{card.commander_name}</Field>}
                {card.bio && (
                  <Field label="about">
                    <span style={{ lineHeight: 1.65 }}>{card.bio}</span>
                  </Field>
                )}
                {!card.pronouns && !card.home_region && !card.bio && !card.commander_name && (
                  <span style={{ ...mono, fontSize: 10, color: C.faint }}>nothing on the back yet</span>
                )}
              </div>

              <div style={{
                flex: "0 0 auto", background: C.edge, padding: "5px 10px",
                ...mono, fontSize: 8, color: C.faint,
                display: "flex", justifyContent: "space-between",
              }}>
                <span>@{card.handle}</span>
                <span>trainer since {monthYear(card.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Bar({ children, tight }) {
  return (
    <div style={{
      flex: "0 0 auto", background: C.bar,
      padding: tight ? "5px 10px" : "7px 10px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    }}>
      {children}
    </div>
  );
}

// A deck row is a name, its rating, and links to where it actually lives. The
// links are the point: a card that names a deck without letting you go read it is
// a dead end.
function DeckRow({ deck }) {
  const stop = e => e.stopPropagation(); // the card flips on click; links must not
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...slab, fontSize: 13, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {deck.name}
        </span>
        {deck.rating && (
          <span style={{ ...mono, fontSize: 12, color: C.accent, flexShrink: 0 }}>{deck.rating}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        {deck.deck_url && (
          <a href={deck.deck_url} target="_blank" rel="noopener noreferrer" onClick={stop}
             style={{ ...mono, fontSize: 8, color: C.dim, textDecoration: "none" }}>
            {hostLabel(deck.deck_url)} ↗
          </a>
        )}
        {/* The receipt. The rating above is self-reported; this is how a reader
            checks it in one tap, which is why we never needed to scrape it. */}
        {deck.scrycheck_url && (
          <a href={deck.scrycheck_url} target="_blank" rel="noopener noreferrer" onClick={stop}
             style={{ ...mono, fontSize: 8, color: C.accent, textDecoration: "none" }}>
            scrycheck ↗
          </a>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...mono, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>
        {label}
      </span>
      <span style={{ ...mono, fontSize: 11, color: C.ink }}>{children}</span>
    </div>
  );
}

// trash_magic reads as "trash magic" on the card; the underscore is a database
// concern, not a person's.
function label(v) { return v === "cedh" ? "cEDH" : v.replace(/_/g, " "); }

function hostLabel(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h.replace(/\.(com|net|gg|app)$/, "");
  } catch { return "deck"; }
}

function monthYear(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toLowerCase();
}
