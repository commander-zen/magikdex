import { useEffect, useState } from "react";
import QRCode from "qrcode";

// THE PRINTED PLAYER-ID — the MSCHF-inspired card, in Ben's deck-id language.
//
// Same palette, type and motifs as scripts/reference/deck-id-card-mockup-v4.html
// (cream paper, ink, the yellow spine strip, Archivo Black hero over JetBrains
// Mono labels). NOT the same layout, and it cannot be: the deck-id card is
// landscape 3.5 × 2.5in so it stands out in a deck box, while this one is
// portrait 63 × 88mm so it fits a sleeve next to real cards. The design language
// is transferable; the geometry is not.
//
// ── Why it is not the dark BadgeCard ─────────────────────────────────────────
// The dark card is right on a screen and wrong on paper. A full-bleed near-black
// card burns a cartridge on a home printer, banding is obvious on plain paper,
// and — the part that actually matters — the QR sits on a dark ground, which is
// the worst case for a scanner. The v4 mockup says it in its own note: cream
// keeps ink coverage low AND lets the QR scan at full contrast.
//
// BadgeCard is unchanged and still owns the screen at /t/<handle>. This is the
// print-only artifact.

const PAPER = "#F5F1E6";
const INK = "#161311";
const YELLOW = "#F5C400";
const GRAY = "#6B6459";

// Everything is sized in cqw — percentages of the card's own width — so one
// renderer works at any size and a width in millimetres resolves every font and
// gap to physical units for free. Same trick, and same 340px design basis, as
// BadgeCard, so the two stay mentally interchangeable.
const BASIS = 340;
const u = n => `${((n * 100) / BASIS).toFixed(3)}cqw`;

const display = { fontFamily: "'Archivo Black', sans-serif" };
const mono = { fontFamily: "'JetBrains Mono', monospace" };

// A handle is 3–20 characters and CANNOT WRAP — the shape check allows only
// [a-z0-9_], so there is no space to break on. A single size would either
// overflow at 20 characters or waste half the card at 4, so the hero steps down
// by length. Archivo Black averages ~0.62em per glyph; each step below is
// checked against the 300px content width at the 340px basis.
function handleSize(handle) {
  const n = (handle || "").length;
  if (n <= 5) return 58;    // 5 × .62 × 58 = 180
  if (n <= 8) return 44;    // 8 × .62 × 44 = 218
  if (n <= 12) return 32;   // 12 × .62 × 32 = 238
  if (n <= 16) return 25;   // 16 × .62 × 25 = 248
  return 20;                // 20 × .62 × 20 = 248
}

const label = s => String(s ?? "").replace(/_/g, " ");
const SPECIAL = { cedh: "cEDH" };
const pretty = s => SPECIAL[s] ?? label(s);

export default function PrintCard({ card, width = "63mm" }) {
  const handle = card?.handle ?? "";
  const url = typeof location !== "undefined" ? `${location.origin}/t/${handle}` : "";
  const [qr, setQr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // margin: 4 is the spec — four modules of quiet zone on every side or
    // scanners fail to locate the code. Carried over from BadgeCard, where
    // shipping margin:1 produced a card that looked perfect and would not scan.
    // 1024 so the code is never upscaled at 300dpi.
    QRCode.toDataURL(url, { margin: 4, width: 1024, errorCorrectionLevel: "M" })
      .then(d => { if (!cancelled) setQr(d); })
      .catch(() => { /* the printed URL below is the fallback */ });
    return () => { cancelled = true; };
  }, [url]);

  const gameStyle = (card?.philosophy ?? []).map(pretty);
  const playStyle = (card?.playstyle ?? []).map(pretty);

  return (
    <>
      <style>{`.pc-scene { container-type: inline-size; max-width: 100%; }`}</style>
      <div className="pc-scene" style={{ width }}>
        <div style={{
          position: "relative", width: "100%", aspectRatio: "63 / 88",
          background: PAPER, color: INK,
          // The outer edge is the CUT LINE, so it is a hard ink rule and square
          // — a rounded corner here would be a corner you cannot cut to.
          border: `${u(4)} solid ${INK}`,
          overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}>
          {/* The spine. On the deck-id card this is the only part visible when
              it is slotted upright in a box; it stays solid and carries no text
              so the colour alone identifies the card. */}
          <div style={{ height: u(7), background: YELLOW, flex: "none" }} />

          <div style={{
            flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
            padding: `${u(14)} ${u(16)} ${u(12)}`, gap: u(8),
          }}>
            <div style={{
              ...mono, fontSize: u(8), fontWeight: 700, letterSpacing: "0.14em",
              color: GRAY, textTransform: "uppercase", flex: "none",
            }}>
              Commander / Trainer ID
            </div>

            <div style={{
              ...display, fontSize: u(handleSize(handle)), lineHeight: 0.94,
              textTransform: "uppercase", color: INK, flex: "none",
              // Belt and braces: the ramp is sized so this never triggers, but a
              // handle that somehow overflows should break rather than bleed off
              // the cut edge.
              overflowWrap: "anywhere",
            }}>
              @{handle}
            </div>

            {/* Game style — the yellow block with the ink rule, the mockup's tag.
                Skipped entirely when unset: an empty yellow box reads as a
                printing fault, not as "not answered". */}
            {gameStyle.length > 0 && (
              <div style={{ flex: "none" }}>
                <span style={{
                  ...mono, display: "inline-block",
                  background: YELLOW, color: INK,
                  border: `${u(2)} solid ${INK}`,
                  padding: `${u(4)} ${u(8)}`,
                  fontSize: u(11), fontWeight: 800, letterSpacing: "0.02em",
                  textTransform: "uppercase", lineHeight: 1.2,
                }}>
                  {gameStyle.join(" · ")}
                </span>
              </div>
            )}

            {playStyle.length > 0 && (
              <div style={{
                ...mono, fontSize: u(10), fontWeight: 500, letterSpacing: "0.04em",
                color: GRAY, textTransform: "lowercase", lineHeight: 1.35, flex: "none",
              }}>
                {playStyle.join(" · ")}
              </div>
            )}

            {/* The QR takes whatever vertical room is left and centres in it, so
                a card with no play style does not leave a hole — it just gets a
                bigger code, which is strictly better for scanning. */}
            <div style={{
              flex: 1, minHeight: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>
              <div style={{
                background: "#fff", border: `${u(2)} solid ${INK}`,
                padding: u(5), lineHeight: 0,
                height: "100%", aspectRatio: "1 / 1",
                maxWidth: "100%", boxSizing: "border-box",
              }}>
                {qr && <img src={qr} alt="" style={{ width: "100%", height: "100%", display: "block" }} />}
              </div>
            </div>

            <div style={{
              ...mono, fontSize: u(8), fontWeight: 500, letterSpacing: "0.06em",
              color: GRAY, flex: "none", textAlign: "center",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {(typeof location !== "undefined" ? location.host : "")}/t/{handle}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
