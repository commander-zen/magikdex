import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import ToolChips from "../components/ToolChips";
import PageHeader from "../components/PageHeader";
import { BREW_TOOLS } from "../data/tools";
import SearchScreen from "../brew-components/screens/SearchScreen.jsx";
import SwipeScreen from "../brew-components/screens/SwipeScreen.jsx";
import ReviewScreen from "../brew-components/screens/ReviewScreen.jsx";
import { fetchFirstPageForSwipe, fetchCardIdentity, getCardImage, LOKI_CLONE_QUERY } from "../lib/scryfall.js";
import { supabase } from "../lib/supabase.js";

// Brew sub-screens are always dark, regardless of the app theme mode —
// card art is designed against dark and the light tokens were leaking in.
const BREW = {
  base:    "#0a0e1a",
  surface: "#111820",
  text:    "#e8f0ee",
  dim:     "#4a6358",
  amber:   "#e8a020",
  green:   "#7ab89a",
  red:     "#a04040",
  border:  "#1a2520",
};

// The brew-components were ported from Deck Stack, whose styles reference
// CSS custom properties (--bg, --color-surface, --bevel-*, etc.) in
// module-level style objects that can't call useTheme(). This bridge maps
// every Deck Stack variable onto the fixed Brew dark palette at the
// takeover root, so the ported components stay dark without per-file edits.
const BREW_VARS = {
  "--bg": BREW.base,
  "--panel": BREW.surface,
  "--panel2": BREW.surface,
  "--text": BREW.text,
  "--text2": BREW.dim,
  "--muted": BREW.dim,
  "--primary": BREW.amber,
  "--secondary": BREW.green,
  "--success": BREW.green,
  "--danger": BREW.red,
  "--active": BREW.amber,
  "--color-bg": BREW.base,
  "--color-surface": BREW.surface,
  "--color-surface-raised": BREW.surface,
  "--color-chrome": BREW.surface,
  "--color-chrome-light": BREW.border,
  "--color-chrome-mid": BREW.dim,
  "--color-chrome-dark": BREW.border,
  "--color-titlebar": BREW.amber,
  "--color-titlebar-text": BREW.base,
  "--color-text-primary": BREW.text,
  "--color-text-secondary": BREW.dim,
  "--color-text-chrome": BREW.text,
  "--bevel-light": BREW.border,
  "--bevel-dark": BREW.border,
  "--bevel-inset-light": BREW.border,
  "--bevel-inset-dark": BREW.border,
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

// Temporary dev seed — skips SearchScreen and swipes the hardcoded Loki queue.
const LOKI_SESSION_LABEL = "Loki, God of Mischief — oops all clones";

const BREW_MODES = [
  { key: "legend",    name: "New Legend",     desc: "Start fresh around a commander" },
  { key: "import",    name: "Import Deck",    desc: "Bring in a Moxfield or Archidekt URL" },
  { key: "pile",      name: "Free Pile",      desc: "No commander, just building a stack" },
  { key: "discovery", name: "Card Discovery", desc: "Browse and swipe without a goal" },
];

// PageHeader pattern on the fixed dark palette. The shared component reads
// useTheme(), which would follow the app's light mode in here.
function BrewModeSelect({ onSelect, onDevSeed, devLoading, devError }) {
  return (
    <div style={{ padding: "28px 20px 40px", maxWidth: 430, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{
          fontFamily: "'Noto Sans', sans-serif",
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: BREW.dim,
          marginBottom: 4,
        }}>
          Helix
        </div>
        <div style={{
          fontFamily: "'Noto Sans', sans-serif",
          fontSize: 28,
          fontWeight: 300,
          letterSpacing: "0.02em",
          color: BREW.text,
          lineHeight: 1.1,
        }}>
          brew
        </div>
        <div style={{ width: 32, height: 1, background: BREW.amber, marginTop: 10 }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {BREW_MODES.map((m, i) => (
          <div
            key={m.key}
            onClick={() => onSelect(m.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 0",
              borderBottom: i < BREW_MODES.length - 1 ? `1px solid ${BREW.border}` : "none",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 15,
                fontWeight: 400,
                color: BREW.text,
                lineHeight: 1.2,
                marginBottom: 3,
              }}>
                {m.name}
              </div>
              <div style={{
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 12,
                fontWeight: 300,
                color: `${BREW.text}60`,
                lineHeight: 1.5,
              }}>
                {m.desc}
              </div>
            </div>
            <span
              className="material-symbols-rounded"
              style={{
                flexShrink: 0,
                fontSize: 16,
                fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                color: BREW.dim,
              }}
            >
              arrow_forward
            </span>
          </div>
        ))}
      </div>

      {/* Temporary fourth-wall dev seed — remove once real search flows land */}
      <div
        onClick={() => { if (!devLoading) onDevSeed(); }}
        style={{
          marginTop: 36,
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 12,
          color: BREW.dim,
          cursor: devLoading ? "default" : "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {devLoading ? "// Loki test session — loading…" : "// Loki test session"}
      </div>
      {devError && (
        <div style={{
          marginTop: 8,
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 11,
          color: BREW.red,
        }}>
          {devError}
        </div>
      )}
    </div>
  );
}

// Inverse of buildCardRows: expand a deck's existing deck_cards rows back
// into per-instance card entries for a given section, so the swipe tally
// and review screen reflect live deck contents on resume rather than zero.
function expandRows(rows, section) {
  const result = [];
  for (const r of rows) {
    if (r.section !== section) continue;
    for (let i = 0; i < r.quantity; i++) {
      result.push({ name: r.card_name, instanceId: crypto.randomUUID() });
    }
  }
  return result;
}

// Every Scryfall query issued during a session — auto-seed or in-session
// search — is constrained to the legend's color identity server-side of
// whatever the user typed, so illegal cards can never surface.
function withColorIdentity(q, colorIdentity) {
  const ci = colorIdentity?.length ? colorIdentity.join("").toLowerCase() : "c";
  return `${q} legal:commander ci<=${ci}`.trim();
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

export default function Brew({ session, onSessionDone, resetSignal }) {
  const { theme } = useTheme();
  // shell | modes | search | swipe | review
  const [brewView, setBrewView] = useState("shell");
  const [brewMode, setBrewMode] = useState(null);

  const [query, setQuery]           = useState("");
  const [sessionLabel, setSessionLabel] = useState(null);
  const [swipeCards, setSwipeCards] = useState([]);
  const [swipeIndex, setSwipeIndex] = useState(0);
  const [swipeOrder, setSwipeOrder] = useState("name");
  const [swipeDir, setSwipeDir]     = useState("asc");
  const [pile, setPile]             = useState([]);
  const [decklist, setDecklist]     = useState([]);
  const [maybeboard, setMaybeboard] = useState([]);

  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);

  // A legend-attached session (launched from LegendIdentity's "brew" verb)
  // skips commander selection and lands directly on the search screen,
  // optionally attaching to that legend's in-progress deck.
  const [attachDeckId, setAttachDeckId]       = useState(null);
  const [existingCardRows, setExistingCardRows] = useState([]);
  const [legendColorIdentity, setLegendColorIdentity] = useState(null);

  // Where "back" from review should land — the legend's deck row is review's
  // canonical parent; entering review via the swipe tally keeps swipe-back.
  const [reviewOrigin, setReviewOrigin] = useState("swipe");

  const writeQueueRef = useRef([]);
  const flushingRef   = useRef(false);

  // Decided cards (pile/decklist/maybe, this session or earlier) by name —
  // re-seeds and in-session searches must never re-queue them.
  const decidedNamesRef = useRef(new Set());
  useEffect(() => {
    decidedNamesRef.current = new Set([...pile, ...decklist, ...maybeboard].map(c => c.name));
  }, [pile, decklist, maybeboard]);

  // A legend-attached session skips commander/mode selection entirely and
  // drops straight into the swipe carousel, auto-seeded from the legend's
  // color identity (fetched now if the row hasn't been backfilled yet).
  useEffect(() => {
    if (!session || brewView !== "shell") return;
    setBrewMode("legend");
    setSessionLabel(session.legend.name);
    let cancelled = false;
    (async () => {
      // Flick-is-a-write: the session's deck must exist before any swipe can
      // land, so create it now if the legend has no in-progress deck yet —
      // matched on legend_id, never a name-insert.
      let deckId = session.deckId;
      if (!deckId) {
        const { data: deck, error: deckError } = await supabase
          .from("decks")
          .insert({ legend: session.legend.name, legend_id: session.legend.id, status: "Active" })
          .select()
          .single();
        if (!deckError) deckId = deck.id;
      }

      let existingRows = [];
      if (deckId) {
        setAttachDeckId(deckId);
        const { data } = await supabase
          .from("deck_cards")
          .select("card_name, quantity, section")
          .eq("deck_id", deckId);
        existingRows = data ?? [];
        if (!cancelled) {
          setExistingCardRows(existingRows);
          // Tally on resume: the header/review counts read live deck contents,
          // not zero — flicks increment from here.
          setDecklist(expandRows(existingRows, "decklist"));
          setMaybeboard(expandRows(existingRows, "maybe"));
          setPile(expandRows(existingRows, "pile"));
        }
      }

      let colorIdentity = session.legend.color_identity;
      if (!colorIdentity) {
        const card = await fetchCardIdentity(session.legend.name);
        colorIdentity = card?.color_identity ?? [];
        if (card) {
          await supabase.from("legends").update({ color_identity: colorIdentity }).eq("id", session.legend.id);
        }
      }
      if (cancelled) return;
      setLegendColorIdentity(colorIdentity);

      // Deck row is a door: opening a deck from LegendIdentity lands directly
      // on its live review, not the swipe carousel. The queue still seeds in
      // the background (excluding everything already in the deck) so review's
      // back arrow can drop straight into "continue brewing".
      if (session.startView === "review") {
        setReviewOrigin("legend");
        setBrewView("review");
        await seedSwipeQueue(colorIdentity, existingRows, { setView: false });
      } else {
        await seedSwipeQueue(colorIdentity, existingRows);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // legal:commander ci<=<identity> -t:land, ordered by edhrec popularity —
  // dev seed for the legend-attached session's initial queue. Cards already
  // in the attached deck are filtered out client-side.
  async function seedSwipeQueue(colorIdentity, excludeRows = [], { setView = true } = {}) {
    setLoading(true);
    setError(null);
    try {
      const rawQuery = "-t:land";
      const q = withColorIdentity(rawQuery, colorIdentity);
      const { cards } = await fetchFirstPageForSwipe(q, null, { order: "edhrec" });
      if (!cards.length) throw new Error("No cards found for that query.");
      // Exclude every card already in the deck, on either board — recomputed
      // from live deck_cards on every entry, not just the session that first
      // seeded the queue — plus anything decided so far this session.
      const exclude = new Set([...excludeRows.map(r => r.card_name), ...decidedNamesRef.current]);
      setQuery(rawQuery);
      // The auto-seed arrives in EDHREC-rank order — reflect that in the sort
      // control so the label names the order actually applied (not "NAME").
      setSwipeOrder("edhrec");
      setSwipeDir("asc");
      setSwipeCards(cards.filter(c => !exclude.has(c.name)));
      setSwipeIndex(0);
      if (setView) setBrewView("swipe");
    } catch (err) {
      setError(err.message);
      if (setView) setBrewView("search");
    } finally {
      setLoading(false);
    }
  }

  // A flick is a write: each decklist/maybe decision (and its undo) is
  // queued and applied to deck_cards immediately, fire-and-forget, so the
  // gesture/animation never blocks on the network. Failed writes retry with
  // backoff; only persistent failure (3 attempts) surfaces, via `reconnecting`.
  function commitCard(card, section, delta) {
    if (!attachDeckId) return;
    writeQueueRef.current.push({ deckId: attachDeckId, cardName: card.name, section, delta, attempts: 0 });
    flushWriteQueue();
  }

  async function flushWriteQueue() {
    if (flushingRef.current) return;
    flushingRef.current = true;
    while (writeQueueRef.current.length > 0) {
      const item = writeQueueRef.current[0];
      try {
        await applyCardDelta(item);
        writeQueueRef.current.shift();
        setReconnecting(false);
      } catch {
        item.attempts += 1;
        if (item.attempts >= 3) {
          setReconnecting(true);
          writeQueueRef.current.shift();
          continue;
        }
        flushingRef.current = false;
        setTimeout(flushWriteQueue, 1500);
        return;
      }
    }
    flushingRef.current = false;
  }

  // Read-modify-write a single deck_cards row for (deck, card, section).
  async function applyCardDelta({ deckId, cardName, section, delta }) {
    const { data: existing, error: selError } = await supabase
      .from("deck_cards")
      .select("id, quantity")
      .eq("deck_id", deckId).eq("card_name", cardName).eq("section", section)
      .maybeSingle();
    if (selError) throw selError;
    const quantity = (existing?.quantity ?? 0) + delta;
    if (quantity <= 0) {
      if (existing) {
        const { error } = await supabase.from("deck_cards").delete().eq("id", existing.id);
        if (error) throw error;
      }
    } else if (existing) {
      const { error } = await supabase.from("deck_cards").update({ quantity }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("deck_cards").insert({ deck_id: deckId, card_name: cardName, section, quantity });
      if (error) throw error;
    }
  }

  // Live review: removing a card from a section is itself a write (-1).
  function handleRemoveCard(name, section) {
    const [list, setList] = section === "decklist" ? [decklist, setDecklist]
      : section === "maybe" ? [maybeboard, setMaybeboard]
      : [pile, setPile];
    const idx = list.findIndex(c => c.name === name);
    if (idx === -1) return;
    const card = list[idx];
    setList(prev => prev.filter((_, i) => i !== idx));
    commitCard(card, section, -1);
  }

  // Tapping the Brew tab while already on this page returns to the landing
  // (shell) view without discarding the in-progress session — only react
  // to changes after mount, so this doesn't fight the session-init effect.
  const lastResetSignal = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal !== lastResetSignal.current) {
      lastResetSignal.current = resetSignal;
      setBrewView("shell");
    }
  }, [resetSignal]);

  function resetBrew() {
    setBrewMode(null);
    setQuery("");
    setSessionLabel(null);
    setSwipeCards([]);
    setSwipeIndex(0);
    setPile([]);
    setDecklist([]);
    setMaybeboard([]);
    setError(null);
    setSaveError(null);
    setAttachDeckId(null);
    setExistingCardRows([]);
    setReviewOrigin("swipe");
  }

  async function runSearch(q, order = swipeOrder, dir = swipeDir, label) {
    setLoading(true);
    setError(null);
    try {
      // In a legend-attached session, every typed query is constrained to the
      // legend's color identity server-side — the user's input is never
      // trusted alone, matching the auto-seed path above.
      const finalQuery = session ? withColorIdentity(q, legendColorIdentity) : q;
      const { cards } = await fetchFirstPageForSwipe(finalQuery, null, { order, dir });
      if (!cards.length) throw new Error("No cards found for that query.");
      // Decided cards (this session or earlier) never re-queue, no matter how
      // the queue was re-seeded — skipped/browsed cards are unaffected.
      const filtered = cards.filter(c => !decidedNamesRef.current.has(c.name));
      if (!filtered.length) throw new Error("No cards found for that query.");
      setQuery(q);
      setSessionLabel(label !== undefined ? label : sessionLabel);
      setSwipeCards(filtered);
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
    if (query) runSearch(query, order, dir, sessionLabel);
  }

  // Non-session flows (mode select / Loki dev seed) have no deck yet —
  // upsert legend → create deck → bulk insert deck_cards (002 schema).
  // Session flows never reach this: their deck exists from session start
  // and is kept live by commitCard, so review has no save step.
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

      // The legend may have been typed rather than picked from a Scryfall
      // list — attempt to heal its identity now so the Box tile arrives
      // with art/oracle data already attached. Best-effort: failures here
      // shouldn't block the save.
      if (!legend.image_uri || !legend.type_line) {
        try {
          const card = await fetchCardIdentity(commanderName);
          if (card) {
            await supabase.from("legends").update({
              scryfall_id: card.id,
              image_uri: getCardImage(card, "art_crop"),
              type_line: card.type_line ?? null,
              oracle_text: card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? null,
              mana_cost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? null,
              color_identity: card.color_identity ?? [],
            }).eq("id", legend.id);
          }
        } catch { /* best-effort identity backfill */ }
      }

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
    t.action === "brew-search" ? { ...t, onClick: () => setBrewView("modes") } : t
  );

  // ── Back ladder ──────────────────────────────────────────────────────────
  // One rung at a time, the Box surface is the root:
  //   Box surface → brew carousel → (search | review)
  //   Box surface → deck view (review opened from the deck row)
  // A legend-attached session skips straight to swipe with an auto-seeded
  // queue, so "back" from swipe exits to the Box surface. The in-swipe search
  // affordance only re-seeds, so its "back" returns to swipe. Review reached
  // from the deck row exits to the Box surface (the legend, pinned last-active,
  // is the surface's top block); review reached from the swipe tally returns to
  // swipe. The Loki dev seed has no real search, so its "back" is the modes
  // screen. null = exit the session (resetBrew + onSessionDone).
  const isLokiSession = sessionLabel === LOKI_SESSION_LABEL;
  const inOverlay = brewView !== "shell" || !!session;
  const backTarget =
      brewView === "shell"  ? null
    : brewView === "modes"  ? "shell"
    : brewView === "search" ? (session ? "swipe" : "modes")
    : brewView === "swipe"  ? (session ? null : (isLokiSession ? "modes" : "search"))
    : brewView === "review" ? (reviewOrigin === "legend" ? null : "swipe")
    : "swipe";

  function handleBack() {
    if (backTarget === null || backTarget === undefined) {
      resetBrew();
      onSessionDone?.();
    } else {
      setBrewView(backTarget);
    }
  }

  // Hardware/browser Back must behave identically to the in-app chevron. While
  // the takeover is open we trap one synthetic history entry and route every
  // Back — hardware or chevron (via goBack → history.back) — through the same
  // handleBack ladder, re-arming the trap until handleBack exits the session.
  const backTargetRef = useRef(backTarget);
  backTargetRef.current = backTarget;
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;

  useEffect(() => {
    if (!inOverlay) return;
    window.history.pushState({ magicdexBrew: true }, "");
    const onPop = () => {
      const exiting = backTargetRef.current === null || backTargetRef.current === undefined;
      handleBackRef.current();
      // Climbing a rung consumes the trap entry — re-arm so the next Back keeps
      // climbing. Exiting must not re-arm, leaving the launcher entry on top.
      if (!exiting) window.history.pushState({ magicdexBrew: true }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [inOverlay]);

  // The chevron routes through the same history Back the hardware button uses.
  function goBack() {
    if (inOverlay) window.history.back();
    else handleBack();
  }

  if (brewView !== "shell") {
    return (
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: BREW.base,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        ...BREW_VARS,
      }}>
        {brewView !== "swipe" && (
          <button
            onClick={goBack}
            aria-label="Back"
            style={{
              position: "fixed",
              top: "calc(env(safe-area-inset-top) + 10px)",
              left: "calc(env(safe-area-inset-left) + 10px)",
              zIndex: 51,
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              padding: 0,
              color: BREW.text,
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
        )}

        {brewView === "modes" && (
          <BrewModeSelect
            onSelect={(key) => {
              setBrewMode(key);
              setBrewView("search");
            }}
            onDevSeed={() => runSearch(LOKI_CLONE_QUERY, swipeOrder, swipeDir, LOKI_SESSION_LABEL)}
            devLoading={loading}
            devError={error}
          />
        )}

        {brewView === "search" && (
          <SearchScreen
            onSearch={runSearch}
            loading={loading}
            error={error}
            commanderCard={null}
            onCommanderCardChange={() => {}}
            initialQuery={query}
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
            onGoToPile={() => { setReviewOrigin("swipe"); setBrewView("review"); }}
            onExit={goBack}
            onGoToSearch={() => setBrewView("search")}
            onSearchMore={() => setBrewView("search")}
            commanderCard={sessionLabel ? { name: sessionLabel } : null}
            onCommanderCardChange={() => {}}
            initialIndex={swipeIndex}
            onIndexChange={setSwipeIndex}
            swipeOrder={swipeOrder}
            swipeDir={swipeDir}
            onSortChange={handleSortChange}
            onCardCommit={session ? commitCard : undefined}
            reconnecting={reconnecting}
          />
        )}

        {brewView === "review" && (
          <ReviewScreen
            decklist={decklist}
            maybeboard={maybeboard}
            onConfirm={handleConfirmSave}
            saving={saving}
            error={saveError}
            live={!!session}
            onRemove={handleRemoveCard}
            commander={session ? { name: session.legend.name, art: session.legend.image_uri } : null}
          />
        )}
      </div>
    );
  }

  // In the magicdex IA, Brew is only ever launched with a session — the
  // session-init effect flips brewView off "shell" on the next tick. Hold the
  // dark takeover meanwhile rather than flashing the legacy tool landing.
  if (session) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: BREW.base,
        ...BREW_VARS,
      }} />
    );
  }

  // Legacy non-session landing (mode select / free pile / discovery). Retained
  // but no longer reachable now that the tab bar is gone.
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
