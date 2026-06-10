import { useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import ToolChips from "../components/ToolChips";
import PageHeader from "../components/PageHeader";
import { BREW_TOOLS } from "../data/tools";
import SearchScreen from "../brew-components/screens/SearchScreen.jsx";
import SwipeScreen from "../brew-components/screens/SwipeScreen.jsx";
import ReviewScreen from "../brew-components/screens/ReviewScreen.jsx";
import { fetchFirstPageForSwipe } from "../lib/scryfall.js";
import { supabase } from "../lib/supabase.js";

// The brew-components were ported from Deck Stack, whose styles reference
// CSS custom properties (--bg, --color-surface, --bevel-*, etc.) in
// module-level style objects that can't call useTheme(). This bridge maps
// every Deck Stack variable onto MTG DNA theme tokens at the takeover root,
// so the ported components re-theme (including light/dark) without per-file
// style rewrites. Theme keys differ by mode, hence the || fallbacks.
function brewThemeVars(theme) {
  const panel = theme.surface || theme.paper;
  const text = theme.white || theme.ink;
  const muted = theme.dim || theme.muted;
  const accent = theme.amber || theme.gold;
  const success = theme.green || theme.gold;
  const danger = theme.stamp || "#c0392b";
  return {
    "--bg": theme.base,
    "--panel": panel,
    "--panel2": panel,
    "--text": text,
    "--text2": muted,
    "--muted": muted,
    "--primary": accent,
    "--secondary": success,
    "--success": success,
    "--danger": danger,
    "--active": accent,
    "--color-bg": theme.base,
    "--color-surface": panel,
    "--color-surface-raised": panel,
    "--color-chrome": panel,
    "--color-chrome-light": theme.border,
    "--color-chrome-mid": muted,
    "--color-chrome-dark": theme.border,
    "--color-titlebar": accent,
    "--color-titlebar-text": theme.base,
    "--color-text-primary": text,
    "--color-text-secondary": muted,
    "--color-text-chrome": text,
    "--bevel-light": theme.border,
    "--bevel-dark": theme.border,
    "--bevel-inset-light": theme.border,
    "--bevel-inset-dark": theme.border,
    "--font-system": "'Noto Sans', sans-serif",
    "--font-size-base": "13px",
    "--font-size-sm": "11px",
    "--font-size-lg": "16px",
    "--font-size-xl": "20px",
    "--space-1": "4px",
    "--space-2": "8px",
    "--space-3": "12px",
    "--space-4": "16px",
    "--space-5": "24px",
    "--space-6": "32px",
  };
}

// Collapse instances to (card_name, section) rows with quantities for deck_cards.
function buildCardRows(deckId, boards) {
  const rows = [];
  for (const [section, cards] of boards) {
    const counts = new Map();
    for (const c of cards) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    for (const [card_name, quantity] of counts) {
      rows.push({ deck_id: deckId, card_name, quantity, section });
    }
  }
  return rows;
}

export default function Brew() {
  const { theme } = useTheme();
  // shell | search | swipe | review
  const [brewView, setBrewView] = useState("shell");

  const [query, setQuery]           = useState("");
  const [swipeCards, setSwipeCards] = useState([]);
  const [swipeIndex, setSwipeIndex] = useState(0);
  const [swipeOrder, setSwipeOrder] = useState("name");
  const [swipeDir, setSwipeDir]     = useState("desc");
  const [pile, setPile]             = useState([]);
  const [decklist, setDecklist]     = useState([]);
  const [maybeboard, setMaybeboard] = useState([]);

  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState(null);

  function resetBrew() {
    setQuery("");
    setSwipeCards([]);
    setSwipeIndex(0);
    setPile([]);
    setDecklist([]);
    setMaybeboard([]);
    setError(null);
    setSaveError(null);
  }

  async function runSearch(q, order = swipeOrder, dir = swipeDir) {
    setLoading(true);
    setError(null);
    try {
      const { cards } = await fetchFirstPageForSwipe(q, null, { order, dir });
      if (!cards.length) throw new Error("No cards found for that query.");
      setQuery(q);
      setSwipeCards(cards);
      setSwipeIndex(0);
      setBrewView("swipe");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSortChange(order, dir) {
    setSwipeOrder(order);
    setSwipeDir(dir);
    if (query) runSearch(query, order, dir);
  }

  // Upsert legend → create deck → bulk insert deck_cards (002 schema).
  async function handleConfirmSave(commanderName, buildName) {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: legend, error: legendError } = await supabase
        .from("legends")
        .upsert({ name: commanderName }, { onConflict: "name" })
        .select()
        .single();
      if (legendError) throw legendError;

      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .insert({
          legend: commanderName, // legacy text column, kept in sync
          legend_id: legend.id,
          build_name: buildName || null,
          status: "Active",
        })
        .select()
        .single();
      if (deckError) throw deckError;

      const rows = buildCardRows(deck.id, [
        ["pile", pile],
        ["decklist", decklist],
        ["maybe", maybeboard],
      ]);
      for (let i = 0; i < rows.length; i += 100) {
        const { error: cardError } = await supabase
          .from("deck_cards")
          .insert(rows.slice(i, i + 100));
        if (cardError) throw cardError;
      }

      resetBrew();
      setBrewView("shell");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // tools.js is static data, so the Helix: Brew entry carries an action key
  // and the live handler is injected here.
  const tools = BREW_TOOLS.map(t =>
    t.action === "brew-search" ? { ...t, onClick: () => setBrewView("search") } : t
  );

  if (brewView !== "shell") {
    const backTarget = brewView === "search" ? "shell"
      : brewView === "swipe" ? "search"
      : "swipe";
    // Swipe view: the stack strip owns the top edge, so the exit moves bottom-left.
    const backPosition = brewView === "swipe"
      ? { bottom: 10, left: 10 }
      : { top: 10, left: 10 };

    return (
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: theme.base,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        ...brewThemeVars(theme),
      }}>
        <button
          onClick={() => setBrewView(backTarget)}
          aria-label="Back"
          style={{
            position: "fixed",
            ...backPosition,
            zIndex: 51,
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            padding: 0,
            color: theme.white || theme.ink,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span
            className="material-symbols-rounded"
            style={{
              fontSize: 22,
              fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
            }}
          >
            arrow_back
          </span>
        </button>

        {brewView === "search" && (
          <SearchScreen
            onSearch={runSearch}
            loading={loading}
            error={error}
            commanderCard={null}
            onCommanderCardChange={() => {}}
          />
        )}

        {brewView === "swipe" && (
          <SwipeScreen
            cards={swipeCards}
            pile={pile}
            onPileChange={setPile}
            maybeboard={maybeboard}
            onMaybeboardChange={setMaybeboard}
            decklist={decklist}
            onDecklistChange={setDecklist}
            onGoToPile={() => setBrewView("review")}
            onGoToSearch={() => setBrewView("search")}
            onSearchMore={() => setBrewView("search")}
            commanderCard={null}
            onCommanderCardChange={() => {}}
            initialIndex={swipeIndex}
            onIndexChange={setSwipeIndex}
            swipeOrder={swipeOrder}
            swipeDir={swipeDir}
            onSortChange={handleSortChange}
            activeDeckId={null}
            onSavePile={() => {}}
          />
        )}

        {brewView === "review" && (
          <ReviewScreen
            pile={pile}
            decklist={decklist}
            maybeboard={maybeboard}
            onConfirm={handleConfirmSave}
            saving={saving}
            error={saveError}
          />
        )}
      </div>
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
        <PageHeader eyebrow="Helix" title="brew" />
        <ToolChips tools={tools} />
      </div>
    </div>
  );
}
