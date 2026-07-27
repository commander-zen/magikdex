import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import ToolChips from "../components/ToolChips";
import PageHeader from "../components/PageHeader";
import { BREW_TOOLS } from "../data/tools";
import SearchScreen from "../brew-components/screens/SearchScreen.jsx";
import SwipeScreen from "../brew-components/screens/SwipeScreen.jsx";
import ReviewScreen from "../brew-components/screens/ReviewScreen.jsx";
import { fetchFirstPageForSwipe, fetchCardIdentity, getCardImage, fetchBrewStack, fetchTagStack, getCardDataBatch } from "../lib/scryfall.js";
import { getBrewDefaults } from "../lib/brewDefaults.js";
import { tagCard, untagCard, fetchDeckCardsWithTags, autoWrecTags, applyAutoTags, WREC_TO_OTAGS } from "../lib/deckTags.js";
import { fetchLegendDeck, deleteLegend, upsertLegend } from "../lib/legendDeck.js";
import { supabase } from "../lib/supabase.js";

// deck_card ids the user has curated (or that auto-tagging has already been
// offered to). The deck-list "heal" only re-suggests to ZERO-tag rows, so
// without this a card stripped back to no tags would see its suggestions creep
// back on the next open. A card is marked the first time it's auto-tagged (at
// insert or heal) AND the moment the user toggles any tag on it — so once a
// card is touched, its tags are the user's to keep, even at zero. Per-browser
// (a fresh device may re-heal a card once); deck_card ids are globally unique
// so one flat set covers every deck.
const HEALED_KEY = "magikdex.curatedDeckCards";
function loadHealedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(HEALED_KEY) || "[]")); }
  catch { return new Set(); }
}
function markHealed(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (list.length === 0) return;
  try {
    const set = loadHealedSet();
    for (const id of list) set.add(id);
    localStorage.setItem(HEALED_KEY, JSON.stringify([...set]));
  } catch { /* storage blocked — the mark just isn't remembered */ }
}

// Brew sub-screens are always dark — card art is designed against dark.
// Jackson Storm "steel storm" recolor (UAT batch 2, item 3): near-black
// grounds, one electric-steel accent replacing the old gold/amber, a dimmer
// steel secondary replacing the green.
const BREW = {
  base:    "#08090c",
  surface: "#12151a",
  text:    "#e8eaed",
  dim:     "#5a6672",
  accent:  "#38bdf8",
  accent2: "#5f9bbf",
  red:     "#e0555f",
  border:  "#1b2129",
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
  "--primary": BREW.accent,
  "--secondary": BREW.accent2,
  "--success": BREW.accent2,
  "--danger": BREW.red,
  "--active": BREW.accent,
  "--color-bg": BREW.base,
  "--color-surface": BREW.surface,
  "--color-surface-raised": BREW.surface,
  "--color-chrome": BREW.surface,
  "--color-chrome-light": BREW.border,
  "--color-chrome-mid": BREW.dim,
  "--color-chrome-dark": BREW.border,
  "--color-titlebar": BREW.accent,
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

// Label used to recognize a Loki dev-seeded session for back-navigation targeting.
const LOKI_SESSION_LABEL = "Loki, God of Mischief — oops all clones";

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

// The decklist search bar (Change 1) is a STACK GENERATOR over all of Scryfall,
// not the in-stack narrow. Distinguish a bare name search from raw Scryfall
// syntax: any operator (: = < > or a quote) means the user is writing syntax,
// so pass it through untouched. Bare text is a name search, gated to 3+ chars so
// a stray letter doesn't fire a 20k-card query. Scryfall already treats bare
// words as name matches, so no name: wrapping is needed — and withColorIdentity
// ANDs legal:commander + the deck's identity on top of either form, so an
// illegal card can never surface no matter what the user types.
const SCRYFALL_SYNTAX = /[:=<>"]/;
function nameOrSyntax(input) {
  const isSyntax = SCRYFALL_SYNTAX.test(input);
  return { isSyntax, tooShort: !isSyntax && input.length < 3 };
}

// A query is "default seed" when the user typed nothing — it's either empty or
// just the exclude-lands marker the seed itself added. Only these queries are
// eligible for the legend-relevant RPC stack; anything typed goes to live
// Scryfall search as always.
function isDefaultSeedQuery(q) {
  return q === "" || q === "-t:land";
}

// A WREC gap-filling stack persists as the marker query "wrec:<category>"
// (never sent to Scryfall) so session resume rebuilds it through tag_stack
// the way default seeds rebuild through brew_stack.
const WREC_QUERY_PREFIX = "wrec:";
function wrecQueryCategory(q) {
  return q?.startsWith(WREC_QUERY_PREFIX) ? q.slice(WREC_QUERY_PREFIX.length) : null;
}

// ── In-stack narrowing ───────────────────────────────────────────────────────
// A legend brew's swipe stack is a DB relevance ranking (brew_stack / tag_stack),
// NOT a Scryfall query — so "tweak what I'm looking at" is a CLIENT-SIDE filter
// over the cards already dealt, preserving the EDHREC synergy ordering, never a
// fresh generic search that would throw the ranking away (Ben, 2026-07-04: narrow
// Zhulodok to drop Eldrazi without losing relevance). We support the tweaks that
// matter mid-swipe on a phone, evaluated against fields the stack cards carry
// (name/type_line/oracle_text/cmc):
//   t:/type:   include only cards whose type line contains the value  (t:dragon)
//   -t:/-type: exclude cards whose type line contains the value       (-t:eldrazi)
//   o:/oracle: oracle-text contains (and -o: to exclude)
//   cmc/mv + >=,<=,=,>,<  numeric mana-value bound   (cmc<=4, -mv>6)
//   bare word  name OR type OR oracle-text contains (and -word to exclude)
// Terms AND together. A card outside the relevant stack (beyond the top-N) is out
// of scope by design — that's the deliberate cost of keeping relevance.
function parseNarrowTokens(input) {
  // Split on whitespace but keep "quoted phrases" and key:"quoted vals" whole.
  const tokens = (input ?? "").match(/-?(?:[a-z]+:"[^"]*"|"[^"]*"|\S+)/gi) ?? [];
  const preds = [];
  for (const raw of tokens) {
    const neg = raw.startsWith("-");
    const tok = neg ? raw.slice(1) : raw;
    const cmp = tok.match(/^(?:cmc|mv)(>=|<=|=|>|<)(\d+(?:\.\d+)?)$/i);
    if (cmp) { preds.push({ kind: "cmc", op: cmp[1], n: parseFloat(cmp[2]), neg }); continue; }
    const kv = tok.match(/^([a-z]+):(.*)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      const val = kv[2].replace(/^"|"$/g, "").toLowerCase();
      if (!val) continue;
      if (key === "t" || key === "type")   { preds.push({ kind: "field", field: "type_line",   val, neg }); continue; }
      if (key === "o" || key === "oracle") { preds.push({ kind: "field", field: "oracle_text", val, neg }); continue; }
      // Unknown operator (c:, pow:, id:, otag: …) can't be answered from the
      // cached fields — degrade to a loose free-text contains of the whole token
      // rather than silently matching nothing.
      preds.push({ kind: "field", field: "any", val: tok.toLowerCase(), neg }); continue;
    }
    const word = tok.replace(/^"|"$/g, "").toLowerCase();
    if (word) preds.push({ kind: "field", field: "any", val: word, neg });
  }
  return preds;
}

function cmpNum(a, op, b) {
  switch (op) {
    case ">=": return a >= b;
    case "<=": return a <= b;
    case ">":  return a > b;
    case "<":  return a < b;
    default:   return a === b; // "="
  }
}

function cardMatchesNarrow(card, preds) {
  for (const p of preds) {
    let hit;
    if (p.kind === "cmc") {
      const c = typeof card.cmc === "number" ? card.cmc : null;
      hit = c !== null && cmpNum(c, p.op, p.n);
    } else {
      const hay = p.field === "any"
        ? `${card.name ?? ""}\n${card.type_line ?? ""}\n${card.oracle_text ?? ""}`.toLowerCase()
        : (card[p.field] ?? "").toLowerCase();
      hit = hay.includes(p.val);
    }
    if (p.neg ? hit : !hit) return false;
  }
  return true;
}

function applyNarrow(cards, input) {
  const preds = parseNarrowTokens(input);
  if (!preds.length) return cards;
  return cards.filter(c => cardMatchesNarrow(c, preds));
}

// The RPC stack arrives relevance-ordered (per-legend EDHREC synergy first,
// then global EDHREC rank — brew_stack v2); name/CMC preferences re-sort it
// client-side (the live-search path sorts server-side via the order param
// instead). Synergy + edhrec_rank ride on RPC cards so the "edhrec" sort can
// rebuild that exact order locally after a name/CMC detour; live-search cards
// carry no synergy, so for them it degrades to plain edhrec_rank.
function sortStack(cards, order, dir = "asc") {
  const mul = dir === "desc" ? -1 : 1;
  const key = order === "edhrec"
    ? (a, b) =>
        // -1e9 floor: real synergy scores are tiny (|s| < 1), and a finite
        // floor keeps the subtraction NaN-free when neither card has one.
        // theme_boost (brew_stack v3, migration 012) breaks synergy ties so a
        // re-sort rebuilds the RPC's exact order; absent (pre-012, live
        // search, tag_stack) it's 0 everywhere and changes nothing.
        (b.synergy ?? -1e9) - (a.synergy ?? -1e9) ||
        (b.theme_boost ?? 0) - (a.theme_boost ?? 0) ||
        (a.edhrec_rank ?? Infinity) - (b.edhrec_rank ?? Infinity)
    : order === "cmc"
      ? (a, b) => (a.cmc ?? 0) - (b.cmc ?? 0)
      : (a, b) => a.name.localeCompare(b.name);
  return [...cards].sort((a, b) => mul * key(a, b));
}

// ── Per-legend brew-session resume ──────────────────────────────────────────
// Transient swipe-session view state — the active seed/search and the queue
// position — persisted to localStorage keyed by legend id, so reopening a
// legend lands exactly where the user left off. This is view state ONLY: the
// deck itself persists independently via flick-is-a-write to deck_cards and is
// never touched here (or by expiry). Stale sessions (>30d) are discarded so the
// queue re-fetches against current card data.
const BREW_SESSION_PREFIX = "magicdex-brew-session:";
const BREW_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function brewSessionKey(legendId) {
  return `${BREW_SESSION_PREFIX}${legendId}`;
}

// Returns the persisted session, or null if absent/corrupt/expired. Expired
// sessions are cleared on read — reopening then starts a fresh default seed.
function loadBrewSession(legendId) {
  if (!legendId) return null;
  try {
    const raw = localStorage.getItem(brewSessionKey(legendId));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.lastActive !== "number" ||
        Date.now() - s.lastActive > BREW_SESSION_TTL_MS) {
      localStorage.removeItem(brewSessionKey(legendId));
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function saveBrewSession(legendId, state) {
  if (!legendId) return;
  try {
    localStorage.setItem(
      brewSessionKey(legendId),
      JSON.stringify({ ...state, lastActive: Date.now() }),
    );
  } catch { /* storage full/disabled — resume is best-effort */ }
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

  const [query, setQuery]           = useState("");
  // The user's in-stack narrowing terms (legend sessions only) — a client-side
  // filter over the relevance/wrec stack that preserves its ordering. Separate
  // from `query` (which stays the stack IDENTITY: ""/-t:land default, wrec:cat)
  // so resume can rebuild the same stack and then re-apply the filter.
  const [stackNarrow, setStackNarrow] = useState("");
  const [sessionLabel, setSessionLabel] = useState(null);
  const [swipeCards, setSwipeCards] = useState([]);
  const [swipeIndex, setSwipeIndex] = useState(0);
  // Hand mode (Change 4): a resolved snapshot of the current decklist to flip
  // through. Kept separate from swipeCards so it never touches the brew stack or
  // its persisted resume seed — hand mode is transient.
  const [handCards, setHandCards] = useState([]);
  // Where the last review pass left off (UAT batch 2, item 15) — re-entering
  // review resumes at that card instead of restarting; clamped on entry in
  // case the deck shrank underneath it.
  const [handIndex, setHandIndex] = useState(0);
  const [swipeOrder, setSwipeOrder] = useState("name");
  const [swipeDir, setSwipeDir]     = useState("asc");
  const [pile, setPile]             = useState([]);
  const [decklist, setDecklist]     = useState([]);

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
  // The deck list's "add cards" search text. Device UAT — it lives HERE, not in
  // ReviewScreen: that screen unmounts on every view change, so a typed Scryfall
  // query was lost the moment you backed out, forcing a retype.
  const [deckSearchDraft, setDeckSearchDraft] = useState("");
  // Device UAT — closing the review carousel used to dump you at the top of the
  // deck list. This carries the card you were looking at back to the list so it
  // can scroll to it instead of rubber-banding.
  const [anchorCard, setAnchorCard] = useState(null);
  const [legendColorIdentity, setLegendColorIdentity] = useState(null);

  // WREC tags per deck card, keyed `${section}:${card_name}` →
  // { id: deck_card_id, tags: string[], quantity }. Loaded when review opens;
  // toggling is an immediate write (a tag is a write, no save step).
  const [cardTags, setCardTags] = useState({});

  const writeQueueRef = useRef([]);
  const flushingRef   = useRef(false);

  // The full, un-narrowed relevance/wrec stack for the active seed. Narrowing
  // and sort re-derive the swipe queue from this, so clearing a filter restores
  // the whole stack rather than a progressively-shrunk remainder.
  const baseStackRef = useRef([]);

  // ── Backup nudge (Ben 2026-07-03): zero barrier to START brewing, but once
  // someone is >9 kept cards deep they've built something worth keeping —
  // prompt an unlinked (anonymous, no email) account to back the brew up.
  // Fires only on GROWTH past the threshold within this session (a resumed
  // big deck doesn't nudge on entry, only on its next flick), once per
  // legend per browser (dismiss = don't nag that brew again; Settings always
  // has the flow).
  const NUDGE_DECK_SIZE = 10;
  const [hasEmail, setHasEmail] = useState(null); // null = unknown yet
  const [showBackupNudge, setShowBackupNudge] = useState(false);
  const [nudgeEmail, setNudgeEmail] = useState("");
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [nudgeError, setNudgeError] = useState(null);
  const initialDeckSizeRef = useRef(null);

  function nudgeKey(legendId) {
    return `magicdex-backup-nudge:${legendId}`;
  }

  useEffect(() => {
    const total = decklist.length;
    if (!session?.legend?.id || showBackupNudge || nudgeSent) return;
    if (hasEmail !== false) return; // linked already, or auth state unknown
    if (initialDeckSizeRef.current === null) return; // session still initializing
    if (total < NUDGE_DECK_SIZE || total <= initialDeckSizeRef.current) return;
    try { if (localStorage.getItem(nudgeKey(session.legend.id))) return; } catch { return; }
    // Threshold-crossing is inherently an effect of list growth — one guarded
    // setState, no cascade (every early return above keeps it a no-op).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowBackupNudge(true);
  }, [decklist.length, hasEmail, session, showBackupNudge, nudgeSent]);

  function dismissBackupNudge() {
    try { localStorage.setItem(nudgeKey(session?.legend?.id), "1"); } catch { /* nag again next visit */ }
    setShowBackupNudge(false);
  }

  async function sendBackupEmail() {
    const addr = nudgeEmail.trim();
    if (!addr || nudgeBusy) return;
    setNudgeBusy(true);
    setNudgeError(null);
    const { error: linkError } = await supabase.auth.updateUser({ email: addr });
    setNudgeBusy(false);
    if (linkError) {
      // Human copy for the two raw errors seen live: email_address_invalid
      // renders an empty address, and the mailer's rate limit reads like a
      // user fault when it's a server budget.
      setNudgeError(linkError.code === "email_address_invalid"
        ? "that email doesn't look deliverable — try another"
        : linkError.code === "over_email_send_rate_limit"
          ? "email is busy right now — your brew is still here, try again in an hour (or from settings)"
          : linkError.message);
      return;
    }
    setNudgeSent(true);
    try { localStorage.setItem(nudgeKey(session?.legend?.id), "1"); } catch { /* flag is best-effort */ }
  }

  // Decided cards (pile/decklist/maybe, this session or earlier) by name —
  // re-seeds and in-session searches must never re-queue them.
  const decidedNamesRef = useRef(new Set());
  useEffect(() => {
    decidedNamesRef.current = new Set([...pile, ...decklist].map(c => c.name));
  }, [pile, decklist]);

  // A legend-attached session skips commander/mode selection entirely and
  // drops straight into the swipe carousel, auto-seeded from the legend's
  // color identity (fetched now if the row hasn't been backfilled yet).
  useEffect(() => {
    if (!session || brewView !== "shell") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionLabel(session.legend.name);
    // A new session starts un-narrowed; resume restores any saved filter below.
    setStackNarrow("");
    baseStackRef.current = [];
    // Backup-nudge state resets per session; the account's email status is a
    // local session read (no network).
    initialDeckSizeRef.current = null;
    setShowBackupNudge(false);
    setNudgeSent(false);
    setNudgeError(null);
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      setHasEmail(user ? Boolean(user.email) : null);
    });
    let cancelled = false;
    (async () => {
      // Resolve the legend's one deck from the same shared source every
      // surface uses (lib/legendDeck.js) — never trust session.deckId, which
      // may be stale by the time this effect runs. Flick-is-a-write: the
      // session's deck must exist before any swipe can land, so create it
      // now if the legend truly has none yet — matched on legend_id, never
      // a name-insert.
      const existingDeck = await fetchLegendDeck(session.legend.id);
      let deckId = existingDeck?.id ?? null;
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
          const startDecklist = expandRows(existingRows, "decklist");
          setDecklist(startDecklist);
          setPile(expandRows(existingRows, "pile"));
          // Nudge baseline: only growth past this size counts, so resuming a
          // big deck doesn't prompt on entry — its next flick does.
          initialDeckSizeRef.current = startDecklist.length;
        }
      }
      if (!cancelled && initialDeckSizeRef.current === null) initialDeckSizeRef.current = 0;

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

      // Resume the exact session left behind (same seed/search + queue
      // position) if one is persisted and unexpired; loadBrewSession returns
      // null (and clears the key) past the 30-day TTL, dropping us onto a fresh
      // default seed instead.
      const persisted = loadBrewSession(session.legend.id);

      // Deck row is a door: opening a deck from LegendIdentity lands directly
      // on its live review, not the swipe carousel. The queue still seeds in
      // the background (excluding everything already in the deck) so review's
      // back arrow can drop straight into "continue brewing".
      // Land on review when opened as a deck door OR when the last persisted
      // coarse view was review/hand (UAT batch 2, item 5 — resume where you
      // left off after a background reload); otherwise resume the swipe queue.
      const resumeToReview = session.startView === "review"
        || persisted?.view === "review" || persisted?.view === "hand";
      if (resumeToReview) {
        setBrewView("review");
        // resumeOrSeedSwipeQueue is a hoisted function declaration further down;
        // calling it from this async IIFE is safe (it only runs post-mount).
        // eslint-disable-next-line react-hooks/immutability
        await resumeOrSeedSwipeQueue(colorIdentity, existingRows, persisted, { setView: false });
      } else {
        await resumeOrSeedSwipeQueue(colorIdentity, existingRows, persisted);
      }
    })();
    return () => { cancelled = true; };
  // Runs once per new session; brewView/resumeOrSeedSwipeQueue are read fresh, not tracked.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // One door for the no-query default stack: the legend-relevant RPC first
  // (brew_stack — cards sharing the legend's own Tagger-page tags, EDHREC-
  // ordered, from our DB), falling back to the generic live Scryfall seed when
  // the legend has no tag profile yet or the RPC fails. Typed queries never
  // come here — they stay on live search.
  async function fetchDefaultStack(colorIdentity, order, dir, excludeLands) {
    if (session?.legend?.name) {
      const stack = await fetchBrewStack({
        legendName: session.legend.name,
        colorIdentity,
        excludeLands,
      });
      // Already-in-deck cards are excluded client-side by every caller (same
      // as the live path), so p_deck_id isn't needed here.
      if (stack.length) return order === "edhrec" ? stack : sortStack(stack, order, dir);
    }
    const q = withColorIdentity(excludeLands ? "-t:land" : "", colorIdentity);
    const { cards } = await fetchFirstPageForSwipe(q, { order, dir });
    return cards;
  }

  // A WREC category's gap-filling stack (tag_stack RPC): the category's otags
  // in the color identity, EDHREC-rank ordered, deck rows excluded
  // server-side. [] when the RPC/ingest isn't in place — callers surface it.
  async function fetchCategoryStack(category, colorIdentity, order, dir) {
    const cards = await fetchTagStack({
      tags: WREC_TO_OTAGS[category] ?? [],
      colorIdentity,
      deckId: attachDeckId,
    });
    if (!cards.length) return [];
    return order === "edhrec" ? cards : sortStack(cards, order, dir);
  }

  // "add more <category>" from the deck list's WREC band: deal that
  // category's stack and drop into the swipe. Throws (for the button's
  // inline error) when no stack exists; decided-this-session names are
  // excluded on top of the RPC's deck-row exclusion.
  async function handleAddMore(category) {
    const cards = await fetchCategoryStack(category, legendColorIdentity, "edhrec", "asc");
    baseStackRef.current = cards;
    const filtered = buildSwipeCards(cards, "", "edhrec", "asc");
    if (!filtered.length) throw new Error("no cards to deal for this category");
    setStackNarrow("");
    setQuery(`${WREC_QUERY_PREFIX}${category}`);
    setSwipeOrder("edhrec");
    setSwipeDir("asc");
    setSwipeCards(filtered);
    setSwipeIndex(0);
    setBrewView("swipe");
  }

  // Derive the swipe queue from a full base stack: drop everything already in
  // the deck or decided this session, apply the in-stack narrow, then order it
  // (edhrec order reproduces the RPC's exact relevance ranking from the cards'
  // synergy/theme_boost/edhrec_rank). One place so seed, resume, add-more, sort,
  // and narrow all build the queue identically.
  function buildSwipeCards(base, narrow, order, dir, excludeRows = existingCardRows) {
    const exclude = new Set([
      ...excludeRows.map(r => r.card_name),
      ...decidedNamesRef.current,
    ]);
    const kept = applyNarrow(base, narrow).filter(c => !exclude.has(c.name));
    return sortStack(kept, order, dir);
  }

  // Default seed for the legend-attached session's initial queue — relevance-
  // first via fetchDefaultStack. Cards already in the attached deck are
  // filtered out client-side.
  async function seedSwipeQueue(colorIdentity, excludeRows = [], { setView = true } = {}) {
    setLoading(true);
    setError(null);
    try {
      // The starting order/filter come from the user's persisted brew defaults
      // (EDHREC + exclude-lands by default); per-session controls still override.
      const defaults = getBrewDefaults();
      const rawQuery = defaults.excludeLands ? "-t:land" : "";
      const cards = await fetchDefaultStack(colorIdentity, defaults.sort, "asc", defaults.excludeLands);
      if (!cards.length) throw new Error("No cards found for that query.");
      // A fresh seed clears any in-stack narrow. buildSwipeCards excludes every
      // card already in the deck (recomputed from live deck_cards on every
      // entry) plus anything decided so far this session.
      baseStackRef.current = cards;
      setStackNarrow("");
      setQuery(rawQuery);
      // Reflect the seed's actual order in the sort control so the label names
      // the order applied (the earlier label-accuracy fix).
      setSwipeOrder(defaults.sort);
      setSwipeDir("asc");
      setSwipeCards(buildSwipeCards(cards, "", defaults.sort, "asc", excludeRows));
      setSwipeIndex(0);
      if (setView) setBrewView("swipe");
    } catch (err) {
      setError(err.message);
      if (setView) setBrewView("search");
    } finally {
      setLoading(false);
    }
  }

  // Resume the persisted seed/search + queue position when one survives; on any
  // failure (no session, a seed that now errors or returns nothing) fall back
  // to a fresh default seed so the user is never stranded on a broken stack.
  async function resumeOrSeedSwipeQueue(colorIdentity, excludeRows, persisted, opts = {}) {
    if (persisted && await tryResumeSwipeQueue(colorIdentity, excludeRows, persisted, opts)) return;
    await seedSwipeQueue(colorIdentity, excludeRows, opts);
  }

  // Rebuild the queue from a persisted session: same seed/search, same order,
  // same position (clamped — the existing dedupe still drops cards decked since,
  // so the queue may have shrunk). Returns false (no state mutated past the
  // fetch) if the seed now errors or comes back empty, so the caller can seed a
  // fresh default instead.
  async function tryResumeSwipeQueue(colorIdentity, excludeRows, persisted, { setView = true } = {}) {
    setLoading(true);
    setError(null);
    try {
      const order    = persisted.order ?? getBrewDefaults().sort;
      const dir      = persisted.dir ?? "asc";
      const rawQuery = persisted.query ?? "";
      const narrow   = persisted.narrow ?? "";
      // A resumed default seed goes back through the relevance stack, not the
      // generic live search — otherwise reopening a legend would silently swap
      // its tag-filtered stack for an unfiltered one. A persisted wrec: marker
      // resumes its category stack the same way (never sent to Scryfall).
      let cards;
      const wrecCategory = wrecQueryCategory(rawQuery);
      if (wrecCategory) {
        cards = await fetchCategoryStack(wrecCategory, colorIdentity, order, dir);
      } else if (isDefaultSeedQuery(rawQuery)) {
        cards = await fetchDefaultStack(colorIdentity, order, dir, rawQuery === "-t:land");
      } else {
        ({ cards } = await fetchFirstPageForSwipe(withColorIdentity(rawQuery, colorIdentity), { order, dir }));
      }
      // Re-apply the saved in-stack narrow on top of the rebuilt base stack.
      baseStackRef.current = cards;
      const filtered = buildSwipeCards(cards, narrow, order, dir, excludeRows);
      if (!filtered.length) return false; // empty/stale → fall back to default seed
      setStackNarrow(narrow);
      setQuery(rawQuery);
      setSwipeOrder(order);
      setSwipeDir(dir);
      setSwipeCards(filtered);
      const idx = Number.isFinite(persisted.index) ? persisted.index : 0;
      setSwipeIndex(Math.max(0, Math.min(idx, filtered.length - 1)));
      if (setView) setBrewView("swipe");
      return true;
    } catch {
      return false; // invalid/network error → fall back to default seed
    } finally {
      setLoading(false);
    }
  }

  // Persist the live session's transient view state (seed + queue position) per
  // legend on every change, so reopening resumes exactly here. Only once a real
  // queue exists, to avoid clobbering a good saved session with empty pre-seed
  // state on mount. The deck is NOT here — it persists via deck_cards writes.
  useEffect(() => {
    if (!session?.legend?.id || swipeCards.length === 0) return;
    // Search stacks are EPHEMERAL (Ben, Change 1): a typed-search stack is never
    // persisted as the resume seed, so reopening the legend always returns to the
    // default EDHREC stack (or the last default/wrec stack saved before the
    // search) rather than resuming a one-off search — the default stay "home".
    // Default seeds ("" / "-t:land") and wrec: gap-fill markers still persist.
    if (!isDefaultSeedQuery(query) && !wrecQueryCategory(query)) return;
    // `view` is the coarse brew view (UAT batch 2, item 5) so a background
    // reload resumes review/hand where it was, not just the swipe queue.
    saveBrewSession(session.legend.id, {
      query, narrow: stackNarrow, order: swipeOrder, dir: swipeDir, index: swipeIndex,
      view: brewView,
    });
  }, [session, query, stackNarrow, swipeOrder, swipeDir, swipeIndex, swipeCards.length, brewView]);

  // Warm the upcoming card ART off-swipe (Ben's load-time complaint): the
  // queue DATA already seeds silently in the background when the deck list
  // opens, but the images only started fetching once the swipe mounted — so
  // the first card painted late. This fetches the first slots' art into the
  // browser cache while the user is still reading the deck list; SwipeScreen's
  // own next-3 preloader owns it after mount. The Set keeps each URL to one
  // Image() churn per session.
  const warmedArtRef = useRef(new Set());
  useEffect(() => {
    if (brewView === "swipe" || swipeCards.length === 0) return;
    const from = Math.max(0, swipeIndex - 1);
    for (const c of swipeCards.slice(from, swipeIndex + 6)) {
      const url = getCardImage(c, "large") ?? getCardImage(c, "normal");
      if (!url || warmedArtRef.current.has(url)) continue;
      warmedArtRef.current.add(url);
      const img = new Image();
      img.src = url;
    }
  }, [brewView, swipeCards, swipeIndex]);

  // A flick is a write: each decklist/maybe decision (and its undo) is
  // queued and applied to deck_cards immediately, fire-and-forget, so the
  // gesture/animation never blocks on the network. Failed writes retry with
  // backoff; only persistent failure (3 attempts) surfaces, via `reconnecting`.
  function commitCard(card, section, delta) {
    if (!attachDeckId) return;
    writeQueueRef.current.push({
      deckId: attachDeckId, cardName: card.name, section, delta, attempts: 0,
      // oracle_id rides along so a fresh insert can auto-apply WREC tags
      // (RPC-stack and live-search cards both carry it).
      oracleId: card.oracle_id ?? null,
    });
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
  async function applyCardDelta({ deckId, cardName, section, delta, oracleId }) {
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
      const { data: inserted, error } = await supabase
        .from("deck_cards")
        .insert({ deck_id: deckId, card_name: cardName, section, quantity })
        .select("id")
        .single();
      if (error) throw error;
      // Auto-WREC on the FIRST copy only, best-effort: a throw here would
      // retry the whole delta and double the quantity, so failures are
      // swallowed — the deck-list heal re-applies missing suggestions.
      if (oracleId) {
        try {
          const suggestions = await autoWrecTags([oracleId]);
          await applyAutoTags(inserted.id, suggestions.get(oracleId) ?? []);
          markHealed(inserted.id); // offered — never re-suggest, even if cleared
        } catch { /* healed on next deck-list open */ }
      }
    }
  }

  // Live review: removing a card from a section is itself a write (-1).
  function handleRemoveCard(name, section) {
    const [list, setList] = section === "decklist" ? [decklist, setDecklist]
      : [pile, setPile];
    const idx = list.findIndex(c => c.name === name);
    if (idx === -1) return;
    const card = list[idx];
    // Device UAT — once the LAST copy leaves the deck, drop it from the
    // start-of-session row snapshot too. buildSwipeCards excludes both that
    // snapshot and the live decided-names set; decidedNamesRef self-updates
    // from state, but existingCardRows was a stale snapshot, so a removed card
    // stayed excluded from the add-cards search ("already in your deck").
    const stillHasCopy = list.some((c, i) => i !== idx && c.name === name);
    setList(prev => prev.filter((_, i) => i !== idx));
    commitCard(card, section, -1);
    if (!stillHasCopy) {
      setExistingCardRows(prev => prev.filter(r => !(r.card_name === name && r.section === section)));
    }
  }

  // Device UAT — add another copy of a card you can legally run multiples of
  // (basics, "any number" cards). There was no way to add basics at all: they
  // only arrived by flicking the same card repeatedly in the swipe stack.
  function handleAddCopy(name, section) {
    const [list, setList] = section === "decklist" ? [decklist, setDecklist]
      : [pile, setPile];
    const existing = list.find(c => c.name === name);
    if (!existing) return;
    const entry = { ...existing, instanceId: crypto.randomUUID() };
    setList(prev => [...prev, entry]);
    commitCard(entry, section, 1);
  }

  // ── Hand mode (Change 4) ────────────────────────────────────────────────────
  // Flip through the deck as its own swipe stack. Enter builds a resolved
  // snapshot of the current decklist (unique cards, full data for art), then
  // hands it to the same SwipeScreen in handMode. Cuts write through the SAME
  // deck path the review screen uses, so the decklist and every counter update
  // live — no parallel state. (The board-move path died with the maybeboard:
  // there's nowhere else for a card to go.)
  async function enterHandMode(orderedNames, startName) {
    // The review stack flips through the deck in the SAME order the decklist is
    // currently showing (Change 9) — ReviewScreen passes its display-ordered,
    // de-duped names (its sort/group state); fall back to raw decklist order if
    // none was handed in.
    const names = orderedNames?.length
      ? orderedNames
      : [...new Set(decklist.map(c => c.name))];
    if (!names.length) return;
    setLoading(true);
    try {
      const { data } = await getCardDataBatch(names);
      // Preserve the passed order; drop names the cache couldn't resolve.
      const cards = names.map(n => data[n]).filter(Boolean);
      if (!cards.length) return;
      setHandCards(cards);
      // Device UAT — start ON the selected card when one was handed in
      // (tapping a row's mini-card, or hitting review with a card expanded);
      // otherwise resume at the last-viewed position (clamped).
      if (startName) {
        const at = cards.findIndex(c => c.name === startName);
        setHandIndex(at >= 0 ? at : 0);
      } else {
        setHandIndex(i => Math.min(i, cards.length - 1));
      }
      setBrewView("hand");
    } finally {
      setLoading(false);
    }
  }

  // ↑ cut — remove ALL copies of a card from the decklist (one deck_cards
  // delta). Returns the quantity removed so UNDO can restore exactly that many.
  function handCut(card) {
    const copies = decklist.filter(c => c.name === card.name);
    if (!copies.length) return 0;
    setDecklist(prev => prev.filter(c => c.name !== card.name));
    commitCard(card, "decklist", -copies.length);
    return copies.length;
  }
  function handUncut(card, quantity) {
    const qty = quantity ?? 1;
    const entries = Array.from({ length: qty }, () => ({ name: card.name, instanceId: crypto.randomUUID() }));
    setDecklist(prev => [...prev, ...entries]);
    commitCard(card, "decklist", qty);
  }

  // Load every deck card's WREC tags when review opens (and on resume), keyed
  // for O(1) lookup by the review rows. `heal` backfills auto-suggestions for
  // untagged cards (see healAutoTags), then re-loads once without healing.
  async function loadDeckTags(deckId, heal = true) {
    if (!deckId) return;
    try {
      const rows = await fetchDeckCardsWithTags(deckId);
      const map = {};
      for (const r of rows) {
        map[`${r.section}:${r.card_name}`] = { id: r.id, tags: r.tags, autoTags: r.autoTags, quantity: r.quantity };
      }
      setCardTags(map);
      if (heal) healAutoTags(deckId, rows);
    } catch { /* tags are best-effort; review still renders without them */ }
  }

  // Backfill auto-WREC suggestions for deck cards that predate flick-time
  // auto-tagging (or whose flick-time write failed). Scope: ZERO-tag rows the
  // user hasn't already curated (loadHealedSet) — a card that's been touched,
  // even stripped to zero, is theirs to keep and never re-suggested. Names
  // resolve through the batched cache; one card_tags query covers all of them.
  async function healAutoTags(deckId, rows) {
    const curated = loadHealedSet();
    const bare = rows.filter(r => r.tags.length === 0 && !curated.has(r.id));
    if (bare.length === 0) return;
    try {
      const { data: byName } = await getCardDataBatch(bare.map(r => r.card_name));
      const ids = [...new Set(
        bare.map(r => byName[r.card_name]?.oracle_id).filter(Boolean),
      )];
      const suggestions = await autoWrecTags(ids);
      let touched = false;
      await Promise.all(bare.map(async r => {
        const oid = byName[r.card_name]?.oracle_id;
        const tags = oid ? suggestions.get(oid) : null;
        if (!tags?.length) return;
        await applyAutoTags(r.id, tags);
        touched = true;
      }));
      // Mark every row we could RESOLVE (whether or not it got a suggestion) so
      // it's not re-offered next open; leave cache-miss rows unmarked to retry.
      markHealed(bare.filter(r => byName[r.card_name]?.oracle_id).map(r => r.id));
      if (touched) loadDeckTags(deckId, false);
    } catch { /* best-effort — untagged rows just stay untagged this open */ }
  }

  useEffect(() => {
    // Opening the deck list loads its tags — an async fetch whose setState lands
    // after the await, not a synchronous cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (brewView === "review" && attachDeckId) loadDeckTags(attachDeckId);
  }, [brewView, attachDeckId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggling a WREC tag is an immediate write — flick-is-a-write extends to
  // tagging, no save step. Optimistic, reverting on failure.
  async function handleToggleTag(name, section, tag) {
    if (!attachDeckId) return;
    const key = `${section}:${name}`;
    let entry = cardTags[key];
    let deckCardId = entry?.id;
    if (!deckCardId) {
      const { data } = await supabase
        .from("deck_cards")
        .select("id")
        .eq("deck_id", attachDeckId).eq("card_name", name).eq("section", section)
        .maybeSingle();
      deckCardId = data?.id;
      if (!deckCardId) return;
    }
    const had = (entry?.tags ?? []).includes(tag);
    // Tap toggle (Ben, 2026-07-09): a chip either EMPTIES to blank (present —
    // including a pre-tagged auto recommendation) or FILLS as the user's
    // (absent). This replaces the old confirm ladder, which made clearing a
    // recommendation two taps.
    // UAT batch 3, item 2 — the optimistic transition is computed from `prev`
    // (not the outer `had`): using `had` here meant a stale read could append a
    // DUPLICATE of an already-present tag, so a deselect left the cell filled
    // and un-clearable. Recomputing per-`prev` keeps the toggle idempotent.
    const prevEntry = entry ?? { id: deckCardId, tags: [], autoTags: [], quantity: 1 };
    setCardTags(prev => {
      const cur = prev[key] ?? { id: deckCardId, tags: [], autoTags: [], quantity: 1 };
      const has = cur.tags.includes(tag);
      const tags = has ? cur.tags.filter(t => t !== tag) : [...cur.tags, tag];
      const autoTags = has ? (cur.autoTags ?? []).filter(t => t !== tag) : (cur.autoTags ?? []);
      return { ...prev, [key]: { ...cur, id: deckCardId, tags, autoTags } };
    });
    try {
      if (had) await untagCard(deckCardId, tag);
      else await tagCard(deckCardId, tag);
      markHealed(deckCardId); // user curated this card — stop auto-suggesting to it
    } catch {
      setCardTags(prev => ({ ...prev, [key]: prevEntry }));
    }
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
    setQuery("");
    setStackNarrow("");
    setDeckSearchDraft("");
    baseStackRef.current = [];
    setSessionLabel(null);
    setSwipeCards([]);
    setSwipeIndex(0);
    setPile([]);
    setDecklist([]);
    setError(null);
    setSaveError(null);
    setAttachDeckId(null);
    setExistingCardRows([]);
  }

  async function runSearch(q, order = swipeOrder, dir = swipeDir, label) {
    setLoading(true);
    setError(null);
    try {
      // In a legend-attached session, every typed query is constrained to the
      // legend's color identity server-side — the user's input is never
      // trusted alone, matching the auto-seed path above.
      const finalQuery = session ? withColorIdentity(q, legendColorIdentity) : q;
      const { cards } = await fetchFirstPageForSwipe(finalQuery, { order, dir });
      // Decided cards (this session or earlier) never re-queue, no matter how
      // the queue was re-seeded — skipped/browsed cards are unaffected.
      const filtered = cards.filter(c => !decidedNamesRef.current.has(c.name));
      if (!filtered.length) throw new Error("No cards found for that query.");
      setQuery(q);
      setSessionLabel(label !== undefined ? label : sessionLabel);
      setSwipeCards(filtered);
      setSwipeIndex(0);
      setBrewView("swipe");
      return { ok: true };
    } catch (err) {
      setError(err.message);
      // Distinguish malformed syntax (echo Scryfall's reason) from a valid
      // query that simply matched nothing, so callers can toast the right
      // thing instead of failing silently.
      const kind = err.code === "invalid_query" ? "invalid" : "empty";
      return { ok: false, kind, message: err.message };
    } finally {
      setLoading(false);
    }
  }

  // Change 1 — the decklist search bar summons a CUSTOM swipe stack from all of
  // Scryfall (the EDHREC list is only the default stack). Results are never a
  // list: they become the swipe stack itself, routed into the same SwipeScreen
  // used everywhere else. The typed query becomes the stack identity (`query`),
  // so session resume rebuilds it through the existing typed-search branch and
  // the origin subline reads `search: …`. baseStackRef is set to the results so
  // the in-swipe filter (Change 3) narrows THIS stack, not the old one. Cards
  // already in the deck (or decided this session) are dropped by buildSwipeCards,
  // so the user never swipes past what they already have. Returns a runSearch-
  // shaped result so the caller can surface the short/empty/syntax cases as one
  // mono line. This is also the alternate-stack-source primitive hand mode reuses.
  async function runGlobalSearch(rawInput) {
    const input = (rawInput ?? "").trim();
    if (!input) return { ok: false, kind: "empty", message: "type a card name or Scryfall syntax" };
    if (nameOrSyntax(input).tooShort) {
      return { ok: false, kind: "short", message: "type at least 3 letters to search by name" };
    }
    setLoading(true);
    setError(null);
    try {
      const finalQuery = withColorIdentity(input, legendColorIdentity);
      const { cards } = await fetchFirstPageForSwipe(finalQuery, { order: swipeOrder, dir: swipeDir });
      baseStackRef.current = cards;
      const filtered = buildSwipeCards(cards, "", swipeOrder, swipeDir);
      if (!filtered.length) {
        // An empty legal-card search should be impossible by design, so a dry
        // result almost always means "every match is already in the deck".
        const message = cards.length
          ? "every card matching that is already in your deck"
          : "no cards match that search";
        return { ok: false, kind: "empty", message };
      }
      setStackNarrow("");
      setQuery(input);
      setSwipeCards(filtered);
      setSwipeIndex(0);
      setBrewView("swipe");
      return { ok: true };
    } catch (err) {
      // Surface Scryfall's own syntax reason; otherwise a generic one-liner.
      const kind = err.code === "invalid_query" ? "invalid" : "error";
      return { ok: false, kind, message: err.message };
    } finally {
      setLoading(false);
    }
  }

  // The in-swipe search box for a legend session NARROWS the current relevance/
  // wrec stack client-side instead of running a generic Scryfall search — the
  // EDHREC ordering is preserved and only cards the stack already holds are ever
  // shown (Ben's "keep relevance" call). Empty terms clear the filter and
  // restore the full stack. Returns the runSearch-shaped result so SearchScreen's
  // error/empty handling is unchanged.
  function applyStackNarrow(terms) {
    const trimmed = (terms ?? "").trim();
    // Even a ZERO-MATCH filter lands on the swipe screen (Change 3): SwipeScreen
    // shows the "nothing in this stack matches" escape state with a "search all
    // cards" hatch, so the dead end becomes a bigger stack without ever leaving
    // the swipe. Clearing the filter (empty terms) rebuilds the full stack.
    const next = buildSwipeCards(baseStackRef.current, trimmed, swipeOrder, swipeDir);
    setError(null);
    setStackNarrow(trimmed);
    setSwipeCards(next);
    setSwipeIndex(0);
    setBrewView("swipe");
    return { ok: true };
  }

  // Clear the in-swipe filter from the SwipeScreen chip's ✕ — rebuild the full
  // (un-narrowed) stack in place, staying on the swipe. Never destructive.
  function clearStackNarrow() {
    setStackNarrow("");
    setSwipeCards(buildSwipeCards(baseStackRef.current, "", swipeOrder, swipeDir));
    setSwipeIndex(0);
  }

  function handleSortChange(order, dir) {
    setSwipeOrder(order);
    setSwipeDir(dir);
    // A legend session always owns a client-side stack (relevance or wrec,
    // possibly narrowed) — re-derive it from the base so sorting never triggers
    // a generic search that would drop the ranking or the active narrow.
    // Undecided position resets to the top, matching the re-fetch paths.
    if (session) {
      setSwipeCards(buildSwipeCards(baseStackRef.current, stackNarrow, order, dir));
      setSwipeIndex(0);
      return;
    }
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
      const legend = await upsertLegend({ name: commanderName });

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
    // Change 11 — the ladder is swipe → deck list → Box: swipe/hand back to the
    // deck list, the deck list back to the Box (always, regardless of how it was
    // reached). Non-session (Loki/legacy) swipe keeps its old target.
    : brewView === "swipe"  ? (session ? "review" : (isLokiSession ? "modes" : "search"))
    : brewView === "hand"   ? "review"
    : brewView === "review" ? (session ? null : "swipe")
    : "swipe";

  function handleBack() {
    if (backTarget === null || backTarget === undefined) {
      resetBrew();
      onSessionDone?.();
    } else {
      setBrewView(backTarget);
    }
  }

  // The deck list's bottom-nav targets (Change 11): goToSwipe (BREW, deal the
  // discovery stack) and goHome (BACK, exit to the Box — the deck list's parent
  // in the swipe → deck list → Box ladder). Both are single-path regardless of
  // how the deck list was reached.
  function goToSwipe() {
    setBrewView("swipe");
  }
  function goHome() {
    resetBrew();
    onSessionDone?.();
  }

  // Deleting the legend — the one destructive act in the app, and it deletes
  // OUTRIGHT: legend, deck, cards, tags; nothing survives in the Box.
  // Confirmed in ReviewScreen, executed here. Pending flick-writes are
  // dropped first so a queued +1 can't land after (and be rejected by) the
  // delete; the persisted swipe session and the legend's slot in the saved
  // box order / last-active keys are cleared; then the session exits to the
  // Box. Throws on failure so ReviewScreen's confirm UI can surface it.
  async function handleDeleteDeck() {
    const legendId = session?.legend?.id;
    if (!legendId) return;
    writeQueueRef.current = [];
    await deleteLegend(legendId, attachDeckId);
    try {
      localStorage.removeItem(brewSessionKey(legendId));
      const order = JSON.parse(localStorage.getItem("magicdex-box-order") ?? "null");
      if (Array.isArray(order)) {
        localStorage.setItem("magicdex-box-order", JSON.stringify(order.filter(id => id !== legendId)));
      }
      if (localStorage.getItem("magicdex-last-legend") === String(legendId)) {
        localStorage.removeItem("magicdex-last-legend");
      }
    } catch { /* best-effort local cleanup */ }
    resetBrew();
    onSessionDone?.();
  }

  // Hardware/browser Back must behave identically to the in-app chevron. While
  // the takeover is open we trap one synthetic history entry and route every
  // Back — hardware or chevron (via goBack → history.back) — through the same
  // handleBack ladder, re-arming the trap until handleBack exits the session.
  // The "latest ref" pattern: the history-trap effect below must always call the
  // CURRENT backTarget/handleBack without re-subscribing on every render, so
  // these are refreshed on each render by design.
  const backTargetRef = useRef(backTarget);
  // eslint-disable-next-line react-hooks/refs
  backTargetRef.current = backTarget;
  const handleBackRef = useRef(handleBack);
  // eslint-disable-next-line react-hooks/refs
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

  // The swipe header names the stack's origin when it isn't the default. Derived
  // from `query` (the stack identity), so it survives resume with no extra state:
  // the default seed ("" / "-t:land") and wrec: gap-fill markers stay anonymous
  // (the commander anchor already identifies those); anything else is a Change-1
  // search stack, labelled `search: {query}`.
  const stackOrigin = session && query && !isDefaultSeedQuery(query) && !wrecQueryCategory(query)
    ? { type: "search", query }
    : null;

  // The size of the current stack BEFORE the in-swipe filter narrows it — feeds
  // the filter chip's `{matching} of {total}` count and the narrow panel's
  // "narrows the current stack of {N}" copy. Un-narrowed and deck-excluded, so
  // it's the honest "how big is the stack I'm filtering" number.
  // baseStackRef is only ever reassigned alongside a setSwipeCards that
  // re-renders, so reading it here can't go stale in practice.
  const totalStackCount = session
    // eslint-disable-next-line react-hooks/refs
    ? buildSwipeCards(baseStackRef.current, "", swipeOrder, swipeDir).length
    : 0;

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
        {brewView !== "swipe" && brewView !== "hand" && !(brewView === "review" && session) && (
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

        {brewView === "search" && (
          <SearchScreen
            onSearch={session ? applyStackNarrow : runSearch}
            loading={loading}
            error={error}
            // Legend sessions narrow the current stack — prefill the box with the
            // active filter (not `query`, which is the stack identity), and drop
            // into narrow mode (no otag chips: they can't be evaluated locally).
            initialQuery={session ? stackNarrow : query}
            narrowStack={!!session}
            stackCount={totalStackCount}
          />
        )}

        {brewView === "swipe" && (
          <SwipeScreen
            cards={swipeCards}
            pile={pile}
            onPileChange={setPile}
            decklist={decklist}
            onDecklistChange={setDecklist}
            onGoToPile={() => setBrewView("review")}
            onSearchMore={() => setBrewView("review")}
            commanderCard={session
              ? { name: session.legend.name, art: session.legend.image_uri }
              : sessionLabel ? { name: sessionLabel } : null}
            initialIndex={swipeIndex}
            onIndexChange={setSwipeIndex}
            swipeOrder={swipeOrder}
            swipeDir={swipeDir}
            onSortChange={handleSortChange}
            onCardCommit={session ? commitCard : undefined}
            reconnecting={reconnecting}
            stackOrigin={stackOrigin}
            stackNarrow={session ? stackNarrow : ""}
            onClearFilter={session ? clearStackNarrow : undefined}
            onSearchAll={session ? runGlobalSearch : undefined}
            onEditQuery={session ? runGlobalSearch : undefined}
          />
        )}

        {brewView === "hand" && (
          <SwipeScreen
            cards={handCards}
            pile={pile}
            onPileChange={setPile}
            decklist={decklist}
            onDecklistChange={setDecklist}
            // Closing the flip pass (↓) carries the card you were on back to
            // the list, so it lands there instead of at the top (device UAT).
            onGoToPile={() => {
              setAnchorCard(handCards[handIndex]?.name ?? null);
              setBrewView("review");
            }}
            commanderCard={session
              ? { name: session.legend.name, art: session.legend.image_uri }
              : sessionLabel ? { name: sessionLabel } : null}
            initialIndex={handIndex}
            onIndexChange={setHandIndex}
            swipeOrder={swipeOrder}
            swipeDir={swipeDir}
            reconnecting={reconnecting}
            handMode
            cardTags={cardTags}
            onToggleTag={handleToggleTag}
            onHandCut={handCut}
            onHandUncut={handUncut}
          />
        )}

        {brewView === "review" && (
          <ReviewScreen
            decklist={decklist}
            onConfirm={handleConfirmSave}
            saving={saving}
            error={saveError}
            live={!!session}
            onRemove={handleRemoveCard}
            commander={session ? { name: session.legend.name, art: session.legend.image_uri } : null}
            cardTags={cardTags}
            onToggleTag={handleToggleTag}
            onHome={session ? goHome : undefined}
            onBrew={session ? goToSwipe : undefined}
            onDeleteDeck={session ? handleDeleteDeck : undefined}
            onAddMore={session ? handleAddMore : undefined}
            onDeckSearch={session ? runGlobalSearch : undefined}
            stackCount={swipeCards.length}
            deckKey={session?.legend?.id ?? null}
            onHand={session ? enterHandMode : undefined}
            searchDraft={deckSearchDraft}
            onSearchDraftChange={setDeckSearchDraft}
            onAddCopy={session ? handleAddCopy : undefined}
            anchorCard={anchorCard}
          />
        )}

        {/* Backup nudge — bottom sheet over whichever brew screen is up.
            Non-blocking by design (Ben: no barrier to entry): "not now"
            dismisses for this brew, the flow stays available in Settings. */}
        {showBackupNudge && (
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60,
            display: "flex", justifyContent: "center",
            background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
            paddingTop: 40,
          }}>
            <div style={{
              width: "100%", maxWidth: 430,
              background: "var(--bg)",
              borderTop: "1px solid var(--primary)",
              padding: "16px 20px calc(env(safe-area-inset-bottom) + 16px)",
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              {!nudgeSent ? (
                <>
                  <div style={{
                    fontFamily: "'Noto Sans', sans-serif",
                    fontSize: 13, lineHeight: 1.5,
                    color: "var(--text)",
                  }}>
                    {decklist.length} cards in — this brew is
                    becoming something. Add an email so it can't be lost to a
                    cleared browser or a new phone. Used for nothing else.
                  </div>
                  <input
                    type="email"
                    placeholder="email"
                    value={nudgeEmail}
                    onChange={e => setNudgeEmail(e.target.value)}
                    autoComplete="email"
                    autoCapitalize="off"
                    spellCheck={false}
                    style={{
                      width: "100%", boxSizing: "border-box", minHeight: 44,
                      background: "transparent",
                      color: "var(--text)",
                      fontFamily: "'Noto Sans Mono', monospace", fontSize: 13,
                      border: "1px solid var(--muted)",
                      padding: "0 12px", borderRadius: 0, outline: "none",
                    }}
                  />
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={sendBackupEmail}
                      disabled={nudgeBusy || !nudgeEmail.trim()}
                      style={{
                        minHeight: 44, flex: 1,
                        background: "transparent",
                        border: "1px solid var(--primary)",
                        color: "var(--primary)",
                        fontFamily: "'Noto Sans Mono', monospace",
                        fontSize: 11, letterSpacing: "0.06em",
                        cursor: "pointer",
                        opacity: nudgeBusy || !nudgeEmail.trim() ? 0.5 : 1,
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {nudgeBusy ? "sending…" : "save my brew"}
                    </button>
                    <button
                      onClick={dismissBackupNudge}
                      style={{
                        minHeight: 44, flex: 1,
                        background: "transparent",
                        border: "1px solid var(--muted)",
                        color: "var(--muted)",
                        fontFamily: "'Noto Sans Mono', monospace",
                        fontSize: 11, letterSpacing: "0.06em",
                        cursor: "pointer",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      not now
                    </button>
                  </div>
                  {nudgeError && (
                    <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
                      {nudgeError}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{
                    fontFamily: "'Noto Sans', sans-serif",
                    fontSize: 13, lineHeight: 1.5,
                    color: "var(--text)",
                  }}>
                    confirmation sent — tap the link in your inbox and this brew
                    (and everything else in your box) is safe anywhere.
                  </div>
                  <button
                    onClick={() => setShowBackupNudge(false)}
                    style={{
                      minHeight: 44,
                      background: "transparent",
                      border: "1px solid var(--primary)",
                      color: "var(--primary)",
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 11, letterSpacing: "0.06em",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    got it
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // In the magicdex IA, Brew is only ever launched with a session — the
  // session-init effect flips brewView off "shell" on the next tick, while
  // deck_cards/color-identity fetches are still in flight. The commander's
  // name/art come straight off the session prop with no fetch needed, so the
  // anchor paints immediately instead of holding a bare dark rectangle.
  if (session) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: BREW.base,
        ...BREW_VARS,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: "calc(env(safe-area-inset-top) + 10px)",
      }}>
        <div style={{
          width: "100%", maxWidth: 430,
          display: "flex", alignItems: "center", gap: 12,
          padding: "0 20px 16px",
        }}>
          <div style={{
            width: 56, height: 56, flexShrink: 0,
            borderRadius: "5.5% / 4%",
            overflow: "hidden",
            background: BREW.surface,
          }}>
            {session.legend.image_uri && (
              <img
                src={session.legend.image_uri}
                alt={session.legend.name}
                draggable={false}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
          </div>
          <div style={{
            flex: 1, minWidth: 0,
            fontFamily: "'Zilla Slab', serif",
            fontSize: 18,
            color: BREW.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {session.legend.name}
          </div>
        </div>
        <div style={{
          width: "100%", maxWidth: 430,
          padding: "0 20px",
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 12,
          color: BREW.dim,
          marginBottom: 16,
        }}>
          loading deck…
        </div>
        <div style={{
          width: "100%", maxWidth: 430,
          padding: "0 20px",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{
              height: 14,
              borderRadius: 2,
              background: BREW.surface,
              opacity: 1 - i * 0.1,
            }} />
          ))}
        </div>
      </div>
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
