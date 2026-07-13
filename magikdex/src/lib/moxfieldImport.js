import { getCardData, getCardDataBatch } from "./scryfall.js";
import { WREC_TAGS } from "./deckTags.js";

// Strip a trailing "(SET) NUM" printing marker (e.g. "Sol Ring (2XM) 232")
// so the bare name resolves cleanly — Moxfield (and our own card lookups)
// resolve printing by name alone.
function stripPrinting(name) {
  return name.replace(/\s+\([A-Za-z0-9]+\)(\s+[\w-]+)?\s*$/, "").trim();
}

// One line: "<qty> <name> [#tag #tag ...]". Quantity defaults to 1 when no
// leading integer is present. Hashtags are pulled out before the qty/name
// split so they never leak into the name; tags outside the WREC enum
// (Moxfield decks may carry arbitrary tags) are silently dropped rather than
// erroring — only #ramp/#card-advantage/#disruption/#mass-disruption/#plan
// round-trip.
function parseMoxfieldLine(trimmed) {
  const tagMatches = [...trimmed.matchAll(/#(\S+)/g)].map(m => m[1].toLowerCase());
  const withoutTags = trimmed.replace(/#\S+/g, "").trim();
  if (!withoutTags) return null;

  const qtyMatch = withoutTags.match(/^(\d+)\s+(.+)$/);
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
  const rest = qtyMatch ? qtyMatch[2] : withoutTags;

  const name = stripPrinting(rest);
  if (!name) return null;

  const tags = tagMatches.filter(t => WREC_TAGS.includes(t));
  return { quantity, name, tags };
}

// Splits pasted text into lines, tracking Moxfield's "Commander" section
// header (a bare "Commander" or "Commander:" line) so cards listed under it
// carry `isCommander: true`. Any other header text (Mainboard, Sideboard,
// etc.) isn't special-cased — it parses as an ordinary line and falls out as
// unresolved later, which is the intended skip-don't-fail behavior.
export function parseMoxfieldText(text) {
  const lines = [];
  let inCommanderSection = false;

  for (const raw of (text ?? "").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) { inCommanderSection = false; continue; }
    if (/^commander:?$/i.test(trimmed)) { inCommanderSection = true; continue; }
    const parsed = parseMoxfieldLine(trimmed);
    if (!parsed) continue;
    lines.push({ ...parsed, raw: trimmed, isCommander: inCommanderSection });
  }
  return lines;
}

// Resolves every parsed line's card: the whole list against the local cache
// in one batched query, then only true cache misses walk the throttled live
// exact→fuzzy path one-by-one (was a serial round-trip per line — a 100-card
// paste took seconds even fully cached). Never throws; an unresolved name
// carries `card: null` so the caller can flag/skip it rather than failing
// the whole import.
export async function resolveImportLines(lines) {
  const { data, misses } = await getCardDataBatch(lines.map(l => l.name));
  const missSet = new Set(misses);
  const resolved = [];
  for (const line of lines) {
    const card = missSet.has(line.name)
      ? await getCardData(line.name)
      : (data[line.name] ?? null);
    resolved.push({ ...line, card });
  }
  return resolved;
}

// Same eligibility rule used by the swipe carousel's commander check.
function isCommanderEligible(card) {
  const type = card?.type_line ?? "";
  const oracle = card?.oracle_text ?? "";
  return (
    (type.includes("Legendary") && type.includes("Creature")) ||
    (type.includes("Legendary") && type.includes("Vehicle")) ||
    oracle.includes("can be your commander")
  );
}

// Duplicate names (same card listed twice, or differing only by the casing
// the user pasted) collapse into one line — quantities sum, tags union, and
// the name normalizes to the resolved card's canonical spelling when known.
export function mergeDuplicateLines(resolvedLines) {
  const byName = new Map();
  for (const line of resolvedLines) {
    const key = (line.card?.name ?? line.name).toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.quantity += line.quantity;
      existing.tags = [...new Set([...existing.tags, ...line.tags])];
      existing.isCommander = existing.isCommander || line.isCommander;
    } else {
      byName.set(key, { ...line, name: line.card?.name ?? line.name });
    }
  }
  return [...byName.values()];
}

// Commander resolution order: an explicit "Commander" section line wins
// (Moxfield convention); else a single legal-commander-eligible resolved
// card auto-picks; otherwise the caller must ask the user — `candidates`
// carries whichever set was ambiguous so the UI can offer a picker.
export function pickCommander(resolvedLines) {
  const marked = resolvedLines.filter(l => l.isCommander && l.card);
  if (marked.length === 1) return { commander: marked[0], candidates: [] };

  const eligible = resolvedLines.filter(l => l.card && isCommanderEligible(l.card));
  if (eligible.length === 1) return { commander: eligible[0], candidates: [] };

  return { commander: null, candidates: marked.length > 1 ? marked : eligible };
}

// Everything after parsing is shared between the paste path and the URL
// path: resolve against the cache, dedupe, split unresolved, detect the
// commander.
async function finishImport(parsedLines) {
  const resolved = await resolveImportLines(parsedLines);
  const merged = mergeDuplicateLines(resolved);
  const unresolved = merged.filter(l => !l.card);
  const resolvedLines = merged.filter(l => l.card);
  const { commander, candidates } = pickCommander(resolvedLines);
  return { resolvedLines, unresolved, commander, candidates };
}

// One door for the whole paste→preview pipeline: parse, resolve, dedupe,
// and attempt commander detection. Never throws — resolution failures show
// up as `unresolved` lines instead.
export async function prepareImport(text) {
  return finishImport(parseMoxfieldText(text));
}

// ── Deck-URL import (Moxfield / Archidekt) ────────────────────────────────────
// Both providers block browser CORS (verified live 2026-07-09), so the fetch
// goes through our own /api/deck proxy, which normalizes either provider to
// { name, commanders: [names], cards: [{ name, quantity, section }] }.
// The Vite dev server and the Capacitor shell aren't the Vercel origin, so
// they call the deployed function absolutely; in production it's same-origin.
const DECK_API_BASE =
  typeof window !== "undefined" && /\.vercel\.app$/.test(window.location.hostname)
    ? ""
    : "https://magikdex.vercel.app";

export function isDeckUrl(text) {
  return /(?:moxfield\.com\/decks\/[A-Za-z0-9_-]+|archidekt\.com\/decks\/\d+)/i.test(text ?? "");
}

// URL → the same preview shape prepareImport returns. Unlike the paste path
// this CAN throw (network/private deck) — the caller surfaces the message.
// Tags never come from a URL import (auto-tagging owns that now); the
// maybe/sideboard sections ride along as `section` on each line.
export async function prepareImportFromUrl(url) {
  const res = await fetch(`${DECK_API_BASE}/api/deck?url=${encodeURIComponent(url.trim())}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `import failed (${res.status})`);

  const lines = [
    ...(body.commanders ?? []).map(name => ({
      quantity: 1, name, tags: [], raw: name, isCommander: true,
    })),
    ...(body.cards ?? []).map(c => ({
      quantity: c.quantity ?? 1, name: c.name, tags: [], raw: c.name,
      isCommander: false, section: c.section === "maybe" ? "maybe" : "decklist",
    })),
  ];
  if (lines.length === 0) throw new Error("that deck came back empty");
  return finishImport(lines);
}
