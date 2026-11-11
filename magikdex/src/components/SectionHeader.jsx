import { useTheme } from "../theme/ThemeContext";

export default function SectionHeader({ label }) {
  const { theme } = useTheme();

  const color       = `${theme.white}66`;
  const borderColor = theme.muted;

  return (
    <div style={{
      fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
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
