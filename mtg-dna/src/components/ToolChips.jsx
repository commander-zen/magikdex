import { C, TIER_COLORS, TIERS } from "../constants";

export default function ToolChips({ tools }) {
  const grouped = TIERS.reduce((acc, t) => {
    acc[t] = tools.filter(tool => tool.tier === t);
    return acc;
  }, {});

  return (
    <>
      {TIERS.filter(t => grouped[t].length > 0).map(tier => {
        const tc = TIER_COLORS[tier];
        return (
          <div key={tier} style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: tc.badge,
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: 6,
                background: tc.bg,
                border: `1px solid ${tc.border}`,
                fontSize: 11,
                fontWeight: 800,
                color: tc.badge,
              }}>{tier}</span>
              Tier
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {grouped[tier].map(tool => (
                <a
                  key={tool.name}
                  href={tool.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 16px",
                    borderRadius: 14,
                    background: tc.bg,
                    border: `1px solid ${tc.border}`,
                    textDecoration: "none",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: `${tc.badge}22`,
                    border: `1px solid ${tc.badge}55`,
                    fontSize: 12,
                    fontWeight: 800,
                    color: tc.badge,
                    letterSpacing: 0,
                  }}>{tool.tier}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: tc.text,
                      lineHeight: 1.2,
                      marginBottom: 3,
                    }}>{tool.name}</div>
                    <div style={{
                      fontSize: 12,
                      color: C.muted,
                      lineHeight: 1.5,
                    }}>{tool.desc}</div>
                  </div>
                  <span className="material-symbols-rounded" style={{
                    flexShrink: 0,
                    fontSize: 18,
                    fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                    color: tc.badge,
                    opacity: 0.7,
                  }}>open_in_new</span>
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
