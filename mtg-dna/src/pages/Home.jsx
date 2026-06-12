import { useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import PageHeader from "../components/PageHeader";
import LegendBox from "../components/LegendBox";
import LegendIdentity from "../components/LegendIdentity";
import SettingsSheet from "../components/SettingsSheet";

// The last-active legend's id — most recently brewed/opened. Persisted to
// localStorage now; a `legends.last_active_at` column can back this later.
const LAST_KEY = "magicdex-last-legend";

// The Box is the root and the only home: one scrolling surface with the
// last-active legend's identity block on top and the full Box grid below.
export default function Home({ onLaunchBrew, reloadSignal }) {
  const { theme, mode } = useTheme();
  const [legends, setLegends] = useState([]);
  const [activeLegend, setActiveLegend] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const glyphColor = mode === "light" ? `${theme.ink}80` : `${theme.white}80`;

  // Pick the top block on every load: keep the current legend if it survived
  // the reload, else the persisted last-active, else the first in the Box.
  function handleLegendsLoaded(list) {
    setLegends(list);
    setActiveLegend(prev => {
      if (prev) {
        const still = list.find(l => l.id === prev.id);
        if (still) return still;
      }
      const lastId = localStorage.getItem(LAST_KEY);
      return list.find(l => String(l.id) === lastId) ?? list[0] ?? null;
    });
  }

  // Tapping a grid tile swaps the top block on the same surface (no push) and
  // pins that legend as last-active.
  function selectLegend(legend) {
    localStorage.setItem(LAST_KEY, String(legend.id));
    setActiveLegend(legend);
  }

  // Brewing also pins last-active so the surface returns to it afterward.
  function launchBrew(legend, deck, opts) {
    localStorage.setItem(LAST_KEY, String(legend.id));
    onLaunchBrew(legend, deck, opts);
  }

  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      background: theme.base,
      position: "relative",
      WebkitOverflowScrolling: "touch",
    }}>
      {/* Settings glyph — inconspicuous, top-right over the surface */}
      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Settings"
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top) + 10px)",
          right: 12,
          zIndex: 10,
          width: 40, height: 40,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", padding: 0,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          className="material-symbols-rounded"
          style={{
            fontSize: 20,
            color: glyphColor,
            fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
          }}
        >
          settings
        </span>
      </button>

      {/* Top: last-active legend's identity block. Re-mounts (re-fetches) when
          the active legend changes or a brew session ends (reloadSignal). */}
      {activeLegend && (
        <LegendIdentity
          key={`${activeLegend.id}-${reloadSignal}`}
          legend={activeLegend}
          onBrew={launchBrew}
        />
      )}

      {/* Below: the full Box grid (+ add-legend tile) */}
      <div style={{ padding: "28px 20px 40px" }}>
        <PageHeader eyebrow="Helix" title="home" />
        <LegendBox
          onSelectLegend={selectLegend}
          onLegendsLoaded={handleLegendsLoaded}
          reloadSignal={reloadSignal}
        />
      </div>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
