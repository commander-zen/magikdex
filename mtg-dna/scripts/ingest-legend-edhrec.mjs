#!/usr/bin/env node
// ingest-legend-edhrec.mjs — cache each Box legend's EDHREC commander page
// (synergy card lists + theme tags) into legend_synergy / legend_themes.
//
// MANUAL, dev-machine only (same posture as the other ingests):
//
//   SUPABASE_SERVICE_KEY=... npm run ingest:legend-edhrec
//   npm run ingest:legend-edhrec -- --dry-run --name="Hawkeye, Young Avenger"
//
// Source is json.edhrec.com/pages/commanders/<slug>.json — the commander
// page's own data feed (UNOFFICIAL, per DATA_SOURCES.md: cached here on a
// schedule, never called from the app at request time). Structure verified
// live 2026-07-02: container.json_dict.cardlists holds the card lists (High
// Synergy Cards, Top Cards, per-type lists; each cardview has name / synergy
// / num_decks / potential_decks) and panels.taglinks holds the rank-ordered
// theme tags (Hawkeye: Burn 13, Spellslinger 7 — the "main theme" signal).
//
// Requires migration 011 (legend_synergy + legend_themes).

import { makeSupabase, politeFetch, sleep } from "./ingest-shared.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_NAME = args.find(a => a.startsWith("--name="))?.slice(7) ?? null;

const EDHREC_DELAY_MS = 400; // gentler spacing for the unofficial endpoint

const supabase = DRY_RUN && ONLY_NAME ? null : makeSupabase();

// EDHREC commander slugs: lowercase, punctuation stripped, spaces → hyphens
// ("Hawkeye, Young Avenger" → hawkeye-young-avenger). Verified against live
// pages for all three Box legends; a miss logs and skips, never throws.
function edhrecSlug(name) {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Legend oracle_id comes from our own cards cache — no API call needed.
async function lookupOracleId(name) {
  if (!supabase) return `dry-run:${name}`;
  const { data } = await supabase
    .from("cards")
    .select("oracle_id")
    .eq("name_lower", name.toLowerCase())
    .maybeSingle();
  return data?.oracle_id ?? null;
}

async function fetchCommanderPage(slug) {
  const res = await politeFetch(
    `https://json.edhrec.com/pages/commanders/${slug}.json`,
    { delayMs: EDHREC_DELAY_MS },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`EDHREC ${slug}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  let legends;
  if (ONLY_NAME && DRY_RUN) {
    legends = [{ name: ONLY_NAME }];
  } else {
    let q = supabase.from("legends").select("name");
    if (ONLY_NAME) q = q.eq("name", ONLY_NAME);
    const { data, error } = await q;
    if (error) throw new Error(`legends read failed: ${error.message}`);
    legends = data ?? [];
  }
  if (legends.length === 0) {
    console.log("No legends in the Box — nothing to fetch.");
    return;
  }

  const runIso = new Date().toISOString();

  for (const legend of legends) {
    const slug = edhrecSlug(legend.name);
    const oracleId = await lookupOracleId(legend.name);
    if (!oracleId) {
      console.log(`${legend.name}: not in the cards cache — skipped.`);
      continue;
    }

    const page = await fetchCommanderPage(slug);
    if (!page) {
      console.log(`${legend.name}: no EDHREC page at "${slug}" — skipped (new/obscure commander?).`);
      continue;
    }

    // ── Synergy rows: every cardlist, deduped by name (a card can sit in High
    // Synergy AND its type list — first list wins, they carry the same score) ──
    const rows = new Map();
    for (const list of page.container?.json_dict?.cardlists ?? []) {
      for (const cv of list.cardviews ?? []) {
        if (!cv?.name) continue;
        const key = cv.name.toLowerCase();
        if (rows.has(key)) continue;
        rows.set(key, {
          legend_oracle_id: oracleId,
          card_name: cv.name,
          name_lower: key,
          synergy: cv.synergy ?? null,
          num_decks: cv.num_decks ?? null,
          potential_decks: cv.potential_decks ?? null,
          source_list: list.tag ?? null,
          updated_at: runIso,
        });
      }
    }

    // ── Theme rows: rank-ordered taglinks ──
    const themes = (page.panels?.taglinks ?? []).map((t, i) => ({
      legend_oracle_id: oracleId,
      theme_slug: t.slug,
      theme_name: t.value ?? t.slug,
      deck_count: t.count ?? null,
      rank: i,
      updated_at: runIso,
    }));

    const topThemes = themes.slice(0, 3).map(t => `${t.theme_name} ${t.deck_count}`).join(", ");
    console.log(`${legend.name} [${slug}] → ${rows.size} synergy cards, ${themes.length} themes (top: ${topThemes})`);

    if (DRY_RUN) continue;

    const synergyRows = [...rows.values()];
    for (let i = 0; i < synergyRows.length; i += 500) {
      const { error } = await supabase
        .from("legend_synergy")
        .upsert(synergyRows.slice(i, i + 500), { onConflict: "legend_oracle_id,name_lower" });
      if (error) throw new Error(`legend_synergy upsert failed: ${error.message}`);
    }
    if (themes.length) {
      const { error } = await supabase
        .from("legend_themes")
        .upsert(themes, { onConflict: "legend_oracle_id,theme_slug" });
      if (error) throw new Error(`legend_themes upsert failed: ${error.message}`);
    }
    // Prune rows this run didn't re-see (card fell off the page / theme gone).
    for (const table of ["legend_synergy", "legend_themes"]) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("legend_oracle_id", oracleId)
        .lt("updated_at", runIso);
      if (error) throw new Error(`${table} prune failed: ${error.message}`);
    }

    await sleep(200);
  }

  if (!DRY_RUN) {
    const { count } = await supabase
      .from("legend_synergy")
      .select("*", { count: "exact", head: true });
    console.log("──────────────────────────────────────────────");
    console.log(`legend_synergy table now holds: ${count ?? "?"} rows`);
  }
}

main().catch(err => {
  console.error("\nEDHREC ingest failed:", err.message);
  process.exit(1);
});
