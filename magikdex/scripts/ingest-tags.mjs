#!/usr/bin/env node
// ingest-tags.mjs — populate card_tags from the verified otag taxonomy.
//
// MANUAL, dev-machine only (same posture as ingest-cards.mjs). Run nightly-ish
// or before a brew session; re-run during spoiler season:
//
//   SUPABASE_SERVICE_KEY=... npm run ingest:tags
//   npm run ingest:tags -- --dry-run            # API walk only, no DB writes
//   SUPABASE_SERVICE_KEY=... npm run ingest:tags -- --tag=sweeper
//
// For each taxonomy tag it walks the official paginated search
// (api.scryfall.com, otag: syntax — Tagger's community tags are indexed
// there), upserts (oracle_id, tag) rows with source 'otag-search', then
// prunes rows the run didn't re-see (tag removed upstream). Full pulls, no
// page cap: the taxonomy is curated small enough that a complete run is
// ~260 pages ≈ 2 minutes at compliant spacing.
//
// Requires migration 009 (card_tags table).

import { TAXONOMY } from "./otag-taxonomy.mjs";
import { makeSupabase, fetchOtagOracleIds, writeCardTags } from "./ingest-shared.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_TAG = args.find(a => a.startsWith("--tag="))?.slice(6) ?? null;

const entries = ONLY_TAG ? TAXONOMY.filter(t => t.tag === ONLY_TAG) : TAXONOMY;
if (entries.length === 0) {
  console.error(`Unknown tag "${ONLY_TAG}" — not in otag-taxonomy.mjs.`);
  process.exit(1);
}

const supabase = DRY_RUN ? null : makeSupabase();

async function main() {
  const runIso = new Date().toISOString();
  let totalRows = 0;

  for (const { tag, cards: expected } of entries) {
    const { ids, total, pages } = await fetchOtagOracleIds(tag);
    // Drift note, not an error: counts move as the community tags cards.
    const drift = expected ? ` (taxonomy said ${expected})` : "";
    console.log(`otag:${tag} → ${ids.length} oracle ids over ${pages} pages, total_cards ${total}${drift}`);

    if (DRY_RUN) { totalRows += ids.length; continue; }

    const rows = ids.map(oracle_id => ({
      oracle_id,
      tag,
      source: "otag-search",
      updated_at: runIso,
    }));
    await writeCardTags(supabase, rows, {
      pruneEq: { tag, source: "otag-search" },
      runIso,
    });
    totalRows += rows.length;
  }

  console.log("──────────────────────────────────────────────");
  console.log(`${DRY_RUN ? "[dry run] would write" : "wrote"} ${totalRows} card_tags rows across ${entries.length} tags`);

  if (!DRY_RUN) {
    const { count } = await supabase
      .from("card_tags")
      .select("*", { count: "exact", head: true });
    console.log(`card_tags table now holds: ${count ?? "?"} rows`);
  }
}

main().catch(err => {
  console.error("\nTag ingest failed:", err.message);
  process.exit(1);
});
