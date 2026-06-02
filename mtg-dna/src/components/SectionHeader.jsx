import { C } from "../constants";

export default function SectionHeader({ label }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: C.muted,
      marginBottom: 14,
      paddingBottom: 8,
      borderBottom: `1px solid ${C.border}`,
    }}>{label}</div>
  );
}
