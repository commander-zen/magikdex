// ingest-shared.mjs — env + polite HTTP shared by the ingest scripts.
//
// One copy of the .env loader and the rate-limited Scryfall fetch so the tag
// scripts can't drift apart on compliance details (DATA_SOURCES.md: 50–100ms
// minimum between api.scryfall.com requests; every request MUST carry both a
// User-Agent AND an Accept header — Scryfall 400s without the pair).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

export const UA = "magikdex/1.0 (tag ingest; deck-stack.vercel.app)";

// ── Env (same contract as ingest-cards.mjs: process.env wins, ../.env fills
// gaps, SUPABASE_SERVICE_KEY is required for DB writes and never committed) ──
export function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env file — rely on process.env */ }
  return env;
}

export function makeSupabase() {
  const env = loadEnv();
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error(
      "Missing env. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_KEY.\n" +
      "SUPABASE_SERVICE_KEY is the service-role key for this server-side bulk write — never commit it.",
    );
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Polite fetch: spaced requests, UA+Accept always, patient 429 backoff ────
// The documented floor is 50–100ms between requests, but sustained pagination
// gets throttled well below that ceiling in practice (observed live: 429 after
// ~25 back-to-back pages at 120ms). 250ms sustained + escalating waits on 429
// keeps a full ingest run inside Scryfall's tolerance.
let lastRequestAt = 0;

export async function politeFetch(url, { delayMs = 250, ...init } = {}) {
  const headers = {
    "User-Agent": UA,
    Accept: "application/json",
    ...(init.headers ?? {}),
  };

  const backoffs = [5000, 15000, 45000];
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const res = await fetch(url, { ...init, headers });
    if (res.status !== 429) return res;
    if (attempt >= backoffs.length) {
      throw new Error(`Still rate-limited (429) after ${backoffs.length} backoffs at ${url} — aborting run.`);
    }
    const retryAfter = Number(res.headers.get("retry-after")) * 1000 || 0;
    const pause = Math.max(backoffs[attempt], retryAfter);
    console.log(`  429 — backing off ${pause / 1000}s…`);
    await sleep(pause);
  }
}

// ── Paginated otag search → deduped oracle_id list ──────────────────────────
// `maxPages` caps deep tags (175 cards/page); pass Infinity for a full pull.
// `order=edhrec` puts the most-played cards in the first pages, so a capped
// pull keeps exactly the cards a brew stack wants.
export async function fetchOtagOracleIds(tag, { maxPages = Infinity } = {}) {
  const ids = new Set();
  let url =
    "https://api.scryfall.com/cards/search?order=edhrec&q=" +
    encodeURIComponent(`otag:${tag}`);
  let pages = 0;
  let total = 0;

  while (url && pages < maxPages) {
    const res = await politeFetch(url);
    if (res.status === 404) return { ids: [], total: 0, pages: 0 }; // tag has no cards / vanished
    if (!res.ok) throw new Error(`otag:${tag} page ${pages + 1} failed: HTTP ${res.status}`);
    const d = await res.json();
    total = d.total_cards ?? total;
    for (const c of d.data ?? []) {
      // reversible layouts carry oracle_id per face, not at top level
      const oid = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
      if (oid) ids.add(oid);
    }
    pages += 1;
    url = d.has_more ? d.next_page : null;
  }
  return { ids: [...ids], total, pages };
}

// ── card_tags writer: upsert current rows, prune rows not re-seen this run ──
export async function writeCardTags(supabase, rows, { pruneEq, runIso }) {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("card_tags")
      .upsert(batch, { onConflict: "oracle_id,tag" });
    if (error) throw new Error(`card_tags upsert failed: ${error.message}`);
  }
  // Prune within the given scope (a tag, or a legend's oracle_id): anything
  // this run didn't re-write is stale — the tag was removed upstream.
  let q = supabase.from("card_tags").delete().lt("updated_at", runIso);
  for (const [col, val] of Object.entries(pruneEq)) q = q.eq(col, val);
  const { error } = await q;
  if (error) throw new Error(`card_tags prune failed: ${error.message}`);
}
