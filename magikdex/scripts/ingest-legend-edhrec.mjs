#!/usr/bin/env node
// ingest-legend-edhrec.mjs — cache EDHREC commander pages (synergy card
// lists + theme tags) into legend_synergy / legend_themes.
//
// MANUAL, dev-machine only (same posture as the other ingests). Post-013
// the SERVICE_ROLE key is required — RLS blocks the publishable key from
// writing the shared cache tables:
//
//   SUPABASE_SERVICE_KEY=<service_role> npm run ingest:legend-edhrec            (Box legends)
//   SUPABASE_SERVICE_KEY=<service_role> npm run ingest:legend-edhrec -- --all   (EVERY commander)
//   npm run ingest:legend-edhrec -- --dry-run --name="Hawkeye, Young Avenger"
//
// --all walks every commander-legal candidate in the cards cache (legendary
// creatures + "can be your commander" cards), most-played first (EDHREC rank
// order) so an interrupted run still covers what people actually brew.
// ~2,900 pages at politeFetch's 400ms spacing ≈ 25–40 min; commanders with
// no EDHREC page 404 and are skipped. Together with brew_stack v4 (015),
// this makes the brew stack relevant for every commander in the game —
// Ben's 2026-07-03 verdict: the generic fallback stack loses a Commander
// player instantly.
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

import { makeSupabase, politeFetch } from "./ingest-shared.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ALL = args.includes("--all");
const ONLY_NAME = args.find(a => a.startsWith("--name="))?.slice(7) ?? null;

const EDHREC_DELAY_MS = 400; // gentler spacing for the unofficial endpoint

const supabase = DRY_RUN && ONLY_NAME ? null : makeSupabase();

// EDHREC commander slugs: lowercase, punctuation stripped, spaces → hyphens
// ("Hawkeye, Young Avenger" → hawkeye-young-avenger). DFC/adventure names
// slug from the FRONT FACE only — EDHREC pages live at the front face's
// slug, and "A // B" would otherwise mint a bogus "a-b" slug. A miss logs
// and skips, never throws.
function edhrecSlug(name) {
  return name
    .split("//")[0]
    .trim()
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

// --all: every commander-legal candidate in the cards cache — legendary
// creatures plus anything whose text grants commander eligibility. Paged
// reads (PostgREST caps at 1,000 rows); EDHREC-rank order = most played
// first.
async function fetchAllCommanders() {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("cards")
      .select("name, oracle_id")
      .eq("legal_commander", true)
      // `*` wildcards — inside an or() filter string PostgREST expects *
      // (verified live: this exact filter returns 3,321 candidates)
      .or("and(type_line.ilike.*legendary*,type_line.ilike.*creature*),oracle_text.ilike.*can be your commander*")
      .order("edhrec_rank", { ascending: true, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`commander enumeration failed: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function fetchCommanderPage(slug) {
  const res = await politeFetch(
    `https://json.edhrec.com/pages/commanders/${slug}.json`,
    { delayMs: EDHREC_DELAY_MS },
  );
  // Any 4xx = "this slug has no commander page" — skip, never abort. Seen
  // live: 404 for unplayed commanders, 403 for non-commander false positives
  // (battles whose back face is a legendary creature, e.g.
  // invasion-of-ikoria killed the first --all run). 5xx/exhausted-429 still
  // throw: those are EDHREC-side problems worth stopping for.
  if (res.status >= 400 && res.status < 500) return null;
  if (!res.ok) throw new Error(`EDHREC ${slug}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  let legends;
  if (ONLY_NAME && DRY_RUN) {
    legends = [{ name: ONLY_NAME }];
  } else if (ALL) {
    legends = await fetchAllCommanders();
    console.log(`--all: ${legends.length} commander candidates (most played first)`);
  } else {
    let q = supabase.from("legends").select("name");
    if (ONLY_NAME) q = q.eq("name", ONLY_NAME);
    const { data, error } = await q;
    if (error) throw new Error(`legends read failed: ${error.message}`);
    legends = data ?? [];
  }
  if (legends.length === 0) {
    console.log("Nothing to fetch.");
    return;
  }

  const runIso = new Date().toISOString();
  let done = 0, missed = 0, synergyTotal = 0;

  for (const legend of legends) {
    const slug = edhrecSlug(legend.name);
    const oracleId = legend.oracle_id ?? await lookupOracleId(legend.name);
    if (!oracleId) {
      console.log(`${legend.name}: not in the cards cache — skipped.`);
      continue;
    }

    const page = await fetchCommanderPage(slug);
    if (!page) {
      missed++;
      if (!ALL) console.log(`${legend.name}: no EDHREC page at "${slug}" — skipped (new/obscure commander?).`);
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

    if (!ALL) {
      const topThemes = themes.slice(0, 3).map(t => `${t.theme_name} ${t.deck_count}`).join(", ");
      console.log(`${legend.name} [${slug}] → ${rows.size} synergy cards, ${themes.length} themes (top: ${topThemes})`);
    }

    if (DRY_RUN) { done++; synergyTotal += rows.size; continue; }

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

    done++;
    synergyTotal += rows.size;
    if (ALL && done % 100 === 0) {
      console.log(`  …${done} commanders cached (${missed} without a page so far, ${synergyTotal} synergy rows)`);
    }
  }

  console.log("──────────────────────────────────────────────");
  console.log(`cached ${done} commanders; ${missed} had no EDHREC page`);
  if (!DRY_RUN) {
    const { count } = await supabase
      .from("legend_synergy")
      .select("*", { count: "exact", head: true });
    console.log(`legend_synergy table now holds: ${count ?? "?"} rows`);
  }
}

main().catch(err => {
  console.error("\nEDHREC ingest failed:", err.message);
  process.exit(1);
});
