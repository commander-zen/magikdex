// The card page (index.html): one deck in, its Bracket Card out (Ben,
// 2026-11-10: "user puts in a link or pastes in a decklist and gets a
// [card]"). The sheet of nine and the play test print are their own pages.
import { renderPDF, MAX_CARDS } from "./card.js";
import {
  $, KEYS, load, store, loadPaper, fontsReady, slug, cardStats, cardSVG, sheetFor,
  paperPicker, deckForm, styleEditor,
} from "./common.js";

const state = { card: load(KEYS.deck)?.card ?? null, paper: loadPaper() };

function commit() {
  store(KEYS.deck, { card: state.card });
  render();
}

const form = deckForm($("#deck-form"), {
  label: () => (state.card ? "Make a new card" : "Make my Bracket Card"),
  onCard(card) {
    state.card = card;   // one deck, one card: a new deck replaces it
    $("#sheet-note").hidden = true;
    commit();
    $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
  },
});

const renderStyles = styleEditor($("#style"), { get: () => state.card, onChange: commit });
const renderPaper = paperPicker($("#papers"), () => state.paper, p => { state.paper = p; render(); });

$("#download").addEventListener("click", () => {
  if (!state.card) return;
  renderPDF([sheetFor([state.card], state.paper)]).save(`bracket-card-${slug(cardStats(state.card).title)}.pdf`);
});

// Copies this deck onto the sheet page's list, then goes there. The same
// grade isn't added twice.
$("#to-sheet").addEventListener("click", () => {
  const sheet = load(KEYS.sheet) ?? {};
  const cards = Array.isArray(sheet.cards) ? sheet.cards : [];
  const same = c => c.stats.gradedAt === state.card.stats.gradedAt && c.stats.deckHash === state.card.stats.deckHash;
  if (!cards.some(same)) {
    if (cards.length >= MAX_CARDS) {
      $("#sheet-note").hidden = false;
      return;
    }
    cards.push(structuredClone(state.card));
    store(KEYS.sheet, { cards });
  }
  location.href = "sheet.html";
});

function render() {
  const card = state.card;
  $("#result").hidden = !card;
  form.setLabel(card ? "Make a new card" : "Make my Bracket Card");
  if (!card) return;
  $("#preview").innerHTML = cardSVG(card);
  $("#undated").hidden = Boolean(card.stats.gradedAt);
  renderStyles();
  renderPaper();
}

// ── A deck sent from magikdex ───────────────────────────────────────────────
// magikdex's "bracket card + proxies" opens this page with the deck in the URL
// fragment (magikdex src/lib/bracketCardLink.js writes it; change both
// together):
//   #bc=z.<base64url(deflate-raw(json))>  or  #bc=j.<base64url(json)>
//   json = { v: 1, c: [commander, partner?], l: "1 Sol Ring\n…" }
// It only FILLS the paste form. Nothing is analyzed until the owner taps, so
// a ScryCheck request is never spent on a link alone.
async function readHandoff() {
  const m = location.hash.match(/^#bc=([zj])\.([A-Za-z0-9_-]+)$/);
  if (!m) return;
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
    form.fill({ commander, partner, list: String(deck.l ?? "") });
    $("#deck-form").scrollIntoView({ block: "start" });
  } catch {
    form.setError("That magikdex link didn't come through. Export the deck again, or paste the list.");
  }
}

fontsReady.then(render, () => form.setError("The card fonts failed to load. Refresh to try again."));
readHandoff();
// If the page is already open in that tab, only the fragment changes, and a
// fragment change doesn't reload the page.
addEventListener("hashchange", readHandoff);
