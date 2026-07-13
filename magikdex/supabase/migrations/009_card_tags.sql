-- 009_card_tags.sql — Scryfall Tagger oracle tags + EDHREC rank (brew-relevance foundation)
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- Three additions that feed the legend-relevant brew stack:
--
--   1. cards.edhrec_rank — Scryfall's own card objects carry EDHREC rank, so
--      default stack ordering costs zero extra requests. Populated by
--      re-running `npm run ingest:cards` after this migration.
--   2. card_tags — oracle-tag rows sourced from Scryfall Tagger, written by
--      the tag ingest scripts. Two write paths share the table:
--        'otag-search'      — official api.scryfall.com `otag:` searches
--                             (Tagger tags are indexed there, verified live
--                             2026-07-02: otag:removal → 6,367 cards)
--        'tagger-card-page' — a legend's own Tagger page taggings (GraphQL),
--                             i.e. "what tags does THIS commander carry"
--   3. deck_card_tags.source — provenance for WREC tags, so auto-applied tags
--      render visually distinct from user-assigned ones (device-pass verdict:
--      auto by default, differentiated; 'plan' stays user-only by rule).

alter table cards add column if not exists edhrec_rank integer;

-- Stack ordering path: ... order by edhrec_rank nulls last.
create index if not exists cards_edhrec_rank_idx on cards(edhrec_rank);

-- Oracle-tag join table. Deliberately NO foreign key to cards(oracle_id):
-- during spoiler season a tag search can return cards not yet in the weekly
-- cards ingest, and a FK would fail whole upsert batches on ingest-order
-- timing. Rows that don't join to cards are inert and self-heal on the next
-- cards refresh.
create table if not exists card_tags (
  oracle_id  text not null,
  tag        text not null,
  source     text not null check (source in ('otag-search', 'tagger-card-page')),
  updated_at timestamptz not null default now(),
  primary key (oracle_id, tag)
);

-- Stack filtering path: all cards carrying one of the legend's theme tags.
create index if not exists card_tags_tag_idx on card_tags(tag);

-- WREC tag provenance. Existing rows are all human-assigned → default 'user'
-- backfills them correctly.
alter table deck_card_tags add column if not exists source text not null
  default 'user' check (source in ('user', 'auto'));

-- No RLS block: matches the project's existing open-access posture. card_tags
-- is public read-only reference data; writes are the scheduled ingest scripts
-- (service role), not the anon client.
