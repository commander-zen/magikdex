import { useEffect, useState } from "react";
import { ArrowRight, Pointer, Search, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const count = dex?.count ?? 0;

  return (
    <div className="box-border flex h-full flex-col overflow-y-auto bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] font-sans text-foreground">
      <header className="flex min-h-13 flex-none items-center justify-between pl-2 pr-1">
        <Wordmark onClick={onAbout} />
        <Button variant="ghost" size="icon" aria-label="Settings" className="text-muted-foreground" onClick={() => setSettingsOpen(true)}>
          <Settings aria-hidden />
        </Button>
      </header>

      {/* 1. SEARCH → SWIPE */}
      <form onSubmit={submit} className="flex flex-col gap-3 px-4 pt-7">
        <h1 className="text-balance text-[1.75rem] font-bold leading-tight tracking-tight">
          <label htmlFor="landing-search">Swipe through any card</label>
        </h1>
        <p id="landing-search-hint" className="-mt-1 text-[15px] text-muted-foreground">
          Search for a card or use Scryfall syntax.
        </p>
        <div className="relative mt-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="landing-search"
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="t:dragon c:r mv<=4"
            enterKeyHint="search"
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            aria-describedby="landing-search-hint"
            className="min-h-13 pl-11 pr-12 [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <Button type="button" variant="ghost" size="icon" aria-label="Clear search"
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setQ("")}>
              <X aria-hidden />
            </Button>
          )}
        </div>
        <Button type="submit" size="lg" className="press mt-1 w-full text-[17px]">
          Start swiping
          <Pointer aria-hidden />
        </Button>
      </form>

      <div className="min-h-6 flex-1" />

      {/* 2. YOUR DEX — bottom, in thumb reach */}
      <div className="px-4 pb-4">
        <button
          data-slot="dex-card"
          onClick={onOpenDex}
          className="press flex min-h-30 w-full cursor-pointer flex-col items-stretch gap-2.5 rounded-xl border border-control bg-card p-4 text-left hover:bg-raised"
        >
          <span className="text-sm text-muted-foreground">
            {dex === null ? "Your dex" : count === 0 ? "Your dex is empty" : `Your dex · ${count} ${count === 1 ? "brew" : "brews"}`}
          </span>
          {dex?.last ? (
            <span className="flex min-w-0 items-center gap-2.5">
              <ColorPips identity={dex.last.identity} size={14} />
              <span className="truncate text-lg font-semibold">{dex.last.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[13px] text-muted-foreground">{dex.last.total}/{DECK_GATE}</span>
            </span>
          ) : (
            <span className="text-lg font-semibold">{dex === null ? "\u00a0" : "Pick a legend and start a brew"}</span>
          )}
          <span className="flex items-center justify-between text-[15px] font-semibold text-primary">
            {count ? "Open your dex" : "Go to your dex"}
            <ArrowRight aria-hidden className="size-5" />
          </span>
        </button>
      </div>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
