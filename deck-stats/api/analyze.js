// POST /api/analyze  { "url": "<moxfield-or-archidekt-deck-url>" }
//
// Runs a ScryCheck analysis and returns what the card prints.
//
// Lifted from magikdex/api/scrycheck.js. Same rules:
// ⚠️ SCRYCHECK_API_KEY lives in Vercel env and is read ONLY here. ScryCheck's
// terms forbid browser-side calls and committing the key.
//
// ⚠️ THE ONE DIFFERENCE, AND IT MATTERS: magikdex requires a Supabase session
// before it will spend a call. Deck Stats has no accounts, so the controls are
// a per-IP throttle and a per-URL cache. That is a speed bump, not a lock —
// anyone who rotates IPs can still burn the private-beta quota. If ScryCheck
// usage ever looks wrong, this is the door to tighten first.

const SCRYCHECK_ENDPOINT = "https://scrycheck.com/api/v1/analyze";

function isSupportedDeckUrl(raw) {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    return host === "moxfield.com" || host === "archidekt.com";
  } catch {
    return false;
  }
}

const ERROR_MAP = {
  INVALID_REQUEST:         [400, "That deck link didn't look right."],
  UNSUPPORTED_SOURCE:      [400, "ScryCheck reads Moxfield and Archidekt links only."],
  SOURCE_UNAVAILABLE:      [404, "Couldn't read that deck. Is it public?"],
  TEMPORARILY_UNAVAILABLE: [429, "ScryCheck is busy. Try again in a moment."],
  ANALYSIS_FAILED:         [502, "ScryCheck couldn't analyze that deck."],
};

// ── Throttle (per IP) and cache (per deck URL) ──────────────────────────────
// Both in-process: a warm instance remembers, a recycled one forgets. The cache
// is what makes re-tapping "analyze" on the same deck free, which is the
// common case while someone fiddles with their tags.
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10 * 60_000;
const hits = new Map();

function overRateLimit(ip) {
  const now = Date.now();
  const times = (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  times.push(now);
  hits.set(ip, times);
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (!v.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return times.length > RATE_LIMIT;
}

const CACHE_TTL_MS = 6 * 60 * 60_000;
const cache = new Map();

function cached(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  cache.delete(url);
  return null;
}

function remember(url, data) {
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(url, { at: Date.now(), data });
}

// ⚠️ THE VECTOR KEYS ARE NOT THE LABELS. ScryCheck's API says velocity /
// efficiency / lethality where its site shows Speed / Mana base / Threats —
// proven against a live analysis in magikdex. This map is that seam.
function normalize(data) {
  const v = data.vectors ?? {};
  const num = n => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);
  return {
    commanders: Array.isArray(data.commanders) ? data.commanders.filter(Boolean) : [],
    name: data.name ?? null,
    score: data.powerLevel?.level != null ? String(data.powerLevel.level) : null,
    bracket: data.bracket?.number ?? null,
    deckUrl: data.deckUrl ?? null,
    vectors: {
      speed:       num(v.velocity),
      consistency: num(v.consistency),
      interaction: num(v.interaction),
      manaBase:    num(v.efficiency),
      threats:     num(v.lethality),
    },
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const API_KEY = process.env.SCRYCHECK_API_KEY;
  if (!API_KEY) {
    console.error("analyze: missing SCRYCHECK_API_KEY");
    res.status(500).json({ error: "Deck analysis isn't configured on this deploy yet." });
    return;
  }

  const url = String(req.body?.url ?? "").trim();
  if (!isSupportedDeckUrl(url)) {
    res.status(400).json({ error: "Paste a public Moxfield or Archidekt deck link." });
    return;
  }

  const hit = cached(url);
  if (hit) { res.status(200).json(hit); return; }

  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  if (overRateLimit(ip)) {
    res.status(429).json({ error: "That's a lot of decks. Give it a few minutes." });
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
      body: JSON.stringify({ url }),
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

    const stats = normalize(json.data ?? {});
    stats.sourceUrl = url;
    remember(url, stats);
    res.status(200).json(stats);
  } catch (err) {
    console.error("analyze: proxy error", err);
    res.status(502).json({ error: "Couldn't reach ScryCheck." });
  }
};
