import { useEffect, useState } from "react";
import QRCode from "qrcode";
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

// Everything inside the card is sized in `cqw` — percentages of the CARD's own
// width — so one renderer works at any size. Numbers below are still written as
// the pixels they were designed at, on a 340px-wide card; u() converts.
const BASIS = 340;
const u = n => `${((n * 100) / BASIS).toFixed(3)}cqw`;

// `width` omitted means "fill the space you're given" — the hero case. Pass a
// number for a deliberately small copy (the editor's preview), or any CSS length
// string — `"63mm"` is how the print sheet gets a true-size card, and because the
// internals are in cqw they scale to physical units for free.
//
// The width MUST be an inline style, never part of the <style> block: class names
// are global, and two mounted cards would fight over `.tc-scene`. (They did. The
// off-screen settings preview was quietly shrinking the real card.)
//
// `flat` renders the front only, with no 3D scene: for print, where a transform
// is a liability and there is nothing to tap.
// THE TWO FACES HAVE DIFFERENT JOBS. Front is STATIC: handle, QR, how you enjoy
// the game. It prints once and rides in a deck box, so nothing that changes may
// live on it — which is why the decks moved to the back in 033. A deck list is the
// thing about a player that changes most, and a printed card carrying one is stale
// the next time they brew. Back SCROLLS, holds everything mutable, and is never
// printed (it isn't rendered at all when `flat`).
export default function BadgeCard({ card, decks = [], links = [], width = null, flat = false }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <>
      <style>{`
        .tc-scene { max-width: 100%; perspective: 1800px;
          container-type: inline-size; }
        /* 63mm x 88mm. The proportion is the point — it has to sit in a deck box
           next to real cards without looking wrong. */
        .tc-card { position: relative; width: 100%; aspect-ratio: 63 / 88;
          transform-style: preserve-3d;
          transition: transform .7s cubic-bezier(.2,.9,.25,1); cursor: pointer; }
        .tc-card.flipped { transform: rotateY(180deg); }
        /* Print: no transform, no transition, and a square outer edge — that edge
           is the cut line, so it must be where the scissors go. */
        .tc-card.flat { transform-style: flat; transition: none; cursor: default; }
        .tc-card.flat > .tc-face { border-radius: 0; box-shadow: none; }
        .tc-face { position: absolute; inset: 0;
          -webkit-backface-visibility: hidden; backface-visibility: hidden;
          background: ${C.edge}; border-radius: ${u(15)}; padding: ${u(9)};
          box-shadow: 0 16px 34px rgba(0,0,0,.55);
          display: flex; flex-direction: column; }
        .tc-face.back { transform: rotateY(180deg); }
        .tc-inner { flex: 1; min-height: 0; background: ${C.frame};
          border-radius: ${u(8)}; overflow: hidden;
          display: flex; flex-direction: column; }
        @media (prefers-reduced-motion: reduce) { .tc-card { transition: none; } }
      `}</style>

      <div className="tc-scene" style={{
        width: width == null ? "100%" : typeof width === "number" ? `${width}px` : width,
      }}>
        <div
          className={`tc-card${flipped ? " flipped" : ""}${flat ? " flat" : ""}`}
          onClick={flat ? undefined : () => setFlipped(f => !f)}
          role={flat ? undefined : "button"}
          tabIndex={flat ? undefined : 0}
          aria-label={flat ? undefined : flipped ? "Show front of card" : "Show back of card"}
          onKeyDown={flat ? undefined : e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
          }}
        >
          {/* ── FRONT ─────────────────────────────────────────────────────── */}
          <div className="tc-face front">
            <div className="tc-inner">
              {/* Title bar — screen name only. No mana cost: the Magic card is a
                  model for size and rhythm here, not a system to reimplement. */}
              <Bar>
                <span style={{ ...slab, fontSize: u(17), fontWeight: 600, color: C.ink }}>
                  @{card.handle}
                </span>
              </Bar>

              {/* THE ART BOX IS THE QR CODE.
                  The card's job is "scan this so we can play again", and this is
                  the largest real estate on it — decoration was the wrong tenant.
                  Commander art stays as a dimmed wash behind, which also fixes the
                  confusion that art in a card frame reads as "a card OF that
                  commander", making the deck rows below look like they belonged to
                  it.

                  GENERATED ON DEVICE. A QR web service would mean every user's
                  card URL travelling to a third party just to draw a square. */}
              {/* `flex: 1` — the QR now takes ALL the room the deck rows used to
                  occupy. That is the point of moving them: this square is the
                  card's entire function, it is what a phone camera has to find
                  across a table in bad light, and it was sharing the face with a
                  list that changes every time you brew. */}
              <div style={{
                flex: 1, minHeight: 0, position: "relative", overflow: "hidden",
                borderTop: `1px solid ${C.edge}`, borderBottom: `1px solid ${C.edge}`,
                background: C.panel,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {card.commander_art_url && (
                  <img src={card.commander_art_url} alt=""
                       style={{
                         position: "absolute", inset: 0, width: "100%", height: "100%",
                         objectFit: "cover", opacity: 0.28,
                       }} />
                )}
                <QrPanel handle={card.handle} />
              </div>

              {/* Type line — ALWAYS all four words. It doubles as the key: you can
                  read what the axes are and where this person sits, at once. Lit
                  means claimed. */}
              <Bar tight>
                <span style={{ display: "flex", flexWrap: "wrap", gap: u(4), alignItems: "baseline" }}>
                  {PHILOSOPHY_CHOICES.map((v, i) => {
                    const on = card.philosophy?.includes(v);
                    return (
                      <span key={v} style={{ display: "flex", alignItems: "baseline", gap: u(4) }}>
                        {i > 0 && <span style={{ ...mono, fontSize: u(9), color: C.line }}>//</span>}
                        <span style={{
                          ...slab, fontSize: u(12),
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

              {/* No text box. The decks that filled it live on the back now — see
                  the note at the top of this file. */}

              {/* Collector line — the artist credit lives here, exactly where a
                  real card puts it. Scryfall asks for it and the frame wants it. */}
              <div style={{
                flex: "0 0 auto", background: C.edge, padding: `${u(5)} ${u(10)}`,
                display: "flex", justifyContent: "space-between", gap: u(8),
                ...mono, fontSize: u(8), color: C.faint,
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
          {/* Omitted entirely when flat: `backface-visibility` is not reliably
              honoured in print, and a second absolutely-positioned face would
              print straight over the front. */}
          {!flat && (
          <div className="tc-face back">
            <div className="tc-inner">
              <Bar>
                <span style={{ ...slab, fontSize: u(15), fontWeight: 600, color: C.ink }}>
                  {card.display_name}
                </span>
              </Bar>

              <div style={{
                flex: 1, minHeight: 0, background: C.panel, padding: u(12),
                display: "flex", flexDirection: "column", gap: u(12), overflowY: "auto",
              }}>
                {/* Availability first — it is the only field here that is about
                    RIGHT NOW, and burying it under three standing facts would
                    make the reader work for the one thing that decays.

                    IT ONLY RENDERS ON SCREEN. The back of the card is omitted
                    entirely when `flat`, which is the print path, so a paper card
                    can never carry a frozen "ready to pod up" that stopped being
                    true the night it came out of the printer. Worth stating,
                    because the first instinct on seeing this field is to put it
                    on the front, where print WOULD pick it up. */}
                {card.ready_to_pod && (
                  <Field label="right now">
                    <span style={{ color: C.accent }}>
                      ready to pod up{card.ready_note ? ` · ${card.ready_note}` : ""}
                    </span>
                  </Field>
                )}
                {card.pronouns   && <Field label="pronouns">{card.pronouns}</Field>}
                {card.home_region && <Field label="plays around">{card.home_region}</Field>}
                {/* "plays around" is a region; this is the standing answer to
                    "where do I find you again?" — a shop and a night, or a
                    Discord. Two different questions, two different fields. */}
                {card.usually_found_at && <Field label="found at">{card.usually_found_at}</Field>}
                {card.commander_name && <Field label="signature">{card.commander_name}</Field>}
                {card.bio && (
                  <Field label="about">
                    <span style={{ lineHeight: 1.65 }}>{card.bio}</span>
                  </Field>
                )}

                {/* The decks, relocated from the front. Still the three you CHOSE
                    rather than your most recent — but here they can change without
                    making a printed card wrong. */}
                {decks.length > 0 && (
                  <Field label="decks">
                    <span style={{ display: "flex", flexDirection: "column", gap: u(7) }}>
                      {decks.map(d => <DeckRow key={d.position} deck={d} />)}
                    </span>
                  </Field>
                )}

                {/* The linktree. Everything you'd hand someone at the table anyway
                    — Discord, Moxfield, socials — so a person who scans this can
                    reach you WITHOUT making an account of their own. */}
                {links.length > 0 && (
                  <Field label="find me">
                    <span style={{ display: "flex", flexDirection: "column", gap: u(6) }}>
                      {links.map(l => <LinkRow key={l.position} link={l} />)}
                    </span>
                  </Field>
                )}

                {!card.pronouns && !card.home_region && !card.usually_found_at &&
                 !card.bio && !card.commander_name && !card.ready_to_pod &&
                 decks.length === 0 && links.length === 0 && (
                  <span style={{ ...mono, fontSize: u(10), color: C.faint }}>nothing on the back yet</span>
                )}
              </div>

              <div style={{
                flex: "0 0 auto", background: C.edge, padding: `${u(5)} ${u(10)}`,
                ...mono, fontSize: u(8), color: C.faint,
                display: "flex", justifyContent: "space-between",
              }}>
                <span>@{card.handle}</span>
                <span>trainer since {monthYear(card.created_at)}</span>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
    </>
  );
}

// A light panel with a quiet zone around the code: QR wants dark modules on a
// light field, and printing it straight onto artwork is how you get a code that
// will not scan.
function QrPanel({ handle }) {
  const [src, setSrc] = useState(null);
  const url = cardUrl(handle);

  useEffect(() => {
    let cancelled = false;
    // 640 so it stays crisp on a 3x screen at the size it now renders.
    QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: "M" })
      .then(d => { if (!cancelled) setSrc(d); })
      .catch(() => { /* the typed URL below is the fallback */ });
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div style={{
      position: "relative", display: "flex", flexDirection: "column",
      alignItems: "center", gap: u(5),
    }}>
      {/* Sized to nearly fill the art box, which since 033 is the whole middle of
          the card. This is the thing a phone camera has to find across a table in
          bad light — it gets the room the deck rows used to take, and a bigger
          code is a code that scans on the first try. */}
      <div style={{
        background: "#fff", padding: u(8), borderRadius: u(4),
        width: u(215), height: u(215),
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {src
          ? <img src={src} alt={`QR code for ${url}`} style={{ width: "100%", height: "100%", display: "block" }} />
          : <span style={{ ...mono, fontSize: u(8), color: "#888" }}>…</span>}
      </div>
      {/* Readable fallback: a scan that fails at 11pm in bad light still leaves
          something a person can type. */}
      <span style={{
        ...mono, fontSize: u(8), color: C.ink, background: "rgba(10,10,12,.72)",
        padding: `${u(2)} ${u(5)}`, borderRadius: u(3), letterSpacing: "0.02em",
      }}>
        {shortUrl(handle)}
      </span>
    </div>
  );
}

function cardUrl(handle) {
  const origin = typeof location !== "undefined" ? location.origin : "";
  return `${origin}/t/${handle}`;
}
function shortUrl(handle) {
  const host = typeof location !== "undefined" ? location.host : "";
  return `${host}/t/${handle}`;
}

function Bar({ children, tight }) {
  return (
    <div style={{
      flex: "0 0 auto", background: C.bar,
      padding: tight ? `${u(5)} ${u(10)}` : `${u(7)} ${u(10)}`,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: u(8),
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
    <div style={{ display: "flex", flexDirection: "column", gap: u(3) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: u(8) }}>
        <span style={{ ...slab, fontSize: u(13), color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {deck.name}
        </span>
        {deck.rating && (
          <span style={{ ...mono, fontSize: u(12), color: C.accent, flexShrink: 0 }}>{deck.rating}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: u(8), alignItems: "baseline" }}>
        {deck.deck_url && (
          <a href={deck.deck_url} target="_blank" rel="noopener noreferrer" onClick={stop}
             style={{ ...mono, fontSize: u(8), color: C.dim, textDecoration: "none" }}>
            {hostLabel(deck.deck_url)} ↗
          </a>
        )}
        {/* The receipt. The rating above is self-reported; this is how a reader
            checks it in one tap, which is why we never needed to scrape it. */}
        {deck.scrycheck_url && (
          <a href={deck.scrycheck_url} target="_blank" rel="noopener noreferrer" onClick={stop}
             style={{ ...mono, fontSize: u(8), color: C.accent, textDecoration: "none" }}>
            scrycheck ↗
          </a>
        )}
      </div>
    </div>
  );
}

// A linktree row. Two shapes, because a Discord username is not a URL — it can
// only be COPIED, and rendering it as a dead link would be a small lie that costs
// somebody a failed tap at exactly the wrong moment.
function LinkRow({ link }) {
  const [copied, setCopied] = useState(false);
  const stop = e => e.stopPropagation(); // the card flips on click; rows must not

  if (link.kind === "handle") {
    return (
      <button
        onClick={e => {
          stop(e);
          navigator.clipboard?.writeText(link.value)
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })
            // A clipboard write can be refused (insecure context, permissions).
            // The value is on screen either way, so a failure is not a dead end.
            .catch(() => {});
        }}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: u(8), background: "transparent", border: "none", padding: 0,
          textAlign: "left", cursor: "pointer", width: "100%",
        }}
      >
        <span style={{ ...mono, fontSize: u(10), color: C.dim }}>{link.label}</span>
        <span style={{ ...mono, fontSize: u(10), color: copied ? C.accent : C.ink }}>
          {copied ? "copied" : link.value}
        </span>
      </button>
    );
  }

  return (
    <a href={link.value} target="_blank" rel="noopener noreferrer" onClick={stop}
       style={{
         display: "flex", justifyContent: "space-between", alignItems: "baseline",
         gap: u(8), textDecoration: "none",
       }}>
      <span style={{ ...mono, fontSize: u(10), color: C.dim }}>{link.label}</span>
      <span style={{ ...mono, fontSize: u(10), color: C.accent }}>
        {hostLabel(link.value)} ↗
      </span>
    </a>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: u(4) }}>
      <span style={{ ...mono, fontSize: u(8), letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>
        {label}
      </span>
      <span style={{ ...mono, fontSize: u(11), color: C.ink }}>{children}</span>
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
