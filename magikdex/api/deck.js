// GET /api/deck?url=<moxfield-or-archidekt-deck-url>
//
// The one server-side door for deck-URL imports. Both providers block browser
// CORS (verified live 2026-07-09: Moxfield sends no ACAO header at all;
// Archidekt pins ACAO to http://localhost:3000 regardless of Origin), so the
// client can't fetch them directly — this function fetches server-side and
// returns a NORMALIZED, tiny payload instead of the provider's full blob
// (a Moxfield deck JSON runs ~500KB; this returns a few KB):
//
//   { name, commanders: [names], cards: [{ name, quantity, section }] }
//
// section ∈ "decklist" | "maybe" — the app's own deck_cards sections.
// Public read-only data, no credentials → ACAO * so the Vite dev server and
// the Capacitor shell (capacitor://localhost) can call it too.

// Moxfield's Cloudflare adaptively 403s server-side tool traffic (verified
// 2026-07-09: plain "magikdex/1.0" → 403; a Mozilla/5.0-prefixed UA passed
// until repeated probes got the source IP flagged, then everything 403'd).
// Moxfield's actual policy is pre-approved User-Agents for tools — request
// one from Moxfield support and set it as MOXFIELD_UA in Vercel env; until
// then this honest default may or may not pass their filter, and a 403
// surfaces to the user as "paste the text instead". Archidekt has no such
// gate.
const UA = process.env.MOXFIELD_UA || "Mozilla/5.0 magikdex/1.0 (+https://magikdex.vercel.app)";

function parseDeckUrl(url) {
  const mox = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
  if (mox) return { provider: "moxfield", id: mox[1] };
  const arch = url.match(/archidekt\.com\/decks\/(\d+)/i);
  if (arch) return { provider: "archidekt", id: arch[1] };
  return null;
}

// Moxfield v3 (verified live 2026-07-09): boards.<name>.cards is an object
// keyed by internal id; each entry carries quantity + card.name. Only the
// gameplay boards map in; tokens/planes/attractions/etc. are ignored.
async function fetchMoxfield(id) {
  const res = await fetch(`https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(id)}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) return { upstreamError: res.status };
  const d = await res.json();

  const boardCards = (board) => Object.values(d.boards?.[board]?.cards ?? {});
  const toRow = (section) => (e) =>
    e.card?.name ? { name: e.card.name, quantity: e.quantity ?? 1, section } : null;

  const cards = [
    ...boardCards("mainboard").map(toRow("decklist")),
    ...boardCards("maybeboard").map(toRow("maybe")),
    ...boardCards("sideboard").map(toRow("maybe")),
  ].filter(Boolean);
  const commanders = boardCards("commanders").map(e => e.card?.name).filter(Boolean);

  return { deck: { name: d.name ?? "", commanders, cards } };
}

// Archidekt (verified live 2026-07-09 on deck 7031486): flat cards[] with
// categories by NAME; the deck-level categories[] carries includedInDeck.
// A card whose first category is excluded from the deck (or is the
// conventional Maybeboard/Sideboard) goes to "maybe"; the Commander
// category is the commander, not a deck row.
async function fetchArchidekt(id) {
  const res = await fetch(`https://archidekt.com/api/decks/${encodeURIComponent(id)}/`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) return { upstreamError: res.status };
  const d = await res.json();

  const included = new Map((d.categories ?? []).map(c => [c.name, c.includedInDeck !== false]));
  const isMaybeCategory = (name) =>
    /^(maybeboard|sideboard)$/i.test(name ?? "") || included.get(name) === false;

  const commanders = [];
  const cards = [];
  for (const e of d.cards ?? []) {
    const name = e.card?.oracleCard?.name;
    if (!name) continue;
    const cats = e.categories ?? [];
    if (cats.includes("Commander")) { commanders.push(name); continue; }
    cards.push({
      name,
      quantity: e.quantity ?? 1,
      section: cats.some(isMaybeCategory) ? "maybe" : "decklist",
    });
  }

  return { deck: { name: d.name ?? "", commanders, cards } };
}

// ESM (not the usual CommonJS module.exports): this package.json declares
// "type": "module", so Vercel's Node runtime loads api/*.js as ES modules —
// a module.exports here would throw at invocation.
export default async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }

  const parsed = parseDeckUrl(String(req.query.url ?? ""));
  if (!parsed) {
    res.status(400).json({ error: "Not a Moxfield or Archidekt deck URL." });
    return;
  }

  try {
    const result = parsed.provider === "moxfield"
      ? await fetchMoxfield(parsed.id)
      : await fetchArchidekt(parsed.id);
    if (result.notFound) {
      res.status(404).json({ error: "Deck not found — is it public?" });
      return;
    }
    if (result.upstreamError) {
      res.status(502).json({
        error: result.upstreamError === 403
          ? `${parsed.provider} refused the request (bot filter) — paste the deck text instead.`
          : `${parsed.provider} responded ${result.upstreamError}.`,
      });
      return;
    }
    // Deck lists change; cache briefly at the edge so repeat imports of a
    // popular deck don't hammer the provider.
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(result.deck);
  } catch {
    res.status(502).json({ error: `Could not reach ${parsed.provider}.` });
  }
};
