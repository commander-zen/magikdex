import { useTheme } from "../theme/ThemeContext";
import { SEARCH_CHIPS } from "../data/searchChips";

// Guided-search chip layer — controlled by the parent, which owns selection
// state so it can fold selected chips' tags into the compiled search query.
export default function SearchChips({ selected, onToggle }) {
  const { theme, mode } = useTheme();

  const dimColor     = mode === "light" ? theme.muted : theme.dim;
  const accentColor  = mode === "light" ? theme.gold  : theme.amber;
  const borderColor  = mode === "light" ? theme.border : theme.muted;

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
              fontFamily: "'Noto Sans', sans-serif",
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
