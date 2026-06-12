import { useState } from "react";

// Review the accumulated swipe results before saving. Purely presentational —
// the Supabase writes live in the page that owns the brew state (Brew.jsx),
// keeping brew-components free of db imports.

const SECTIONS = [
  { key: "pile",     label: "PILE" },
  { key: "decklist", label: "DECKLIST" },
  { key: "maybe",    label: "MAYBE" },
];

// Stackables (basic lands etc.) can repeat — collapse to name + quantity.
function groupByName(cards) {
  const counts = new Map();
  for (const c of cards) {
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, quantity]) => ({ name, quantity }));
}

export default function ReviewScreen({
  pile, decklist, maybeboard,
  onConfirm, saving, error,
  live, onRemove,
}) {
  const [commanderName, setCommanderName] = useState("");
  const [buildName, setBuildName] = useState("");

  const groups = {
    pile: groupByName(pile),
    decklist: groupByName(decklist),
    maybe: groupByName(maybeboard),
  };
  const total = pile.length + decklist.length + maybeboard.length;
  const canSave = Boolean(commanderName.trim()) && total > 0 && !saving;

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    fontFamily: "var(--font-system)",
    fontSize: 16,
    border: "1px solid var(--bevel-dark)",
    padding: "10px 12px",
    borderRadius: 0,
    outline: "none",
  };

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg)",
      color: "var(--text)",
      fontFamily: "'Noto Sans', sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      overflowY: "auto",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 430,
        padding: "64px 20px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>

        <div style={{
          fontFamily: "var(--font-system)",
          fontSize: 20,
          letterSpacing: "0.08em",
          color: "var(--text)",
        }}>
          {live ? "DECK" : "REVIEW"} · {total} CARD{total !== 1 ? "S" : ""}
        </div>

        {/* Grouped card lists */}
        {SECTIONS.map(({ key, label }) => (
          <div key={key}>
            <div style={{
              fontSize: 11,
              letterSpacing: "0.14em",
              color: "var(--muted)",
              borderBottom: "1px solid var(--bevel-dark)",
              paddingBottom: 6,
              marginBottom: 6,
            }}>
              {label} · {groups[key].reduce((n, c) => n + c.quantity, 0)}
            </div>
            {groups[key].length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>—</div>
            ) : (
              groups[key].map(({ name, quantity }) => (
                <div key={name} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "5px 0",
                  fontSize: 13,
                  color: "var(--text)",
                }}>
                  <span style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>{name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {quantity > 1 && (
                      <span style={{ color: "var(--muted)" }}>×{quantity}</span>
                    )}
                    {live && (
                      <button
                        onClick={() => onRemove(name, key)}
                        aria-label={`Remove ${name}`}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          color: "var(--muted)",
                          fontFamily: "var(--font-system)",
                          fontSize: 14,
                          lineHeight: 1,
                          cursor: "pointer",
                        }}
                      >×</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ))}

        {/* Name the brew — live sessions write on every flick, nothing to save */}
        {!live && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <input
              type="text"
              placeholder="Commander name"
              value={commanderName}
              onChange={e => setCommanderName(e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Build name (optional)"
              value={buildName}
              onChange={e => setBuildName(e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={inputStyle}
            />
            <button
              onClick={() => onConfirm(commanderName.trim(), buildName.trim())}
              disabled={!canSave}
              style={{
                width: "100%",
                background: "var(--color-titlebar)",
                color: "var(--color-titlebar-text)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-xl)",
                letterSpacing: "0.12em",
                border: "none",
                padding: "16px 24px",
                borderRadius: 0,
                cursor: canSave ? "pointer" : "default",
                opacity: canSave ? 1 : 0.5,
              }}
            >
              {saving ? "SAVING…" : "SAVE BREW"}
            </button>
            {error && (
              <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
                {error}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
