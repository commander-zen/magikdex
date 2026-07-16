import { useState, useEffect, useRef } from "react";
import { getCardData, getCardDataBatch, getCardImage } from "../../lib/scryfall.js";
import WrecBand, { WREC_CHIPS, LABEL_BY_TAG, WrecIcon, WREC_CHIP_COLORS } from "../../components/WrecBand.jsx";

// Change 14 — how far left a decklist row must be dragged to commit a delete.
const ROW_DELETE_AT = 88;

// The only ref here is the swipe-gesture start tracker (swipeStart), read solely
// inside pointer event handlers — the correct place for refs.

// Spine screens pad for the notch (top, clearing the back chevron) and the
// home indicator (bottom) now that no tab bar absorbs the bottom.
const SAFE_TOP    = "calc(env(safe-area-inset-top) + 56px)";
const SAFE_BOTTOM = "calc(env(safe-area-inset-bottom) + 24px)";

// WREC_CHIPS / LABEL_BY_TAG now live in the shared WrecBand (canonical taxonomy);
// imported above so the composition band and the per-row tag chips share one list.

// Review the accumulated swipe results before saving. Purely presentational —
// the Supabase writes live in the page that owns the brew state (Brew.jsx),
// keeping brew-components free of db imports.

// Stackables (basic lands etc.) can repeat — collapse to name + quantity.
function groupByName(cards) {
  const counts = new Map();
  for (const c of cards) {
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, quantity]) => ({ name, quantity }));
}

// Moxfield bulk-edit text: "<qty> <name> #tag #tag", one card per line, name
// only (no set/collector — Moxfield resolves printing). WREC tags map
// straight to plain #hashtags, space-separated after the name; untagged
// cards get no hashtags. Pulled from cardTags (deck_cards quantity +
// deck_card_tags), keyed `${section}:${name}` — only the decklist section
// counts as "the deck" (maybeboard/pile are excluded).
function buildMoxfieldExport(cardTags, commanderName) {
  const lines = commanderName ? [`1 ${commanderName}`] : [];
  for (const key in cardTags) {
    if (!key.startsWith("decklist:")) continue;
    const name = key.slice("decklist:".length);
    const { quantity, tags } = cardTags[key];
    const hashtags = (tags ?? []).map(t => `#${t}`).join(" ");
    lines.push(hashtags ? `${quantity} ${name} ${hashtags}` : `${quantity} ${name}`);
  }
  return lines.join("\n");
}

// ── Decklist grouping / sorting (Change 6) ──────────────────────────────────
// Moxfield-familiar organize controls, rendered in HELIX. Buckets are derived
// from the resolved card data (type_line / cmc / color_identity); a card whose
// data hasn't resolved yet falls into an "Other" / "MV ?" tail so nothing
// vanishes from the list mid-load.

// Type bucketing. Rules are evaluated IN ORDER, so a multi-type card lands in
// its primary bucket (Artifact Creature → Creatures, Enchantment Land → Lands).
// TYPE_ORDER is the on-screen reading order (Moxfield-familiar; lands last) and
// is the one knob to re-sequence groups without touching bucketing. NOTE: the
// exact live Moxfield sub-order couldn't be extracted (SPA); this is the
// standard type precedence — adjust to taste.
const TYPE_RULES = [
  [/\bCreature\b/,     "Creature"],
  [/\bPlaneswalker\b/, "Planeswalker"],
  [/\bBattle\b/,       "Battle"],
  [/\bLand\b/,         "Land"],
  [/\bInstant\b/,      "Instant"],
  [/\bSorcery\b/,      "Sorcery"],
  [/\bArtifact\b/,     "Artifact"],
  [/\bEnchantment\b/,  "Enchantment"],
];
const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"];
const TYPE_LABEL = {
  Creature: "CREATURES", Planeswalker: "PLANESWALKERS", Battle: "BATTLES",
  Instant: "INSTANTS", Sorcery: "SORCERIES", Artifact: "ARTIFACTS",
  Enchantment: "ENCHANTMENTS", Land: "LANDS", Other: "OTHER",
};
function typeBucket(card) {
  const t = card?.type_line ?? "";
  for (const [re, bucket] of TYPE_RULES) if (re.test(t)) return bucket;
  return "Other";
}

// CMC / mana-value bucketing — 0..6 then a 7+ tail; unresolved cards last.
function cmcBucket(card) {
  const c = typeof card?.cmc === "number" ? card.cmc : null;
  if (c === null) return "MV ?";
  const n = Math.floor(c);
  return n >= 7 ? "MV 7+" : `MV ${n}`;
}
function cmcRank(key) {
  if (key === "MV ?")  return 999;
  if (key === "MV 7+") return 7;
  return parseInt(key.slice(3), 10);
}

// Colour bucketing off colour IDENTITY (the field the cache carries — a close
// proxy for Moxfield's colour grouping). Mono in WUBRG order, then multi, then
// colourless.
const WUBRG_LABEL = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const COLOR_ORDER = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless"];
function colorBucket(card) {
  const ci = card?.color_identity ?? [];
  if (ci.length === 0) return "Colorless";
  if (ci.length > 1)  return "Multicolor";
  return WUBRG_LABEL[ci[0]] ?? "Colorless";
}

// UAT batch 2, item 14 — Moxfield's two-axis organize model: GROUP BY and
// SORT BY are independent. Scoped to the data the decklist actually carries
// (type_line / cmc / color_identity) — EDHREC-rank sort is deliberately
// omitted because the cards cache the deck rows read (CARD_CACHE_COLS) has no
// edhrec_rank column, so it couldn't be honored here.
const GROUP_OPTIONS = [
  { value: "type",  label: "type" },
  { value: "cmc",   label: "mana value" },
  { value: "color", label: "color" },
  { value: "none",  label: "none" },
];
const SORT_OPTIONS = [
  { value: "name", label: "name" },
  { value: "cmc",  label: "mana value" },
];

// Comparator for the SORT BY axis. cmc sorts numerically (unresolved cards
// tail at 99), tie-broken by name; name sorts a–z.
function sortComparator(sortBy, cardOf) {
  if (sortBy === "cmc") {
    return (a, b) => {
      const ca = typeof cardOf(a.name)?.cmc === "number" ? cardOf(a.name).cmc : 99;
      const cb = typeof cardOf(b.name)?.cmc === "number" ? cardOf(b.name).cmc : 99;
      return ca - cb || a.name.localeCompare(b.name);
    };
  }
  return (a, b) => a.name.localeCompare(b.name);
}

// Ordered groups for a section: [{ key, label, items }]. groupBy === "none" is
// a single unlabelled group. Bucket ORDER is fixed per axis (type/colour by
// canonical order; cmc numerically); items WITHIN each group follow the
// independent SORT BY axis.
function buildDeckGroups(items, groupBy, sortBy, cardOf) {
  const cmp = sortComparator(sortBy, cardOf);
  if (groupBy === "none") {
    return [{ key: "all", label: null, items: [...items].sort(cmp) }];
  }
  const bucketOf = groupBy === "type"  ? n => typeBucket(cardOf(n))
    : groupBy === "color" ? n => colorBucket(cardOf(n))
    :                       n => cmcBucket(cardOf(n));
  const map = new Map();
  for (const it of items) {
    const b = bucketOf(it.name);
    if (!map.has(b)) map.set(b, []);
    map.get(b).push(it);
  }
  let keys;
  if (groupBy === "type")       keys = TYPE_ORDER.filter(k => map.has(k));
  else if (groupBy === "color") keys = COLOR_ORDER.filter(k => map.has(k));
  else                          keys = [...map.keys()].sort((a, b) => cmcRank(a) - cmcRank(b));
  return keys.map(k => ({
    key: k,
    label: groupBy === "type" ? TYPE_LABEL[k] : k.toUpperCase(),
    items: [...map.get(k)].sort(cmp),
  }));
}

// View preference persists per deck (keyed by legend id, the stable per-deck
// id — one deck per legend). Best-effort localStorage. Returns { groupBy,
// sortBy }, migrating the two older stored shapes forward.
const VIEW_PREF_PREFIX = "magikdex-decklist-view:";
function loadViewPref(deckKey) {
  if (!deckKey) return null;
  try {
    const p = JSON.parse(localStorage.getItem(VIEW_PREF_PREFIX + deckKey) ?? "null");
    if (!p) return null;
    // Current shape.
    if (p.groupBy && p.sortBy) return { groupBy: p.groupBy, sortBy: p.sortBy };
    // Single-key shape {view}: grouping was the view, sort was always a–z.
    if (p.view) return { groupBy: p.view === "az" ? "none" : p.view, sortBy: "name" };
    // Oldest shape {groupBy, sort}.
    if (p.groupBy) return { groupBy: p.groupBy, sortBy: p.sort === "cmc" ? "cmc" : "name" };
    return null;
  } catch { return null; }
}

export default function ReviewScreen({
  decklist, maybeboard,
  onConfirm, saving, error,
  live, onRemove,
  commander,
  cardTags, onToggleTag,
  onHome, onBrew,
  onDeleteDeck,
  onMoveCard,
  onAddMore,
  onDeckSearch,
  stackCount = 0,
  deckKey = null,
  onHand,
  searchDraft = "", onSearchDraftChange,
}) {
  const [commanderName, setCommanderName] = useState("");
  const [buildName, setBuildName] = useState("");
  // Tap-to-expand: only one card's WREC chip selector open at a time. Chosen
  // over always-on chips so five 44px targets fit mobile width cleanly and
  // untagged cards stay chip-free (no "uncategorized" noise).
  const [expandedKey, setExpandedKey] = useState(null);
  // Per-card gameplay data (type/mana/oracle), keyed by name. deck_cards only
  // stores name+quantity, so anything richer is fetched on demand — tagging a
  // card with no visible context is guesswork. undefined = not yet resolved,
  // null = name couldn't resolve (show "card data unavailable"), object = card.
  const [cardData, setCardData] = useState({});
  const [copied, setCopied] = useState(false);
  // WREC filter — tapping a category in the composition panel narrows the list
  // to that category's cards; tapping it again clears. One category at a time
  // (the panel is a composition readout, not a query builder).
  const [wrecFilter, setWrecFilter] = useState(null);
  // Vault-spec section 1 — the five-cell band is secondary info, collapsed
  // behind a one-line summary chip by default; tapping the chip discloses the
  // full band inline (not a new screen). Picking a category applies the filter
  // and re-collapses so the narrowed list is immediately visible.
  const [wrecOpen, setWrecOpen] = useState(false);
  // Device UAT — the (?) opens an in-app explainer of WREC (not a jump
  // straight to YouTube); the Command Zone video link sits at its bottom.
  const [wrecInfoOpen, setWrecInfoOpen] = useState(false);
  // View control (UAT batch 2, item 14) — Moxfield's two independent axes:
  // GROUP BY (default type, Moxfield-familiar) and SORT BY (default name).
  // Lazily seeded from the per-deck saved pref, then persisted on change.
  // Orthogonal to the WREC readout — this organizes the list, the readout
  // reads composition.
  const savedView = loadViewPref(deckKey);
  const [groupBy, setGroupBy] = useState(() => savedView?.groupBy ?? "type");
  const [sortBy, setSortBy]   = useState(() => savedView?.sortBy ?? "name");
  // Change 14 — the view options are collapsed by default (progressive
  // disclosure); the summary chip shows current state and expands on tap.
  const [controlsOpen, setControlsOpen] = useState(false);
  // Change 14 — swipe-left-to-delete a decklist row (replaces the crowded per-row
  // ✕). Only one row swipes at a time, so a single {key,dx} pair drives the
  // transform. Axis-locks against vertical scroll (touchAction pan-y lets the
  // page scroll; a horizontal lock owns the gesture). A clean tap (no axis lock)
  // still toggles the WREC chip selector — the row's original job.
  const [swipeKey, setSwipeKey] = useState(null);
  const [swipeDx, setSwipeDx]   = useState(0);
  const swipeStart = useRef(null);

  function rowPointerDown(e, key) {
    if (!live) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
    swipeStart.current = { x: e.clientX, y: e.clientY, key, axis: null };
  }
  function rowPointerMove(e) {
    const s = swipeStart.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "x") setSwipeKey(s.key);
      else { swipeStart.current = null; return; } // vertical → let the page scroll
    }
    if (s.axis === "x") setSwipeDx(Math.max(-110, Math.min(0, dx)));
  }
  function rowPointerUp(e, key, name, sectionKey) {
    const s = swipeStart.current;
    swipeStart.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (s.axis === "x") {
      if (dx < -ROW_DELETE_AT) onRemove(name, sectionKey);
      setSwipeKey(null);
      setSwipeDx(0);
    } else if (s.axis === null && live) {
      // No drag → a tap. Device UAT — a DECKLIST row now opens the review
      // carousel AT that card (tagging lives there, not in an inline grid).
      // Maybeboard rows aren't in that carousel, so they keep the inline
      // expander (their only tag + move-to-mainboard path).
      if (sectionKey === "decklist" && onHand) {
        onHand(orderedDeckNames(), name);
      } else {
        setExpandedKey(k => (k === key ? null : key));
      }
    }
  }
  function rowPointerCancel() {
    swipeStart.current = null;
    setSwipeKey(null);
    setSwipeDx(0);
  }
  useEffect(() => {
    if (!deckKey) return;
    try { localStorage.setItem(VIEW_PREF_PREFIX + deckKey, JSON.stringify({ groupBy, sortBy })); }
    catch { /* view pref is best-effort */ }
  }, [deckKey, groupBy, sortBy]);
  // "add more" (gap-filling stack) — pending/error state is local so the
  // button can report "no cards" inline without a global error channel.
  const [addingMore, setAddingMore] = useState(false);
  const [addMoreError, setAddMoreError] = useState(null);
  // Tap the commander NAME in the header → the full card, to re-read its
  // text (same overlay grammar as the swipe screen's commander bar; the
  // header carries no art — Ben: name only). undefined = lookup failed.
  const [showCommander, setShowCommander] = useState(false);
  const [commanderFull, setCommanderFull] = useState(null);
  // Change 1 — the "add cards" search bar. Submitting hands the query to the
  // parent, which builds a search-derived swipe stack and switches to the swipe
  // view (unmounting this screen); only a rejected query (too short / everything
  // already in-deck / bad syntax) returns control here to show the one-line why.
  // Device UAT — the typed syntax lives in the PARENT's session state, not here:
  // this screen unmounts whenever you back out (or a search deals a stack), and
  // local state took the query with it, forcing a full retype.
  const cardSearch = searchDraft;
  const setCardSearch = (v) => onSearchDraftChange?.(v);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchMsg, setSearchMsg] = useState(null);
  // Change 10 — the search bar is TWO doors in one row: while it's empty and
  // unfocused its right half reads "quick brew" (deal the synergy stack, onBrew);
  // focus it (or type) and that half becomes a search-submit magnifier so a power
  // user can pull an exact card / Scryfall query. searchFocused drives the swap.
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef(null);
  const showQuickBrew = !searchFocused && !cardSearch.trim();

  async function handleCardSearch() {
    const q = cardSearch.trim();
    if (!q || searchBusy) return;
    setSearchBusy(true);
    setSearchMsg(null);
    const res = await onDeckSearch(q);
    if (res && !res.ok) {
      setSearchMsg(res.message);
      setSearchBusy(false);
    }
  }

  async function openCommander() {
    setShowCommander(true);
    if (commanderFull || !commander?.name) return;
    const card = await getCardData(commander.name);
    setCommanderFull(card ?? undefined);
  }

  async function handleAddMore() {
    setAddingMore(true);
    setAddMoreError(null);
    try {
      await onAddMore(wrecFilter);
      // Success unmounts this screen (the parent switches to the swipe view).
    } catch (err) {
      setAddMoreError(err?.message ?? "couldn't build a stack");
      setAddingMore(false);
    }
  }
  // Delete is a two-step inline confirm — no modal, the row itself expands.
  // `deleting` never resets on success: the parent tears the session down and
  // this screen unmounts, so only failure returns control here.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteDeck();
    } catch (err) {
      setDeleteError(err?.message ?? "delete failed — try again");
      setDeleting(false);
    }
  }

  // Copy is the guaranteed part (works everywhere); the share sheet is a
  // best-effort bonus where supported — a cancelled/unsupported share never
  // blocks the copy or the confirmation toast.
  async function handleExport() {
    const text = buildMoxfieldExport(cardTags, commander?.name);
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch { /* clipboard may be denied — share sheet below still offers a path */ }
    if (navigator.share) {
      try { await navigator.share({ text, title: `${commander?.name ?? "Deck"} export` }); }
      catch { /* user cancelled or share unsupported for this payload — ignore */ }
    }
  }

  const groups = {
    decklist: groupByName(decklist),
    maybe: groupByName(maybeboard),
  };

  // The decklist flattened in its current display order (group + sort) — the
  // order the review/flip carousel walks. Device UAT: entering review (or
  // tapping a row's mini-card) opens that carousel AT the chosen card, so both
  // paths hand this list plus a start name to onHand.
  const orderedDeckNames = () =>
    buildDeckGroups(groups.decklist, groupBy, sortBy, (n) => cardData[n])
      .flatMap(g => g.items.map(it => it.name));

  // Resolve every listed card's data in ONE batched cache query — per-name
  // getCardData here cost a Supabase round-trip (plus CORS preflight) per
  // card, which was the deck-view load lag. The batch paints all cache hits
  // in a single state merge; only true cache misses (new/misspelled names)
  // trickle in per-name afterward via the throttled live path.
  useEffect(() => {
    const names = [...groups.decklist, ...groups.maybe]
      .map(c => c.name)
      .filter(name => cardData[name] === undefined);
    if (names.length === 0) return;
    let cancelled = false;
    getCardDataBatch(names).then(({ data, misses }) => {
      if (cancelled) return;
      setCardData(prev => {
        const next = { ...prev };
        for (const [name, card] of Object.entries(data)) {
          if (next[name] === undefined) next[name] = card;
        }
        return next;
      });
      for (const name of misses) {
        getCardData(name).then(card => {
          if (cancelled) return;
          setCardData(prev => (prev[name] !== undefined ? prev : { ...prev, [name]: card }));
        });
      }
    });
    return () => { cancelled = true; };
    // groups is derived from decklist/maybeboard; cardData is intentionally
    // omitted (the setter guards against clobbering already-resolved entries).
  }, [decklist, maybeboard]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalCards = decklist.length + maybeboard.length;
  const canSave = Boolean(commanderName.trim()) && totalCards > 0 && !saving;

  // A live session anchored to a legend shows the commander header; the
  // non-session save flow has no legend yet, so it keeps the text header.
  const showAnchor = live && commander;

  // WREC composition counts (by card quantity). Multi-tag means these can sum
  // to more than the deck size — a composition view, not a partition. A zero
  // category is the dump-stat tell, so it renders dimmed.
  const wrecCounts = WREC_CHIPS.map(({ tag, label }) => {
    let n = 0;
    for (const k in (cardTags ?? {})) {
      // Device UAT — the maybeboard is NOT part of the WREC calculus. Keys are
      // `${section}:${name}`, so count the mainboard only; otherwise sidelined
      // cards inflated every role.
      if (!k.startsWith("decklist:")) continue;
      const e = cardTags[k];
      if (e?.tags?.includes(tag)) n += (e.quantity ?? 1);
    }
    return { tag, label, n };
  });

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    fontFamily: "var(--font-system)",
    fontSize: 16,
    border: "1px solid var(--bevel-dark)",
    padding: "10px 12px",
    borderRadius: 0,
    outline: "none",
  };

  function renderSection(label, allItems, sectionKey, accessory = null, panel = null) {
    // An active WREC filter narrows each section to that category's cards;
    // the header count follows the filtered view so it reads as an answer
    // ("DECKLIST · 4" = four ramp cards) rather than the unfiltered total.
    const items = wrecFilter
      ? allItems.filter(({ name }) =>
          (cardTags?.[`${sectionKey}:${name}`]?.tags ?? []).includes(wrecFilter))
      : allItems;
    const total = items.reduce((n, c) => n + c.quantity, 0);
    // Change 6 — split the section into ordered groups per the view control.
    // The row body below is unchanged; it just iterates a group's items now.
    const groups = buildDeckGroups(items, groupBy, sortBy, (n) => cardData[n]);
    return (
      <div key={sectionKey}>
        {/* Change v4 — the view (group/sort) control rides INLINE on the section
            header instead of its own line, killing one of the pre-list bands.
            accessory = the compact chip (decklist only); panel = its expanded
            options, rendered just below the header when open. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          borderBottom: "1px solid var(--bevel-dark)",
          paddingBottom: 6,
          marginBottom: 6,
        }}>
          {/* UAT batch 2, item 6 — the decklist header IS the WREC trigger now:
              no DECKLIST label, no count (the list is right there), just WREC.
              An active filter is still named beside it. Maybeboard (and the
              non-live save flow) keep the plain text label. */}
          {live && sectionKey === "decklist" ? (
            <span style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
              <button
                onClick={() => setWrecOpen(o => !o)}
                aria-label="WREC composition — show category counts"
                aria-expanded={wrecOpen}
                style={{
                  minHeight: 44, minWidth: 0,
                  display: "flex", alignItems: "center", gap: 4,
                  background: "transparent", border: "none", padding: 0,
                  // UAT batch 2, item 9 — section headers carry real H1 weight
                  // (Zilla display serif), not paragraph-sized mono.
                  fontFamily: "'Zilla Slab', serif",
                  fontWeight: 700,
                  fontSize: 17, letterSpacing: "0.08em",
                  color: "var(--primary)",
                  cursor: "pointer", WebkitTapHighlightColor: "transparent",
                }}
              >
                WREC
                <span className="material-symbols-rounded" style={{ fontSize: 18, color: "var(--muted)" }}>
                  {wrecOpen ? "expand_less" : "expand_more"}
                </span>
                {wrecFilter && (
                  <span style={{
                    fontSize: 11, letterSpacing: "0.14em",
                    color: "var(--muted)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    · {LABEL_BY_TAG[wrecFilter]}
                  </span>
                )}
              </button>
              {/* A (?) that opens the WREC explainer (device UAT — the video
                  link lives inside that box, not a jump straight to YouTube). */}
              <button
                onClick={(e) => { e.stopPropagation(); setWrecInfoOpen(true); }}
                aria-label="What is WREC?"
                style={{
                  width: 44, height: 44, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "none", padding: 0,
                  color: "var(--muted)", cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>help</span>
              </button>
            </span>
          ) : (
            <span style={{
              // Same H1 weight as the WREC trigger (item 9) — one section rank.
              fontFamily: "'Zilla Slab', serif",
              fontWeight: 700,
              fontSize: 17, letterSpacing: "0.08em",
              color: "var(--text)",
            }}>
              {label} · {total}
              {wrecFilter && ` · ${LABEL_BY_TAG[wrecFilter]}`}
            </span>
          )}
          {accessory}
        </div>
        {/* Disclosed WREC band — opens right under its trigger, still the
            filter door: tapping a category applies the filter, tapping the
            active one clears. UAT batch 2, item 8 — the band STAYS OPEN after
            a pick (it's a dashboard, not a menu); only the trigger closes it.
            Zeros stay dimmed but tappable (a zero IS the gap → "add more"). */}
        {live && sectionKey === "decklist" && wrecOpen && (
          <div style={{ paddingBottom: 6 }}>
            <WrecBand
              counts={wrecCounts}
              accent="var(--primary)"
              muted="var(--muted)"
              text="var(--text)"
              activeTag={wrecFilter}
              onTapTag={(tag) => {
                setWrecFilter(f => (f === tag ? null : tag));
                setAddMoreError(null);
              }}
            />
          </div>
        )}
        {panel}
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>—</div>
        ) : (
          groups.map(g => (
            <div key={g.key}>
              {g.label && (
                <div style={{
                  // UAT batch 2, item 9 — group headers are a real H2 rank
                  // under the section header, not near-invisible 10px mono.
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 13, letterSpacing: "0.12em",
                  color: "var(--text2)",
                  padding: "14px 0 3px",
                }}>
                  {g.label} · {g.items.reduce((n, c) => n + c.quantity, 0)}
                </div>
              )}
              {g.items.map(({ name, quantity }) => {
            const key = `${sectionKey}:${name}`;
            const tags = cardTags?.[key]?.tags ?? [];
            // Auto-suggested subset (deck_card_tags.source 'auto') — rendered
            // hollow/dimmed so Ben's tags and the machine's never look alike.
            const autoTags = cardTags?.[key]?.autoTags ?? [];
            const expanded = expandedKey === key;
            const card = cardData[name];               // undefined | null | object
            const cardImg = card ? (getCardImage(card, "normal") ?? getCardImage(card, "small")) : null;
            return (
              <div key={name}>
                {/* Change 14 — swipe-left to delete (a red delete zone reveals
                    behind); a clean tap still opens the WREC chip selector. */}
                <div style={{ position: "relative", overflow: "hidden" }}>
                  {live && swipeKey === key && (
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "flex-end",
                      paddingRight: 16,
                      background: "var(--danger)",
                    }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 20, color: "#fff" }}>delete</span>
                    </div>
                  )}
                <div
                  onPointerDown={live ? (e) => rowPointerDown(e, key) : undefined}
                  onPointerMove={live ? rowPointerMove : undefined}
                  onPointerUp={live ? (e) => rowPointerUp(e, key, name, sectionKey) : undefined}
                  onPointerCancel={live ? rowPointerCancel : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    minHeight: live ? 44 : undefined,
                    padding: "5px 0",
                    fontSize: 13,
                    color: "var(--text)",
                    // Device UAT — paint an opaque bg ONLY while this row is
                    // being swiped (to cover the red delete zone). Idle rows
                    // stay transparent so they don't paint var(--bg) on their
                    // own transform-promoted layer, which rendered a hair
                    // darker than the page and made tap targets look deeper.
                    background: (live && swipeKey === key) ? "var(--bg)" : "transparent",
                    transform: swipeKey === key ? `translateX(${swipeDx}px)` : "translateX(0)",
                    transition: swipeKey === key ? "none" : "transform 160ms ease",
                    touchAction: live ? "pan-y" : undefined,
                    cursor: live ? "pointer" : "default",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {/* Vault UAT item 4 — the NAME is the whole row (Zilla 600,
                      primary ink): type line and cost badge are gone; the WREC
                      icon chips carry the remaining context. */}
                  <span style={{
                    flex: 1, minWidth: 0,
                    fontFamily: "'Zilla Slab', serif",
                    fontWeight: 600,
                    fontSize: 15,
                    lineHeight: 1.15,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>{name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {/* Vault spec §4 — collapsed tags are icon CHIPS (icon =
                        exact category, color = family), replacing the anonymous
                        dots that read as noise without a legend. Max two + a +N
                        overflow so tagging density can't break row height.
                        Dashed border = auto-suggested, solid = user's (same
                        split as the expanded tag grid). Untagged rows render
                        nothing — never an empty placeholder. UAT batch 2, item
                        13 — the icon persists through row expansion (it used to
                        vanish the moment you opened the row). */}
                    {tags.length > 0 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {tags.slice(0, 2).map(t => {
                          const auto = autoTags.includes(t);
                          const c = WREC_CHIP_COLORS[t];
                          return (
                            <span
                              key={t}
                              title={LABEL_BY_TAG[t] ?? t}
                              style={{
                                width: 22, height: 22,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                border: `1px ${auto ? "dashed" : "solid"} ${c?.border ?? "var(--muted)"}`,
                                background: c?.bg ?? "transparent",
                              }}
                            >
                              <WrecIcon tag={t} />
                            </span>
                          );
                        })}
                        {tags.length > 2 && (
                          <span style={{
                            fontFamily: "'Noto Sans Mono', monospace",
                            fontSize: 11, color: "var(--muted)",
                          }}>+{tags.length - 2}</span>
                        )}
                      </span>
                    )}
                    {quantity > 1 && (
                      <span style={{ color: "var(--muted)" }}>×{quantity}</span>
                    )}
                  </div>
                </div>
                </div>

                {/* Expanded row — device UAT: this now only fires for MAYBEBOARD
                    rows (decklist rows open the review carousel on tap instead).
                    The mini-card is a static preview here; the WREC tag targets
                    + move-to-mainboard beside it are the maybeboard's inline
                    editor, since those cards aren't in the flip carousel. */}
                {live && expanded && (
                  <div style={{
                    display: "flex", alignItems: "stretch", gap: 12,
                    padding: "4px 0 12px",
                  }}>
                    {/* Mini-card — a static preview (maybeboard cards have no
                        carousel to open into). Corner mask matches every card. */}
                    <div
                      style={{
                        flexShrink: 0, width: 104,
                        aspectRatio: "63 / 88",
                        background: "var(--panel)",
                        borderRadius: "5.5% / 4%", overflow: "hidden",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                      }}
                    >
                      {cardImg ? (
                        <img
                          src={cardImg}
                          alt={name}
                          draggable={false}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        <span style={{
                          width: "100%", height: "100%",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "'Noto Sans Mono', monospace",
                          fontSize: 10, color: "var(--muted)", textAlign: "center", padding: 6,
                        }}>
                          {card === null ? "no card" : "…"}
                        </span>
                      )}
                    </div>

                    {/* WREC tag targets + the move-board action as a sixth
                        uniform cell (2×3 beside the card, equal widths). Same
                        chip form throughout; the swap glyph marks move as an
                        action, not a tag. User-facing copy says "mainboard"
                        even though the section value is decklist. */}
                    <div style={{
                      flex: 1, minWidth: 0,
                      display: "grid",
                      gridTemplateColumns: "repeat(2, 1fr)",
                      gridAutoRows: "minmax(44px, 1fr)",
                      gap: 6,
                    }}>
                      {WREC_CHIPS.map(({ tag, label }) => {
                        const active = tags.includes(tag);
                        // UAT batch 3, item 2 — each cell now shows the WREC
                        // ICON badge (same vocabulary as the collapsed row
                        // chips), and its APPLIED state is unmistakable: an
                        // applied tag fills in its category color (solid border
                        // = user, dashed = auto-suggested); an unapplied one is
                        // dimmed/empty. Deselecting empties the cell (the toggle
                        // idempotency fix in Brew makes that actually land).
                        const auto = active && autoTags.includes(tag);
                        const c = WREC_CHIP_COLORS[tag];
                        return (
                          <button
                            key={tag}
                            onClick={(e) => { e.stopPropagation(); onToggleTag?.(name, sectionKey, tag); }}
                            style={{
                              minHeight: 44,
                              padding: "0 6px",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                              border: `1px ${auto ? "dashed" : "solid"} ${active ? (c?.stroke ?? "var(--primary)") : "var(--muted)"}`,
                              background: active ? (c?.bg ?? "transparent") : "transparent",
                              color: active ? (c?.stroke ?? "var(--primary)") : "var(--muted)",
                              opacity: active ? 1 : 0.5,
                              fontFamily: "'Noto Sans Mono', monospace",
                              fontSize: 10,
                              letterSpacing: "0.08em",
                              borderRadius: 0,
                              cursor: "pointer",
                              WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            <WrecIcon tag={tag} size={14} />
                            {label}
                          </button>
                        );
                      })}
                      {onMoveCard && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onMoveCard(name, sectionKey); }}
                          style={{
                            minHeight: 44,
                            padding: "0 6px",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                            border: "1px solid var(--muted)",
                            background: "transparent",
                            color: "var(--muted)",
                            fontFamily: "'Noto Sans Mono', monospace",
                            fontSize: 10,
                            letterSpacing: "0.08em",
                            borderRadius: 0,
                            cursor: "pointer",
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >
                          <span className="material-symbols-rounded" style={{ fontSize: 14 }}>swap_vert</span>
                          {sectionKey === "decklist" ? "MAYBE" : "MAIN"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
            </div>
          ))
        )}
      </div>
    );
  }

  // The view control (UAT batch 2, item 14). The collapsed chip rides inline
  // on the DECKLIST header (see renderSection accessory); tapping it reveals
  // the two Moxfield axes (GROUP BY / SORT BY) as a panel just under that
  // header. Split out here so both pieces stay one definition regardless of
  // where they mount. The chip summarizes both axes ("type · name").
  const groupLabel = GROUP_OPTIONS.find(o => o.value === groupBy)?.label ?? groupBy;
  const sortLabel  = SORT_OPTIONS.find(o => o.value === sortBy)?.label ?? sortBy;
  const viewChip = (
    <button
      onClick={() => setControlsOpen(o => !o)}
      aria-label="Group and sort options"
      style={{
        minHeight: 44, padding: "0 8px", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 5,
        background: "transparent", border: "none",
        color: "var(--text)",
        fontFamily: "'Noto Sans Mono', monospace",
        fontSize: 11, letterSpacing: "0.04em",
        borderRadius: 0, cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--muted)" }}>tune</span>
      {groupLabel} · {sortLabel}
      <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--muted)" }}>
        {controlsOpen ? "expand_less" : "expand_more"}
      </span>
    </button>
  );
  // One axis row (label + segmented options) — reused for GROUP BY and SORT BY.
  const axisRow = (axisLabel, options, value, setValue) => (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <span style={{
        fontFamily: "'Noto Sans Mono', monospace",
        fontSize: 10, letterSpacing: "0.1em", color: "var(--muted)",
        width: 52, flexShrink: 0,
      }}>{axisLabel}</span>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => setValue(o.value)}
            style={{
              minHeight: 44, padding: "0 10px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent",
              border: `1px solid ${active ? "var(--primary)" : "var(--bevel-dark)"}`,
              color: active ? "var(--primary)" : "var(--muted)",
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 11, letterSpacing: "0.06em",
              borderRadius: 0, cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
  const viewPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {axisRow("GROUP", GROUP_OPTIONS, groupBy, setGroupBy)}
      {axisRow("SORT", SORT_OPTIONS, sortBy, setSortBy)}
    </div>
  );

  // Bottom thumb-zone nav, live sessions only — the deck list is the landing
  // surface: HOME (exit to the Box) left, BREW (deal into the swipe) right.
  const showBottomNav = live && (onHome || onBrew);

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg)",
      color: "var(--text)",
      fontFamily: "'Noto Sans', sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      // No overflow/scroll here on purpose: Brew.jsx's fixed `inset:0` takeover
      // wrapper is the actual scrolling ancestor. Declaring overflowY:auto on
      // this div too made IT the nearest CSS "scroll container" for the sticky
      // header below — but since this div only has minHeight (no capped
      // height), it always grows to fit its own content and never overflows
      // itself, so the sticky child had no clipped viewport to stick against
      // and just scrolled away with the page. Leaving scroll to the one
      // ancestor that's actually viewport-bound lets position:sticky resolve
      // against it correctly.
      paddingBottom: showBottomNav ? "calc(env(safe-area-inset-bottom) + 64px)" : SAFE_BOTTOM,
    }}>

      {/* Frozen header — the commander anchor stays pinned to the top of the
          scrolling list (spreadsheet top-row behavior), so the deck stays
          identifiable as rows scroll beneath. The WREC readout lives on the
          decklist section header now (UAT batch 2, item 6). Safe-area top
          inset respected; the content below clears it at rest so the first
          row is never hidden under the header. */}
      {live && (
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          alignSelf: "stretch",
          background: "var(--bg)",
          borderBottom: "1px solid var(--bevel-dark)",
        }}>
          {/* Commander anchor — a small card thumbnail in the corner plus the
              name (UAT batch 2, item 7; sized well under the 56px sprite that
              smushed the name on device). Tapping either opens the full card.
              Padded left of the brew back chevron so the two never overlap. */}
          {showAnchor && (
          <div style={{
            maxWidth: 430,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
            paddingTop: "calc(env(safe-area-inset-top) + 10px)",
            paddingBottom: 10,
            paddingLeft: "calc(env(safe-area-inset-left) + 56px)",
            paddingRight: 20,
          }}>
            <button
              onClick={openCommander}
              aria-label="Show commander card"
              style={{
                flex: 1, minWidth: 0,
                minHeight: 44,
                display: "flex", alignItems: "center",
                background: "transparent", border: "none", padding: 0,
                textAlign: "left",
                fontFamily: "'Zilla Slab', serif",
                fontSize: 18,
                letterSpacing: "0.02em",
                color: "var(--text)",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {commander.art && (
                <img
                  src={commander.art}
                  alt=""
                  draggable={false}
                  style={{
                    width: 27, height: 38, objectFit: "cover",
                    // corner mask matches the swipe card / box sprite
                    borderRadius: "5.5% / 4%",
                    flexShrink: 0, marginRight: 10,
                  }}
                />
              )}
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {commander.name}
                </span>
                {/* UAT batch 3, item 4 — the deck's total card count, near the
                    commander header (was missing from the list view). Commander
                    + mainboard, matching the Box's deck-total convention. */}
                <span style={{
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 11, letterSpacing: "0.08em",
                  color: "var(--muted)",
                }}>
                  {decklist.length + 1} cards
                </span>
              </span>
            </button>
            {/* Export — Moxfield bulk-edit text, WREC tags as #hashtags. Copy
                is guaranteed; the share sheet (where supported) is a bonus. */}
            <button
              onClick={handleExport}
              aria-label="Export deck as Moxfield text"
              style={{
                width: 44, height: 44, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", padding: 0,
                color: copied ? "var(--success)" : "var(--muted)",
                cursor: "pointer", WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
                {copied ? "check" : "ios_share"}
              </span>
            </button>
          </div>
          )}

        </div>
      )}

      <div style={{
        width: "100%",
        maxWidth: 430,
        padding: live ? "20px 20px 40px" : `${SAFE_TOP} 20px 40px`,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>

        {/* Change 10 — the two-door bar. One row: a text field on the left, and a
            right half that is EITHER "quick brew" (deal the synergy stack for this
            legend, onBrew) while empty+unfocused, OR a search-submit magnifier
            once focused/typed (build a custom swipe stack from all of Scryfall —
            commander-legal, in the deck's color identity, minus what's in the
            deck — and drop into the same swipe screen; never a results list). This
            folds the old middle "brew" nav button INTO the bar. */}
        {live && (onDeckSearch || onBrew) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{
              display: "flex", alignItems: "stretch",
              border: `1px solid ${searchFocused ? "var(--primary)" : "var(--bevel-dark)"}`,
              background: "var(--color-bg)",
              opacity: searchBusy ? 0.5 : 1,
            }}>
              <input
                ref={searchInputRef}
                type="text"
                value={cardSearch}
                onChange={e => setCardSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                onKeyDown={e => { if (e.key === "Enter") handleCardSearch(); }}
                placeholder="use scryfall syntax"
                autoComplete="off" autoCorrect="off" spellCheck={false}
                readOnly={searchBusy}
                style={{
                  flex: 1, minWidth: 0, boxSizing: "border-box", minHeight: 44,
                  background: "transparent",
                  color: "var(--text)",
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 16,
                  border: "none",
                  padding: "0 12px", borderRadius: 0, outline: "none",
                }}
              />
              {showQuickBrew && onBrew ? (
                <button
                  onClick={onBrew}
                  aria-label="Quick brew — deal the discovery stack"
                  style={{
                    flexShrink: 0, minHeight: 44,
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "0 14px",
                    background: "transparent",
                    border: "none",
                    borderLeft: "1px solid var(--bevel-dark)",
                    color: "var(--primary)",
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 12, letterSpacing: "0.06em",
                    cursor: "pointer", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>style</span>
                  quick brew
                </button>
              ) : (
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={handleCardSearch}
                  disabled={searchBusy || !cardSearch.trim()}
                  aria-label="Search for cards to add"
                  style={{
                    flexShrink: 0, width: 48, minHeight: 44,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "transparent",
                    border: "none",
                    borderLeft: "1px solid var(--bevel-dark)",
                    color: cardSearch.trim() ? "var(--primary)" : "var(--muted)",
                    cursor: cardSearch.trim() ? "pointer" : "default",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 20 }}>search</span>
                </button>
              )}
            </div>
            {searchMsg && (
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, color: "var(--muted)", lineHeight: 1.5,
              }}>
                {searchMsg}
              </div>
            )}
          </div>
        )}

        {/* Text header only when there's no commander anchor (save flow). */}
        {!showAnchor && (
          <div style={{
            fontFamily: "var(--font-system)",
            fontSize: 20,
            letterSpacing: "0.08em",
            color: "var(--text)",
          }}>
            {live ? "DECK" : "REVIEW"} · {totalCards} CARD{totalCards !== 1 ? "S" : ""}
          </div>
        )}

        {/* Change 2 — first-run empty state teaches instead of showing a lone
            "—" (which read as broken). Only when the whole deck is empty in a
            live session; a filtered-empty section still uses the "—" in
            renderSection (there it means "no ramp here", not "nothing yet"). The
            CTA fires the same onBrew as the bottom-nav brew button. */}
        {live && totalCards === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            textAlign: "center", gap: 14, padding: "32px 12px 24px",
          }}>
            {stackCount > 0 && (
              <div style={{
                fontFamily: "'Zilla Slab', serif",
                fontSize: 22, lineHeight: 1.3,
                color: "var(--text)",
              }}>
                {stackCount} cards are shuffled and waiting
              </div>
            )}
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12, lineHeight: 1.5,
              color: "var(--muted)",
            }}>
              swipe to keep or cut, or add exact cards above
            </div>
            <button
              onClick={onBrew}
              style={{
                minHeight: 44, marginTop: 4,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 24px",
                background: "transparent",
                border: "1px solid var(--primary)",
                color: "var(--primary)",
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 13, letterSpacing: "0.1em",
                borderRadius: 0,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              start brewing →
            </button>
          </div>
        ) : (
          <>
            {/* DECKLIST always; MAYBEBOARD only when it holds cards. No pile.
                The view control rides on the DECKLIST header (accessory + panel);
                only meaningful once the deck holds cards. */}
            {renderSection("DECKLIST", groups.decklist, "decklist",
              totalCards > 0 ? viewChip : null,
              totalCards > 0 && controlsOpen ? viewPanel : null)}
            {maybeboard.length > 0 && renderSection("MAYBEBOARD", groups.maybe, "maybe")}
          </>
        )}

        {/* Gap-filling: a filtered category view ends in "add more" — deal a
            swipe stack of that category's tag pool in the commander's colors
            (agnostic of the plan). Plan is excluded: the main brew stack IS
            the plan stack, so there's nothing narrower to deal. */}
        {live && onAddMore && wrecFilter && wrecFilter !== "plan" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={handleAddMore}
              disabled={addingMore}
              style={{
                minHeight: 44,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: "transparent",
                border: "1px solid var(--primary)",
                color: "var(--primary)",
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, letterSpacing: "0.08em",
                cursor: addingMore ? "default" : "pointer",
                opacity: addingMore ? 0.6 : 1,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>add</span>
              {addingMore ? "dealing…" : `add more ${LABEL_BY_TAG[wrecFilter] ?? wrecFilter}`}
            </button>
            {addMoreError && (
              <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
                {addMoreError}
              </div>
            )}
          </div>
        )}

        {/* Delete — the destructive act sits at the END of the list,
            physically separated from export (top) and home/brew (bottom nav)
            per the NN/g destructive-action rule, and confirms inline: the row
            expands in place, no modal. Deletes OUTRIGHT: the legend, its
            deck, cards, and tags all leave the Box — nothing survives. */}
        {live && onDeleteDeck && (
          <div style={{ borderTop: "1px solid var(--bevel-dark)", paddingTop: 4 }}>
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                style={{
                  minHeight: 44,
                  display: "flex", alignItems: "center", gap: 6,
                  background: "transparent", border: "none", padding: 0,
                  color: "var(--muted)",
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 12, letterSpacing: "0.08em",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>delete</span>
                delete legend
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
                <div style={{
                  fontFamily: "'Noto Sans', sans-serif",
                  fontSize: 13, lineHeight: 1.5,
                  color: "var(--text2)",
                }}>
                  Delete {commander?.name ?? "this legend"}? The legend, its deck
                  ({totalCards} card{totalCards !== 1 ? "s" : ""}), and all tags leave
                  the box. This can't be undone.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => { setConfirmingDelete(false); setDeleteError(null); }}
                    disabled={deleting}
                    style={{
                      minHeight: 44, flex: 1,
                      background: "transparent",
                      border: "1px solid var(--muted)",
                      borderRadius: 0,
                      color: "var(--text)",
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 12, letterSpacing: "0.08em",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{
                      minHeight: 44, flex: 1,
                      background: "transparent",
                      border: "1px solid var(--danger)",
                      borderRadius: 0,
                      color: "var(--danger)",
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 12, letterSpacing: "0.08em",
                      cursor: deleting ? "default" : "pointer",
                      opacity: deleting ? 0.6 : 1,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {deleting ? "deleting…" : "delete"}
                  </button>
                </div>
                {deleteError && (
                  <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
                    {deleteError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Name the brew — live sessions write on every flick, nothing to save */}
        {!live && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <input
              type="text"
              placeholder="Commander name"
              value={commanderName}
              onChange={e => setCommanderName(e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Build name (optional)"
              value={buildName}
              onChange={e => setBuildName(e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={inputStyle}
            />
            <button
              onClick={() => onConfirm(commanderName.trim(), buildName.trim())}
              disabled={!canSave}
              style={{
                width: "100%",
                background: "var(--color-titlebar)",
                color: "var(--color-titlebar-text)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-xl)",
                letterSpacing: "0.12em",
                border: "none",
                padding: "16px 24px",
                borderRadius: 0,
                cursor: canSave ? "pointer" : "default",
                opacity: canSave ? 1 : 0.5,
              }}
            >
              {saving ? "SAVING…" : "SAVE BREW"}
            </button>
            {error && (
              <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
                {error}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Bottom thumb-zone nav — live sessions only. HOME sits bottom-RIGHT
          to match the swipe screen's home (Ben: "home needs to be in the
          same spot" — one thumb position app-wide); BREW (left) deals into
          the swipe stack for this deck — the forward action, so it carries
          the emphasized color. Text labels, mono, ≥44px. */}
      {showBottomNav && (
        <div style={{
          position: "fixed",
          left: 0, right: 0,
          bottom: 0,
          zIndex: 5,
          display: "flex",
          justifyContent: "center",
          padding: "0 0 calc(env(safe-area-inset-bottom) + 8px)",
          background: "linear-gradient(to top, var(--bg) 60%, transparent)",
        }}>
          <div style={{
            width: "100%",
            maxWidth: 430,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
          }}>
            {/* Change 11/10 — back bottom-LEFT (exits to the Box, the decklist's
                parent in the ladder); the flip-deck REVIEW entry sits
                bottom-RIGHT. Home is removed (the back-ladder replaces it — two
                taps to the Box is intended). The middle "brew" button is gone
                too (Change 10): quick brew now lives in the search bar above. */}
            <button
              onClick={onHome}
              aria-label="Back"
              style={{
                minHeight: 44,
                display: "flex", alignItems: "center", gap: 6,
                background: "transparent", border: "none",
                color: "var(--muted)",
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, letterSpacing: "0.08em",
                padding: "0 10px",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_back</span>
              back
            </button>
            {/* Bottom-right REVIEW — enters the flip pass. Device UAT: it
                starts ON the card currently expanded in the list (if any);
                otherwise it resumes at the last card viewed (Brew keeps the
                index). Same slot as the swipe screen's done; deck-with-cards
                only. */}
            {onHand && totalCards > 0 && (
              <button
                onClick={() => onHand(
                  // Flip through the deck in the SAME order it's displayed here
                  // (Change 9) — flatten the current groups in display order.
                  orderedDeckNames(),
                  // Start on the expanded decklist card, if one is open.
                  expandedKey?.startsWith("decklist:") ? expandedKey.slice("decklist:".length) : undefined,
                )}
                aria-label="Review — flip through your deck"
                style={{
                  minHeight: 44,
                  display: "flex", alignItems: "center",
                  background: "transparent", border: "none",
                  color: "var(--primary)",
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 12, letterSpacing: "0.08em",
                  padding: "0 10px",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                review
              </button>
            )}
          </div>
        </div>
      )}

      {/* Commander card overlay — tap the header name to re-read the card,
          tap anywhere to dismiss. Unaltered card image (Scryfall terms). */}
      {showCommander && (
        <div
          onClick={() => setShowCommander(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${commander?.name} card`}
          style={{
            position: "fixed", inset: 0, zIndex: 250,
            background: "rgba(0,0,0,0.82)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {commanderFull ? (
            <img
              src={getCardImage(commanderFull, "normal")}
              alt={commander?.name}
              draggable={false}
              style={{
                width: "min(88vw, 400px)",
                borderRadius: "4.75% / 3.5%",
              }}
            />
          ) : (
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 12,
              color: commanderFull === undefined ? "var(--danger)" : "var(--muted)",
            }}>
              {commanderFull === undefined ? "couldn't load the card" : "loading…"}
            </div>
          )}
        </div>
      )}

      {/* WREC explainer (device UAT) — what the five roles mean, measured
          against Rachel Weeks' recommended template, with the Command Zone
          video link at the BOTTOM. Tap the backdrop or × to dismiss. */}
      {wrecInfoOpen && (
        <div
          onClick={() => setWrecInfoOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="What is WREC?"
          style={{
            position: "fixed", inset: 0, zIndex: 260,
            background: "rgba(0,0,0,0.82)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "24px 16px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 420, maxHeight: "84dvh",
              overflowY: "auto",
              background: "var(--panel)",
              border: "1px solid var(--bevel-dark)",
              padding: "18px 18px calc(env(safe-area-inset-bottom) + 18px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{
                fontFamily: "'Zilla Slab', serif", fontWeight: 700,
                fontSize: 18, letterSpacing: "0.06em", color: "var(--text)",
              }}>
                WHAT IS WREC?
              </span>
              <button
                onClick={() => setWrecInfoOpen(false)}
                aria-label="Close"
                style={{
                  width: 44, height: 44, margin: "-10px -10px -10px 0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "none", padding: 0,
                  color: "var(--muted)", cursor: "pointer", WebkitTapHighlightColor: "transparent",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 22 }}>close</span>
              </button>
            </div>
            <p style={{
              fontFamily: "'Noto Sans', sans-serif", fontSize: 13, lineHeight: 1.55,
              color: "var(--text2)", margin: "0 0 14px",
            }}>
              WREC (the Wachel Reeks Effectiveness Coefficient, named in honor of the
              great Rachel Weeks) measures your deck against her recommended 100-card
              template. Treat the targets as guidelines, not rules — a healthy starting
              point that plenty of great decks bend. A role near its target scores best;
              well over or under is just a nudge to take a second look, not a red flag.
            </p>
            {[
              ["Ramp", 10, "Mana acceleration, to get ahead of the curve."],
              ["Card Advantage", 12, "Draw and card generation that keeps your hand stocked."],
              ["Disruption", 12, "Targeted interaction — answer a single threat (removal, counters)."],
              ["Mass Disruption", 6, "Board wipes and mass answers that reset the table."],
              ["Mana Base", 38, "Your lands and fixing."],
              ["Plan", 30, "The cards that actually execute your deck's gameplan."],
            ].map(([role, target, desc]) => (
              <div key={role} style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: "1px solid var(--bevel-dark)" }}>
                <span style={{
                  flexShrink: 0, minWidth: 24, textAlign: "right",
                  fontFamily: "'Noto Sans Mono', monospace", fontSize: 12,
                  color: "var(--primary)",
                }}>{target}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{
                    display: "block",
                    fontFamily: "'Noto Sans Mono', monospace", fontSize: 12,
                    letterSpacing: "0.06em", color: "var(--text)",
                  }}>{role}</span>
                  <span style={{
                    display: "block",
                    fontFamily: "'Noto Sans', sans-serif", fontSize: 12, lineHeight: 1.45,
                    color: "var(--text2)",
                  }}>{desc}</span>
                </span>
              </div>
            ))}
            <a
              href="https://youtu.be/OSNV6224cHg"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                marginTop: 16,
                minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                border: "1px solid var(--primary)", color: "var(--primary)",
                fontFamily: "'Noto Sans Mono', monospace", fontSize: 12, letterSpacing: "0.08em",
                textDecoration: "none", WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>play_circle</span>
              watch the command zone guide
            </a>
          </div>
        </div>
      )}

      {/* Export confirmation — brief dimmed flash, mirrors the app's toast grammar. */}
      {copied && (
        <div style={{
          position: "fixed",
          left: "50%",
          bottom: showBottomNav ? "calc(env(safe-area-inset-bottom) + 76px)" : "calc(env(safe-area-inset-bottom) + 24px)",
          transform: "translateX(-50%)",
          zIndex: 300,
          background: "rgba(0,0,0,0.8)",
          color: "rgba(255,255,255,0.85)",
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 12,
          letterSpacing: "0.06em",
          padding: "8px 14px",
          border: "1px solid var(--bevel-dark)",
          pointerEvents: "none",
        }}>
          copied — paste into Moxfield bulk edit
        </div>
      )}
    </div>
  );
}
