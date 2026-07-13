import { useState } from "react";
import { getCardImage } from "../lib/scryfall.js";
import { CATEGORY_ORDER, CATEGORY_META } from "../lib/wrec.js";

// ── Text view ─────────────────────────────────────────────────────────────────

function TextList({ pile, onRemove }) {
  const grouped = {};
  for (const cat of CATEGORY_ORDER) grouped[cat] = [];
  for (const card of pile) {
    const cat = card._deckCategory ?? "plan";
    if (grouped[cat]) grouped[cat].push(card);
    else grouped["plan"].push(card);
  }

  return (
    <div>
      {CATEGORY_ORDER.map(cat => {
        const cards = grouped[cat];
        if (!cards.length) return null;
        const meta = CATEGORY_META[cat];
        return (
          <div key={cat} style={{ marginBottom: 18 }}>
            <div style={{
              fontSize: "var(--font-size-sm)",
              fontFamily: "var(--font-system)",
              color: "var(--color-text-secondary)",
              letterSpacing: 2,
              marginBottom: 6,
              paddingBottom: 4,
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}>
              {meta.emoji} {meta.label.toUpperCase()} — {cards.length}
            </div>
            {cards.map((card, i) => (
              <div
                key={`${card.id}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                }}
              >
                <span style={{ flex: 1, fontSize: "var(--font-size-sm)", fontFamily: "var(--font-system)", color: "var(--color-text-primary)", letterSpacing: 0.3 }}>
                  1 {card.name}
                </span>
                <button
                  onClick={() => onRemove(card.id, cat)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "rgba(255,255,255,0.25)",
                    fontSize: 14,
                    cursor: "pointer",
                    padding: "0 4px",
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Visual view ───────────────────────────────────────────────────────────────

function VisualGrid({ pile, onRemove }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 8 }}>
      {pile.map((card, i) => {
        const art = getCardImage(card, "art_crop");
        return (
          <div
            key={`${card.id}-${i}`}
            style={{
              position: "relative",
              background: "var(--color-surface-raised)",
              borderRadius: 0,
              overflow: "hidden",
              borderStyle: "solid",
              borderWidth: "1px",
              borderTopColor: "var(--bevel-light)",
              borderLeftColor: "var(--bevel-light)",
              borderBottomColor: "var(--bevel-dark)",
              borderRightColor: "var(--bevel-dark)",
            }}
          >
            {art ? (
              <img src={art} alt={card.name} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{
                width: "100%", aspectRatio: "4/3",
                background: "var(--color-chrome-dark)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 7, color: "var(--color-text-secondary)", fontFamily: "var(--font-system)", padding: 4, textAlign: "center",
              }}>
                {card.name}
              </div>
            )}
            <div style={{
              padding: "2px 4px 3px",
              fontSize: 7,
              fontFamily: "var(--font-system)",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}>
              {card.name}
            </div>
            <button
              onClick={() => onRemove(card.id, card._deckCategory ?? "plan")}
              style={{
                position: "absolute",
                top: 3, right: 3,
                width: 16, height: 16,
                borderRadius: "50%",
                border: "none",
                background: "rgba(255,77,109,0.85)",
                color: "#fff",
                fontSize: 9,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Pill + slide-up sheet ─────────────────────────────────────────────────────

export default function DeckReviewPill({ pile, onRemove }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("text");

  if (!pile || pile.length === 0) return null;

  return (
    <>
      {/* Floating pill */}
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          bottom: 72,
          right: 16,
          zIndex: 50,
          background: "var(--color-chrome)",
          color: "var(--color-text-chrome)",
          borderStyle: "solid",
          borderWidth: "2px",
          borderTopColor: "var(--bevel-light)",
          borderLeftColor: "var(--bevel-light)",
          borderBottomColor: "var(--bevel-dark)",
          borderRightColor: "var(--bevel-dark)",
          borderRadius: 0,
          padding: "8px 16px",
          fontFamily: "var(--font-system)",
          fontSize: "var(--font-size-base)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          userSelect: "none",
        }}
      >
        ▪ {pile.length} KEPT
      </button>

      {/* Slide-up sheet */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{
            width: "100%",
            maxHeight: "80dvh",
            background: "var(--color-surface)",
            borderStyle: "solid",
            borderWidth: "2px",
            borderTopColor: "var(--bevel-light)",
            borderLeftColor: "var(--bevel-light)",
            borderBottomColor: "var(--bevel-dark)",
            borderRightColor: "var(--bevel-dark)",
            borderRadius: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Title bar */}
            <div style={{
              background: "var(--color-titlebar)",
              color: "var(--color-titlebar-text)",
              fontFamily: "var(--font-system)",
              fontSize: "var(--font-size-base)",
              fontWeight: "bold",
              padding: "var(--space-1) var(--space-2)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}>
              <span style={{ flex: 1 }}>
                YOUR STACK — {pile.length} CARDS
              </span>

              {/* Text / Visual toggle */}
              <div style={{ display: "flex", gap: 3 }}>
                {["text", "visual"].map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    style={{
                      padding: "1px 8px",
                      borderRadius: 0,
                      borderStyle: "solid",
                      borderWidth: "2px",
                      borderTopColor: view === v ? "var(--bevel-dark)" : "var(--bevel-light)",
                      borderLeftColor: view === v ? "var(--bevel-dark)" : "var(--bevel-light)",
                      borderBottomColor: view === v ? "var(--bevel-light)" : "var(--bevel-dark)",
                      borderRightColor: view === v ? "var(--bevel-light)" : "var(--bevel-dark)",
                      background: "var(--color-chrome)",
                      color: "var(--color-text-chrome)",
                      fontSize: "var(--font-size-sm)",
                      cursor: "pointer",
                      fontFamily: "var(--font-system)",
                    }}
                  >
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "var(--color-chrome)",
                  color: "var(--color-text-chrome)",
                  borderStyle: "solid",
                  borderWidth: "2px",
                  borderTopColor: "var(--bevel-light)",
                  borderLeftColor: "var(--bevel-light)",
                  borderBottomColor: "var(--bevel-dark)",
                  borderRightColor: "var(--bevel-dark)",
                  width: "20px",
                  height: "20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                  borderRadius: 0,
                  fontFamily: "var(--font-system)",
                  fontSize: "var(--font-size-sm)",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Sheet content */}
            <div style={{ overflowY: "auto", flex: 1, padding: "14px 20px 32px" }}>
              {view === "text" ? (
                <TextList pile={pile} onRemove={onRemove} />
              ) : (
                <VisualGrid pile={pile} onRemove={onRemove} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
