import { fetchCardIdentity } from "./scryfall.js";
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

// Resolves every parsed line's card through the cache-first identity lookup
// (local `cards` cache → live exact → live fuzzy; never throws). An
// unresolved name carries `card: null` so the caller can flag/skip it rather
// than failing the whole import.
export async function resolveImportLines(lines) {
  const resolved = [];
  for (const line of lines) {
    const card = await fetchCardIdentity(line.name);
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

// One door for the whole paste→preview pipeline: parse, resolve, dedupe,
// and attempt commander detection. Never throws — resolution failures show
// up as `unresolved` lines instead.
export async function prepareImport(text) {
  const parsed = parseMoxfieldText(text);
  const resolved = await resolveImportLines(parsed);
  const merged = mergeDuplicateLines(resolved);
  const unresolved = merged.filter(l => !l.card);
  const resolvedLines = merged.filter(l => l.card);
  const { commander, candidates } = pickCommander(resolvedLines);
  return { resolvedLines, unresolved, commander, candidates };
}
