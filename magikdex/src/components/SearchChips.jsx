import { useTheme } from "../theme/ThemeContext";
import { SEARCH_CHIPS } from "../data/searchChips";

// Guided-search chip layer — controlled by the parent, which owns selection
// state so it can fold selected chips' tags into the compiled search query.
export default function SearchChips({ selected, onToggle }) {
  const { theme } = useTheme();

  const dimColor     = theme.dim;
  const accentColor  = theme.accent;
  const borderColor  = theme.muted;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {SEARCH_CHIPS.map(chip => {
        const active = selected.has(chip.id);
        return (
          <button
            key={chip.id}
            onClick={() => onToggle(chip.id)}
            aria-pressed={active}
            style={{
              minHeight: 44,
              padding: "0 14px",
              display: "flex",
              alignItems: "center",
              border: `1px solid ${active ? accentColor : borderColor}`,
              background: active ? accentColor : "transparent",
              color: active ? theme.base : dimColor,
              fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
              fontSize: 13,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
