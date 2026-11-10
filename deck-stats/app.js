import { loadFonts, layoutCard, layoutSheet, renderSheetSVG, renderPDF, PAPERS, MAX_CARDS, PROXY_MM } from "./card.js";
import { GAME_STYLES, MAX_TAGS } from "./tags.js";
import { parseList, resolveRows, printingsOf, proxyItems, fetchImages, faces, isBasicLand, nameKey } from "./proxies.js";

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
  $("#handoff").hidden = true;
}

// ── A deck sent from magikdex ───────────────────────────────────────────────
// magikdex's "bracket card + proxies" opens this page with the deck in the URL
// fragment (magikdex src/lib/deckStatsLink.js writes it; change both
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
    $('[data-mode="list"]').click();
    $("#commander").value = commander;
    $("#partner").value = partner;
    $("#deck-list").value = String(deck.l ?? "");
    $("#handoff").hidden = false;
    $("#deck-form").scrollIntoView({ block: "start" });
  } catch {
    setError("That magikdex link didn't come through. Export the deck again, or paste the list.");
  }
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
    // A pasted list is kept: it is what the proxy print prints. A linked deck
    // gets its list later, in the proxy panel.
    state.cards.push({ stats: json, gameStyle: "", tags: [], list: body.deckList ?? null, proxy: { exclude: [], picks: {} } });
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

// ── Play style: up to three. EDHREC suggestions, or typed + enter ──────────
// Lowercase, like every other label on the card ("casual", "trash magic").
function addTag(raw) {
  const card = current();
  const v = String(raw ?? "").trim().toLowerCase();
  if (card && v && card.tags.length < MAX_TAGS && !card.tags.includes(v)) card.tags.push(v);
  $("#tag-input").value = "";
  commit();
}

$("#tag-input").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  addTag(e.target.value);
});
$("#tag-input").addEventListener("input", renderSuggestions);

// Nothing until you type (Ben, in magikdex: "i dont want all the chips just
// the search bar"). Then the commander's EDHREC themes that match, in
// EDHREC's rank order. A card saved before themes existed simply has none.
function renderSuggestions() {
  const card = current();
  const q = $("#tag-input").value.trim().toLowerCase();
  const themes = q && card ? (card.stats.themes ?? []) : [];
  const hits = themes
    .filter(t => t.toLowerCase().includes(q) && !card.tags.includes(t.toLowerCase()))
    .slice(0, 12);
  $("#suggestions").replaceChildren(...hits.map(t => chip(t.toLowerCase(), false, () => addTag(t))));
}

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

const slug = s => (s || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

$("#download").addEventListener("click", () => {
  if (!state.cards.length) return;
  const doc = renderPDF([sheet()]);
  const name = state.cards.length === 1 ? slug(cardStats(state.cards[0]).title) : `sheet-${state.cards.length}`;
  doc.save(`deck-stats-${name}.pdf`);
});

// ── Proxies: print the selected deck, mtgprint-style ────────────────────────
// Ben's reference is mtgprint.net (see proxies.js). One PDF: the deck's
// Bracket Card first, then every card in its list at 63 × 88 mm, 9 per page.
// The resolved Scryfall cards live only in memory (refetched after a
// refresh); what is saved with the deck is its list, the cards left out and
// the printings picked.
const proxy = { deck: null, rows: null, busy: false, error: null, editing: false, picking: null, prints: null };
const closeProxy = () => Object.assign(proxy, { deck: null, rows: null, busy: false, error: null, editing: false, picking: null, prints: null });

function proxyPrefs(card) {
  card.proxy ??= { exclude: [], picks: {} };
  return card.proxy;
}

// The commander has to print too, and a pasted list often leaves it out,
// since deckStats asks for the commander in its own field.
function deckRows(card) {
  const rows = parseList(card.list);
  const have = new Set(rows.map(r => r.key));
  const missing = (card.stats.commanders ?? [])
    .filter(n => !have.has(nameKey(n)))
    .map(name => ({ key: nameKey(name), name, qty: 1, set: null, cn: null }));
  return [...missing, ...rows];
}

async function loadProxies() {
  const card = current();
  if (!card?.list) return;
  Object.assign(proxy, { deck: card, rows: null, busy: true, error: null, editing: false, picking: null });
  renderProxy();
  try {
    const rows = await resolveRows(deckRows(card), proxyPrefs(card).picks);
    if (proxy.deck === card) proxy.rows = rows;
  } catch (err) {
    if (proxy.deck === card) proxy.error = err.message;
  } finally {
    if (proxy.deck === card) { proxy.busy = false; renderProxy(); }
  }
}

$("#proxy-open").addEventListener("click", () => {
  const card = current();
  if (!card) return;
  if (card.list) { loadProxies(); return; }
  $("#proxy-list").value = "";
  Object.assign(proxy, { deck: card, editing: true });
  renderProxy();
});

$("#proxy-use").addEventListener("click", () => {
  const card = current();
  const text = $("#proxy-list").value.trim();
  if (!card || !text) return;
  card.list = text;
  save();
  loadProxies();
});

function openPicker(row) {
  Object.assign(proxy, { picking: row.key, prints: null });
  renderProxy();
  printingsOf(row.card)
    .then(prints => { if (proxy.picking === row.key) proxy.prints = prints; })
    .catch(() => { if (proxy.picking === row.key) proxy.prints = []; })
    .finally(renderProxy);
}

function choosePrinting(row, printing) {
  proxyPrefs(current()).picks[row.key] = printing.id;
  row.card = printing;
  Object.assign(proxy, { picking: null, prints: null });
  save();
  renderProxy();
}

function toggleExclude(keys, out) {
  const prefs = proxyPrefs(current());
  const set = new Set(prefs.exclude);
  for (const k of keys) out ? set.add(k) : set.delete(k);
  prefs.exclude = [...set];
  save();
  renderProxy();
}

const proxyPages = items => {
  const pages = [];
  for (let i = 0; i < items.length; i += MAX_CARDS) {
    pages.push(layoutSheet(items.slice(i, i + MAX_CARDS), state.paper, { card: PROXY_MM, ruler: false }));
  }
  return pages;
};

$("#proxy-download").addEventListener("click", async () => {
  const card = current();
  if (!card || !proxy.rows) return;
  const items = proxyItems(proxy.rows, new Set(proxyPrefs(card).exclude));
  if (!items.length) return;
  const btn = $("#proxy-download");
  btn.disabled = true;
  proxy.error = null;
  try {
    const images = await fetchImages(items.map(i => i.img), (n, total) => { btn.textContent = `loading cards ${n} / ${total}…`; });
    btn.textContent = "building the PDF…";
    await new Promise(r => setTimeout(r, 30));   // let the label paint first
    const grade = layoutSheet([{ prims: layoutCard(cardStats(card)) }], state.paper);
    renderPDF([grade, ...proxyPages(items)], images).save(`deck-stats-${slug(cardStats(card).title)}-proxies.pdf`);
  } catch (err) {
    proxy.error = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "download deck + proxies PDF";
    renderProxy();
  }
});

function proxyRow(row, excluded) {
  const el = document.createElement("div");
  el.className = excluded || !row.card ? "pr out" : "pr";

  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "pr-thumb";
  if (row.card) {
    const img = document.createElement("img");
    img.src = faces(row.card)[0]?.small ?? "";
    img.alt = "";
    img.loading = "lazy";
    thumb.append(img);
    thumb.setAttribute("aria-label", `Choose a printing of ${row.name}`);
    thumb.addEventListener("click", () => (proxy.picking === row.key ? (closePicker(), renderProxy()) : openPicker(row)));
  } else {
    thumb.disabled = true;
  }

  const info = document.createElement("div");
  info.className = "pr-info";
  const name = document.createElement("div");
  name.textContent = `${row.qty} × ${row.name}`;
  const sub = document.createElement("div");
  sub.className = "pr-sub";
  sub.textContent = row.card ? `${row.card.set.toUpperCase()} ${row.card.collector_number} · tap the card to change` : "not found on Scryfall";
  info.append(name, sub);

  const toggle = chip(excluded ? "out" : "in", !excluded && Boolean(row.card), () => toggleExclude([row.key], !excluded),
    `${excluded ? "Include" : "Leave out"} ${row.name}`);
  toggle.disabled = !row.card;
  el.append(thumb, info, toggle);
  return el;
}

const closePicker = () => Object.assign(proxy, { picking: null, prints: null });

function pickerEl(row) {
  const el = document.createElement("div");
  el.className = "picker";
  if (!proxy.prints) {
    el.textContent = "loading every printing…";
    return el;
  }
  if (!proxy.prints.length) {
    el.textContent = "Couldn't load the printings. Try again.";
    return el;
  }
  el.append(...proxy.prints.map(p => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = p.id === row.card.id ? "pick on" : "pick";
    b.setAttribute("aria-label", `${p.set_name} ${p.collector_number}`);
    const img = document.createElement("img");
    img.src = faces(p)[0]?.small ?? "";
    img.alt = "";
    img.loading = "lazy";
    const cap = document.createElement("span");
    cap.textContent = `${p.set.toUpperCase()} ${p.collector_number}`;
    b.append(img, cap);
    b.addEventListener("click", () => choosePrinting(row, p));
    return b;
  }));
  return el;
}

function renderProxy() {
  const card = current();
  const open = Boolean(card) && proxy.deck === card;
  $("#proxy-open").hidden = open || !card;
  $("#proxy").hidden = !open;
  if (!open) return;

  const pasting = !card.list || proxy.editing;
  $("#proxy-paste").hidden = !pasting;
  if (pasting && !$("#proxy-list").value) $("#proxy-list").value = card.list ?? "";

  const rows = pasting ? [] : (proxy.rows ?? []);
  const exclude = new Set(proxyPrefs(card).exclude);
  const items = proxyItems(rows, exclude);
  const missing = rows.filter(r => !r.card);

  let status = "";
  if (proxy.busy) status = "finding your cards on Scryfall…";
  else if (proxy.rows && !pasting) {
    status = `${items.length} cards · ${Math.ceil(items.length / MAX_CARDS)} pages of proxies, after the Bracket Card`;
    if (missing.length) status += `. not found: ${missing.map(r => r.name).join(", ")}`;
  }
  $("#proxy-status").textContent = status;
  $("#proxy-error").hidden = !proxy.error;
  $("#proxy-error").textContent = proxy.error ?? "";

  const basics = rows.filter(r => isBasicLand(r.card)).map(r => r.key);
  const basicsOut = basics.length > 0 && basics.every(k => exclude.has(k));
  $("#proxy-tools").hidden = pasting || !proxy.rows;
  $("#proxy-tools").replaceChildren(
    chip("skip basic lands", basicsOut, () => toggleExclude(basics, !basicsOut)),
    chip("edit list", false, () => { proxy.editing = true; $("#proxy-list").value = card.list ?? ""; renderProxy(); }),
  );

  $("#proxy-rows").replaceChildren(...rows.flatMap(row => {
    const els = [proxyRow(row, exclude.has(row.key))];
    if (proxy.picking === row.key) els.push(pickerEl(row));
    return els;
  }));

  $("#proxy-download").hidden = pasting || !items.length;
  // The 1:1 rule: the pages exactly as they print, small scans standing in.
  $("#proxy-pages").innerHTML = pasting ? "" : proxyPages(items).map(renderSheetSVG).join("");
}

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

const sheet = () => layoutSheet(state.cards.map(c => ({ prims: layoutCard(cardStats(c)) })), state.paper);

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
  renderSuggestions();
  $("#editing").textContent = card
    ? `editing ${state.sel + 1}. ${cardStats(card).title}${card.stats.gradedAt ? "" : " (undated: analyze it again to grade it)"}`
    : "";

  if (state.cards.length) $("#preview").innerHTML = renderSheetSVG(sheet());

  // The proxy panel belongs to one deck; picking another closes it.
  if (proxy.deck && proxy.deck !== card) closeProxy();
  renderProxy();
}

restore();
fontsReady.then(render, () => setError("The card fonts failed to load. Refresh to try again."));
readHandoff();
// If deckStats is already open in that tab, only the fragment changes, and a
// fragment change doesn't reload the page.
addEventListener("hashchange", readHandoff);
