#!/usr/bin/env node
// ingest-legend-tags.mjs — profile each Box legend from its Scryfall Tagger
// page, then pull the card pool for that legend's theme tags.
//
// MANUAL, dev-machine only (same posture as ingest-cards.mjs):
//
//   SUPABASE_SERVICE_KEY=... npm run ingest:legend-tags
//   npm run ingest:legend-tags -- --dry-run --name="Krenko, Mob Boss"
//
// Per legend:
//   1. Resolve the printing (set + collector number + oracle_id) via the
//      official API — legends.scryfall_id when present, exact-name otherwise.
//   2. Read the legend's OWN Tagger page (tagger.scryfall.com) through the
//      page's GraphQL endpoint: fetch the card page once for the session
//      cookie + CSRF token, then POST the same query the page itself runs.
//      Verified live 2026-07-02 (Krenko → repeatable-creature-tokens,
//      typal-goblin, exponential, + ancestors). This endpoint is UNOFFICIAL:
//      one page GET + one POST per legend, cached in card_tags, never called
//      from the app at request time.
//   3. Keep ORACLE_CARD_TAG taggings + their ancestor slugs (Tagger's
//      hierarchy roll-up is what makes umbrella tags searchable), drop
//      catalog noise (cycle-*, filterout*, …), write rows with source
//      'tagger-card-page'.
//   4. For each kept tag not already covered by the nightly taxonomy pull,
//      fetch its top pages via official `otag:` search ordered by EDHREC
//      rank (capped — the deep tail of a 5,000-card tag is exactly what a
//      brew stack doesn't want) and write source 'otag-search' rows.
//
// Requires migration 009 (card_tags table).

import { TAXONOMY, isBlockedTag } from "./otag-taxonomy.mjs";
import {
  makeSupabase, politeFetch, fetchOtagOracleIds, writeCardTags, sleep,
} from "./ingest-shared.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_NAME = args.find(a => a.startsWith("--name="))?.slice(7) ?? null;

// Top ~1,050 cards per legend tag (6 pages × 175, EDHREC-ordered).
const MAX_PAGES_PER_LEGEND_TAG = 6;
const TAGGER_DELAY_MS = 300; // gentler spacing for the unofficial endpoint

const TAXONOMY_TAGS = new Set(TAXONOMY.map(t => t.tag));

const supabase = DRY_RUN && ONLY_NAME ? null : makeSupabase();

// ── Step 1: printing lookup (official API) ──────────────────────────────────
async function resolvePrinting(legend) {
  const url = legend.scryfall_id
    ? `https://api.scryfall.com/cards/${legend.scryfall_id}`
    : "https://api.scryfall.com/cards/named?exact=" + encodeURIComponent(legend.name);
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`printing lookup for "${legend.name}" failed: HTTP ${res.status}`);
  const c = await res.json();
  const oracle_id = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
  return { oracle_id, set: c.set, number: c.collector_number, name: c.name };
}

// ── Step 2: Tagger session + per-card GraphQL query ─────────────────────────
async function taggerSession(set, number) {
  const res = await politeFetch(`https://tagger.scryfall.com/card/${set}/${number}`, {
    delayMs: TAGGER_DELAY_MS,
    headers: { Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`Tagger page ${set}/${number} failed: HTTP ${res.status}`);
  const html = await res.text();
  const token = html.match(/csrf-token" content="([^"]+)"/)?.[1];
  if (!token) throw new Error("No CSRF token in Tagger page — page shape changed, re-verify by hand.");
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map(c => c.split(";")[0])
    .join("; ");
  return { token, cookie };
}

async function fetchTaggerTags(set, number, session) {
  const query =
    "query($set:String!,$number:String!){card:cardBySet(set:$set,number:$number)" +
    "{name taggings{tag{name slug type ancestorTags{slug}}}}}";
  const res = await politeFetch("https://tagger.scryfall.com/graphql", {
    delayMs: TAGGER_DELAY_MS,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": session.token,
      Cookie: session.cookie,
    },
    body: JSON.stringify({ query, variables: { set, number } }),
  });
  if (!res.ok) throw new Error(`Tagger GraphQL failed: HTTP ${res.status}`);
  const d = await res.json();
  if (d.errors) throw new Error(`Tagger GraphQL errors: ${JSON.stringify(d.errors).slice(0, 300)}`);

  // ── Step 3: oracle tags + ancestors, minus catalog noise ──
  const slugs = new Set();
  for (const t of d.data?.card?.taggings ?? []) {
    if (t.tag?.type !== "ORACLE_CARD_TAG") continue;
    for (const slug of [t.tag.slug, ...(t.tag.ancestorTags ?? []).map(a => a.slug)]) {
      if (slug && !isBlockedTag(slug)) slugs.add(slug);
    }
  }
  return [...slugs];
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  let legends;
  if (ONLY_NAME && DRY_RUN) {
    legends = [{ name: ONLY_NAME, scryfall_id: null }];
  } else {
    let q = supabase.from("legends").select("name, scryfall_id");
    if (ONLY_NAME) q = q.eq("name", ONLY_NAME);
    const { data, error } = await q;
    if (error) throw new Error(`legends read failed: ${error.message}`);
    legends = data ?? [];
  }
  if (legends.length === 0) {
    console.log(ONLY_NAME ? `No legend named "${ONLY_NAME}".` : "No legends in the Box — nothing to profile.");
    return;
  }

  const runIso = new Date().toISOString();

  for (const legend of legends) {
    const p = await resolvePrinting(legend);
    const session = await taggerSession(p.set, p.number);
    const tags = await fetchTaggerTags(p.set, p.number, session);
    console.log(`${p.name} [${p.set}/${p.number}] → ${tags.length} oracle tags: ${tags.join(", ")}`);

    // ── Step 4: card pool for the legend's tags the taxonomy doesn't cover ──
    for (const tag of tags.filter(t => !TAXONOMY_TAGS.has(t))) {
      const { ids, total, pages } = await fetchOtagOracleIds(tag, {
        maxPages: MAX_PAGES_PER_LEGEND_TAG,
      });
      console.log(`  otag:${tag} → ${ids.length} of ${total} cards (${pages} pages, EDHREC-ordered)`);
      if (DRY_RUN || ids.length === 0) continue;
      await writeCardTags(
        supabase,
        ids.map(oracle_id => ({ oracle_id, tag, source: "otag-search", updated_at: runIso })),
        { pruneEq: { tag, source: "otag-search" }, runIso },
      );
    }

    // Profile rows LAST: a legend usually appears inside its own tags' pools,
    // and the pool upsert would flip the shared (oracle_id, tag) row's source
    // back to 'otag-search' if it wrote after this (caught on the first live
    // run — Hawkeye's 5 profile rows all lost their provenance).
    if (!DRY_RUN) {
      await writeCardTags(
        supabase,
        tags.map(tag => ({ oracle_id: p.oracle_id, tag, source: "tagger-card-page", updated_at: runIso })),
        { pruneEq: { oracle_id: p.oracle_id, source: "tagger-card-page" }, runIso },
      );
    }

    await sleep(200);
  }

  if (!DRY_RUN) {
    const { count } = await supabase
      .from("card_tags")
      .select("*", { count: "exact", head: true });
    console.log("──────────────────────────────────────────────");
    console.log(`card_tags table now holds: ${count ?? "?"} rows`);
  }
}

main().catch(err => {
  console.error("\nLegend tag ingest failed:", err.message);
  process.exit(1);
});
