#!/usr/bin/env node
// ingest-cards.mjs — local Scryfall gameplay-cache loader.
//
// MANUAL, dev-machine only. NOT a serverless function, NOT wired to any cron or
// deploy. Run it by hand after a set release to refresh the `cards` table
// (migration 007) from Scryfall's `oracle_cards` bulk file (~168 MB).
//
//   SUPABASE_SERVICE_KEY=... npm run ingest:cards
//
// Requires (read from process.env, falling back to the project-root .env):
//   - SUPABASE_URL          (or VITE_SUPABASE_URL — reused if SUPABASE_URL unset)
//   - SUPABASE_SERVICE_KEY  the Supabase SERVICE ROLE key. This is a server-side
//                           bulk write that bypasses RLS; the anon key is NOT
//                           used here. The service key must be provided via env
//                           and MUST NEVER be committed (.env is gitignored).
//
// Compliance (DATA_SOURCES.md): the manifest call hits api.scryfall.com once
// with a User-Agent; the bulk file itself is on *.scryfall.io, which is NOT
// rate-limited. The array is STREAMED, never buffered whole. Gameplay data
// only — no prices.

import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

// stream-json / stream-chain are CommonJS — require them to sidestep ESM interop.
const require = createRequire(import.meta.url);
const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/stream-array.js");

const UA = "magikdex/1.0 (bulk ingest; deck-stack.vercel.app)";
const BULK_MANIFEST = "https://api.scryfall.com/bulk-data";
const BATCH_SIZE = 500;

// ── Env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      // process.env wins; .env only fills gaps.
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env file — rely on process.env */ }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing env. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_KEY.\n" +
    "SUPABASE_SERVICE_KEY is the service-role key for this server-side bulk write — never commit it.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Card → cards-table row (migration 007 columns) ──────────────────────────
function mapCard(c) {
  const faces = c.card_faces ?? null;
  const topImg = c.image_uris ?? null;
  // DFCs (transform / modal_dfc / etc.) carry images per face, not at top level.
  const faceImg = faces?.[0]?.image_uris ?? null;
  return {
    oracle_id: c.oracle_id,
    scryfall_id: c.id ?? null,
    name: c.name,
    name_lower: (c.name ?? "").toLowerCase(),
    type_line: c.type_line ?? null,
    oracle_text: c.oracle_text ?? null,
    mana_cost: c.mana_cost ?? null,
    cmc: c.cmc ?? null,
    color_identity: c.color_identity ?? [],
    layout: c.layout ?? null,
    card_faces: faces, // jsonb — supabase-js serializes the array/object
    image_normal: topImg?.normal ?? faceImg?.normal ?? null,
    art_crop: topImg?.art_crop ?? faceImg?.art_crop ?? null,
    // migration 009 — Scryfall ships EDHREC rank on every card object, so the
    // brew stack's default ordering costs zero extra requests.
    edhrec_rank: c.edhrec_rank ?? null,
    // migration 010 — the oracle bulk includes un-sets/banned/Alchemy cards;
    // brew_stack filters on this so the stack never deals illegal cards.
    legal_commander: c.legalities?.commander === "legal",
    updated_at: new Date().toISOString(),
  };
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Fetching Scryfall bulk-data manifest…");
  const manifestRes = await fetch(BULK_MANIFEST, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!manifestRes.ok) throw new Error(`Manifest fetch failed: HTTP ${manifestRes.status}`);
  const { data } = await manifestRes.json();
  const oracle = (data ?? []).find(d => d.type === "oracle_cards");
  if (!oracle?.download_uri) throw new Error("No oracle_cards entry in bulk-data manifest.");
  console.log(`oracle_cards: ~${(oracle.size / 1048576).toFixed(1)} MB → ${oracle.download_uri}`);

  const fileRes = await fetch(oracle.download_uri, { headers: { "User-Agent": UA } });
  if (!fileRes.ok || !fileRes.body) throw new Error(`Bulk file fetch failed: HTTP ${fileRes.status}`);

  // Stream the JSON array — never buffer the whole ~168 MB file.
  const pipeline = chain([Readable.fromWeb(fileRes.body), parser(), streamArray()]);

  const seen = new Set();        // guard against duplicate PKs within a batch
  let batch = [];
  let processed = 0;
  let skipped = 0;
  let written = 0;
  let batchesWritten = 0;

  async function flush() {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    const { error } = await supabase.from("cards").upsert(rows, { onConflict: "oracle_id" });
    if (error) throw new Error(`Upsert failed (batch ${batchesWritten + 1}): ${error.message}`);
    batchesWritten += 1;
    written += rows.length;
    console.log(`  batch ${batchesWritten}: +${rows.length} rows (${written} upserted)`);
  }

  // for-await drives backpressure: the stream pauses while a batch upserts.
  for await (const { value } of pipeline) {
    processed += 1;
    if (!value?.oracle_id || seen.has(value.oracle_id)) { skipped += 1; continue; }
    seen.add(value.oracle_id);
    batch.push(mapCard(value));
    if (batch.length >= BATCH_SIZE) await flush();
    if (processed % 5000 === 0) console.log(`processed ${processed} cards…`);
  }
  await flush();

  // Final count from the table itself.
  const { count } = await supabase
    .from("cards")
    .select("*", { count: "exact", head: true });

  console.log("──────────────────────────────────────────────");
  console.log(`processed: ${processed}  |  upserted: ${written}  |  skipped: ${skipped}`);
  console.log(`batches written: ${batchesWritten}`);
  console.log(`cards table now holds: ${count ?? "?"} rows`);
}

main().catch(err => {
  console.error("\nIngest failed:", err.message);
  process.exit(1);
});
