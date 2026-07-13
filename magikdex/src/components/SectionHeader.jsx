import { useTheme } from "../theme/ThemeContext";

export default function SectionHeader({ label }) {
  const { theme, mode } = useTheme();

  const color       = mode === "light" ? `${theme.ink}8c`   : `${theme.white}66`;
  const borderColor = mode === "light" ? theme.border : theme.muted;

  return (
    <div style={{
      fontFamily: "'Noto Sans', sans-serif",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color,
      marginBottom: 14,
      paddingBottom: 8,
      borderBottom: `1px solid ${borderColor}`,
    }}>
      {label}
    </div>
  );
}
