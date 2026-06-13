import { useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import LegendBox from "../components/LegendBox";
import LegendIdentity from "../components/LegendIdentity";
import SettingsSheet from "../components/SettingsSheet";

// The last-active legend's id — most recently brewed/opened. Persisted to
// localStorage now; a `legends.last_active_at` column can back this later.
const LAST_KEY = "magicdex-last-legend";

// The Box is the root and the only home, modeled on a Pokémon storage box:
// a detail pane on top (the selected legend) and the box tray below.
export default function Home({ onLaunchBrew, reloadSignal }) {
  const { theme, mode } = useTheme();
  const [legends, setLegends] = useState([]);
  const [activeLegend, setActiveLegend] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const glyphColor   = mode === "light" ? `${theme.ink}80` : `${theme.white}80`;
  const titleColor   = mode === "light" ? theme.ink   : theme.white;
  const dimColor     = mode === "light" ? theme.muted : theme.dim;
  const trayBg       = mode === "light" ? theme.paper : theme.surface;
  const borderColor  = mode === "light" ? theme.border : theme.muted;

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

  // Tapping a tray slot swaps the top detail pane on the same surface (no
  // push) and pins that legend as last-active.
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
      display: "flex",
      flexDirection: "column",
      background: theme.base,
      overflow: "hidden",
    }}>
      {/* Top bar — the magıcdex wordmark drops to the eyebrow position so the
          box header below doesn't compete with it; settings gear on the right. */}
      <div style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: "calc(env(safe-area-inset-top) + 10px)",
        paddingLeft: "calc(env(safe-area-inset-left) + 16px)",
        paddingRight: 12,
        paddingBottom: 10,
      }}>
        {/* Dotless i (U+0131): lowercase, dot removed, to evoke "dex". */}
        <div style={{
          fontFamily: "'Zilla Slab', serif",
          fontSize: 18,
          fontWeight: 400,
          letterSpacing: "0.01em",
          color: titleColor,
          lineHeight: 1,
        }}>
          mag&#x0131;cdex
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          style={{
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
      </div>

      {/* TOP PANE (~55%) — the selected legend's detail. Scrolls internally if
          the oracle text / deck rows overflow; stays put while the tray scrolls. */}
      <div style={{
        flex: "55 1 0",
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
      }}>
        {activeLegend ? (
          <LegendIdentity
            key={`${activeLegend.id}-${reloadSignal}`}
            legend={activeLegend}
            onBrew={launchBrew}
          />
        ) : (
          <div style={{
            height: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 12,
            color: dimColor,
            opacity: 0.6,
          }}>
            add your first legend
          </div>
        )}
      </div>

      {/* BOTTOM PANE (~45%) — the box tray, a distinct surface. */}
      <div style={{
        flex: "45 1 0",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: trayBg,
        borderTop: `1px solid ${borderColor}`,
      }}>
        <LegendBox
          onSelectLegend={selectLegend}
          onLegendsLoaded={handleLegendsLoaded}
          reloadSignal={reloadSignal}
          activeId={activeLegend?.id}
        />
      </div>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
