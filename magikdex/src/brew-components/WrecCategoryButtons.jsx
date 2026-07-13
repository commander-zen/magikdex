import { WREC_CHIP } from "../constants/wrec.js";

export default function WrecCategoryButtons({ currentTags = [], onToggle }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {Object.entries(WREC_CHIP).map(([cat, chip]) => {
        const isActive = currentTags.includes(cat);
        return (
          <button
            key={cat}
            onClick={() => onToggle(cat)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: isActive ? `1px solid ${chip.border}` : "1px solid rgba(255,255,255,0.08)",
              background: isActive ? chip.bg : "rgba(255,255,255,0.04)",
              color: isActive ? chip.color : "var(--text)",
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 13, letterSpacing: 2,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}
          >
            <span>{chip.label}</span>
            {isActive && <span style={{ fontSize: 11, color: chip.color }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}
