// THE PROXY PRINT — a deck list → Scryfall printings → 63 × 88 mm pages.
//
// Ben's reference is mtgprint.net: paste a list, pick the official printing
// you want for any card, leave cards out, get a PDF at 9 per page. No custom
// art and no custom frames (Ben, 2026-11-10): every proxy is a real Scryfall
// scan, drawn whole so its artist and copyright lines stay on the card.
//
// Everything here runs in the browser against Scryfall's public API. There is
// no key and nothing goes through our server.

const SCRYFALL = "https://api.scryfall.com";
const HEADERS = { Accept: "application/json" };
// Scryfall asks for 50–100 ms between requests.
const pause = ms => new Promise(r => setTimeout(r, ms));

// ── Parse ───────────────────────────────────────────────────────────────────
// Reads what Moxfield, Archidekt and Arena export: "1 Sol Ring",
// "1x Sol Ring", "1 Sol Ring (C21) 263", "1 Sol Ring (C21) 263 *F*", with
// optional "Commander" / "Deck" / "Sideboard" headers and Moxfield #tags.
// Ported from magikdex's moxfieldImport.js, but it KEEPS the "(SET) 123"
// marker instead of stripping it: that is the printing the owner chose.
const SECTION = /^(commander|companion|deck|main|mainboard|sideboard|maybeboard|considering|tokens?)\s*:?\s*(\(\d+\))?$/i;
// Not part of the 100 that get played, so not printed.
const SKIPPED = new Set(["sideboard", "maybeboard", "considering", "token", "tokens"]);

export const nameKey = name => String(name).toLowerCase().split(" // ")[0].trim();

export function parseList(text) {
  const rows = new Map();
  let section = "deck";
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#\S+/g, "").trim();
    if (!line || line.startsWith("//")) continue;
    const head = line.match(SECTION);
    if (head) { section = head[1].toLowerCase(); continue; }
    if (SKIPPED.has(section)) continue;

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const qty = m ? Number(m[1]) : 1;
    const rest = (m ? m[2] : line).replace(/\s+\*[A-Z]+\*\s*$/, "").trim();
    const printing = rest.match(/^(.*?)\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+))?$/);
    const name = (printing ? printing[1] : rest).trim();
    if (!name || qty < 1) continue;

    // The same card on two lines is one row.
    const key = nameKey(name);
    const seen = rows.get(key);
    if (seen) { seen.qty += qty; continue; }
    rows.set(key, {
      key, name, qty: Math.min(qty, 99),
      set: printing?.[2]?.toLowerCase() ?? null,
      cn: printing?.[3] ?? null,
    });
  }
  return [...rows.values()];
}

// ── Resolve ─────────────────────────────────────────────────────────────────
// One printing per row, in this order of preference: the one the owner picked
// here, the one the list names with "(SET) 123", or Scryfall's default.
// ⚠️ BY FRONT FACE. /cards/collection finds "Fire" and "Esika, God of the
// Tree" but NOT "Fire // Ice" or "Esika… // The Prismatic Bridge" (checked
// live 2026-11-10), and lists export the full name. So it is asked for the
// front face, always.
const byName = row => ({ name: row.name.split(" // ")[0].trim() });

function identifier(row, picks) {
  if (picks[row.key]) return { id: picks[row.key] };
  if (row.set && row.cn) return { set: row.set, collector_number: row.cn };
  return byName(row);
}

function matches(card, ident) {
  if (ident.id) return card.id === ident.id;
  if (ident.set) return card.set === ident.set && card.collector_number.toLowerCase() === ident.collector_number.toLowerCase();
  return nameKey(card.name) === nameKey(ident.name);
}

// Last try for a name the exact lookup missed (a typo, a missing accent):
// Scryfall's fuzzy match, one request each. Capped, because a pasted essay
// would otherwise fire hundreds.
const MAX_FUZZY = 20;
async function fuzzy(name) {
  try {
    const res = await fetch(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`, { headers: HEADERS });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function collection(identifiers) {
  let res;
  try {
    res = await fetch(`${SCRYFALL}/cards/collection`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers }),
    });
  } catch {
    throw new Error("Couldn't reach Scryfall. Check your connection.");
  }
  if (!res.ok) throw new Error(`Scryfall answered ${res.status}. Try again in a moment.`);
  return (await res.json()).data ?? [];
}

// Returns the rows with `card` set (or null when Scryfall has no such card —
// shown as "not found", never silently dropped).
export async function resolveRows(rows, picks = {}) {
  const found = new Map();
  const pass = async (indexes, identOf) => {
    for (let i = 0; i < indexes.length; i += 75) {
      const chunk = indexes.slice(i, i + 75);
      const cards = await collection(chunk.map(identOf));
      for (const card of cards) {
        for (const idx of chunk) if (!found.has(idx) && matches(card, identOf(idx))) found.set(idx, card);
      }
      await pause(100);
    }
  };
  const all = rows.map((_, i) => i);
  await pass(all, i => identifier(rows[i], picks));
  // A stale pick or a mistyped "(SET) 123" falls back to the card's name.
  const retry = all.filter(i => !found.has(i) && !identifier(rows[i], picks).name);
  if (retry.length) await pass(retry, i => byName(rows[i]));
  for (const i of all.filter(i => !found.has(i)).slice(0, MAX_FUZZY)) {
    const card = await fuzzy(rows[i].name);
    if (card) found.set(i, card);
    await pause(100);
  }
  return rows.map((row, i) => ({ ...row, card: found.get(i) ?? null }));
}

// Every paper printing of a card, newest first. Fetched only when the owner
// opens the picker for that card; Sol Ring alone has a few hundred.
export async function printingsOf(card) {
  const q = `oracleid:${card.oracle_id} game:paper`;
  let url = `${SCRYFALL}/cards/search?order=released&dir=desc&unique=prints&q=${encodeURIComponent(q)}`;
  const out = [];
  while (url && out.length < 400) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) break;
    const json = await res.json();
    out.push(...(json.data ?? []));
    url = json.has_more ? json.next_page : null;
    if (url) await pause(100);
  }
  return out;
}

// ── What prints ─────────────────────────────────────────────────────────────
// A double-faced card prints both faces, back right after front. Split,
// adventure and flip cards are one image, so one card.
export function faces(card) {
  if (!card) return [];
  if (card.image_uris) return [card.image_uris];
  return (card.card_faces ?? []).map(f => f.image_uris).filter(Boolean);
}

export const isBasicLand = card => /^Basic\b.*\bLand\b/.test(card?.type_line ?? "");

// One sheet item per printed card: `img` is the print-resolution scan, `thumb`
// the small one the on-screen preview uses.
//
// `corners`: Scryfall's scans have WHITE rounded corners, so a square cut
// leaves white nicks on a black-bordered card (mtgprint's "black corners"
// option). Filled in only when Scryfall says the printing is black-bordered;
// on borderless or white-bordered art it would be the defect instead.
export function proxyItems(rows, exclude) {
  const out = [];
  for (const row of rows) {
    if (!row.card || exclude.has(row.key)) continue;
    const corners = row.card.border_color === "black";
    for (let n = 0; n < row.qty; n++) {
      for (const f of faces(row.card)) out.push({ img: f.large, thumb: f.small, corners });
    }
  }
  return out;
}

// The scans as bytes for jsPDF, each URL fetched once (thirty Islands are one
// image), six at a time.
export async function fetchImages(urls, onProgress) {
  const unique = [...new Set(urls)];
  const out = new Map();
  let next = 0, done = 0;
  const worker = async () => {
    while (next < unique.length) {
      const url = unique[next++];
      const res = await fetch(url);
      if (!res.ok) throw new Error("A card image failed to load. Try again.");
      out.set(url, new Uint8Array(await res.arrayBuffer()));
      onProgress?.(++done, unique.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, unique.length) }, worker));
  return out;
}
