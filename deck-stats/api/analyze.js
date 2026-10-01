// POST /api/analyze — runs a ScryCheck analysis and returns what the card prints.
//
// Two request shapes, the same two ScryCheck accepts:
//   { "url": "<moxfield-or-archidekt-deck-url>" }
//   { "deckName": "…", "commanders": ["…"], "deckList": "1 Sol Ring\n…" }
//
// Lifted from magikdex/api/scrycheck.js. Same rules:
// ⚠️ SCRYCHECK_API_KEY lives in Vercel env and is read ONLY here. ScryCheck's
// terms forbid browser-side calls and committing the key.
//
// ⚠️ THE ONE DIFFERENCE, AND IT MATTERS: magikdex requires a Supabase session
// before it will spend a call. Deck Stats has no accounts, so the controls are
// a per-IP throttle, a global cap at ScryCheck's own limit, and a cache. That
// is a speed bump, not a lock — anyone who rotates IPs can still burn the
// private-beta quota. If ScryCheck usage ever looks wrong, tighten this first.

const SCRYCHECK_ENDPOINT = "https://scrycheck.com/api/v1/analyze";

// Pasted lists are capped well above any real Commander list (100 lines of
// "1 Card Name (SET) 123" is ~4k chars) so a junk body never reaches ScryCheck.
const MAX_LIST_CHARS = 20_000;
const MAX_NAME_CHARS = 150;

function isSupportedDeckUrl(raw) {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    return host === "moxfield.com" || host === "archidekt.com";
  } catch {
    return false;
  }
}

const ERROR_MAP = {
  INVALID_REQUEST:         [400, "ScryCheck couldn't read that deck. Check the link or list."],
  UNSUPPORTED_SOURCE:      [400, "ScryCheck reads Moxfield and Archidekt links only."],
  SOURCE_UNAVAILABLE:      [404, "Couldn't read that deck. Is it public?"],
  TEMPORARILY_UNAVAILABLE: [429, "ScryCheck is busy. Try again in a moment."],
  ANALYSIS_FAILED:         [502, "ScryCheck couldn't analyze that deck."],
};

// Turn the request body into exactly what gets sent to ScryCheck, or an error
// message. Only whitelisted fields are forwarded.
function buildPayload(body) {
  const url = String(body?.url ?? "").trim();
  if (url) {
    return isSupportedDeckUrl(url)
      ? { payload: { url } }
      : { error: "Paste a public Moxfield or Archidekt deck link." };
  }

  const deckList = String(body?.deckList ?? "").trim();
  const commanders = (Array.isArray(body?.commanders) ? body.commanders : [])
    .map(c => String(c ?? "").trim()).filter(Boolean);
  const deckName = String(body?.deckName ?? "").trim().slice(0, MAX_NAME_CHARS);

  if (!deckList) return { error: "Paste a deck link or a deck list." };
  if (deckList.length > MAX_LIST_CHARS) return { error: "That list is too long for one Commander deck." };
  if (!commanders.length) return { error: "Name your commander." };
  if (commanders.length > 2 || commanders.some(c => c.length > MAX_NAME_CHARS)) {
    return { error: "One commander, or two for partners." };
  }
  return { payload: { deckName: deckName || commanders.join(" & "), commanders, deckList } };
}

// ── Throttles and cache ─────────────────────────────────────────────────────
// All in-process: a warm instance remembers, a recycled one forgets. The cache
// is what makes re-tapping "analyze" on the same deck free, which is the
// common case while someone fiddles with their tags — and Adam asked that a
// deck only be checked when it actually changes.
const IP_LIMIT = 8;
const IP_WINDOW_MS = 10 * 60_000;
// ScryCheck's limit for the whole key is 10 requests per minute. Stay under it
// here so a burst fails with our message instead of theirs.
const GLOBAL_LIMIT = 9;
const GLOBAL_WINDOW_MS = 60_000;
const hits = new Map();
let globalHits = [];

function overRateLimit(ip) {
  const now = Date.now();
  globalHits = globalHits.filter(t => now - t < GLOBAL_WINDOW_MS);
  if (globalHits.length >= GLOBAL_LIMIT) return "global";
  const times = (hits.get(ip) ?? []).filter(t => now - t < IP_WINDOW_MS);
  if (times.length >= IP_LIMIT) return "ip";
  times.push(now);
  hits.set(ip, times);
  globalHits.push(now);
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (!v.some(t => now - t < IP_WINDOW_MS)) hits.delete(k);
  }
  return null;
}

const CACHE_TTL_MS = 6 * 60 * 60_000;
const cache = new Map();

function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  cache.delete(key);
  return null;
}

function remember(key, data) {
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data });
}

// ⚠️ THE VECTOR KEYS ARE NOT THE LABELS. ScryCheck's API says velocity /
// efficiency / lethality where its site shows Speed / Mana base / Threats —
// proven against a live analysis in magikdex. This map is that seam.
function normalize(data, payload) {
  const v = data.vectors ?? {};
  const num = n => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);
  const commanders = Array.isArray(data.commanders) ? data.commanders.filter(Boolean) : [];
  return {
    commanders: commanders.length ? commanders : (payload.commanders ?? []),
    name: data.name ?? payload.deckName ?? null,
    score: data.powerLevel?.level != null ? String(data.powerLevel.level) : null,
    bracket: data.bracket?.number ?? null,
    // Pasted lists get an analysis page too (verified live 2026-10-01: source
    // "manual", deckUrl scrycheck.com/deck/<hash>).
    deckUrl: data.deckUrl ?? null,
    sourceUrl: payload.url ?? null,
    vectors: {
      speed:       num(v.velocity),
      consistency: num(v.consistency),
      interaction: num(v.interaction),
      manaBase:    num(v.efficiency),
      threats:     num(v.lethality),
    },
  };
}

// EDHREC's themes for the deck's commander(s), as play-style suggestions.
//
// Read from magikdex's own cache (cards + legend_themes in Supabase, both
// world-readable with the publishable anon key). EDHREC's feed is unofficial
// and is never called at request time (DATA_SOURCES.md); the cache is
// refreshed by magikdex's `ingest:legend-edhrec`.
//
// Suggestions only. A miss of any kind is an empty list, never an error: the
// card prints fine and free text still works.
async function themesFor(commanders) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key || !commanders.length) return [];
  const get = async path => {
    const res = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    return res.ok ? res.json() : [];
  };
  const oracleIdOf = async name => {
    const lower = name.toLowerCase();
    let rows = await get(`cards?select=oracle_id&name_lower=eq.${encodeURIComponent(lower)}&limit=1`);
    // ScryCheck may name a double-faced commander by its front face alone.
    if (!rows.length && !lower.includes("//")) {
      rows = await get(`cards?select=oracle_id&name_lower=like.${encodeURIComponent(`${lower} //*`)}&limit=1`);
    }
    return rows[0]?.oracle_id ?? null;
  };
  try {
    const lists = await Promise.all(commanders.map(async name => {
      const id = await oracleIdOf(name);
      if (!id) return [];
      const rows = await get(`legend_themes?select=theme_name,theme_slug&legend_oracle_id=eq.${id}&order=rank.asc&limit=200`);
      return rows.map(t => t.theme_name || t.theme_slug).filter(Boolean);
    }));
    // Partners: interleave the two ranked lists so both commanders' top
    // themes come first, then drop repeats.
    const out = [];
    for (let i = 0; i < Math.max(...lists.map(l => l.length), 0); i++) {
      for (const l of lists) if (l[i] && !out.some(t => t.toLowerCase() === l[i].toLowerCase())) out.push(l[i]);
    }
    return out;
  } catch {
    return [];
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const API_KEY = process.env.SCRYCHECK_API_KEY;
  if (!API_KEY) {
    console.error("analyze: missing SCRYCHECK_API_KEY");
    res.status(500).json({ error: "Deck analysis isn't configured on this deploy yet." });
    return;
  }

  const { payload, error } = buildPayload(req.body);
  if (error) { res.status(400).json({ error }); return; }

  const cacheKey = JSON.stringify(payload);
  const hit = cached(cacheKey);
  if (hit) { res.status(200).json(hit); return; }

  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  const limited = overRateLimit(ip);
  if (limited) {
    res.status(429).json({
      error: limited === "global"
        ? "Lots of decks being checked right now. Try again in a minute."
        : "That's a lot of decks. Give it a few minutes.",
    });
    return;
  }

  try {
    const apiRes = await fetch(SCRYCHECK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "X-ScryCheck-API-Key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // A bare 404 from ScryCheck means the key is wrong, never "deck not found".
    if (apiRes.status === 404) {
      console.error("analyze: 404 from ScryCheck, check SCRYCHECK_API_KEY");
      res.status(500).json({ error: "Deck analysis isn't configured on this deploy yet." });
      return;
    }

    let json;
    try { json = await apiRes.json(); }
    catch { res.status(502).json({ error: "Unexpected response from ScryCheck." }); return; }

    if (!json || json.success === false) {
      const [status, message] = ERROR_MAP[json?.error?.code] ?? [502, "Analysis failed. Try again."];
      res.status(status).json({ error: message });
      return;
    }

    const stats = normalize(json.data ?? {}, payload);
    stats.themes = await themesFor(stats.commanders);
    remember(cacheKey, stats);
    res.status(200).json(stats);
  } catch (err) {
    console.error("analyze: proxy error", err);
    res.status(502).json({ error: "Couldn't reach ScryCheck." });
  }
};
