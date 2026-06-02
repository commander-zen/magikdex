import { C } from "../constants";

export default function TeaserCard({ accent, name, desc }) {
  return (
    <div style={{
      padding: "16px",
      borderRadius: 14,
      background: `${accent}10`,
      border: `1px solid ${accent}33`,
    }}>
      <div style={{
        fontSize: 15,
        fontWeight: 600,
        color: accent,
        marginBottom: 6,
      }}>{name}</div>
      <div style={{
        fontSize: 13,
        color: C.muted,
        lineHeight: 1.55,
        marginBottom: 12,
      }}>{desc}</div>
      <div style={{
        display: "inline-flex",
        padding: "4px 12px",
        borderRadius: 100,
        background: `${accent}14`,
        border: `1px solid ${accent}33`,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: accent,
      }}>Coming soon</div>
    </div>
  );
}
