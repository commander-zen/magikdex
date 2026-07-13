-- 006_wrec_tags.sql — multi-tag WREC categorization for deck cards
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- This is the input that finally feeds WREC and sets the long-broken
-- _deckCategory equivalent: a card carries zero or more WREC tags, and a deck's
-- per-category totals can exceed its card count by design (one card can be ramp
-- AND card-advantage). That's why tags live in a join table, never a single
-- column on deck_cards.

-- Fixed five-value WREC tag set — the enum rejects anything else at the DB
-- level. Wrapped so re-running the migration is safe.
do $$ begin
  create type wrec_tag as enum (
    'ramp',
    'card-advantage',
    'disruption',
    'mass-disruption',
    'plan'
  );
exception
  when duplicate_object then null;
end $$;

-- Join: one deck_card → many tags. NOT a column on deck_cards, because
-- category totals are allowed to exceed deck size (multi-tag by design).
create table if not exists deck_card_tags (
  id uuid primary key default gen_random_uuid(),
  deck_card_id uuid not null references deck_cards(id) on delete cascade,
  tag wrec_tag not null,
  created_at timestamptz not null default now(),
  unique (deck_card_id, tag)
);

create index if not exists deck_card_tags_deck_card_id_idx
  on deck_card_tags(deck_card_id);

-- No RLS block: matches the project's existing open-access posture on
-- decks/deck_cards (anon read/write currently passes).
