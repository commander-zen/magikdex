import { useTheme } from "../theme/ThemeContext";

export default function PageHeader({ eyebrow, title }) {
  const { theme, mode } = useTheme();

  const eyebrowColor = mode === "light" ? theme.muted  : theme.dim;
  const titleColor   = mode === "light" ? theme.ink    : theme.white;
  const ruleColor    = mode === "light" ? theme.gold   : theme.amber;

  return (
    <div style={{ marginBottom: 32 }}>
      {eyebrow && (
        <div style={{
          fontFamily: "'Noto Sans', sans-serif",
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: eyebrowColor,
          marginBottom: 4,
        }}>
          {eyebrow}
        </div>
      )}
      <div style={{
        fontFamily: "'Noto Sans', sans-serif",
        fontSize: 28,
        fontWeight: 300,
        letterSpacing: "0.02em",
        color: titleColor,
        lineHeight: 1.1,
      }}>
        {title}
      </div>
      <div style={{
        width: 32,
        height: 1,
        background: ruleColor,
        marginTop: 10,
      }} />
    </div>
  );
}
