import { useEffect, useState } from "react";
import { PARTNER_VARIANTS, partnerVariant, fetchPartnerCandidates } from "../lib/partners.js";
import { getCardImage } from "../lib/scryfall.js";

// Picks a deck's SECOND commander. Which cards are legal depends entirely on
// which partner mechanic the primary commander uses, so the pool comes from
// lib/partners.js rather than being a free card search — offering an illegal
// pairing would be worse than offering nothing.
//
// Rendered INLINE (not through createPortal, unlike SettingsSheet): it lives
// inside Brew's takeover root, which is where the --primary/--muted CSS
// variables are defined. A portal escapes to document.body and would lose them.
export default function PartnerPickerSheet({ open, commanderCard, current, onSelect, onClose }) {
  // Results are stored WITH the commander they belong to, and "loading" is
  // derived from that key rather than being its own state cleared at the top of
  // the effect. Clearing it there would mean a synchronous setState inside an
  // effect body (react-hooks/set-state-in-effect) — the same antipattern
  // OHANA-186 exists to remove, so this doesn't add another one. Only the
  // post-await write remains, which is the legitimate case.
  const [result, setResult] = useState({ forCard: null, list: null });
  const [busy, setBusy] = useState(false);

  const variant = commanderCard ? partnerVariant(commanderCard) : null;
  const meta = variant ? PARTNER_VARIANTS[variant.kind] : null;
  // null = still loading (or belongs to a different commander).
  const candidates = result.forCard && result.forCard === commanderCard?.name
    ? result.list
    : null;

  useEffect(() => {
    if (!open || !commanderCard) return;
    let cancelled = false;
    (async () => {
      const list = await fetchPartnerCandidates(commanderCard);
      if (!cancelled) setResult({ forCard: commanderCard.name, list });
    })();
    return () => { cancelled = true; };
  }, [open, commanderCard]);

  async function choose(card) {
    if (busy) return;
    setBusy(true);
    try { await onSelect(card); } finally { setBusy(false); }
  }

  const rowStyle = {
    display: "flex", alignItems: "center", gap: 10,
    width: "100%", minHeight: 52,
    padding: "6px 0",
    background: "transparent", border: "none",
    borderBottom: "1px solid var(--bevel-dark)",
    color: "var(--text)",
    fontFamily: "'Zilla Slab', serif", fontSize: 15,
    textAlign: "left", cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 240,
          background: "rgba(0,0,0,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.28s",
        }}
      />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 241,
        display: "flex", justifyContent: "center",
        transform: open ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        pointerEvents: open ? "auto" : "none",
      }}>
        {/* Capped + scrolling body, same shape as SettingsSheet: a bottom sheet
            that grows upward will push its own close button off-screen once the
            list is long enough, locking the user in. */}
        <div style={{
          width: "100%", maxWidth: 600,
          maxHeight: "80dvh",
          background: "var(--bg)",
          borderTop: "1px solid var(--bevel-dark)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{
            flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 20px 10px",
          }}>
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12, letterSpacing: "0.1em",
              color: "var(--muted)",
            }}>
              {meta ? meta.prompt.toUpperCase() : "PARTNER"}
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 44, height: 44, marginRight: -10,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none",
                color: "var(--muted)", cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 22 }}>close</span>
            </button>
          </div>

          <div style={{
            flex: 1, minHeight: 0, overflowY: "auto",
            padding: "0 20px calc(env(safe-area-inset-bottom) + 24px)",
          }}>
            {/* Clearing an existing partner is the only way back to a one-
                commander deck, so it lives at the top where it's findable. */}
            {current && (
              <button onClick={() => choose(null)} disabled={busy} style={{
                ...rowStyle,
                color: "var(--danger)",
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, letterSpacing: "0.06em",
                opacity: busy ? 0.5 : 1,
              }}>
                remove {current.name}
              </button>
            )}

            {candidates === null && (
              <div style={{
                padding: "20px 0",
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, color: "var(--muted)",
              }}>
                finding partners…
              </div>
            )}

            {candidates?.length === 0 && (
              <div style={{
                padding: "20px 0", lineHeight: 1.5,
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, color: "var(--muted)",
              }}>
                no partners found for this commander
              </div>
            )}

            {candidates?.map(card => (
              <button
                key={card.id ?? card.name}
                onClick={() => choose(card)}
                disabled={busy}
                style={{ ...rowStyle, opacity: busy ? 0.5 : 1 }}
              >
                <img
                  src={getCardImage(card, "art_crop")}
                  alt=""
                  draggable={false}
                  style={{
                    width: 34, height: 26, objectFit: "cover",
                    borderRadius: "5.5% / 4%", flexShrink: 0,
                  }}
                />
                <span style={{
                  minWidth: 0, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {card.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
