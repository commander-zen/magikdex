import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase.js";
import { deckDisplayName, deckTotal, resolveLegendDeck } from "../lib/legendDeck.js";
import ColorPips from "../components/ColorPips";
import Wordmark from "../components/Wordmark";
import SettingsSheet from "../components/SettingsSheet";

// Same key Home pins the last-opened legend to.
const LAST_KEY = "magicdex-last-legend";
const DECK_GATE = 100;

// The front door (Ben, 2026-11-10): two jobs, nothing else.
//   1. Swipe a Scryfall search  — the screen's one primary action.
//   2. Open your dex            — a big card at thumb height.
export default function Landing({ onSearch, onOpenDex, onAbout, reloadSignal, active }) {
  const { theme } = useTheme();
  const [q, setQ] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null = still loading; then { count, last } where last is the brew to feature.
  const [dex, setDex] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("legends")
        // Name the FK: legends has two paths to decks (see LegendBox).
        .select("id, name, color_identity, decks!decks_legend_id_fkey(id, build_name, deck_cards(quantity, section))")
        .order("name");
      if (cancelled) return;
      const list = data ?? [];
      const lastId = localStorage.getItem(LAST_KEY);
      const legend = list.find(l => String(l.id) === lastId) ?? list[0] ?? null;
      const deck = legend ? resolveLegendDeck(legend.decks) : null;
      setDex({
        count: list.length,
        last: legend && {
          identity: legend.color_identity,
          name: deckDisplayName(legend, deck),
          total: deck ? deckTotal(deck) : 1,
        },
      });
    })();
    return () => { cancelled = true; };
    // `active`: re-read on coming back from the dex, so a rename made there
    // shows here too.
  }, [reloadSignal, active]);

  function submit(e) {
    e.preventDefault();
    onSearch(q.trim());
  }

  const sans = "'Noto Sans', sans-serif";

  return (
    <div style={{
      height: "100%",
      display: "flex", flexDirection: "column",
      background: theme.base,
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
      boxSizing: "border-box",
      overflowY: "auto",
    }}>
      <div style={{
        flex: "0 0 auto", minHeight: 52,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 4px 0 8px",
      }}>
        <Wordmark onClick={onAbout} />
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="press"
          style={{
            width: 44, height: 44,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "none", padding: 0,
            color: `${theme.white}80`, cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 22 }}>settings</span>
        </button>
      </div>

      {/* 1. SEARCH → SWIPE */}
      <form onSubmit={submit} style={{ padding: "28px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
        <label htmlFor="landing-search" style={{ fontFamily: sans, fontSize: 28, fontWeight: 300, lineHeight: 1.15, color: theme.white }}>
          Swipe through any card
        </label>
        <div style={{ fontFamily: sans, fontSize: 14, color: theme.dim, marginTop: -6 }}>
          Search for a card or use Scryfall syntax.
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          height: 52, padding: "0 14px",
          background: theme.surface,
          border: `1px solid ${theme.muted}`,
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: 20, color: theme.dim }}>search</span>
          <input
            id="landing-search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="t:dragon c:r mv<=4"
            enterKeyHint="search"
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            style={{
              flex: 1, minWidth: 0, height: "100%",
              background: "transparent", border: "none", outline: "none",
              color: theme.white, fontFamily: sans, fontSize: 16,
            }}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              style={{
                width: 44, height: 44, marginRight: -12,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", color: theme.dim, cursor: "pointer",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
            </button>
          )}
        </div>
        <button
          type="submit"
          className="press"
          style={{
            minHeight: 52,
            background: theme.accent, color: theme.base, border: "none",
            fontFamily: sans, fontSize: 17, fontWeight: 600,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Start swiping
          <span className="material-symbols-rounded" style={{ fontSize: 20 }}>swipe</span>
        </button>
      </form>

      <div style={{ flex: 1, minHeight: 24 }} />

      {/* 2. YOUR DEX — bottom, in thumb reach */}
      <div style={{ padding: "0 16px 16px" }}>
        <button
          onClick={onOpenDex}
          className="press"
          style={{
            width: "100%", minHeight: 120,
            display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10,
            padding: 16,
            background: theme.surface,
            border: `1px solid ${theme.muted}`,
            color: theme.white, textAlign: "left",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{ fontFamily: sans, fontSize: 13, color: theme.dim }}>
            {dex === null ? "Your dex" : dex.count === 0 ? "Your dex is empty"
              : `Your dex · ${dex.count} ${dex.count === 1 ? "brew" : "brews"}`}
          </span>
          {dex?.last ? (
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <ColorPips identity={dex.last.identity} size={14} />
              <span style={{
                fontFamily: sans, fontSize: 18,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {dex.last.name}
              </span>
              <span style={{ marginLeft: "auto", fontFamily: "'Noto Sans Mono', monospace", fontSize: 12, color: theme.dim, flexShrink: 0 }}>
                {dex.last.total}/{DECK_GATE}
              </span>
            </span>
          ) : (
            <span style={{ fontFamily: sans, fontSize: 18 }}>
              {dex === null ? " " : "Pick a legend and start a brew"}
            </span>
          )}
          <span style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontFamily: sans, fontSize: 15, color: theme.accent,
          }}>
            {dex?.count ? "Open your dex" : "Go to your dex"}
            <span className="material-symbols-rounded" style={{ fontSize: 22 }}>arrow_forward</span>
          </span>
        </button>
      </div>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
