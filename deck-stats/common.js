// What the three pages share (Ben, 2026-11-10: a separate page for each job):
//   index.html     one deck → its Bracket Card           (app.js)
//   sheet.html     up to nine decks' cards on one sheet  (sheet.js)
//   playtest.html  one deck's play test cards to print   (playtest.js)
// The card page and the play test page work on the SAME deck ("your deck");
// the sheet keeps its own list, and the card page copies a deck into it.
import { loadFonts, layoutCard, layoutSheet, renderSheetSVG, PAPERS, CARD_MM } from "./card.js";
import { GAME_STYLES, MAX_TAGS } from "./tags.js";

export const $ = sel => document.querySelector(sel);

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

export function chip(text, on, onClick, label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = on ? "chip on" : "chip";
  b.textContent = text;
  if (label) b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

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

// ── Paper: Letter or A4 ─────────────────────────────────────────────────────
// Returns its render function.
export function paperPicker(el, get, set) {
  const buttons = Object.entries(PAPERS).map(([key, p]) => {
    const b = chip(p.label, false, () => { set(key); store(KEYS.paper, key); });
    b.dataset.value = key;
    return b;
  });
  el.replaceChildren(...buttons);
  return () => buttons.forEach(b => b.classList.toggle("on", b.dataset.value === get()));
}

// ── The deck form: a link or a pasted list → a graded card ──────────────────
// Built into `form` (a <form>), so all three pages ask the same way.
// `check()` runs before ScryCheck is called and may return an error message
// (e.g. a full sheet), so a request is never spent on a deck that can't be used.
export function deckForm(form, { label, check = () => null, onCard }) {
  form.innerHTML = `
    <div class="seg" role="group" aria-label="How to add your deck">
      <button type="button" class="on" data-mode="url" aria-pressed="true">Deck link</button>
      <button type="button" data-mode="list" aria-pressed="false">Paste a list</button>
    </div>
    <div class="field" data-pane="url">
      <label for="deck-url">Moxfield or Archidekt link</label>
      <input id="deck-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off"
             placeholder="https://moxfield.com/decks/…">
    </div>
    <div data-pane="list" hidden>
      <div class="field">
        <label for="commander">Commander</label>
        <input id="commander" type="text" autocomplete="off" autocapitalize="words" placeholder="Atraxa, Praetors' Voice">
        <input id="partner" type="text" autocomplete="off" autocapitalize="words" aria-label="Partner"
               placeholder="Partner (optional)" class="stack">
      </div>
      <div class="field">
        <label for="deck-list">Deck list</label>
        <textarea id="deck-list" rows="8" autocomplete="off" autocapitalize="off" spellcheck="false"
                  placeholder="1 Sol Ring&#10;1 Arcane Signet&#10;1 Command Tower&#10;…"></textarea>
        <p class="hint">One card per line, as Moxfield, Archidekt or MTGA export it.</p>
      </div>
    </div>
    <p id="handoff" class="note" hidden>Sent from magıkdex. Check the commander, then make the card.</p>
    <button id="analyze" class="primary" type="submit"></button>
    <p id="error" class="error" role="alert" hidden></p>`;

  let mode = "url";
  const q = sel => form.querySelector(sel);
  const btn = q("#analyze");
  const setLabel = text => { if (!btn.disabled) btn.textContent = text; };
  const setError = msg => { q("#error").hidden = !msg; q("#error").textContent = msg ?? ""; };

  const setMode = m => {
    mode = m;
    for (const b of q(".seg").children) {
      b.classList.toggle("on", b.dataset.mode === m);
      b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    }
    for (const pane of form.querySelectorAll("[data-pane]")) pane.hidden = pane.dataset.pane !== m;
    setError(null);
  };
  for (const b of q(".seg").children) b.addEventListener("click", () => setMode(b.dataset.mode));

  function requestBody() {
    if (mode === "url") {
      const url = q("#deck-url").value.trim();
      if (!url) throw new Error("Paste a Moxfield or Archidekt deck link.");
      return { url };
    }
    const commanders = [q("#commander").value, q("#partner").value].map(s => s.trim()).filter(Boolean);
    const deckList = q("#deck-list").value.trim();
    if (!commanders.length) throw new Error("Name your commander.");
    if (!deckList) throw new Error("Paste your deck list.");
    return { commanders, deckList, deckName: commanders.join(" & ") };
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    setError(null);
    const blocked = check();
    if (blocked) { setError(blocked); return; }
    let body;
    try { body = requestBody(); } catch (err) { setError(err.message); return; }

    btn.disabled = true;
    btn.textContent = "Grading…";
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
      for (const id of ["#deck-url", "#commander", "#partner", "#deck-list"]) q(id).value = "";
      q("#handoff").hidden = true;
      onCard(newCard(json, body.deckList));
    } catch (err) {
      setError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label();
    }
  });

  btn.textContent = label();
  return {
    setLabel,
    setError,
    // Fills the paste form from a deck sent by magikdex; nothing is graded
    // until the owner taps.
    fill({ commander, partner, list }) {
      setMode("list");
      q("#commander").value = commander;
      q("#partner").value = partner;
      q("#deck-list").value = list;
      q("#handoff").hidden = false;
    },
  };
}

// ── Game style + play style: what the owner says about their own deck ──────
// Not optional extras (Ben: "the tags… are a must"): every page that shows a
// card shows these with it. Built into `root`; returns its render function.
export function styleEditor(root, { get, onChange }) {
  root.innerHTML = `
    <div class="field">
      <span class="label" id="style-label">Game style</span>
      <div class="chips" id="game-styles" role="group" aria-labelledby="style-label"></div>
    </div>
    <div class="field">
      <label for="tag-input">Play style <span class="dim">· up to ${MAX_TAGS}</span></label>
      <div class="chips" id="tags"></div>
      <input id="tag-input" type="text" autocomplete="off" autocapitalize="off"
             enterkeyhint="done" placeholder="Search themes, or type one">
      <div class="chips" id="suggestions"></div>
    </div>`;
  const q = sel => root.querySelector(sel);

  // Game style: one of four; tap the active one to clear it.
  const styles = GAME_STYLES.map(([value, text]) => {
    const b = chip(text, false, () => {
      const card = get();
      if (!card) return;
      card.gameStyle = card.gameStyle === value ? "" : value;
      onChange();
    });
    b.dataset.value = value;
    return b;
  });
  q("#game-styles").replaceChildren(...styles);

  // Play style: up to three, lowercase like every other label on the card.
  function addTag(raw) {
    const card = get();
    const v = String(raw ?? "").trim().toLowerCase();
    if (card && v && card.tags.length < MAX_TAGS && !card.tags.includes(v)) card.tags.push(v);
    q("#tag-input").value = "";
    onChange();
  }
  q("#tag-input").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addTag(e.target.value);
  });
  q("#tag-input").addEventListener("input", renderSuggestions);

  // Nothing until you type (Ben, in magikdex: "i dont want all the chips just
  // the search bar"). Then the commander's EDHREC themes that match, in
  // EDHREC's rank order. A card saved before themes existed simply has none.
  function renderSuggestions() {
    const card = get();
    const text = q("#tag-input").value.trim().toLowerCase();
    const hits = (text && card ? (card.stats.themes ?? []) : [])
      .filter(t => t.toLowerCase().includes(text) && !card.tags.includes(t.toLowerCase()))
      .slice(0, 12);
    q("#suggestions").replaceChildren(...hits.map(t => chip(t.toLowerCase(), false, () => addTag(t))));
  }

  return function render() {
    const card = get();
    for (const b of styles) b.classList.toggle("on", b.dataset.value === card?.gameStyle);
    q("#tags").replaceChildren(...(card?.tags ?? []).map(tag =>
      chip(`${tag} ×`, true, () => { card.tags = card.tags.filter(t => t !== tag); onChange(); }, `Remove ${tag}`),
    ));
    q("#tag-input").hidden = !card || card.tags.length >= MAX_TAGS;
    renderSuggestions();
  };
}
