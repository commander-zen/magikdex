import { supabase } from "./supabase.js";

const UA = "DeckStack/1.0 (deck-stack.vercel.app)";

// ── Sleep helper ──────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Invalid-query error ─────────────────────────────────────────────────────────
// Scryfall answers a malformed query with HTTP 400/422 and a human `details`
// message ("Expected a colon…"). Tag the thrown error so callers can tell
// "your syntax is wrong" apart from "valid query, zero results" and surface it
// — bad syntax must never fail silently and read like a bug.
function invalidQueryError(details) {
  const err = new Error(details || "Invalid search syntax.");
  err.code = "invalid_query";
  return err;
}

// ── Image helpers ─────────────────────────────────────────────────────────────
export function getCardImage(card, size = "normal") {
  if (card.image_uris) return card.image_uris[size] ?? card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris)
    return card.card_faces[0].image_uris[size] ?? card.card_faces[0].image_uris.normal;
  return null;
}

// ── Mana cost → plain text ────────────────────────────────────────────────────
export function formatManaCost(cost) {
  if (!cost) return "";
  return cost.replace(/\{([^}]+)\}/g, (_, m) => m).replace(/\//g, "");
}

// ── Price display helper ──────────────────────────────────────────────────────
export function formatPrice(card) {
  const usd = card.prices?.usd;
  if (!usd) return null;
  return `$${parseFloat(usd).toFixed(2)}`;
}

// ── Autocomplete card names ───────────────────────────────────────────────────
export async function autocompleteCardNames(query, options = {}) {
  if (!query.trim()) return [];
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(query)}&include_extras=false`,
      { headers: { "User-Agent": UA }, signal: options.signal }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? []).slice(0, 8);
  } catch {
    return [];
  }
}

// ── Commander name search ─────────────────────────────────────────────────────
export async function searchCommanders(query, options = {}) {
  if (!query.trim()) return [];
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(
        `is:commander name:${query.trim()}`
      )}&order=edhrec&unique=cards`,
      { headers: { "User-Agent": UA }, signal: options.signal }
    );
    if (res.status === 400 || res.status === 422) {
      const json = await res.json().catch(() => ({}));
      options.onInvalid?.(json.details ?? "");
      return [];
    }
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data ?? []).slice(0, 8);
  } catch {
    return [];
  }
}

// ── Random commander ──────────────────────────────────────────────────────────
export async function fetchRandomCommander(options = {}) {
  const res = await fetch(
    "https://api.scryfall.com/cards/random?q=is:commander",
    { headers: { "User-Agent": UA }, signal: options.signal }
  );
  if (!res.ok) throw new Error("The fates are silent.");
  return res.json();
}

// ── Fetch a single card by exact name ────────────────────────────────────────
export async function fetchCardByName(name, options = {}) {
  const res = await fetch(
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`,
    { headers: { "User-Agent": UA }, signal: options.signal }
  );
  if (res.status === 404) throw new Error(`"${name}" not found.`);
  if (!res.ok) throw new Error(`Scryfall error: ${res.status}`);
  return res.json();
}

// ── Name-lookup cache plumbing (migration 007 `cards`) ───────────────────────
// fetchCardIdentity is the one exact→fuzzy name lookup behind getCardData and
// the legend identity backfill. It now reads the local gameplay cache FIRST and
// only touches api.scryfall.com on a miss. TYPED search is unaffected: the
// inline/add-legend search keeps using the live query API, because the cache
// can't replicate Scryfall query syntax and proxying it would violate
// DATA_SOURCES' "don't proxy" rule. The carousel's DEFAULT seed, though, is
// served from our DB via fetchBrewStack (migration 010) when the legend has a
// tag profile.

const CARD_CACHE_COLS =
  "oracle_id, scryfall_id, name, type_line, oracle_text, mana_cost, cmc, " +
  "color_identity, layout, card_faces, image_normal, art_crop";

// A cache row → the Scryfall-card shape callers already expect (image_uris,
// card_faces, type_line, …), so getCardImage/manaOf/oracleOf work unchanged.
function cacheRowToCard(row) {
  const image_uris = (row.image_normal || row.art_crop)
    ? { normal: row.image_normal ?? undefined, art_crop: row.art_crop ?? undefined }
    : undefined;
  return {
    id: row.scryfall_id ?? undefined,
    oracle_id: row.oracle_id,
    name: row.name,
    type_line: row.type_line ?? undefined,
    oracle_text: row.oracle_text ?? undefined,
    mana_cost: row.mana_cost ?? undefined,
    cmc: row.cmc ?? undefined,
    color_identity: row.color_identity ?? [],
    layout: row.layout ?? undefined,
    card_faces: row.card_faces ?? undefined,
    image_uris,
  };
}

// A live Scryfall card → a `cards` row (mirrors scripts/ingest-cards.mjs).
function cardToCacheRow(c) {
  if (!c?.oracle_id) return null;
  const faces = c.card_faces ?? null;
  const topImg = c.image_uris ?? null;
  const faceImg = faces?.[0]?.image_uris ?? null;
  return {
    oracle_id: c.oracle_id,
    scryfall_id: c.id ?? null,
    name: c.name,
    name_lower: (c.name ?? "").toLowerCase(),
    type_line: c.type_line ?? null,
    oracle_text: c.oracle_text ?? null,
    mana_cost: c.mana_cost ?? null,
    cmc: c.cmc ?? null,
    color_identity: c.color_identity ?? [],
    layout: c.layout ?? null,
    card_faces: faces,
    image_normal: topImg?.normal ?? faceImg?.normal ?? null,
    art_crop: topImg?.art_crop ?? faceImg?.art_crop ?? null,
  };
}

// Best-effort write-back so the next lookup of this name is instant. If anon
// writes are blocked by RLS this simply no-ops — the live result is still
// returned, and the service-key bulk ingest (npm run ingest:cards) remains the
// authoritative populate path.
function writeBackToCache(card) {
  const row = cardToCacheRow(card);
  if (!row) return;
  supabase.from("cards").upsert(row, { onConflict: "oracle_id" }).then(() => {}, () => {});
}

// Live named lookups are serialized behind the ~100ms politeness delay so a
// burst of cache misses can't exceed Scryfall's rate ceiling.
const SCRYFALL_NAMED_DELAY = 100;
let namedFetchTail = Promise.resolve();
function serializeNamedFetch(fn) {
  const run = namedFetchTail.catch(() => {}).then(fn);
  namedFetchTail = run.then(() => sleep(SCRYFALL_NAMED_DELAY), () => sleep(SCRYFALL_NAMED_DELAY));
  return run;
}

async function liveNamedLookup(name, options) {
  try {
    const exact = await fetch(
      `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`,
      { headers: { "User-Agent": UA }, signal: options.signal }
    );
    if (exact.ok) { const card = await exact.json(); writeBackToCache(card); return card; }
    if (exact.status !== 404) return null;

    const fuzzy = await fetch(
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
      { headers: { "User-Agent": UA }, signal: options.signal }
    );
    if (!fuzzy.ok) return null;
    const card = await fuzzy.json();
    writeBackToCache(card);
    return card;
  } catch {
    return null;
  }
}

// Cache-first identity lookup: local `cards` (case-insensitive exact on
// name_lower) → live exact → live fuzzy. Returns the card object or null (never
// throws), so a miss everywhere reads as "card data unavailable".
export async function fetchCardIdentity(name, options = {}) {
  const key = (name ?? "").trim().toLowerCase();
  if (key) {
    try {
      const { data } = await supabase
        .from("cards")
        .select(CARD_CACHE_COLS)
        .eq("name_lower", key)
        .maybeSingle();
      if (data) return cacheRowToCard(data);
    } catch { /* cache unreachable — fall through to the live API */ }
  }
  return serializeNamedFetch(() => liveNamedLookup(name, options));
}

// ── Single per-card data resolver ─────────────────────────────────────────────
// One door for "give me this card's gameplay data, by name", used by the deck/
// review tagging context. Resolution (cache-first, then a throttled live exact→
// fuzzy + write-back) lives in fetchCardIdentity, so this layer only memoizes
// resolved cards and de-dupes concurrent requests for the same name. With the
// cache populated the common path is a single Supabase read and ZERO calls to
// api.scryfall.com. Returns the card object or null — a null is the caller's cue
// to show "card data unavailable" rather than a blank.
const cardDataCache    = new Map();   // lowercased name → resolved card | null
const cardDataInFlight = new Map();   // lowercased name → Promise<card | null>

export function getCardData(name, options = {}) {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  if (cardDataCache.has(key))    return Promise.resolve(cardDataCache.get(key));
  if (cardDataInFlight.has(key)) return cardDataInFlight.get(key);

  const p = fetchCardIdentity(name, options).then(card => {
    cardDataCache.set(key, card ?? null);
    cardDataInFlight.delete(key);
    return card ?? null;
  });
  cardDataInFlight.set(key, p);
  return p;
}

// ── Batched per-card data resolver ────────────────────────────────────────────
// The list surfaces (deck review, paste-import) need data for MANY names at
// once. Resolving them through getCardData one-by-one costs a Supabase
// round-trip per card — plus a CORS preflight each, throttled through the
// browser's ~6-connections-per-host cap — which is the deck-view load lag.
// This resolves a whole list against the cache in ONE chunked `in` query,
// feeding the same memo getCardData uses. Names the cache doesn't know come
// back in `misses`; the caller decides whether to chase them down the
// throttled live path (getCardData per name) — kept out of this function so
// a screen can paint the 95% cache-hit case without waiting on stragglers.
const CACHE_BATCH_SIZE = 100;

export async function getCardDataBatch(names) {
  const data = {};
  const wanted = new Map(); // lowered key → original spellings awaiting it
  for (const name of names) {
    const key = (name ?? "").trim().toLowerCase();
    if (!key) { data[name] = null; continue; }
    if (cardDataCache.has(key)) { data[name] = cardDataCache.get(key); continue; }
    if (!wanted.has(key)) wanted.set(key, []);
    wanted.get(key).push(name);
  }

  const keys = [...wanted.keys()];
  for (let i = 0; i < keys.length; i += CACHE_BATCH_SIZE) {
    try {
      const { data: rows } = await supabase
        .from("cards")
        .select(CARD_CACHE_COLS + ", name_lower")
        .in("name_lower", keys.slice(i, i + CACHE_BATCH_SIZE));
      for (const row of rows ?? []) {
        const card = cacheRowToCard(row);
        cardDataCache.set(row.name_lower, card);
        for (const orig of wanted.get(row.name_lower) ?? []) data[orig] = card;
        wanted.delete(row.name_lower);
      }
    } catch { /* cache unreachable — the chunk's keys fall out as misses */ }
  }

  const misses = [...wanted.values()].flat();
  return { data, misses };
}

// ── Brew stack (migration 010 RPC) ───────────────────────────────────────────
// The legend-relevant swipe stack, dealt entirely from our own DB: cards in
// the legend's color identity sharing any of its Tagger-page tags
// (card_tags), commander-legal, EDHREC-rank ordered. Each card carries
// `matched_tags` — why it's in the stack. Returns [] on any failure or when
// the legend has no tag profile yet (ingest-legend-tags hasn't run for it),
// so callers can fall back to the generic live seed.
export async function fetchBrewStack({ legendName, colorIdentity, deckId = null, excludeLands = true, limit = 400 }) {
  const legend = await getCardData(legendName);
  if (!legend?.oracle_id) return [];
  try {
    const { data, error } = await supabase.rpc("brew_stack", {
      p_legend_oracle_id: legend.oracle_id,
      p_color_identity: colorIdentity ?? [],
      p_deck_id: deckId,
      p_exclude_lands: excludeLands,
      p_limit: limit,
    });
    if (error) return [];
    return (data ?? []).map(row => ({
      ...cacheRowToCard(row),
      edhrec_rank: row.edhrec_rank ?? undefined,
      matched_tags: row.matched_tags ?? [],
      synergy: row.synergy ?? undefined,
    }));
  } catch {
    return [];
  }
}

// ── Single page fetch ─────────────────────────────────────────────────────────
export async function fetchFirstPage(query, options = {}) {
  const { signal } = options;
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA }, signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Network error.");
  }
  if (res.status === 404) return [];
  if (res.status === 429) throw new Error("Rate limited — try again in a moment.");
  if (!res.ok) throw new Error(`Scryfall error: ${res.status}`);
  const json = await res.json();
  return json.data ?? [];
}

// Dev-seed query: starting point for blue clones, to be hand-tuned later —
// do not "improve" it.
export const LOKI_CLONE_QUERY = 'legal:commander ci<=u t:creature o:"copy of" -o:"token"';

// ── First-page swipe fetch — returns immediately so SwipeScreen can start ─────
export async function fetchFirstPageForSwipe(query, commanderCard = null, options = {}) {
  const { signal, order = "name", dir = "auto" } = options;
  const baseQuery = query + " -type:sticker -type:attraction";
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(baseQuery)}&order=${order}&unique=cards`;
  if (dir !== "auto") url += `&dir=${dir}`;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA }, signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Network error.");
  }
  if (res.status === 404) throw new Error("No cards found for that query.");
  if (res.status === 400 || res.status === 422) {
    const json = await res.json().catch(() => ({}));
    throw invalidQueryError(json.details);
  }
  if (!res.ok) throw new Error(`Scryfall error: ${res.status}`);
  const json = await res.json();
  return { cards: json.data ?? [], nextPage: json.has_more ? json.next_page : null };
}

// ── Fetch one continuation page for background loading ────────────────────────
export async function fetchContinuationPage(pageUrl, options = {}) {
  const { signal } = options;
  let res;
  try {
    res = await fetch(pageUrl, { headers: { "User-Agent": UA }, signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    return { cards: [], nextPage: null };
  }
  if (!res.ok) return { cards: [], nextPage: null };
  const json = await res.json();
  return { cards: json.data ?? [], nextPage: json.has_more ? json.next_page : null };
}

// ── Swipe screen fetch — up to 175 cards, paginated ──────────────────────────
export async function fetchForSwipe(query, commanderCard = null, options = {}) {
  const { signal } = options;
  const CAP = 175;
  const results = [];
  const baseQuery = query + " -type:sticker -type:attraction";
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(baseQuery)}&order=random&unique=cards`;

  while (url && results.length < CAP) {
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA }, signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new Error("Network error.");
    }
    if (res.status === 404) throw new Error("No cards found for that query.");
    if (res.status === 400 || res.status === 422) {
      const json = await res.json().catch(() => ({}));
      throw invalidQueryError(json.details);
    }
    if (!res.ok) throw new Error(`Scryfall error: ${res.status}`);
    const json = await res.json();
    results.push(...(json.data ?? []));
    url = json.has_more && results.length < CAP ? json.next_page : null;
    if (url) await sleep(100);
  }

  return results.slice(0, CAP);
}

// ── Full paginator (kept for existing usage) ──────────────────────────────────
const BACKOFF_429 = 30000;
const PAGE_DELAY  = 500;
export const EJECT_THRESHOLD = 500;
export const HARD_CAP        = 1000;

export async function fetchAllCards(query, onProgress, options = {}) {
  const { signal } = options;
  const all = [];
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`;
  let total = null;

  while (url) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA }, signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new Error("Network error fetching cards.");
    }
    if (res.status === 429) { await sleep(BACKOFF_429); continue; }
    if (!res.ok) { if (res.status === 404) break; throw new Error(`Scryfall error: ${res.status}`); }

    const json = await res.json();
    if (total === null) total = json.total_cards ?? null;
    all.push(...(json.data ?? []));

    if (all.length >= HARD_CAP) {
      onProgress?.({ done: all.length, total: total ?? all.length, partial: [...all], finished: true, autoEjected: true });
      return all;
    }

    const ejectable = all.length >= EJECT_THRESHOLD;
    onProgress?.({ done: all.length, total: total ?? all.length, partial: [...all], ejectable, finished: false });
    url = json.has_more ? json.next_page : null;
    if (url) await sleep(PAGE_DELAY);
  }

  onProgress?.({ done: all.length, total: all.length, partial: [...all], finished: true });
  return all;
}

// ── Query builder ─────────────────────────────────────────────────────────────
export function buildQuery(filters) {
  const parts = [];
  if (filters.name?.trim())   parts.push(`name:"${filters.name.trim()}"`);
  if (filters.oracle?.trim()) parts.push(`o:"${filters.oracle.trim()}"`);
  if (filters.colorIdentity && filters.colorIdentity.length > 0)
    parts.push(`id:${filters.colorIdentity.join("")}`);
  if (filters.colors && filters.colors.selected.length > 0) {
    const joined = filters.colors.selected.join("");
    const mode   = filters.colors.mode;
    if (mode === "exact")       parts.push(`c=${joined}`);
    else if (mode === "subset") parts.push(`c<=${joined}`);
    else                        parts.push(`c:${joined}`);
  }
  if (filters.colors?.colorless) parts.push("c:c");
  if (filters.tags && filters.tags.length > 0)  filters.tags.forEach(t => parts.push(t));
  if (filters.types && filters.types.length > 0) filters.types.forEach(t => parts.push(`t:${t}`));
  if (filters.cmc?.value !== "" && filters.cmc?.value !== undefined) {
    const op = filters.cmc.op || "=";
    parts.push(`cmc${op}${filters.cmc.value}`);
  }
  if (filters.format)           parts.push(`f:${filters.format}`);
  if (filters.freetext?.trim()) parts.push(filters.freetext.trim());
  return parts.join(" ");
}
