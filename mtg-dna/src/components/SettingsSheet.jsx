import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";

// The Box surface's only chrome: a bottom sheet behind the gear glyph holding
// the theme toggle and the colophon that used to live in the footer.
export default function SettingsSheet({ open, onClose }) {
  const { theme, mode, toggleTheme } = useTheme();

  const textColor   = mode === "light" ? theme.ink   : theme.white;
  const dimColor    = mode === "light" ? theme.muted : theme.dim;
  const borderColor = mode === "light" ? theme.border : theme.muted;

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
