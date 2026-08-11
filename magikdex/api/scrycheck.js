// POST /api/scrycheck  { "url": "<moxfield-or-archidekt-deck-url>" }
//
// The one server-side door to ScryCheck's private-beta API. Runs a deck
// analysis and returns a NORMALIZED payload the client can write straight onto
// its decks row.
//
// ⚠️ THE KEY IS THE WHOLE REASON THIS FILE EXISTS. ScryCheck's terms forbid
// browser-side calls and forbid committing the key, so SCRYCHECK_API_KEY lives
// in Vercel env and is read only here. It must NEVER be given a VITE_ prefix —
// anything VITE_-prefixed is inlined into the client bundle and shipped to
// every visitor. This repo has already deleted one function that made that
// mistake (src/services/brewPrompt.js, a VITE_ANTHROPIC_API_KEY calling
// Anthropic from the browser; it only never leaked because nothing imported it).
//
// ⚠️ AND IT IS AUTHENTICATED AND THROTTLED, unlike its predecessor. Pod Check
// ships the same proxy wide open, and its own HARDENING.md files that as H1:
// anyone can loop over public deck ids and burn the quota, where the real
// damage is "ScryCheck revoking your private-beta key or the relationship".
// Every call here costs a favour, so every call must be attributable.

const SCRYCHECK_ENDPOINT = "https://scrycheck.com/api/v1/analyze";

// Same two hosts ScryCheck accepts, checked here so an unsupported link never
// reaches them at all.
function isSupportedDeckUrl(raw) {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    return host === "moxfield.com" || host === "archidekt.com";
  } catch {
    return false;
  }
}

// ScryCheck error code → [http status, user-facing message]. Their codes are
// stable; the copy is ours.
const ERROR_MAP = {
  INVALID_REQUEST:         [400, "That deck link didn't look right."],
  UNSUPPORTED_SOURCE:      [400, "ScryCheck reads Moxfield and Archidekt links only."],
  SOURCE_UNAVAILABLE:      [404, "Couldn't read that deck — is it public?"],
  TEMPORARILY_UNAVAILABLE: [429, "ScryCheck is busy. Try again in a moment."],
  ANALYSIS_FAILED:         [502, "ScryCheck couldn't analyze that deck."],
};

// ── Throttle ────────────────────────────────────────────────────────────────
// Per-user, in-process. Serverless instances are recycled, so this is a speed
// bump rather than a guarantee — but combined with requiring a real session it
// turns "loop over public deck ids" into "create N accounts first", which is a
// different kind of effort. Keep the window generous: a person grading their
// own decks will never notice it.
const RATE_LIMIT = 10;              // analyses …
const RATE_WINDOW_MS = 10 * 60_000; // … per user per 10 minutes
const hits = new Map();

function overRateLimit(userId) {
  const now = Date.now();
  const times = (hits.get(userId) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  times.push(now);
  hits.set(userId, times);
  // Unbounded growth would be a slow leak on a warm instance; drop cold users.
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return times.length > RATE_LIMIT;
}

// Verify the caller holds a real Supabase session by asking Supabase, rather
// than by decoding the JWT here — no secret to hold, no signature code to get
// wrong, and a revoked session stops working immediately.
async function verifyUser(token, supabaseUrl, anonKey) {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

// Map ScryCheck's response onto the columns magikdex stores (034 + 035).
//
// ⚠️ THE VECTOR KEYS ARE NOT THE LABELS. ScryCheck's API says velocity /
// efficiency / lethality where the site shows Speed / Mana base / Threats.
// Proven, not assumed: a live analysis returned velocity 96, consistency 96,
// interaction 88, efficiency 87, lethality 94, and the site's own page for that
// same analysis printed SPEED 96, CONSISTENCY 96, INTERACTION 88, MANA BASE 87,
// THREATS 94 — and renders both vocabularies side by side in its re-score diff.
// Our columns follow the LABELS, because those are the words a user sees when
// they type the numbers in by hand. This map is the seam between the two.
function normalize(data) {
  const v = data.vectors ?? {};
  const num = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);
  return {
    commander: data.commanders?.[0] ?? data.name ?? null,
    // The overall 1-10 rating, kept as text — it mirrors somebody else's rubric
    // (see 030). Never a sixth vector.
    score: data.powerLevel?.level != null ? String(data.powerLevel.level) : null,
    tier: data.powerLevel?.label ?? data.powerLevel?.tier ?? null,
    bracket: data.bracket?.number ?? null,
    // The tap-through target: a permanent, publicly viewable analysis page.
    deckUrl: data.deckUrl ?? null,
    // A cached score is only valid for the version that produced it — observed
    // live: a re-score moved one vector 88 → 87.
    scoringVersion: data.scoringVersion ?? null,
    vectors: {
      speed:       num(v.velocity),
      consistency: num(v.consistency),
      interaction: num(v.interaction),
      manaBase:    num(v.efficiency),
      threats:     num(v.lethality),
    },
    incomplete: data.incomplete === true,
  };
}

// ESM, not CommonJS: package.json declares "type": "module", so Vercel's Node
// runtime loads api/*.js as ES modules (same note as api/deck.js).
export default async (req, res) => {
  // ACAO * like /api/deck, because the Capacitor shell (capacitor://localhost)
  // and the Vite dev server are both cross-origin against the deployment and
  // would otherwise be unable to call this at all.
  //
  // That costs nothing here: CORS IS NOT AN ACCESS CONTROL. It constrains
  // browsers and is ignored entirely by curl or any server, so locking it down
  // would have blocked the native app while stopping no abuse whatsoever. The
  // real controls are the session requirement and the throttle below.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const API_KEY = process.env.SCRYCHECK_API_KEY;
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  if (!API_KEY || !SUPABASE_URL || !ANON_KEY) {
    console.error("scrycheck: missing SCRYCHECK_API_KEY / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
    res.status(500).json({ error: "Deck grading isn't configured on this deploy yet." });
    return;
  }

  const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token) { res.status(401).json({ error: "Sign-in required." }); return; }
  const userId = await verifyUser(token, SUPABASE_URL, ANON_KEY);
  if (!userId) { res.status(401).json({ error: "Sign-in required." }); return; }

  if (overRateLimit(userId)) {
    res.status(429).json({ error: "That's a lot of grading — give it a few minutes." });
    return;
  }

  const url = String(req.body?.url ?? "").trim();
  if (!isSupportedDeckUrl(url)) {
    res.status(400).json({ error: "ScryCheck reads public Moxfield or Archidekt deck links." });
    return;
  }

  try {
    const apiRes = await fetch(SCRYCHECK_ENDPOINT, {
      method: "POST",
      headers: {
        // ScryCheck documents both forms; send both so a strict parser on
        // either one works (matching pod-check's proxy).
        Authorization: `Bearer ${API_KEY}`,
        "X-ScryCheck-API-Key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    // A bare 404 from ScryCheck means the key is missing or wrong — intentional
    // on their side. Never surface it as "deck not found"; that would send the
    // user hunting for a problem with their deck that doesn't exist.
    if (apiRes.status === 404) {
      console.error("scrycheck: 404 from the API — check SCRYCHECK_API_KEY");
      res.status(500).json({ error: "Deck grading isn't configured on this deploy yet." });
      return;
    }

    let json;
    try { json = await apiRes.json(); }
    catch { res.status(502).json({ error: "Unexpected response from ScryCheck." }); return; }

    if (!json || json.success === false) {
      const code = json?.error?.code;
      const [status, message] = ERROR_MAP[code] ?? [502, "Deck grading failed. Try again."];
      res.status(status).json({ error: message });
      return;
    }

    res.status(200).json(normalize(json.data ?? {}));
  } catch (err) {
    console.error("scrycheck: proxy error", err);
    res.status(502).json({ error: "Couldn't reach ScryCheck." });
  }
};
