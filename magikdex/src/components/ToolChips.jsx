import { useTheme } from "../theme/ThemeContext";
import Icon from "./Icon.jsx";

const TIERS = ["S", "A", "B"];

// Steel-storm tier badges (item 3): S rides the electric accent, A a dimmer
// steel, B a near-muted grey.
const TIER_COLORS = {
  S: "#2bc4ae",
  A: "#5fb3a6",
  B: "#567371",
};

export default function ToolChips({ tools }) {
  const { theme } = useTheme();

  const nameColor  = theme.white;
  const descColor  = `${theme.white}60`;
  const tierColor  = theme.muted;
  const divider    = theme.border;

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
          fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
          fontSize: 15,
          fontWeight: 400,
          color: nameColor,
          lineHeight: 1.2,
          marginBottom: 3,
        }}>
          {tool.name}
        </div>
        <div style={{
          fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
          fontSize: 12,
          fontWeight: 300,
          color: descColor,
          lineHeight: 1.5,
        }}>
          {tool.desc}
        </div>
      </div>

      <Icon name="arrow_forward" style={{ flexShrink: 0, fontSize: 16, fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24", color: tierColor, }} />
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
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              fontWeight: 500,
              color: TIER_COLORS[tier],
              letterSpacing: "0.04em",
            }}>
              {tier}
            </span>
            <span style={{
              fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
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
