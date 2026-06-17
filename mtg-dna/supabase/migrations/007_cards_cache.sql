-- 007_cards_cache.sql — local Scryfall gameplay cache (cards table)
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- The target architecture from DATA_SOURCES.md: ingest Scryfall's `oracle_cards`
-- bulk file (~168 MB, one object per Oracle card) into our DB on a schedule, and
-- have the app read THIS table instead of looping card-by-card against the live
-- API. The app's access pattern is name → gameplay data (getCardData(name) and
-- the legend identity backfill), so name/name_lower are the indexed lookup keys.
--
-- GAMEPLAY DATA ONLY — no prices. Per DATA_SOURCES.md prices change daily and we
-- don't use them; caching them here would just rot. Everything stored below
-- (name, type, oracle, mana, cmc, color identity, faces, art) changes rarely, so
-- a weekly / post-set-release refresh of this table is sufficient.

create table if not exists cards (
  -- Oracle identifier is the natural gameplay key (one row per Oracle card).
  oracle_id      text primary key,
  -- Representative printing's Scryfall id, kept for art/image and traceability.
  scryfall_id    text,
  name           text not null,
  -- Normalized lowercase name for case-insensitive exact lookup — the app
  -- matches typed/stored names against this, not the display `name`.
  name_lower     text not null,
  type_line      text,
  oracle_text    text,
  mana_cost      text,
  cmc            numeric,
  color_identity text[],
  -- Layout distinguishes DFCs/adventures/etc.; card_faces holds per-face data
  -- (front/back oracle text, mana, images) for those layouts.
  layout         text,
  card_faces     jsonb,
  -- image_uris.normal / image_uris.art_crop of the representative printing,
  -- null when the card has no single-face image (DFCs carry per-face images in
  -- card_faces instead).
  image_normal   text,
  art_crop       text,
  updated_at     timestamptz not null default now()
);

-- Exact-match lookup on the display name.
create index if not exists cards_name_idx on cards(name);

-- Case-insensitive exact lookup — the primary access path.
create index if not exists cards_name_lower_idx on cards(name_lower);

-- No RLS block: matches the project's existing open-access posture on
-- legends/decks/deck_cards. This is public read-only gameplay reference data;
-- writes are the scheduled bulk ingest, not the anon client.
