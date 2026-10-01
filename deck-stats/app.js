import { loadFonts, layoutCard, renderSVG, renderPDF, PAPERS } from "./card.js";
import { GAME_STYLES, MAX_TAGS } from "./tags.js";

const $ = sel => document.querySelector(sel);

const state = { mode: "url", stats: null, gameStyle: "", tags: [], paper: "letter" };

const fontsReady = loadFonts();

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

// ── Analyze ─────────────────────────────────────────────────────────────────
$("#deck-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#analyze");
  setError(null);
  let body;
  try { body = requestBody(); } catch (err) { setError(err.message); return; }
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
    state.stats = json;
    $("#editor").hidden = false;
    render();
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
    state.gameStyle = state.gameStyle === value ? "" : value;
    render();
  });
  styleRow.append(b);
}

// ── Play style: up to three, typed + enter ──────────────────────────────────
$("#tag-input").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  // Lowercase, like every other label on the card ("casual", "trash magic").
  const v = e.target.value.trim().toLowerCase();
  if (v && state.tags.length < MAX_TAGS && !state.tags.includes(v)) {
    state.tags.push(v);
  }
  e.target.value = "";
  render();
});

// ── Paper + download ────────────────────────────────────────────────────────
const paperRow = $("#papers");
for (const [key, p] of Object.entries(PAPERS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = p.label;
  b.dataset.value = key;
  b.addEventListener("click", () => { state.paper = key; render(); });
  paperRow.append(b);
}

$("#download").addEventListener("click", () => {
  if (!state.stats) return;
  const doc = renderPDF(layoutCard(cardStats()), state.paper);
  const slug = (cardStats().title || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`deck-stats-${slug}.pdf`);
});

// ── Render ──────────────────────────────────────────────────────────────────
function cardStats() {
  const s = state.stats;
  return {
    // The commander is the name on the card, as on the magikdex cards; a
    // partner pair prints both. The deck's own name is the fallback.
    title: s.commanders?.length ? s.commanders.join(" // ") : s.name,
    score: s.score,
    bracket: s.bracket,
    vectors: s.vectors,
    // Falls back to ScryCheck itself if a response ever lacks a page link:
    // the link back is part of the attribution term, not optional.
    qrUrl: s.deckUrl || s.sourceUrl || "https://scrycheck.com/",
    catalogSeed: s.sourceUrl || `${s.commanders?.join("|")}|${s.name}`,
    gameStyleLabel: GAME_STYLES.find(([v]) => v === state.gameStyle)?.[1] ?? null,
    tags: state.tags,
  };
}

function render() {
  for (const b of styleRow.children) b.classList.toggle("on", b.dataset.value === state.gameStyle);
  for (const b of paperRow.children) b.classList.toggle("on", b.dataset.value === state.paper);

  const list = $("#tags");
  list.replaceChildren(...state.tags.map(tag => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip on";
    b.textContent = `${tag} ×`;
    b.setAttribute("aria-label", `Remove ${tag}`);
    b.addEventListener("click", () => { state.tags = state.tags.filter(t => t !== tag); render(); });
    return b;
  }));
  $("#tag-input").hidden = state.tags.length >= MAX_TAGS;

  if (state.stats) $("#preview").innerHTML = renderSVG(layoutCard(cardStats()));
}

render();
