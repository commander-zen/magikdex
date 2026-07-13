import { useTheme } from "../theme/ThemeContext";

export default function TeaserCard({ accent, name, desc }) {
  const { theme, mode } = useTheme();

  const descColor = mode === "light" ? `${theme.ink}99` : `${theme.white}80`;

  return (
    <div style={{
      padding: "16px",
      borderRadius: 0,
      background: `${accent}15`,
      border: `1px solid ${accent}40`,
    }}>
      <div style={{
        fontFamily: "'Noto Sans', sans-serif",
        fontSize: 15,
        fontWeight: 600,
        color: accent,
        marginBottom: 6,
      }}>
        {name}
      </div>
      <div style={{
        fontFamily: "'Noto Sans', sans-serif",
        fontSize: 13,
        color: descColor,
        lineHeight: 1.55,
        marginBottom: 12,
      }}>
        {desc}
      </div>
      <div style={{
        display: "inline-flex",
        padding: "4px 12px",
        borderRadius: 0,
        background: `${accent}15`,
        border: `1px solid ${accent}40`,
        fontFamily: "'Noto Sans', sans-serif",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: accent,
      }}>
        Coming soon
      </div>
    </div>
  );
}
