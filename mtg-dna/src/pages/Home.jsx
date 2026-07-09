import { useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import LegendBox from "../components/LegendBox";
import LegendIdentity from "../components/LegendIdentity";
import SettingsSheet from "../components/SettingsSheet";

// The last-active legend's id — most recently brewed/opened. Persisted to
// localStorage now; a `legends.last_active_at` column can back this later.
const LAST_KEY = "magicdex-last-legend";

// The Box is the root and only home: a single fixed screen modeled on the
// Pokémon Gen-V box — wordmark bar, commander detail pane, box tray. The whole
// thing fits the safe area with NO scrolling anywhere (proportional flex).
export default function Home({ onLaunchBrew, reloadSignal }) {
  const { theme, mode } = useTheme();
  const [activeLegend, setActiveLegend] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const glyphColor   = mode === "light" ? `${theme.ink}80` : `${theme.white}80`;
  const titleColor   = mode === "light" ? theme.ink   : theme.white;
  const dimColor     = mode === "light" ? theme.muted : theme.dim;
  const trayBg       = mode === "light" ? theme.paper : theme.surface;
  const borderColor  = mode === "light" ? theme.border : theme.muted;

  // Pick the detail pane on every load: keep the current legend if it survived
  // the reload, else the persisted last-active, else the first in the Box.
  function handleLegendsLoaded(list) {
    setActiveLegend(prev => {
      if (prev) {
        const still = list.find(l => l.id === prev.id);
        if (still) return still;
      }
      const lastId = localStorage.getItem(LAST_KEY);
      return list.find(l => String(l.id) === lastId) ?? list[0] ?? null;
    });
  }

  // Tapping a tray slot swaps the detail pane in place (no push) and pins
  // that legend as last-active.
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
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
      boxSizing: "border-box",
    }}>
      {/* 1. WORDMARK BAR (~6vh) */}
      <div style={{
        flex: "0 0 auto",
        height: "6vh",
        minHeight: 44,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 8px 0 16px",
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
          mag&#x0131;kdex
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          style={{
            width: 44, height: 44,
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

      {/* 2. DETAIL PANE (~46vh) */}
      <div style={{ flex: "46 1 0", minHeight: 0, overflow: "hidden" }}>
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
            padding: 16,
          }}>
            <div style={{
              border: `1px dashed ${borderColor}`,
              padding: "28px 32px",
              textAlign: "center",
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12,
                letterSpacing: "0.18em",
                color: dimColor,
              }}>
                BOX EMPTY
              </div>
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 11,
                color: dimColor,
                opacity: 0.6,
              }}>
                add your first legend below
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. BOX TRAY (remaining ~42vh) */}
      <div style={{
        flex: "42 1 0",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: trayBg,
        borderTop: `1px solid ${borderColor}`,
        overflow: "hidden",
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
