import { loadFonts, layoutCard, layoutSheet, renderSheetSVG, renderSheetPDF, PAPERS, MAX_CARDS } from "./card.js";
import { GAME_STYLES, MAX_TAGS } from "./tags.js";

const $ = sel => document.querySelector(sel);

// The sheet: up to nine decks, each with its own game style and tags. `sel` is
// the card the style/tag controls are editing.
const state = { mode: "url", cards: [], sel: -1, paper: "letter" };

// ── Kept in this browser, so a refresh doesn't throw away a half-built sheet.
// A convenience only: storage can be blocked or empty, and the page works
// without it.
const STORE_KEY = "deck-stats:sheet:v1";

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ cards: state.cards, paper: state.paper }));
  } catch { /* storage unavailable */ }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (Array.isArray(saved?.cards)) state.cards = saved.cards.slice(0, MAX_CARDS);
    if (PAPERS[saved?.paper]) state.paper = saved.paper;
    state.sel = state.cards.length - 1;
  } catch { /* storage unavailable or corrupt */ }
}

const fontsReady = loadFonts();
const current = () => state.cards[state.sel] ?? null;

// ── Input mode: a deck link, or a pasted list ───────────────────────────────
for (const b of $("#modes").children) {
  b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    for (const x of $("#modes").children) x.classList.toggle("on", x === b);
    for (const pane of document.querySelectorAll("[data-pane]")) pane.hidden = pane.dataset.pane !== state.mode;
    setError(null);
  });
}

function requestBody() {
  if (state.mode === "url") {
    const url = $("#deck-url").value.trim();
    if (!url) throw new Error("Paste a Moxfield or Archidekt deck link.");
    return { url };
  }
  const commanders = [$("#commander").value, $("#partner").value].map(s => s.trim()).filter(Boolean);
  const deckList = $("#deck-list").value.trim();
  if (!commanders.length) throw new Error("Name your commander.");
  if (!deckList) throw new Error("Paste your deck list.");
  return { commanders, deckList, deckName: commanders.join(" & ") };
}

function clearInputs() {
  for (const id of ["#deck-url", "#commander", "#partner", "#deck-list"]) $(id).value = "";
}

// ── Analyze: each deck becomes the next card on the sheet ───────────────────
$("#deck-form").addEventListener("submit", async e => {
  e.preventDefault();
  setError(null);
  // Checked before calling ScryCheck, so a full sheet never spends a request.
  if (state.cards.length >= MAX_CARDS) {
    setError(`The sheet is full (${MAX_CARDS}). Download it, or remove a deck.`);
    return;
  }
  let body;
  try { body = requestBody(); } catch (err) { setError(err.message); return; }

  const btn = $("#analyze");
  btn.disabled = true;
  btn.textContent = "analyzing…";
  try {
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
    state.cards.push({ stats: json, gameStyle: "", tags: [] });
    state.sel = state.cards.length - 1;
    clearInputs();
    commit();
    $("#editor").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "analyze";
  }
});

function setError(msg) {
  const el = $("#error");
  el.hidden = !msg;
  el.textContent = msg ?? "";
}

// ── Game style: one of four, tap the active one to clear it ─────────────────
const styleRow = $("#game-styles");
for (const [value, label] of GAME_STYLES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = label;
  b.dataset.value = value;
  b.addEventListener("click", () => {
    const card = current();
    if (!card) return;
    card.gameStyle = card.gameStyle === value ? "" : value;
    commit();
  });
  styleRow.append(b);
}

// ── Play style: up to three, typed + enter ──────────────────────────────────
$("#tag-input").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const card = current();
  // Lowercase, like every other label on the card ("casual", "trash magic").
  const v = e.target.value.trim().toLowerCase();
  if (card && v && card.tags.length < MAX_TAGS && !card.tags.includes(v)) card.tags.push(v);
  e.target.value = "";
  commit();
});

// ── Paper + download ────────────────────────────────────────────────────────
const paperRow = $("#papers");
for (const [key, p] of Object.entries(PAPERS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = p.label;
  b.dataset.value = key;
  b.addEventListener("click", () => { state.paper = key; commit(); });
  paperRow.append(b);
}

$("#download").addEventListener("click", () => {
  if (!state.cards.length) return;
  const doc = renderSheetPDF(sheet());
  const name = state.cards.length === 1
    ? (cardStats(state.cards[0]).title || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : `sheet-${state.cards.length}`;
  doc.save(`deck-stats-${name}.pdf`);
});

// ── Render ──────────────────────────────────────────────────────────────────
function cardStats(card) {
  const s = card.stats;
  return {
    // The commander is the name on the card; a partner pair prints both. The
    // deck's own name is the fallback.
    title: s.commanders?.length ? s.commanders.join(" // ") : s.name,
    score: s.score,
    bracket: s.bracket,
    vectors: s.vectors,
    // Falls back to ScryCheck itself if a response ever lacks a page link:
    // the link back is part of the attribution term, not optional.
    qrUrl: s.deckUrl || s.sourceUrl || "https://scrycheck.com/",
    catalogSeed: s.sourceUrl || `${s.commanders?.join("|")}|${s.name}`,
    gameStyleLabel: GAME_STYLES.find(([v]) => v === card.gameStyle)?.[1] ?? null,
    tags: card.tags,
  };
}

const sheet = () => layoutSheet(state.cards.map(c => layoutCard(cardStats(c))), state.paper);

function commit() {
  save();
  render();
}

function chip(text, on, onClick, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = on ? "chip on" : "chip";
  b.textContent = text;
  if (label) b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

function render() {
  const card = current();
  $("#editor").hidden = !state.cards.length;
  $("#count").textContent = `${state.cards.length} / ${MAX_CARDS}`;
  $("#analyze").textContent = state.cards.length ? "analyze + add to sheet" : "analyze";

  // The decks on the sheet, in print order. Tap one to edit it.
  $("#deck-list-rows").replaceChildren(...state.cards.map((c, i) => {
    const row = document.createElement("div");
    row.className = i === state.sel ? "deck-row on" : "deck-row";
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "deck-pick";
    pick.textContent = `${i + 1}. ${cardStats(c).title || "untitled deck"}`;
    pick.addEventListener("click", () => { state.sel = i; render(); });
    const del = chip("×", false, () => {
      state.cards.splice(i, 1);
      state.sel = Math.min(state.sel, state.cards.length - 1);
      commit();
    }, `Remove ${cardStats(c).title}`);
    row.append(pick, del);
    return row;
  }));

  for (const b of styleRow.children) b.classList.toggle("on", b.dataset.value === card?.gameStyle);
  for (const b of paperRow.children) b.classList.toggle("on", b.dataset.value === state.paper);

  $("#tags").replaceChildren(...(card?.tags ?? []).map(tag =>
    chip(`${tag} ×`, true, () => { card.tags = card.tags.filter(t => t !== tag); commit(); }, `Remove ${tag}`),
  ));
  $("#tag-input").hidden = !card || card.tags.length >= MAX_TAGS;
  $("#editing").textContent = card ? `editing ${state.sel + 1}. ${cardStats(card).title}` : "";

  if (state.cards.length) $("#preview").innerHTML = renderSheetSVG(sheet());
}

restore();
fontsReady.then(render, () => setError("The card fonts failed to load. Refresh to try again."));
