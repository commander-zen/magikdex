-- 002_legends.sql — normalize commanders out of decks
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).

create table if not exists legends (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  scryfall_id text,
  image_uri text,
  created_at timestamptz not null default now()
);

alter table decks add column if not exists legend_id uuid references legends(id);
alter table decks add column if not exists build_name text;

-- Brew-created decks have no external decklist, so the vault-import columns
-- can no longer be required. The platform CHECK still applies to non-null values.
alter table decks alter column url drop not null;
alter table decks alter column platform drop not null;

-- decks.legend (text) is intentionally kept until reads migrate to legend_id.

-- No RLS block: anon read/write on decks/deck_cards currently passes, so
-- legends is left matching the project's existing open-access posture.
