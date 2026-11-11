// What the three pages share (Ben, 2026-11-10: a separate page for each job):
//   index.html     one deck → its Bracket Card           (pages/CardPage.jsx)
//   sheet.html     up to nine decks' cards on one sheet  (pages/SheetPage.jsx)
//   playtest.html  one deck's play test cards to print   (pages/PlaytestPage.jsx)
// The card page and the play test page work on the SAME deck ("your deck");
// the sheet keeps its own list, and the card page copies a deck into it.
import { loadFonts, layoutCard, layoutSheet, renderSheetSVG, PAPERS, CARD_MM } from "./card.js";
import { GAME_STYLES } from "./tags.js";

// ── Kept in this browser, so a refresh doesn't throw away your work ─────────
// A convenience only: storage can be blocked or empty, and every page works
// without it. The keys keep the site's old name on purpose: renaming them
// would drop what is already saved in people's browsers.
export const KEYS = {
  deck: "deck-stats:card:v1",     // { card }: your deck (card + play test pages)
  sheet: "deck-stats:sheet:v1",   // { cards }: the sheet of up to nine
  paper: "deck-stats:paper:v1",   // "letter" | "a4", for every page
};

export function load(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}

export function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// Paper used to live inside the sheet's record; read it from there once.
export function loadPaper() {
  const p = load(KEYS.paper) ?? load(KEYS.sheet)?.paper;
  return PAPERS[p] ? p : "letter";
}

export const fontsReady = loadFonts();

export const slug = s => (s || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// A graded deck. A pasted list is kept: it is what the play test print
// prints. A linked deck gets its list later, on the play test page.
export const newCard = (stats, list) => ({ stats, gameStyle: "", tags: [], list: list ?? null, proxy: { exclude: [], picks: {} } });

export function cardStats(card) {
  const s = card.stats;
  return {
    // The commander is the name on the card; a partner pair prints both. The
    // deck's own name is the fallback.
    title: s.commanders?.length ? s.commanders.join(" // ") : s.name,
    score: s.score,
    bracket: s.bracket,
    vectors: s.vectors,
    // The QR goes to the LIVE decklist (Ben, 2026-11-10): the printed grade is
    // dated, the list it points to stays current. A pasted list has no list
    // page, so it falls back to ScryCheck's analysis, then ScryCheck itself.
    qrUrl: s.sourceUrl || s.deckUrl || "https://scrycheck.com/",
    qrIsList: Boolean(s.sourceUrl),
    gradedAt: s.gradedAt ?? null,
    deckHash: s.deckHash ?? null,
    scoringVersion: s.scoringVersion ?? null,
    gameStyleLabel: GAME_STYLES.find(([v]) => v === card.gameStyle)?.[1] ?? null,
    tags: card.tags,
  };
}

// One card on screen is shown as the card itself, not as a mostly-blank page.
export function cardSVG(card) {
  const { w, h } = CARD_MM;
  return renderSheetSVG({ w, h, cards: [{ x: 0, y: 0, w, h, prims: layoutCard(cardStats(card)) }], lines: [], texts: [] });
}

// The printed page: these decks' cards, 3 × 3, with crop marks and the ruler.
export const sheetFor = (cards, paper) => layoutSheet(cards.map(c => ({ prims: layoutCard(cardStats(c)) })), paper);

// "cEDH · storm, combo": what the owner said about a deck.
export const saidAbout = card => [GAME_STYLES.find(([v]) => v === card.gameStyle)?.[1], ...card.tags].filter(Boolean).join(" · ");

// POST /api/analyze → a new card. Throws an Error whose message is safe to show.
export async function gradeDeck(body) {
  let res;
  try {
    res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the analyzer. Check your connection.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.error ?? `Analysis failed (${res.status}).`);
  await fontsReady;
  return newCard(json, body.deckList);
}

// ── A deck sent from magikdex ───────────────────────────────────────────────
// magikdex's "bracket card + proxies" opens the card page with the deck in the
// URL fragment (magikdex src/lib/bracketCardLink.js writes it; change both
// together):
//   #bc=z.<base64url(deflate-raw(json))>  or  #bc=j.<base64url(json)>
//   json = { v: 1, c: [commander, partner?], l: "1 Sol Ring\n…" }
// Returns null when there is no handoff, { error } when it is broken.
export async function readHandoff() {
  const m = location.hash.match(/^#bc=([zj])\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  // Clear the fragment first, so a refresh doesn't refill a form the owner
  // has since edited.
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const b64 = m[2].replace(/-/g, "+").replace(/_/g, "/");
    let bytes = Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), c => c.charCodeAt(0));
    if (m[1] === "z") {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const deck = JSON.parse(new TextDecoder().decode(bytes));
    const [commander = "", partner = ""] = Array.isArray(deck.c) ? deck.c.map(String) : [];
    if (deck.v !== 1 || !commander) throw new Error("unknown handoff");
    return { commander, partner, list: String(deck.l ?? "") };
  } catch {
    return { error: "That magikdex link didn't come through. Export the deck again, or paste the list." };
  }
}
