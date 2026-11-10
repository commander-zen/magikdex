// The sheet page (sheet.html): up to nine decks' Bracket Cards on one page,
// 3 × 3, like a proxy sheet (Ben: "i print proxy cards and its always 9 to a
// page"). Its own list, separate from the card page's deck.
import { renderPDF, renderSheetSVG, MAX_CARDS } from "./card.js";
import {
  $, KEYS, load, store, loadPaper, fontsReady, chip, cardStats, sheetFor,
  paperPicker, deckForm, styleEditor,
} from "./common.js";
import { GAME_STYLES } from "./tags.js";

const saved = load(KEYS.sheet);
const state = {
  cards: (Array.isArray(saved?.cards) ? saved.cards : []).slice(0, MAX_CARDS),
  sel: -1,   // the deck whose game style and play style are open
  paper: loadPaper(),
};
state.sel = state.cards.length - 1;

function commit() {
  store(KEYS.sheet, { cards: state.cards });
  render();
}

const full = () => state.cards.length >= MAX_CARDS;
const form = deckForm($("#deck-form"), {
  label: () => (state.cards.length ? "Add to sheet" : "Add the first deck"),
  // Checked before calling ScryCheck, so a full sheet never spends a request.
  check: () => (full() ? `The sheet is full (${MAX_CARDS}). Remove a deck to add another.` : null),
  onCard(card) {
    state.cards.push(card);
    state.sel = state.cards.length - 1;
    commit();
  },
});

// One editor, moved under whichever deck is open.
const editor = document.createElement("div");
editor.className = "row-editor";
const renderStyles = styleEditor(editor, { get: () => state.cards[state.sel] ?? null, onChange: commit });
const renderPaper = paperPicker($("#papers"), () => state.paper, p => { state.paper = p; render(); });

$("#download").addEventListener("click", () => {
  if (!state.cards.length) return;
  renderPDF([sheetFor(state.cards, state.paper)]).save(`bracket-card-sheet-${state.cards.length}.pdf`);
});

// "cEDH · storm, combo": what the owner said, so a closed row still shows it.
const said = card => [GAME_STYLES.find(([v]) => v === card.gameStyle)?.[1], ...card.tags].filter(Boolean).join(" · ");

function deckRow(card, i) {
  const row = document.createElement("div");
  row.className = i === state.sel ? "deck-row on" : "deck-row";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "deck-open";
  open.setAttribute("aria-expanded", String(i === state.sel));
  const name = document.createElement("span");
  name.className = "deck-name";
  name.textContent = `${i + 1}. ${cardStats(card).title || "untitled deck"}`;
  const sub = document.createElement("span");
  sub.className = "deck-sub";
  sub.textContent = said(card) || "Add a game style and play style";
  open.append(name, sub);
  open.addEventListener("click", () => { state.sel = state.sel === i ? -1 : i; render(); });
  const del = chip("×", false, () => {
    state.cards.splice(i, 1);
    state.sel = Math.min(state.sel, state.cards.length - 1);
    commit();
  }, `Remove ${cardStats(card).title}`);
  row.append(open, del);
  return row;
}

function render() {
  const n = state.cards.length;
  form.setLabel(n ? "Add to sheet" : "Add the first deck");
  $("#count").textContent = `${n} of ${MAX_CARDS}`;
  $("#decks").hidden = !n;
  $("#print").hidden = !n;
  $("#deck-rows").replaceChildren(...state.cards.flatMap((card, i) =>
    i === state.sel ? [deckRow(card, i), editor] : [deckRow(card, i)]));
  renderStyles();
  if (!n) return;
  $("#preview").innerHTML = renderSheetSVG(sheetFor(state.cards, state.paper));
  renderPaper();
}

fontsReady.then(render, () => form.setError("The card fonts failed to load. Refresh to try again."));
