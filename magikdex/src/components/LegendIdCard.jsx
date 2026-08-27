import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

// ── THE HERO FITS. It took three rounds of real names to settle this ─────────
// The mockup's 86 is a CEILING, not a fixed size. Short names get it and look
// exactly like the mockup; long ones shrink until they fit the column.
//
// Ben asked for the oversized clipping look back after I first removed it, so I
// fixed the size at 86 and clipped — first to a pixel height (which sheared
// letters through the waist), then to three whole lines with the "//" tail
// dropped. Then he printed two real cards: "second half of ral is missing and
// thranduil is clipped still".
//
// That is the answer. On the MOCKUP the clipped word was a design flourish on a
// word you could still read. On a real card it eats the back face of a
// double-faced commander and shaves the L off THRANDUIL — which reads as a
// typo, not a style. The name is the one thing on this card that has to be
// correct, so it is fitted, and the "//" name is printed whole.
const HERO_MAX = 86;             // the mockup's size, and the ceiling
const HERO_MIN = 30;             // below this it is no longer a hero
const HERO_LEAD = 0.94;          // the mockup's line-height
const HERO_W = 540;              // the left column
const HERO_H = 352 - 82;         // the tag's top, minus the name's top

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

// Neither of these is derivable from the stored value: 'trash_magic' is two
// words and 'cEDH' has a lowercase first letter. Same map trainer.js keeps.
const GAME_STYLE_LABEL = {
  jank: "jank", casual: "casual", trash_magic: "trash magic", cedh: "cEDH",
};

// ONE line, not two. Ben: "play style and the plan are the same thing in my
// eyes." They live in two columns because only an otag can tag a card, but that
// is storage, not meaning — the card says it once.
// Plan first (it is the more specific claim), then the labels, with the game
// style leading. otag slugs are kebab-case; the slug IS the label once the
// hyphens go.
function selfReportLine(deck) {
  const style = GAME_STYLE_LABEL[deck?.self_game_style] ?? null;
  const plan = (deck?.self_plan ?? []).filter(Boolean).map(s => s.replace(/-/g, " "));
  const play = (deck?.self_play_style ?? []).filter(Boolean);
  const parts = [];
  if (style) parts.push(style);
  parts.push(...plan, ...play);
  return parts.length ? parts.join(" · ") : null;
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
  const selfLine = selfReportLine(deck);
  const cat = catalogNo(deck?.id);
  const qrTarget = deck?.scrycheck_url || deck?.url || null;
  const [qr, setQr] = useState(null);

  // ⚠️ MEASURED, NOT ESTIMATED. Three guesses failed before this: a character
  // count, a 0.62-em average advance, and a measured 0.690 advance. Archivo
  // Black's real widths vary far too much per glyph ("MONSOON" vs "LIEGE") for
  // any per-character model, and word wrapping makes the leftover space on each
  // line unpredictable on top of that. The only reliable oracle is the browser.
  const heroRef = useRef(null);
  const [heroSize, setHeroSize] = useState(HERO_MAX);

  useLayoutEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    let cancelled = false;

    // Binary search the largest size that fits — ~6 layouts instead of 57.
    const fit = () => {
      if (cancelled || !el.clientWidth || !el.clientHeight) return;
      const W = el.clientWidth, H = el.clientHeight;
      // Written straight to the DOM inside the loop. Going through state here
      // would need a render per probe, and the probes are throwaway.
      const apply = s => { el.style.fontSize = `${((s * 100) / BASIS).toFixed(4)}cqw`; };
      let lo = HERO_MIN, hi = HERO_MAX, best = HERO_MIN;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        apply(mid);
        // Half a pixel of slack: sub-pixel layout means an exact fit can report
        // scrollWidth one hair over its own clientWidth.
        if (el.scrollHeight <= H + 0.5 && el.scrollWidth <= W + 0.5) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      // ⚠️ ALWAYS assign the winner explicitly, and never clear the property.
      // React owns this element's `style`, so if setHeroSize lands on the value
      // already in state it is a no-op and no render restores anything — an
      // earlier version cleared fontSize here and every card fell back to the
      // inherited 16px.
      apply(best);
      setHeroSize(best);
    };

    fit();
    // Fonts change every measurement, and document.fonts.ready resolves without
    // waiting for a face nothing has requested yet — load() is the one that
    // actually waits for Archivo Black.
    document.fonts?.load?.(`${HERO_MAX}px 'Archivo Black'`)
      .then(() => { if (!cancelled) fit(); })
      .catch(() => {});

    // The card is sized in cqw, so a fit found at one width holds at every
    // width — but the FIRST measurement can happen at a width of zero (a print
    // sheet builds off-screen), and that one has to be redone.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { cancelled = true; ro.disconnect(); };
  }, [name]);

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

          {/* ── THE HERO FILLS THE COLUMN, IT DOES NOT ESCAPE IT ──────────
              The size is measured above: 86 when the name fits at 86, smaller
              when it does not. Short names are identical to the mockup.

              ⚠️ Do NOT reinstate clipping here. It was tried twice on Ben's own
              request for the oversized look and both times real names killed it
              — a pixel-height cut sheared letters through the waist, and a
              3-line cut ate the back face of every double-faced commander plus
              the last letter of THRANDUIL. "second half of ral is missing and
              thranduil is clipped still". A flourish that deletes information
              is not a flourish. overflow:hidden stays only as a backstop for a
              name so long it hits HERO_MIN. */}
          <div ref={heroRef} style={{
            ...abs, top: u(82), left: u(44), width: u(HERO_W), ...display,
            fontSize: u(heroSize), lineHeight: HERO_LEAD,
            color: INK, textTransform: "uppercase",
            height: u(HERO_H), overflow: "hidden",
            // A single unbreakable word longer than the column would otherwise
            // force the fit down to HERO_MIN and still overflow.
            overflowWrap: "anywhere",
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

          {/* THE SELF-REPORT, directly under ScryCheck's tag — and the pairing is
              the point. The yellow block is somebody else's computed reading of
              the decklist; this line is the owner's own claim about how they
              play it. Two different kinds of statement, kept visibly apart.
              (It used to repeat the commander's name, which said nothing the
              card did not already say.) */}
          {/* Two optional rows under the tag, in order of specificity: the PLAN
              (what this deck is trying to do) then the register and playstyle.
              Rendered from a filtered list so a missing plan does not leave a
              gap — whichever survives starts at 434. */}
          {selfLine && (
            <div style={{
              ...abs, top: u(434), left: u(46), ...mono,
              fontSize: u(32), letterSpacing: "0.04em", color: GRAY,
              fontWeight: 500, width: u(540),
              // One row; a long list ellipsises rather than colliding with the
              // credit block below.
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {selfLine}
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
