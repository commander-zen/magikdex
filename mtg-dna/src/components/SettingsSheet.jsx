import { useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import { getBrewDefaults, setBrewDefaults } from "../lib/brewDefaults.js";

// Starting-state choices for a fresh swipe seed (per-session controls override).
const SORT_CHOICES = [
  { value: "edhrec", label: "EDHREC" },
  { value: "name",   label: "A–Z" },
  { value: "cmc",    label: "CMC ↑" },
];

// The Box surface's only chrome: a bottom sheet behind the gear glyph holding
// the theme toggle, the brew defaults, and the colophon.
export default function SettingsSheet({ open, onClose }) {
  const { theme, mode, toggleTheme } = useTheme();
  const [defaults, setDefaults] = useState(getBrewDefaults);

  function updateDefaults(patch) {
    setDefaults(setBrewDefaults(patch));
  }

  const textColor   = mode === "light" ? theme.ink   : theme.white;
  const dimColor    = mode === "light" ? theme.muted : theme.dim;
  const borderColor = mode === "light" ? theme.border : theme.muted;
  const accent      = mode === "light" ? theme.gold  : theme.amber;

  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    minHeight: 48,
    padding: "12px 0",
    borderBottom: `1px solid ${borderColor}`,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };
  const labelStyle = {
    fontFamily: "'Noto Sans', sans-serif",
    fontSize: 14,
    color: textColor,
  };

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 220,
          background: "rgba(0,0,0,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.28s",
        }}
      />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 221,
        display: "flex", justifyContent: "center",
        transform: open ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        pointerEvents: open ? "auto" : "none",
      }}>
        <div style={{
          width: "100%", maxWidth: 600,
          background: theme.base,
          borderTop: `1px solid ${borderColor}`,
          padding: "20px 20px calc(env(safe-area-inset-bottom) + 24px)",
        }}>
          <div style={{
            fontFamily: "'Noto Sans', sans-serif",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: dimColor,
            marginBottom: 12,
          }}>
            settings
          </div>

          {/* Theme toggle */}
          <div onClick={toggleTheme} style={rowStyle}>
            <span style={labelStyle}>theme</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: dimColor }}>
              <span style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12,
              }}>
                {mode}
              </span>
              <span
                className="material-symbols-rounded"
                style={{
                  fontSize: 18,
                  color: dimColor,
                  fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                }}
              >
                {mode === "dark" ? "light_mode" : "dark_mode"}
              </span>
            </span>
          </div>

          {/* ── Brew defaults — starting state of every fresh swipe seed ── */}
          <div style={{
            fontFamily: "'Noto Sans', sans-serif",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: dimColor,
            margin: "20px 0 8px",
          }}>
            brew defaults
          </div>

          {/* Default sort — segmented */}
          <div style={{ ...rowStyle, cursor: "default" }}>
            <span style={labelStyle}>default sort</span>
            <div style={{ display: "flex", border: `1px solid ${borderColor}` }}>
              {SORT_CHOICES.map((c, idx) => {
                const active = defaults.sort === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => updateDefaults({ sort: c.value })}
                    style={{
                      padding: "6px 10px",
                      border: "none",
                      borderLeft: idx > 0 ? `1px solid ${borderColor}` : "none",
                      background: active ? accent : "transparent",
                      color: active ? theme.base : dimColor,
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 10,
                      letterSpacing: "0.06em",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Exclude lands by default */}
          <div
            onClick={() => updateDefaults({ excludeLands: !defaults.excludeLands })}
            style={rowStyle}
          >
            <span style={labelStyle}>exclude lands</span>
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.08em",
              color: defaults.excludeLands ? accent : dimColor,
            }}>
              {defaults.excludeLands ? "ON" : "OFF"}
            </span>
          </div>

          {/* Colophon */}
          <a
            href="https://bsky.app/profile/commanderzen.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...rowStyle, textDecoration: "none" }}
          >
            <span style={labelStyle}>commander zen</span>
            <span style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 13,
              color: dimColor,
              letterSpacing: "0.01em",
            }}>
              @commanderzen.bsky.social
            </span>
          </a>

          <div style={{
            marginTop: 16,
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 11,
            color: dimColor,
            opacity: 0.6,
          }}>
            magicdex · v3
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
