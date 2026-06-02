import { C, TABS } from "../constants";

export default function GlassNav({ active, onSelect }) {
  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 200,
      display: "flex",
      justifyContent: "center",
      paddingBottom: "env(safe-area-inset-bottom, 12px)",
      paddingTop: 8,
      background: "linear-gradient(to top, rgba(6,4,15,0.92) 60%, rgba(6,4,15,0))",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        background: "rgba(18, 14, 36, 0.72)",
        backdropFilter: "blur(24px) saturate(1.6)",
        WebkitBackdropFilter: "blur(24px) saturate(1.6)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 32,
        padding: "6px 8px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
        minWidth: 300,
        maxWidth: 420,
        width: "calc(100% - 40px)",
      }}>
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          const accent = {
            home:       C.cyan,
            collection: C.purple,
            brew:       "#4ade80",
            play:       "#f87171",
            analyze:    C.blue,
          }[tab.id];

          return (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                padding: "8px 4px 6px",
                borderRadius: 24,
                border: "none",
                cursor: "pointer",
                background: isActive ? `${accent}22` : "transparent",
                transition: "background 0.2s, transform 0.15s",
                transform: isActive ? "scale(1.05)" : "scale(1)",
                outline: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                className="material-symbols-rounded"
                style={{
                  fontSize: 24,
                  fontVariationSettings: isActive
                    ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
                    : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                  color: isActive ? accent : C.muted,
                  transition: "color 0.2s, font-variation-settings 0.2s",
                }}
              >
                {tab.icon}
              </span>
              <span style={{
                fontSize: 10,
                fontFamily: "'Noto Sans', sans-serif",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? accent : C.muted,
                letterSpacing: "0.02em",
                lineHeight: 1,
                transition: "color 0.2s",
              }}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
