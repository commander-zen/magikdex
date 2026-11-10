import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import LegendBox from "../components/LegendBox";
import LegendIdentity from "../components/LegendIdentity";
import SettingsSheet from "../components/SettingsSheet";
import ColorPips from "../components/ColorPips";
import Wordmark from "../components/Wordmark";
import { supabase } from "../lib/supabase.js";
import { deckDisplayName, renameDeck, resolveLegendDeck } from "../lib/legendDeck.js";

// The last-active legend's id — most recently brewed/opened. Persisted to
// localStorage now; a `legends.last_active_at` column can back this later.
const LAST_KEY = "magicdex-last-legend";

// The dex: a single fixed screen modeled on the Pokémon Gen-V box — wordmark
// bar, commander detail pane, the deck's name row, box tray. It sits one step
// in from the Landing page (back chevron, top left). The whole thing fits the
// safe area with NO scrolling anywhere (proportional flex).
export default function Home({ onLaunchBrew, onBack, onAbout, reloadSignal }) {
  const { theme } = useTheme();
  const [activeLegend, setActiveLegend] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Inline rename of the selected brew. null = not editing, else the draft.
  const [renameDraft, setRenameDraft] = useState(null);
  const [renameError, setRenameError] = useState(null);
  // Bumped after a rename so the tray re-reads names; added to App's signal.
  const [localReload, setLocalReload] = useState(0);
  // An anonymous box has no credential behind it — lose the browser storage and
  // the account is gone, not locked (see lib/backupState.js). Brew's prompts are
  // bounded and dismissible, so once they're spent there'd be NO signal left
  // that the box is unbacked. This is that signal: ambient, never modal, and
  // only shown once there's something to lose.
  const [hasEmail, setHasEmail] = useState(null); // null = unknown yet
  const [legendCount, setLegendCount] = useState(0);

  // Re-read on reloadSignal: App bumps it when the signed-in account changes,
  // so linking an email (or signing in) clears this without a manual refresh.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setHasEmail(Boolean(data.session?.user?.email));
    });
    return () => { cancelled = true; };
  }, [reloadSignal, settingsOpen]);

  const showBackupFlag = hasEmail === false && legendCount > 0;

  const glyphColor   = `${theme.white}80`;
  const titleColor   = theme.white;
  const dimColor     = theme.dim;
  const trayBg       = theme.surface;
  const borderColor  = theme.muted;

  // Pick the detail pane on every load: keep the current legend if it survived
  // the reload, else the persisted last-active, else the first in the Box.
  function handleLegendsLoaded(list) {
    setLegendCount(list.length);
    setActiveLegend(prev => {
      if (prev) {
        const still = list.find(l => l.id === prev.id);
        if (still) return still;
      }
      const lastId = localStorage.getItem(LAST_KEY);
      return list.find(l => String(l.id) === lastId) ?? list[0] ?? null;
    });
  }

  // Tap-to-preview, tap-again-to-load (Change 13): the FIRST tap on a legend
  // swaps the detail pane (preview) and pins last-active; tapping the legend
  // that's ALREADY selected loads the deck in. Tapping a different slot just
  // moves the selection. deck is passed null — Brew re-resolves the legend's
  // deck from the DB on session start (it never trusts a passed deckId).
  function selectLegend(legend) {
    localStorage.setItem(LAST_KEY, String(legend.id));
    if (activeLegend && legend.id === activeLegend.id) {
      launchBrew(legend, null, { startView: "review" });
      return;
    }
    setRenameDraft(null);
    setActiveLegend(legend);
  }

  const activeDeck = activeLegend ? resolveLegendDeck(activeLegend.decks) : null;
  const activeName = activeLegend ? deckDisplayName(activeLegend, activeDeck) : "";

  function startRename(legend) {
    if (legend && legend.id !== activeLegend?.id) {
      localStorage.setItem(LAST_KEY, String(legend.id));
      setActiveLegend(legend);
    }
    const target = legend ?? activeLegend;
    setRenameError(null);
    setRenameDraft(deckDisplayName(target, resolveLegendDeck(target.decks)));
  }

  async function saveRename(e) {
    e?.preventDefault();
    if (renameDraft === null || !activeLegend) return;
    // Typing the legend's own name back is the same as clearing it.
    const draft = renameDraft.trim() === activeLegend.name ? "" : renameDraft;
    try {
      await renameDeck(activeLegend, activeDeck?.id ?? null, draft);
      setRenameDraft(null);
      setLocalReload(n => n + 1);
    } catch {
      setRenameError("Couldn't save that name. Try again.");
    }
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
        padding: "0 8px 0 4px",
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <button
            onClick={onBack}
            aria-label="Back to start"
            className="press"
            style={{
              width: 44, height: 44,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", padding: 0,
              color: titleColor, cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 24 }}>chevron_left</span>
          </button>
          <Wordmark onClick={onAbout} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {/* Ambient, not modal: states a fact and offers the fix in one tap.
              Deliberately NOT red — nothing is broken, and alarming someone
              who just wanted to brew is its own kind of friction. */}
          {showBackupFlag && (
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="This box is not backed up — add an email"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                minHeight: 44, padding: "0 8px",
                background: "transparent", border: "none",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{
                width: 6, height: 6, flexShrink: 0,
                background: theme.accent,
              }} />
              <span style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 10, letterSpacing: "0.08em",
                color: dimColor, whiteSpace: "nowrap",
              }}>
                not backed up
              </span>
            </button>
          )}
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
      </div>

      {/* 2. DETAIL PANE (~64 of 100) — the selected legend's card.
          This pane is what you READ, the tray is how you NAVIGATE. The tray is
          two rows of wide name tiles (LegendBox COLS×ROWS), which need about
          a third of the height. Change these two flex values together or the
          tray's cells squash — they are a pair. */}
      <div style={{ flex: "64 1 0", minHeight: 0, overflow: "hidden" }}>
        {activeLegend ? (
          <LegendIdentity
            key={`${activeLegend.id}-${reloadSignal}`}
            legend={activeLegend}
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
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 16,
                color: titleColor,
              }}>
                Start your first brew
              </div>
              <div style={{
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 13,
                color: dimColor,
              }}>
                Pick a legend with Add legend below.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* NAME ROW — the selected brew's colour identity and name, a visible
          pencil to rename it (decks.build_name), and the screen's one primary
          action: open the brew. Tapping the selected tile again still opens
          it too, but nothing depends on knowing that. */}
      {activeLegend && (
        <div style={{ flex: "0 0 auto", padding: "6px 12px 8px 16px" }}>
          {renameDraft === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
              <ColorPips identity={activeLegend.color_identity} size={14} />
              <button
                onClick={() => startRename(null)}
                aria-label={`Rename ${activeName}`}
                className="press"
                style={{
                  flex: 1, minWidth: 0, minHeight: 44,
                  display: "flex", alignItems: "center", gap: 6,
                  background: "transparent", border: "none", padding: 0,
                  color: titleColor, cursor: "pointer", textAlign: "left",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span style={{
                  fontFamily: "'Noto Sans', sans-serif", fontSize: 16,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {activeName}
                </span>
                <span className="material-symbols-rounded" style={{ fontSize: 18, color: dimColor, flexShrink: 0 }}>edit</span>
              </button>
              <button
                onClick={() => launchBrew(activeLegend, null, { startView: "review" })}
                className="press"
                style={{
                  minHeight: 44, padding: "0 18px", flexShrink: 0,
                  background: theme.accent, color: theme.base,
                  border: "none",
                  fontFamily: "'Noto Sans', sans-serif", fontSize: 15, fontWeight: 600,
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                Open brew
              </button>
            </div>
          ) : (
            <form onSubmit={saveRename} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
              <input
                autoFocus
                value={renameDraft}
                onChange={e => { setRenameDraft(e.target.value); setRenameError(null); }}
                placeholder={activeLegend.name}
                maxLength={60}
                aria-label="Deck name"
                style={{
                  flex: 1, minWidth: 0, height: 44, padding: "0 12px",
                  background: theme.surface, color: titleColor,
                  border: `1px solid ${theme.accent}`, outline: "none",
                  fontFamily: "'Noto Sans', sans-serif", fontSize: 16,
                }}
              />
              <button
                type="button"
                onClick={() => { setRenameDraft(null); setRenameError(null); }}
                className="press"
                style={{
                  minHeight: 44, padding: "0 12px",
                  background: "transparent", color: dimColor, border: "none",
                  fontFamily: "'Noto Sans', sans-serif", fontSize: 15, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="press"
                style={{
                  minHeight: 44, padding: "0 16px",
                  background: theme.accent, color: theme.base, border: "none",
                  fontFamily: "'Noto Sans', sans-serif", fontSize: 15, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </form>
          )}
          {renameDraft !== null && (
            <div style={{ fontFamily: "'Noto Sans', sans-serif", fontSize: 12, color: renameError ? theme.red : dimColor, marginTop: 4 }}>
              {renameError ?? "Leave it empty to use the legend's name."}
            </div>
          )}
        </div>
      )}

      {/* 3. BOX TRAY (~36 of 100) — pager header + two rows of two wide
          name tiles. */}
      <div style={{
        flex: "36 1 0",
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
          onRenameLegend={startRename}
          reloadSignal={reloadSignal + localReload}
          activeId={activeLegend?.id}
        />
      </div>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Trainer is deliberately NOT here. It was briefly a sheet behind a badge
          glyph in this header, then its own app (trainer/, deleted 2026-10-01).
          magikdex carries no trainer code and talks to no trainer table. */}
    </div>
  );
}
