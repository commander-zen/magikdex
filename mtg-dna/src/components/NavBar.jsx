import { useState } from "react";
import { useTheme } from "../theme/ThemeContext";

const TABS = [
  { id: "home",     label: "Home",     icon: "home"        },
  { id: "vault",    label: "Vault",    icon: "encrypted"   },
  { id: "brew",     label: "Brew",     icon: "science"     },
  { id: "table",    label: "Pod",      icon: "group"       },
  { id: "notebook", label: "Analysis", icon: "menu_book"   },
];

export default function NavBar({ activePage, onNavigate }) {
  const { theme, mode } = useTheme();
  const [localActive, setLocalActive] = useState("home");
  const active = activePage ?? localActive;

  const bg     = mode === "light" ? theme.paper   : theme.surface;
  const border = mode === "light"
    ? `2px solid ${theme.ink}`
    : `1px solid ${theme.muted}`;
  const activeColor   = mode === "light" ? theme.gold  : theme.amber;
  const inactiveColor = mode === "light"
    ? `${theme.ink}80`
    : theme.muted;

  const handleTap = (id) => {
    setLocalActive(id);
    onNavigate?.(id);
  };

  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      display: "flex",
      background: bg,
      borderTop: border,
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      {TABS.map(({ id, label, icon }) => {
        const isActive = active === id;
        const color = isActive ? activeColor : inactiveColor;
        return (
          <button
            key={id}
            onClick={() => handleTap(id)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "10px 0 8px",
              background: "none",
              border: "none",
              cursor: "pointer",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: 22,
                color,
                fontVariationSettings: isActive
                  ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
                  : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                transition: "color 0.15s",
              }}
            >
              {icon}
            </span>
            <span style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 10,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color,
              lineHeight: 1,
              transition: "color 0.15s",
            }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
