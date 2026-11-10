// The play test page (playtest.html): print one deck as play test cards,
// mtgprint-style (Ben's reference is mtgprint.net; see proxies.js). One PDF:
// every card in the list at 63 × 88 mm, 9 per page, with the deck's Bracket
// Card riding in the first slot.
//
// It works on "your deck", the same one the card page shows. The resolved
// Scryfall cards live only in memory (refetched after a refresh); what is
// saved with the deck is its list, the cards left out and the printings picked.
import { layoutCard, layoutSheet, renderSheetSVG, renderPDF, MAX_CARDS, PROXY_MM } from "./card.js";
import { parseList, resolveRows, printingsOf, proxyItems, fetchImages, faces, isBasicLand, nameKey } from "./proxies.js";
import {
  $, KEYS, load, store, loadPaper, fontsReady, chip, slug, cardStats, cardSVG,
  paperPicker, deckForm, styleEditor,
} from "./common.js";

const state = { card: load(KEYS.deck)?.card ?? null, paper: loadPaper(), changing: false };
const proxy = { rows: null, busy: false, error: null, editing: false, picking: null, prints: null };

const save = () => store(KEYS.deck, { card: state.card });
function commit() {
  save();
  render();
}

// ── 1. The deck ─────────────────────────────────────────────────────────────
const form = deckForm($("#deck-form"), {
  label: () => "Use this deck",
  onCard(card) {
    state.card = card;
    state.changing = false;
    commit();
    start();
  },
});

$("#change-deck").addEventListener("click", () => { state.changing = true; render(); });
$("#keep-deck").addEventListener("click", () => { state.changing = false; render(); });

// ── 2. Its Bracket Card, with the owner's game style and play style ─────────
const renderStyles = styleEditor($("#style"), { get: () => state.card, onChange: commit });

// ── 3. The cards ────────────────────────────────────────────────────────────
function prefs(card) {
  card.proxy ??= { exclude: [], picks: {} };
  return card.proxy;
}

// The commander has to print too, and a pasted list often leaves it out,
// since the deck form asks for the commander in its own field.
function deckRows(card) {
  const rows = parseList(card.list);
  const have = new Set(rows.map(r => r.key));
  const missing = (card.stats.commanders ?? [])
    .filter(n => !have.has(nameKey(n)))
    .map(name => ({ key: nameKey(name), name, qty: 1, set: null, cn: null }));
  return [...missing, ...rows];
}

// Straight to the cards if the deck's list is known, else to the paste box
// (a deck added by link: our server can't read its list).
async function start() {
  const card = state.card;
  Object.assign(proxy, { rows: null, busy: false, error: null, editing: !card?.list, picking: null, prints: null });
  $("#proxy-list").value = card?.list ?? "";
  render();
  if (!card?.list) return;
  proxy.busy = true;
  render();
  try {
    const rows = await resolveRows(deckRows(card), prefs(card).picks);
    if (state.card === card) proxy.rows = rows;
  } catch (err) {
    if (state.card === card) proxy.error = err.message;
  } finally {
    if (state.card === card) { proxy.busy = false; render(); }
  }
}

$("#proxy-use").addEventListener("click", () => {
  const text = $("#proxy-list").value.trim();
  if (!state.card || !text) return;
  state.card.list = text;
  save();
  start();
});

function openPicker(row) {
  Object.assign(proxy, { picking: row.key, prints: null });
  render();
  printingsOf(row.card)
    .then(prints => { if (proxy.picking === row.key) proxy.prints = prints; })
    .catch(() => { if (proxy.picking === row.key) proxy.prints = []; })
    .finally(render);
}
const closePicker = () => Object.assign(proxy, { picking: null, prints: null });

function choosePrinting(row, printing) {
  prefs(state.card).picks[row.key] = printing.id;
  row.card = printing;
  closePicker();
  commit();
}

function toggleExclude(keys, out) {
  const p = prefs(state.card);
  const set = new Set(p.exclude);
  for (const k of keys) out ? set.add(k) : set.delete(k);
  p.exclude = [...set];
  commit();
}

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
    thumb.addEventListener("click", () => (proxy.picking === row.key ? (closePicker(), render()) : openPicker(row)));
  } else {
    thumb.disabled = true;
  }

  const info = document.createElement("div");
  info.className = "pr-info";
  const name = document.createElement("div");
  name.className = "pr-name";
  name.textContent = `${row.qty} × ${row.name}`;
  const sub = document.createElement("div");
  sub.className = "pr-sub";
  sub.textContent = row.card ? `${row.card.set.toUpperCase()} ${row.card.collector_number} · tap the art to change` : "Not found on Scryfall";
  info.append(name, sub);

  const toggle = chip(excluded ? "Out" : "In", !excluded && Boolean(row.card), () => toggleExclude([row.key], !excluded),
    `${excluded ? "Include" : "Leave out"} ${row.name}`);
  toggle.disabled = !row.card;
  el.append(thumb, info, toggle);
  return el;
}

function pickerEl(row) {
  const el = document.createElement("div");
  el.className = "picker";
  if (!proxy.prints) {
    el.textContent = "Loading every printing…";
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

// ── 4. Print ────────────────────────────────────────────────────────────────
// The deck's Bracket Card rides in the first slot of the first page, turned
// to fit, so it never costs a sheet of its own.
function pages(card, items) {
  const all = [{ prims: layoutCard(cardStats(card)), turn: true }, ...items];
  const out = [];
  for (let i = 0; i < all.length; i += MAX_CARDS) {
    out.push(layoutSheet(all.slice(i, i + MAX_CARDS), state.paper,
      { card: PROXY_MM, ruler: false, note: i ? null : 'print at 100%, not "fit to page"' }));
  }
  return out;
}

const renderPaper = paperPicker($("#papers"), () => state.paper, p => { state.paper = p; render(); });
const itemsNow = () => proxyItems(proxy.rows ?? [], new Set(prefs(state.card).exclude));

$("#download").addEventListener("click", async () => {
  const card = state.card;
  const items = itemsNow();
  if (!card || !items.length) return;
  const btn = $("#download");
  btn.disabled = true;
  proxy.error = null;
  try {
    const images = await fetchImages(items.map(i => i.img), (n, total) => { btn.textContent = `Loading cards ${n} / ${total}…`; });
    btn.textContent = "Building the PDF…";
    await new Promise(r => setTimeout(r, 30));   // let the label paint first
    renderPDF(pages(card, items), images).save(`bracket-card-${slug(cardStats(card).title)}-play-test.pdf`);
  } catch (err) {
    proxy.error = err.message;
  } finally {
    btn.disabled = false;
    render();   // restores the button's label
  }
});

// ── Render ──────────────────────────────────────────────────────────────────
function render() {
  const card = state.card;
  const asking = !card || state.changing;
  $("#deck-form").hidden = !asking;
  $("#keep-deck").hidden = !(card && state.changing);
  $("#deck-chosen").hidden = asking;
  $("#after-deck").hidden = !card;
  if (!card) return;

  $("#deck-name").textContent = cardStats(card).title;
  $("#preview").innerHTML = cardSVG(card);
  renderStyles();

  const pasting = proxy.editing;
  $("#proxy-paste").hidden = !pasting;
  const rows = pasting ? [] : (proxy.rows ?? []);
  const exclude = new Set(prefs(card).exclude);
  const items = proxyItems(rows, exclude);
  const missing = rows.filter(r => !r.card);
  const pageCount = Math.ceil((items.length + 1) / MAX_CARDS);

  let status = "";
  if (proxy.busy) status = "Finding your cards on Scryfall…";
  else if (proxy.rows && !pasting) {
    status = `${items.length} play test cards + the Bracket Card · ${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
    // Three names at most: each one also has its own "not found" row below.
    if (missing.length) {
      const names = missing.slice(0, 3).map(r => r.name).join(", ");
      status += `. Not found: ${names}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}`;
    }
  }
  $("#proxy-status").textContent = status;
  $("#proxy-error").hidden = !proxy.error;
  $("#proxy-error").textContent = proxy.error ?? "";

  const basics = rows.filter(r => isBasicLand(r.card)).map(r => r.key);
  const basicsOut = basics.length > 0 && basics.every(k => exclude.has(k));
  $("#proxy-tools").hidden = pasting || !proxy.rows;
  $("#proxy-tools").replaceChildren(
    chip("Skip basic lands", basicsOut, () => toggleExclude(basics, !basicsOut)),
    chip("Edit list", false, () => { proxy.editing = true; $("#proxy-list").value = card.list ?? ""; render(); }),
  );
  $("#proxy-rows").replaceChildren(...rows.flatMap(row => {
    const els = [proxyRow(row, exclude.has(row.key))];
    if (proxy.picking === row.key) els.push(pickerEl(row));
    return els;
  }));

  // The 1:1 rule: the pages exactly as they print, small scans standing in.
  const ready = !pasting && Boolean(proxy.rows) && items.length > 0;
  $("#print").hidden = !ready;
  if (!ready) return;
  $("#pages").innerHTML = pages(card, items).map(renderSheetSVG).join("");
  const dl = $("#download");
  if (!dl.disabled) dl.textContent = `Download ${pageCount}-page PDF`;
  renderPaper();
}

fontsReady.then(start, () => form.setError("The card fonts failed to load. Refresh to try again."));
