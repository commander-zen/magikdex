import { useTheme } from "../theme/ThemeContext";

const TIERS = ["S", "A", "B"];

const TIER_COLORS = {
  light: {
    S: "#c8960c",
    A: "#1a141070",
    B: "#1a141040",
  },
  dark: {
    S: "#c8860a",
    A: "#7ab89a",
    B: "#2e3e34",
  },
};

export default function ToolChips({ tools }) {
  const { theme, mode } = useTheme();

  const nameColor  = mode === "light" ? theme.ink               : theme.white;
  const descColor  = mode === "light" ? `${theme.ink}99`        : `${theme.white}60`;
  const tierColor  = mode === "light" ? `${theme.ink}50`        : theme.muted;
  const divider    = mode === "light" ? `${theme.ink}15`        : theme.border;

  const tierColors = TIER_COLORS[mode];

  // Entries without a tier render first, above the tier groupings,
  // with the same row treatment and no group heading.
  const untiered = tools.filter(tool => !tool.tier);

  const grouped = TIERS.reduce((acc, t) => {
    acc[t] = tools.filter(tool => tool.tier === t);
    return acc;
  }, {});

  const renderRow = (tool, i, list) => (
    <a
      key={tool.name}
      href={tool.url}
      target={tool.url ? "_blank" : undefined}
      rel={tool.url ? "noopener noreferrer" : undefined}
      onClick={tool.onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 0",
        borderBottom: i < list.length - 1 ? `1px solid ${divider}` : "none",
        textDecoration: "none",
        cursor: tool.onClick ? "pointer" : undefined,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'Noto Sans', sans-serif",
          fontSize: 15,
          fontWeight: 400,
          color: nameColor,
          lineHeight: 1.2,
          marginBottom: 3,
        }}>
          {tool.name}
        </div>
        <div style={{
          fontFamily: "'Noto Sans', sans-serif",
          fontSize: 12,
          fontWeight: 300,
          color: descColor,
          lineHeight: 1.5,
        }}>
          {tool.desc}
        </div>
      </div>

      <span
        className="material-symbols-rounded"
        style={{
          flexShrink: 0,
          fontSize: 16,
          fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
          color: tierColor,
        }}
      >
        arrow_forward
      </span>
    </a>
  );

  return (
    <>
      {untiered.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {untiered.map((tool, i) => renderRow(tool, i, untiered))}
          </div>
        </div>
      )}

      {TIERS.filter(t => grouped[t].length > 0).map(tier => (
        <div key={tier} style={{ marginBottom: 24 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            paddingBottom: 8,
            borderBottom: `1px solid ${divider}`,
          }}>
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 11,
              fontWeight: 500,
              color: tierColors[tier],
              letterSpacing: "0.04em",
            }}>
              {tier}
            </span>
            <span style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: tierColor,
            }}>
              tier
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {grouped[tier].map((tool, i) => renderRow(tool, i, grouped[tier]))}
          </div>
        </div>
      ))}
    </>
  );
}
