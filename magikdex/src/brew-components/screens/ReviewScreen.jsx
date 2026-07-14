import { useState, useEffect, useRef } from "react";
import { getCardData, getCardDataBatch, getCardImage, formatManaCost } from "../../lib/scryfall.js";
import WrecBand, { WREC_CHIPS, LABEL_BY_TAG } from "../../components/WrecBand.jsx";

// Change 14 — how far left a decklist row must be dragged to commit a delete.
const ROW_DELETE_AT = 88;

// The only ref here is the swipe-gesture start tracker (swipeStart), read solely
// inside pointer event handlers — the correct place for refs.

// Spine screens pad for the notch (top, clearing the back chevron) and the
// home indicator (bottom) now that no tab bar absorbs the bottom.
const SAFE_TOP    = "calc(env(safe-area-inset-top) + 56px)";
const SAFE_BOTTOM = "calc(env(safe-area-inset-bottom) + 24px)";

const DECK_GATE = 100;

// WREC_CHIPS / LABEL_BY_TAG now live in the shared WrecBand (canonical taxonomy);
// imported above so the composition band and the per-row tag chips share one list.

// Type-line display rule (mirrors LegendIdentity): every legal commander is a
// "Legendary Creature — X", so the lead words are dead weight; show the subtypes
// after the em dash. Non-creatures (planeswalker/Background) keep the full line
// so nothing reads blank.
function displayType(typeLine) {
  if (!typeLine) return "";
  return (/creature/i.test(typeLine) && typeLine.includes("—"))
    ? (typeLine.split("—")[1]?.trim() || typeLine)
    : typeLine;
}

// Oracle text, DFC-aware: join both faces so the user judges the whole card.
function oracleOf(card) {
  if (!card) return "";
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces?.length)
    return card.card_faces.map(f => f.oracle_text).filter(Boolean).join("\n\n//\n\n");
  return "";
}

// Mana cost, DFC-aware — front face carries the cast cost.
function manaOf(card) {
  return formatManaCost(card?.mana_cost ?? card?.card_faces?.[0]?.mana_cost);
}

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

// Order rows within a group. cardOf resolves a name → card (may be undefined).
function sortItems(items, sort, cardOf) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (sort === "cmc") {
    return [...items].sort((a, b) =>
      ((cardOf(a.name)?.cmc ?? 99) - (cardOf(b.name)?.cmc ?? 99)) || byName(a, b));
  }
  if (sort === "color") {
    const rank = n => {
      const ci = cardOf(n)?.color_identity ?? [];
      if (ci.length === 0) return 99;
      if (ci.length > 1)  return 50;
      return "WUBRG".indexOf(ci[0]);
    };
    return [...items].sort((a, b) => (rank(a.name) - rank(b.name)) || byName(a, b));
  }
  return [...items].sort(byName);
}

// Ordered groups for a section: [{ key, label, items }]. group === "none" is a
// single unlabelled group (flat sorted list). Bucket order is fixed per mode
// (type/colour by canonical order; cmc numerically).
function buildDeckGroups(items, group, sort, cardOf) {
  if (group === "none") {
    return [{ key: "all", label: null, items: sortItems(items, sort, cardOf) }];
  }
  const bucketOf = group === "type"  ? n => typeBucket(cardOf(n))
    : group === "color" ? n => colorBucket(cardOf(n))
    :                     n => cmcBucket(cardOf(n));
  const map = new Map();
  for (const it of items) {
    const b = bucketOf(it.name);
    if (!map.has(b)) map.set(b, []);
    map.get(b).push(it);
  }
  let keys;
  if (group === "type")       keys = TYPE_ORDER.filter(k => map.has(k));
  else if (group === "color") keys = COLOR_ORDER.filter(k => map.has(k));
  else                        keys = [...map.keys()].sort((a, b) => cmcRank(a) - cmcRank(b));
  return keys.map(k => ({
    key: k,
    label: group === "type" ? TYPE_LABEL[k] : k.toUpperCase(),
    items: sortItems(map.get(k), sort, cardOf),
  }));
}

const GROUP_OPTIONS = [
  { value: "type",  label: "type" },
  { value: "cmc",   label: "mv" },
  { value: "color", label: "color" },
  { value: "none",  label: "none" },
];
const DECK_SORT_OPTIONS = [
  { value: "name",  label: "a–z" },
  { value: "cmc",   label: "mv" },
  { value: "color", label: "color" },
];

// Sort/group preference persists per deck (keyed by legend id, the stable
// per-deck id — one deck per legend). Best-effort localStorage.
const VIEW_PREF_PREFIX = "magikdex-decklist-view:";
function loadViewPref(deckKey) {
  if (!deckKey) return null;
  try { return JSON.parse(localStorage.getItem(VIEW_PREF_PREFIX + deckKey) ?? "null"); }
  catch { return null; }
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
  // WREC filter — tapping a non-zero category in the composition band narrows
  // the list to that category's cards; tapping it again clears. One category
  // at a time (the band is a composition readout, not a query builder).
  const [wrecFilter, setWrecFilter] = useState(null);
  // Sort/group view controls (Change 6). Default: group by type, sort a–z
  // (Moxfield-familiar). Lazily seeded from the per-deck saved pref, then
  // persisted on change. Orthogonal to the WREC band — this organizes the list,
  // the band reads composition.
  const [groupBy, setGroupBy] = useState(() => loadViewPref(deckKey)?.groupBy ?? "type");
  const [sort, setSort]       = useState(() => loadViewPref(deckKey)?.sort ?? "name");
  // Change 14 — the sort/group options are collapsed by default (progressive
  // disclosure) so the list isn't buried under a two-row control block; the
  // summary chip shows current state and expands the full options on tap.
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
      // No drag → a tap → toggle the WREC chip selector (the row's own job).
      setExpandedKey(k => (k === key ? null : key));
    }
  }
  function rowPointerCancel() {
    swipeStart.current = null;
    setSwipeKey(null);
    setSwipeDx(0);
  }
  useEffect(() => {
    if (!deckKey) return;
    try { localStorage.setItem(VIEW_PREF_PREFIX + deckKey, JSON.stringify({ groupBy, sort })); }
    catch { /* view pref is best-effort */ }
  }, [deckKey, groupBy, sort]);
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
  const [cardSearch, setCardSearch] = useState("");
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
  // Count toward the 100-card gate, matching deckTotal everywhere else: every
  // instance across the boards + the commander (never written to deck_cards).
  const deckCount = decklist.length + maybeboard.length + 1;
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
    // Change 6 — split the section into ordered groups per the view controls.
    // The row body below is unchanged; it just iterates a group's items now.
    const groups = buildDeckGroups(items, groupBy, sort, (n) => cardData[n]);
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
          <span style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            color: "var(--muted)",
          }}>
            {label} · {total}
            {wrecFilter && ` · ${LABEL_BY_TAG[wrecFilter]}`}
          </span>
          {accessory}
        </div>
        {panel}
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>—</div>
        ) : (
          groups.map(g => (
            <div key={g.key}>
              {g.label && (
                <div style={{
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 10, letterSpacing: "0.12em",
                  color: "var(--muted)",
                  padding: "10px 0 2px",
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
            const resolved = card !== undefined;       // a lookup has come back
            const unavailable = resolved && card === null;
            const type = card ? displayType(card.type_line) : "";
            const mana = card ? manaOf(card) : "";
            const oracle = card ? oracleOf(card) : "";
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
                    background: live ? "var(--bg)" : "transparent",
                    transform: swipeKey === key ? `translateX(${swipeDx}px)` : "translateX(0)",
                    transition: swipeKey === key ? "none" : "transform 160ms ease",
                    touchAction: live ? "pan-y" : undefined,
                    cursor: live ? "pointer" : "default",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{
                    flex: 1, minWidth: 0,
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    <span style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>{name}</span>
                    {/* Context subline — type (subtypes per the display rule) +
                        mana, dimmed mono. A name that won't resolve says so
                        rather than reading as a blank/broken row. */}
                    {unavailable ? (
                      <span style={{
                        fontFamily: "'Noto Sans Mono', monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}>card data unavailable</span>
                    ) : (type || mana) ? (
                      <span style={{
                        fontFamily: "'Noto Sans Mono', monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}>
                        {type.toLowerCase()}{type && mana ? "  ·  " : ""}{mana}
                      </span>
                    ) : null}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {/* Collapsed tags read as quiet DOTS, not text — the auto
                        tags put amber labels on nearly every row and the list
                        got loud. Filled dot = user tag, hollow = auto (same
                        split as the chips); tap the row for the real chips. */}
                    {!expanded && tags.length > 0 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {tags.map(t => {
                          const auto = autoTags.includes(t);
                          return (
                            <span
                              key={t}
                              title={LABEL_BY_TAG[t] ?? t}
                              style={{
                                width: 6, height: 6,
                                borderRadius: "50%",
                                border: "1px solid var(--primary)",
                                background: auto ? "transparent" : "var(--primary)",
                              }}
                            />
                          );
                        })}
                      </span>
                    )}
                    {quantity > 1 && (
                      <span style={{ color: "var(--muted)" }}>×{quantity}</span>
                    )}
                  </div>
                </div>
                </div>

                {/* Oracle text — shown only while tagging, so the WREC role can
                    be judged without leaving the screen. Body font for
                    readability, dimmed, line breaks preserved. */}
                {live && expanded && oracle && (
                  <div style={{
                    fontFamily: "'Noto Sans', sans-serif",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "var(--text2)",
                    whiteSpace: "pre-wrap",
                    padding: "2px 0 8px",
                  }}>
                    {oracle}
                  </div>
                )}

                {/* Action grid — the five WREC tag chips plus the move-board
                    action as a SIXTH uniform cell (3×2, equal widths, nothing
                    hanging). Same chip form throughout; the swap glyph marks
                    move as an action rather than a tag. User-facing copy says
                    "mainboard" even though the section value is decklist. */}
                {live && expanded && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 6,
                    padding: "4px 0 10px",
                  }}>
                    {WREC_CHIPS.map(({ tag, label }) => {
                      const active = tags.includes(tag);
                      // Auto-suggested: hollow — primary outline/text, no fill.
                      // A user tag fills solid. Tap behavior is identical.
                      const auto = active && autoTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={(e) => { e.stopPropagation(); onToggleTag?.(name, sectionKey, tag); }}
                          style={{
                            minHeight: 44,
                            padding: "0 6px",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            border: `1px ${auto ? "dashed" : "solid"} ${active ? "var(--primary)" : "var(--muted)"}`,
                            background: active && !auto ? "var(--primary)" : "transparent",
                            color: auto ? "var(--primary)" : active ? "var(--color-bg)" : "var(--muted)",
                            fontFamily: "'Noto Sans Mono', monospace",
                            fontSize: 10,
                            letterSpacing: "0.08em",
                            // Scoped exception to the app's no-radius rule — only
                            // these action chips get a soft pill corner.
                            borderRadius: 6,
                            cursor: "pointer",
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >{label}</button>
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
                          borderRadius: 6,
                          cursor: "pointer",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: 14 }}>swap_vert</span>
                        {sectionKey === "decklist" ? "MAYBE" : "MAIN"}
                      </button>
                    )}
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

  // Change v4 — the view (group/sort) control, compact. The collapsed chip rides
  // inline on the DECKLIST header (see renderSection accessory); tapping it
  // reveals the full GROUP/SORT options as a panel just under that header. Split
  // out here so both pieces stay one definition regardless of where they mount.
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
      {GROUP_OPTIONS.find(o => o.value === groupBy)?.label ?? groupBy}
      <span style={{ color: "var(--muted)" }}>·</span>
      {DECK_SORT_OPTIONS.find(o => o.value === sort)?.label ?? sort}
      <span className="material-symbols-rounded" style={{ fontSize: 16, color: "var(--muted)" }}>
        {controlsOpen ? "expand_less" : "expand_more"}
      </span>
    </button>
  );
  const viewPanel = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10 }}>
      <span style={{
        fontFamily: "'Noto Sans Mono', monospace",
        fontSize: 10, letterSpacing: "0.1em", color: "var(--muted)", marginRight: 2,
      }}>GROUP</span>
      {GROUP_OPTIONS.map(o => {
        const active = groupBy === o.value;
        return (
          <button
            key={o.value}
            onClick={() => setGroupBy(o.value)}
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
      <span style={{
        fontFamily: "'Noto Sans Mono', monospace",
        fontSize: 10, letterSpacing: "0.1em", color: "var(--muted)",
        marginLeft: 6, marginRight: 2,
      }}>SORT</span>
      {DECK_SORT_OPTIONS.map(o => {
        const active = sort === o.value;
        return (
          <button
            key={o.value}
            onClick={() => setSort(o.value)}
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

      {/* Frozen header — the commander anchor AND the WREC band stay pinned to
          the top of the scrolling list (spreadsheet top-row behavior), so the
          deck stays identifiable and its composition readable as rows scroll
          beneath. Safe-area top inset respected; the content below clears it at
          rest so the first row is never hidden under the header. */}
      {live && (
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          alignSelf: "stretch",
          background: "var(--bg)",
          borderBottom: "1px solid var(--bevel-dark)",
        }}>
          {/* Commander anchor — NAME ONLY (no art; the 56px sprite smushed
              the name on device). Tapping the name opens the full card.
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
              <span style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {commander.name}
              </span>
            </button>
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 13,
              color: deckCount >= DECK_GATE ? "var(--primary)" : "var(--muted)",
              flexShrink: 0,
            }}>
              {deckCount}/{DECK_GATE}
            </div>
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

          {/* WREC composition band — frozen with the anchor. Five EQUAL cells
              (count over a micro label), no separators — the old inline
              "LABEL n · LABEL n" run read as one busy string on device. A 0
              stays dimmed (the dump-stat tell); non-zero cells filter on tap. */}
          <div style={{
            maxWidth: 430,
            margin: "0 auto",
            paddingLeft: 12, paddingRight: 12,
            paddingTop: showAnchor ? 0 : "calc(env(safe-area-inset-top) + 6px)",
            paddingBottom: 4,
            borderTop: showAnchor ? "1px solid var(--bevel-dark)" : "none",
          }}>
            {/* Shared WrecBand — tappable here (filters the list); zeros stay
                dimmed but tappable (a zero IS the gap → empty filter + "add more"). */}
            <WrecBand
              counts={wrecCounts}
              accent="var(--primary)"
              muted="var(--muted)"
              text="var(--text)"
              activeTag={wrecFilter}
              onTapTag={(tag) => { setWrecFilter(f => (f === tag ? null : tag)); setAddMoreError(null); }}
            />
          </div>
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
                placeholder="add cards · name or scryfall syntax"
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
            {/* Flip-deck REVIEW entry (renamed hand → review in Change 15),
                bottom-right. Only when the deck has cards to flip through. */}
            {onHand && totalCards > 0 && (
              <button
                onClick={() => onHand(
                  // Flip through the deck in the SAME order it's displayed here
                  // (Change 9) — flatten the current groups in display order.
                  buildDeckGroups(groups.decklist, groupBy, sort, (n) => cardData[n])
                    .flatMap(g => g.items.map(it => it.name))
                )}
                aria-label="Review — flip through your deck"
                style={{
                  minHeight: 44,
                  display: "flex", alignItems: "center", gap: 6,
                  background: "transparent", border: "none",
                  color: "var(--text)",
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 12, letterSpacing: "0.08em",
                  padding: "0 10px",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>back_hand</span>
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
