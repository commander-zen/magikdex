import { useTheme } from "../theme/ThemeContext";
import Icon from "./Icon.jsx";

// The magıkdex wordmark, top left on every root screen. It is a button: tapping
// it opens the "what is magikdex" sheet (Ben, 2026-11-10). The small info glyph
// is there so that's discoverable, not a secret.
export default function Wordmark({ onClick }) {
  const { theme } = useTheme();
  return (
    <button
      onClick={onClick}
      aria-label="What is magikdex?"
      className="press"
      style={{
        minHeight: 44, padding: "0 8px",
        display: "flex", alignItems: "center", gap: 6,
        background: "transparent", border: "none",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Dotless i (U+0131): lowercase, dot removed, to evoke "dex". */}
      <span style={{
        fontFamily: "'Zilla Slab', serif",
        fontSize: 18,
        fontWeight: 400,
        letterSpacing: "0.01em",
        color: theme.white,
        lineHeight: 1,
      }}>
        mag&#x0131;kdex
      </span>
      <Icon name="info" style={{ fontSize: 16, color: theme.dim }} />
    </button>
  );
}
