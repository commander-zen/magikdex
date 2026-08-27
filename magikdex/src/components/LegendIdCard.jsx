import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { SCRYCHECK_VECTORS, readVectors } from "./ScryCheckRadar.jsx";

// THE LEGEND / COMMANDER ID CARD — Ben's MSCHF-inspired landscape card, on paper.
//
// Ported from scripts/reference/deck-id-card-mockup-v4.html at its own values.
// 1050 × 750 is 3.5in × 2.5in, and LANDSCAPE is the point: everything else in a
// deck box is 63 × 88mm portrait, so this reads as "not a Magic card" by shape
// alone before anyone looks at it.
//
// ── Everything on it is already on screen ────────────────────────────────────
// No new query and no migration. LegendIdentity already fetches build_name, the
// five vectors (034), scrycheck_bracket / scrycheck_score / scrycheck_url (035),
// and the legend itself. This component only draws them.
//
// ── Sized in cqw, so one renderer covers screen and paper ────────────────────
// Numbers below are the mockup's own pixel values on its 1050-wide canvas; u()
// turns each into a percentage of the card's width. Give the card a width in
// inches and every font, rule and gap resolves to physical units — no separate
// print stylesheet to keep in sync.
const BASIS = 1050;
const u = n => `${((n * 100) / BASIS).toFixed(4)}cqw`;

const PAPER = "#F5F1E6";
const INK = "#161311";
const YELLOW = "#F5C400";
const GRAY = "#6B6459";
const TRACK = "#E1DACB";

const display = { fontFamily: "'Archivo Black', sans-serif" };
const mono = { fontFamily: "'JetBrains Mono', monospace" };

// ── Fitting the hero ─────────────────────────────────────────────────────────
// The deck name is the whole look, and real names run from "Slivers" to
// "Mishra, Claimed by Gix". A fixed 86px does not hold — the mockup's OWN
// example overflows its 540px column at that size.
//
// Sizing by total length is the obvious fix and it is wrong: it shrinks names
// that would have been perfectly happy WRAPPING. "Graveyard Shift" is 15
// characters, but its longest word is 9, so it sits at full size across two
// lines — exactly what the mockup draws with its <br>.
//
// So the fit is greedy-wrapped at each candidate size and accepted only when
// BOTH constraints hold: no single word wider than the column, and the wrapped
// block no taller than the 270px between the name and the tag. Pure arithmetic
// on an average advance — no layout pass, no measuring effect, no reflow.
const COL_W = 540;
const COL_H = 352 - 82;          // the tag's top, minus the name's top
// MEASURED, not assumed. Canvas measureText against the real face: uppercase
// Archivo Black averages 0.690 em/char over realistic word mixes (0.769 for the
// bare alphabet, which has no spaces to average in). The first pass used 0.62 —
// a generic-sans figure — and it under-counted enough that a name the estimator
// placed on four lines actually wrapped to five and ran past the tag. Rounded up
// to 0.70: over-estimating width costs a size step, under-estimating overflows.
const ADVANCE = 0.70;

function heroSize(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 86;

  for (let size = 86; size >= 30; size -= 2) {
    const perLine = Math.floor(COL_W / (ADVANCE * size));
    if (perLine < 1) continue;
    // A word longer than the column can never be broken — [a-z ] names do wrap,
    // but a single long token would bleed past the divider.
    if (words.some(w => w.length > perLine)) continue;

    let lines = 1, used = 0;
    for (const w of words) {
      const need = used ? used + 1 + w.length : w.length;
      if (need <= perLine) used = need;
      else { lines++; used = w.length; }
    }
    if (lines * 0.94 * size <= COL_H) return size;
  }
  return 30;
}

// ScryCheck publishes the overall power level as 1–10, "jank at 1 through cEDH
// at 10". The mockup's tag says "cEDH · Bracket 5", but inventing a band label
// from a number would put a CLAIM on a printed card that ScryCheck never made —
// so the tag carries the number they actually gave, next to the bracket.
function tagText(deck) {
  const parts = [];
  if (deck?.scrycheck_score) parts.push(`power ${deck.scrycheck_score}`);
  if (deck?.scrycheck_bracket != null) parts.push(`bracket ${deck.scrycheck_bracket}`);
  return parts.join(" · ");
}

// A short, stable catalogue number from the deck's id. Decorative — it is the
// mockup's "no. 0042" — and safe: it is printed on the owner's own card, never
// used as a URL, so it is not an enumerable handle on anything.
function catalogNo(id) {
  if (!id) return null;
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(h % 10000).padStart(4, "0");
}

export default function LegendIdCard({ legend, deck, width = "3.5in" }) {
  const name = deck?.build_name || legend?.name || "untitled deck";
  const vectors = readVectors(deck);
  const tag = tagText(deck);
  const cat = catalogNo(deck?.id);
  const qrTarget = deck?.scrycheck_url || deck?.url || null;
  const [qr, setQr] = useState(null);

  useEffect(() => {
    // No synchronous setQr(null) on the empty branch — setting state directly in
    // an effect body is a re-render the component does not need, and the lint
    // rule is right to refuse it. A stale code from a previous deck is instead
    // gated at the render site by `qrTarget &&`.
    if (!qrTarget) return;
    let cancelled = false;
    // margin 4 is the QR spec — four modules of quiet zone on every side, or
    // scanners fail to locate the code at all.
    QRCode.toDataURL(qrTarget, { margin: 4, width: 1024, errorCorrectionLevel: "M" })
      .then(d => { if (!cancelled) setQr(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [qrTarget]);

  const abs = { position: "absolute" };

  return (
    <>
      <style>{`.lid-scene { container-type: inline-size; max-width: 100%; }`}</style>
      <div className="lid-scene" style={{ width }}>
        <div style={{
          position: "relative", width: "100%", aspectRatio: "1050 / 750",
          background: PAPER, color: INK, overflow: "hidden",
          border: `${u(10)} solid ${INK}`,
        }}>
          {/* The spine. The only part visible when the card is slotted upright,
              so it stays solid and carries no text. */}
          <div style={{ ...abs, top: 0, left: 0, right: 0, height: u(16), background: YELLOW }} />

          <div style={{
            ...abs, top: u(44), left: u(46), ...mono,
            fontSize: u(22), letterSpacing: "0.14em", color: GRAY,
            fontWeight: 700, textTransform: "uppercase",
          }}>
            Commander / Deck ID
          </div>

          <div style={{
            ...abs, top: u(82), left: u(44), width: u(540), ...display,
            fontSize: u(heroSize(name)), lineHeight: 0.94,
            color: INK, textTransform: "uppercase", overflowWrap: "anywhere",
          }}>
            {name}
          </div>

          {tag && (
            <div style={{
              ...abs, top: u(352), left: u(46), ...mono,
              background: YELLOW, color: INK,
              fontWeight: 800, fontSize: u(40), letterSpacing: "0.02em",
              padding: `${u(10)} ${u(20)}`, textTransform: "uppercase",
              border: `${u(3)} solid ${INK}`,
            }}>
              {tag}
            </div>
          )}

          {/* The mockup's "archetype" slot. Nothing in the schema stores one, so
              it carries the commander — which is the honest answer to "what is
              this deck" and is never blank. */}
          {legend?.name && (
            <div style={{
              ...abs, top: u(434), left: u(46), ...mono,
              fontSize: u(32), letterSpacing: "0.04em", color: GRAY,
              fontWeight: 500, width: u(540),
            }}>
              {legend.name.toLowerCase()}
            </div>
          )}

          {/* ⚠️ ATTRIBUTION, NOT DECORATION. Migration 034 records that Adam
              approved magikdex showing these five numbers on a self-report basis
              WITH ATTRIBUTION AND A LINK BACK. This block plus the QR pointing at
              scrycheck.com is that term being met, so it is not optional and it
              does not get quietly dropped to free up space.

              It also solves a real defect in the mockup: the QR caption there is
              given 96px of column and its first line needs ~193px, so it wraps to
              four lines in the browser. Moving the credit to the left column at
              full width fixes the fit and matches Ben's later mock. */}
          <div style={{ ...abs, bottom: u(34), left: u(46), width: u(540) }}>
            <div style={{
              ...mono, fontSize: u(20), letterSpacing: "0.06em",
              color: GRAY, fontWeight: 500, marginBottom: u(8),
            }}>
              analysis powered by
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: u(16) }}>
              <span style={{
                ...display, background: INK, color: PAPER,
                fontSize: u(30), letterSpacing: "0.04em",
                padding: `${u(8)} ${u(16)}`, textTransform: "uppercase",
              }}>
                ScryCheck
              </span>
              {cat && (
                <span style={{ ...mono, fontSize: u(22), color: GRAY, letterSpacing: "0.06em" }}>
                  no. {cat}
                </span>
              )}
            </div>
          </div>

          <div style={{ ...abs, top: u(44), bottom: u(44), left: u(612), width: u(2), background: TRACK }} />

          <div style={{ ...abs, top: u(44), left: u(640), right: u(44) }}>
            <div style={{
              ...mono, fontSize: u(22), letterSpacing: "0.1em", color: GRAY,
              fontWeight: 700, textTransform: "uppercase",
              marginBottom: u(16), borderBottom: `${u(2)} solid ${INK}`, paddingBottom: u(8),
            }}>
              Play Profile
            </div>

            {/* Order and labels come from SCRYCHECK_VECTORS — the one canonical
                home for this taxonomy — rather than a second list that can drift
                from the radar. The mockup's row order already matches it. */}
            {SCRYCHECK_VECTORS.map(v => {
              const n = vectors?.[v.key];
              const has = typeof n === "number";
              return (
                <div key={v.key} style={{ display: "flex", alignItems: "center", gap: u(14), marginBottom: u(14) }}>
                  <span style={{
                    ...mono, width: u(170), flex: "none", fontSize: u(26), fontWeight: 600,
                    color: INK, textTransform: "uppercase", letterSpacing: "0.02em",
                  }}>
                    {v.label}
                  </span>
                  <span style={{ flex: 1, height: u(16), background: TRACK, position: "relative" }}>
                    {has && n > 0 && (
                      <span style={{
                        position: "absolute", top: 0, left: 0, bottom: 0,
                        width: `${Math.max(0, Math.min(100, n))}%`, background: INK,
                      }} />
                    )}
                  </span>
                  {/* An ungraded vector prints an em dash, never a zero. Zero is a
                      real ScryCheck reading meaning "virtually absent", so drawing
                      an unknown as one asserts something false about the deck. */}
                  <span style={{
                    ...mono, width: u(56), textAlign: "right", flex: "none",
                    fontSize: u(30), fontWeight: 800, color: has ? INK : GRAY,
                  }}>
                    {has ? Math.round(n) : "—"}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ ...abs, bottom: u(34), right: u(44) }}>
            <div style={{
              width: u(230), height: u(230), background: "#fff",
              padding: u(14), border: `${u(2)} solid ${INK}`, lineHeight: 0,
              boxSizing: "border-box",
            }}>
              {qrTarget && qr && (
                <img src={qr} alt="" style={{ width: "100%", height: "100%", display: "block" }} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
