import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { supabase } from "../lib/supabase.js";
import { getCardData, getCardImage } from "../lib/scryfall.js";
import { resolveLegendDeck } from "../lib/legendDeck.js";
import ScryCheckRadar, { readVectors } from "./ScryCheckRadar.jsx";
import ScryCheckSheet from "./ScryCheckSheet.jsx";

// The detail pane of the storage-box Home — now a PAGED summary, the way a
// Pokémon summary screen is paged.
//
// ⚠️ WHY THIS IS PAGED, because it will look like over-engineering otherwise.
// The pane briefly showed the card art and the ScryCheck radar side by side and
// Ben's read was immediate: "its getting busy on the main page... there's a
// better way to sort this information." Going back to the source settled it —
// in Gen V the PC box shows sprites and identity, and the STAT HEXAGON lives on
// the summary screen's stats page, which you reach by pressing left/right.
// Paging is Pokémon's answer to exactly this problem: not shrinking two things
// to share one pane, but giving each its own and letting you flick between.
//
//   PAGE 1  the card art — the "sprite" page. Identity.
//   PAGE 2  the ScryCheck radar — power level. Analysis.
//
// The pane is not taller than it was and nothing scrolls vertically; each page
// simply gets the WHOLE pane instead of half, which is why the radar's axis
// labels could stop being abbreviations.
//
// ⚠️ A DECK-LESS LEGEND GETS NO SECOND PAGE AT ALL — no page 2, no dots, no
// empty state to swipe into. That is lifted straight from Gen V too: a Pokémon
// with no Ribbons has no Ribbons page. A page that can only ever say "nothing
// here" is worse than the absence of the page.

// The vector columns land in migration 034. Ben applies migrations by hand, so a
// deployed client can be ahead of the database — and naming a column that
// doesn't exist yet fails the WHOLE select, which would blank the detail pane
// for every deck rather than just hiding the radar. Same hazard fetchDeckPartner
// isolates itself against in lib/legendDeck.js. Hence two selects and a fallback.
//
// deck_cards is deliberately NOT fetched: it was here only to count WREC tags.
// One deck per legend is a schema constraint (decks_legend_id_unique), so
// resolveLegendDeck has nothing to weigh and picks the single row regardless.
const DECK_SELECT_WITH_VECTORS =
  "decks!decks_legend_id_fkey(id, status, build_name, scrycheck_speed, scrycheck_consistency, scrycheck_interaction, scrycheck_mana_base, scrycheck_threats)";
const DECK_SELECT_BASE =
  "decks!decks_legend_id_fkey(id, status, build_name)";

export default function LegendIdentity({ legend }) {
  const { theme } = useTheme();
  const [oracleCard, setOracleCard] = useState(null);
  const [deck, setDeck] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pagerRef = useRef(null);

  const dimColor    = theme.dim;
  const textColor   = theme.white;
  const accentColor = theme.accent;
  const trackColor  = theme.muted;
  const plateBg     = theme.surface;

  // Cache-first (memoized) lookup — this used to hit live api.scryfall.com on
  // every legend select, which made the detail pane's sprite the slowest thing
  // on the Home surface. getCardData reads the local cards cache and only
  // falls to the live API on a true miss.
  useEffect(() => {
    let cancelled = false;
    // Clear the stale card immediately so the pane never shows the prior legend.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOracleCard(null);
    getCardData(legend.name)
      .then(card => { if (!cancelled && card) setOracleCard(card); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [legend.name]);

  // Re-fetch this legend's deck so the scores reflect the latest save — the
  // `legend` prop carries the snapshot from when the slot was tapped.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeck(null);
    (async () => {
      // FK named on purpose — see fetchLegendDeck: partner_legend_id (019) made
      // the bare `decks(...)` embed ambiguous and it fails for every user.
      let { data, error } = await supabase
        .from("legends").select(DECK_SELECT_WITH_VECTORS).eq("id", legend.id).single();
      // 42703 is what a SELECT of an unknown column returns; PGRST204/PGRST202
      // are PostgREST's schema-cache misses. Verified live: the select path
      // returns 42703, but both are matched so a stale schema cache degrades to
      // "no radar" rather than to an empty detail pane.
      if (error?.code === "42703" || error?.code === "PGRST204" || error?.code === "PGRST202") {
        ({ data, error } = await supabase
          .from("legends").select(DECK_SELECT_BASE).eq("id", legend.id).single());
      }
      if (cancelled || error || !data) return;
      setDeck(resolveLegendDeck(data.decks));
    })();
    return () => { cancelled = true; };
  }, [legend.id]);

  const cardImage = oracleCard ? (getCardImage(oracleCard, "normal") ?? getCardImage(oracleCard, "large")) : null;
  const hasDeck = Boolean(deck?.id);

  // Selecting a different legend returns to page 1. Landing on the power page of
  // a deck you didn't ask about is disorienting, and the pager keeps its scroll
  // position across a prop change otherwise.
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: "auto" });
    setPage(0);
  }, [legend.id]);

  // Which page is showing. Driven from BOTH the scroll position and the dot
  // taps, which is belt-and-braces on purpose rather than by accident:
  // onScroll is what catches a FLICK (the fast path, and the only thing that
  // knows about a half-swipe that snapped back), while goToPage sets the state
  // itself so a tap is never waiting on an event to land.
  function handleScroll() {
    const el = pagerRef.current;
    if (!el || !el.clientWidth) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setPage(p => (p === next ? p : next));
  }

  // Assigns scrollLeft rather than scrollTo({behavior:"smooth"}) — deliberately.
  // Verified in-browser: the smooth variant never completes here, landing back
  // at 0 every time, and it fails the same way with scroll-snap disabled and
  // with prefers-reduced-motion off, so snap is not the cause. A direct
  // assignment lands and holds. The flick gesture still gets the browser's own
  // native smooth snapping; only the dot tap is instant, which is ordinary
  // behaviour for a pager dot and beats a control that silently does nothing.
  function goToPage(i) {
    const el = pagerRef.current;
    if (!el) return;
    el.scrollLeft = i * el.clientWidth;
    // Set the state here too. Verified in-browser: a programmatic scrollLeft
    // assignment fires NO scroll event in some engines, so an indicator that
    // only listened to onScroll would move the page and leave the dot behind.
    setPage(i);
  }

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: "6px 16px 2px",
      overflow: "hidden",
    }}>
      <div
        ref={pagerRef}
        onScroll={handleScroll}
        className="hide-scrollbar"
        style={{
          flex: 1, minHeight: 0,
          display: "flex",
          overflowX: hasDeck ? "auto" : "hidden",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          // Momentum scrolling on iOS; without it the snap feels sticky.
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* PAGE 1 — the sprite. The card art already carries the name, type and
            mana cost in its own frame, so nothing is labelled here; this page is
            the thing itself, at the largest size the pane allows. */}
        <section
          aria-label="Card"
          style={{
            flex: "0 0 100%", minWidth: 0,
            scrollSnapAlign: "start",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {/* A FIXED box every legend fills identically: the box height is the
              page height and the width follows the MTG card ratio (63:88). The
              img is absolutely positioned so the source image's intrinsic size
              can never drive the box (otherwise an oversized- or old-frame art
              would render taller than a normal card). object-fit cover fills
              without distortion; corner mask unchanged. */}
          <div style={{
            position: "relative",
            height: "100%",
            aspectRatio: "63 / 88",
            borderRadius: "4.8% / 3.4%",
            overflow: "hidden",
            background: plateBg,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}>
            {cardImage && (
              <img
                src={cardImage}
                alt={legend.name}
                draggable={false}
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover", display: "block",
                }}
              />
            )}
          </div>
        </section>

        {/* PAGE 2 — power level. Only exists when there is a deck to grade. */}
        {hasDeck && (
          <section
            aria-label="Power level"
            style={{
              flex: "0 0 100%", minWidth: 0,
              scrollSnapAlign: "start",
              display: "flex", flexDirection: "column",
              padding: "2px 0",
            }}
          >
            <ScryCheckRadar
              vectors={readVectors(deck)}
              accent={accentColor}
              text={textColor}
              dim={dimColor}
              track={trackColor}
              onEdit={() => setSheetOpen(true)}
            />
          </section>
        )}
      </div>

      {/* Page dots. Tappable, not just an indicator — a flick is the fast path
          but it is not a discoverable one, and the dots are what tell you a
          second page exists at all. Hidden entirely at one page, since a lone
          dot indicates nothing. */}
      {hasDeck && (
        <div style={{
          flex: "0 0 auto",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          height: 18,
        }}>
          {["Card", "Power level"].map((label, i) => (
            <button
              key={label}
              onClick={() => goToPage(i)}
              aria-label={label}
              aria-current={page === i ? "true" : undefined}
              style={{
                // The dot is 5px but the target is 18px tall and 14 wide —
                // a 5px tap target is not a tap target.
                width: 14, height: 18, padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", borderRadius: 0,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{
                width: 5, height: 5,
                background: page === i ? accentColor : trackColor,
                transition: "background 0.2s",
              }} />
            </button>
          ))}
        </div>
      )}

      <ScryCheckSheet
        open={sheetOpen}
        deck={deck}
        deckName={deck?.build_name || legend.name}
        onClose={() => setSheetOpen(false)}
        // Patch in place rather than re-running the select: the update already
        // succeeded, so a refetch would only be a slower way to learn what we
        // just wrote.
        onSaved={patch => setDeck(d => (d ? { ...d, ...patch } : d))}
      />
    </div>
  );
}
