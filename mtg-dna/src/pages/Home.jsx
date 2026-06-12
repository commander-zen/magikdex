import { useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import PageHeader from "../components/PageHeader";
import LegendBox from "../components/LegendBox";
import LegendIdentity from "../components/LegendIdentity";

export default function Home() {
  const { theme, mode, toggleTheme } = useTheme();
  const mutedColor  = mode === "light" ? `${theme.ink}b3` : `${theme.white}99`;
  const borderColor = mode === "light" ? theme.border      : theme.muted;

  const [selectedLegend, setSelectedLegend] = useState(null);

  function handleBrew(legend, inProgressDeck) {
    console.log("brew", legend, inProgressDeck);
  }

  if (selectedLegend) {
    return (
      <LegendIdentity
        legend={selectedLegend}
        onBack={() => setSelectedLegend(null)}
        onBrew={handleBrew}
      />
    );
  }

  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      background: theme.base,
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ padding: "28px 20px 40px" }}>
        <PageHeader eyebrow="Helix" title="home" />

        <LegendBox onSelectLegend={setSelectedLegend} />

        <div style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: `1px solid ${borderColor}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <a
            href="https://bsky.app/profile/commanderzen.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 13,
              color: mutedColor,
              textDecoration: "none",
              letterSpacing: "0.01em",
            }}
          >
            @commanderzen.bsky.social
          </a>
          <button
            onClick={toggleTheme}
            style={{
              background: "none",
              border: "none",
              borderRadius: 0,
              padding: 0,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: 18,
                color: mutedColor,
                fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
              }}
            >
              {mode === "dark" ? "light_mode" : "dark_mode"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
