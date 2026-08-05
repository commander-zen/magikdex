-- 001_baseline.sql — the schema that was never captured
--
-- SQUASHED BASELINE, generated from the live project (ref iduoct…) on
-- 2026-08-05 by pg_catalog introspection, not by hand.
--
-- ── Why this file exists ─────────────────────────────────────────────────────
-- Migrations in this repo start at 002 and consist largely of ALTERs against
-- tables no migration ever created: `decks` and `deck_cards` were made in the
-- dashboard and exist nowhere in version control. Consequence: `supabase db
-- reset` fails on the first statement of 002 (`alter table decks add column`),
-- so the migration directory has never been replayable and no migration in this
-- project has ever been tested before being pasted into production.
--
-- This file closes that. It is the CURRENT state of the public schema, squashed
-- — not the June shape of these tables. Reconstructing the original shape is
-- guesswork (002 also does `alter column url drop not null`), and a squash is
-- the standard resolution for a history that was never recorded.
--
-- ── How to use it ────────────────────────────────────────────────────────────
-- 002-022 are now HISTORY, not steps. They must move to
-- supabase/migrations/archive/ before `db reset` is run, or they will replay on
-- top of a schema that already contains their results. Most are guarded with
-- `if not exists` and would no-op, but 008 (`add constraint`), 019, 020 and 021
-- are not idempotent — 021 is a data purge.
--
-- After archiving, the replay order is:
--   001_baseline.sql  →  the trainer migration  →  nothing else.
--
-- ⚠️ INCOMPLETE: FUNCTIONS ARE NOT IN HERE. The introspection query covered
-- types, tables, constraints, indexes, RLS, policies, grants and triggers — but
-- not functions. `tag_stack` and `brew_stack` are live RPCs created by 010/012/
-- 015, and archiving those migrations without dumping the functions first would
-- lose them. Dump functions and append before archiving anything.
--
-- ⚠️ Two live security findings are recorded at the foot of this file. They are
-- reproduced faithfully here rather than fixed — a baseline that differs from
-- production defeats its own purpose. Fixes belong in a follow-up migration.

-- ── Extensions ───────────────────────────────────────────────────────────────
-- gen_random_uuid() is the default on four tables below.
create extension if not exists pgcrypto with schema extensions;

-- ── Types ────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.wrec_tag as enum
    ('ramp', 'card-advantage', 'disruption', 'mass-disruption', 'plan');
exception
  when duplicate_object then null;
end $$;

-- ── Tables ───────────────────────────────────────────────────────────────────
-- Columns only. Every constraint is an ALTER further down, so creation order
-- never depends on foreign-key order.

create table if not exists public.card_tags (
  oracle_id text not null,
  tag text not null,
  source text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cards (
  oracle_id text not null,
  scryfall_id text,
  name text not null,
  name_lower text not null,
  type_line text,
  oracle_text text,
  mana_cost text,
  cmc numeric,
  color_identity text[],
  layout text,
  card_faces jsonb,
  image_normal text,
  art_crop text,
  updated_at timestamp with time zone default now() not null,
  edhrec_rank integer,
  legal_commander boolean
);

create table if not exists public.deck_card_tags (
  id uuid default gen_random_uuid() not null,
  deck_card_id uuid not null,
  -- Schema-qualified deliberately: the introspection dump emitted a bare
  -- `wrec_tag`, which only resolves if public is on the search_path.
  tag public.wrec_tag not null,
  created_at timestamp with time zone default now() not null,
  source text default 'user'::text not null
);

create table if not exists public.deck_cards (
  id uuid default gen_random_uuid() not null,
  deck_id uuid not null,
  -- Links to `cards` by NAME, not by a foreign key to cards.oracle_id. That is
  -- why this table and `decks` are self-contained in the baseline.
  card_name text not null,
  quantity integer default 1 not null,
  section text,
  ownership text,
  created_at timestamp with time zone default now()
);

create table if not exists public.decks (
  id uuid default gen_random_uuid() not null,
  legend text not null,
  -- Nullable because 002 dropped their NOT NULL for brew-created decks, which
  -- have no external decklist. This is the post-002 state, as squashed.
  url text,
  platform text,
  scrycheck_score text,
  status text default 'Active'::text not null,
  created_at timestamp with time zone default now(),
  legend_id uuid,
  build_name text,
  -- Defaulted server-side, which is what makes anonymous sign-in work: the row
  -- is owned from the first insert without the client sending an id (013).
  user_id uuid default auth.uid(),
  partner_legend_id uuid
);

create table if not exists public.legend_synergy (
  legend_oracle_id text not null,
  card_name text not null,
  name_lower text not null,
  synergy numeric,
  num_decks integer,
  potential_decks integer,
  source_list text,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.legend_themes (
  legend_oracle_id text not null,
  theme_slug text not null,
  theme_name text,
  deck_count integer,
  rank smallint not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.legends (
  id uuid default gen_random_uuid() not null,
  name text not null,
  scryfall_id text,
  image_uri text,
  created_at timestamp with time zone default now() not null,
  type_line text,
  oracle_text text,
  mana_cost text,
  color_identity text[],
  user_id uuid default auth.uid()
);

-- ── Constraints ──────────────────────────────────────────────────────────────
alter table public.card_tags add constraint card_tags_pkey
  primary key (oracle_id, tag);
alter table public.card_tags add constraint card_tags_source_check
  check (source = any (array['otag-search'::text, 'tagger-card-page'::text]));

alter table public.cards add constraint cards_pkey primary key (oracle_id);

alter table public.deck_card_tags add constraint deck_card_tags_pkey
  primary key (id);
alter table public.deck_card_tags add constraint deck_card_tags_deck_card_id_fkey
  foreign key (deck_card_id) references public.deck_cards(id) on delete cascade;
alter table public.deck_card_tags add constraint deck_card_tags_deck_card_id_tag_key
  unique (deck_card_id, tag);
alter table public.deck_card_tags add constraint deck_card_tags_source_check
  check (source = any (array['user'::text, 'auto'::text]));

alter table public.deck_cards add constraint deck_cards_pkey primary key (id);
alter table public.deck_cards add constraint deck_cards_deck_id_fkey
  foreign key (deck_id) references public.decks(id) on delete cascade;
alter table public.deck_cards add constraint deck_cards_ownership_check
  check (ownership = any (array['Own'::text, 'Missing'::text, 'Proxy'::text]));

alter table public.decks add constraint decks_pkey primary key (id);
alter table public.decks add constraint decks_legend_id_fkey
  foreign key (legend_id) references public.legends(id);
-- One deck per legend (008). This is the constraint that is NOT idempotent on
-- replay, which is part of why 002-022 have to be archived rather than re-run.
alter table public.decks add constraint decks_legend_id_unique unique (legend_id);
alter table public.decks add constraint decks_partner_legend_id_fkey
  foreign key (partner_legend_id) references public.legends(id);
alter table public.decks add constraint decks_partner_differs
  check ((partner_legend_id is null) or (partner_legend_id <> legend_id));
alter table public.decks add constraint decks_platform_check
  check (platform = any (array['moxfield'::text, 'archidekt'::text]));
alter table public.decks add constraint decks_status_check
  check (status = any (array['Active'::text, 'Shelved'::text, 'Retired'::text]));

alter table public.legend_synergy add constraint legend_synergy_pkey
  primary key (legend_oracle_id, name_lower);

alter table public.legend_themes add constraint legend_themes_pkey
  primary key (legend_oracle_id, theme_slug);

alter table public.legends add constraint legends_pkey primary key (id);
alter table public.legends add constraint legends_user_name_unique
  unique (user_id, name);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists card_tags_tag_idx on public.card_tags using btree (tag);
create index if not exists cards_edhrec_rank_idx on public.cards using btree (edhrec_rank);
create index if not exists cards_name_idx on public.cards using btree (name);
create index if not exists cards_name_lower_idx on public.cards using btree (name_lower);
create index if not exists deck_card_tags_deck_card_id_idx
  on public.deck_card_tags using btree (deck_card_id);
create index if not exists deck_cards_card_name_idx
  on public.deck_cards using btree (card_name);
create index if not exists deck_cards_deck_id_idx on public.deck_cards using btree (deck_id);
create index if not exists decks_user_idx on public.decks using btree (user_id);
create index if not exists legends_user_idx on public.legends using btree (user_id);

-- ── Row level security ───────────────────────────────────────────────────────
alter table public.card_tags      enable row level security;
alter table public.cards          enable row level security;
alter table public.deck_card_tags enable row level security;
alter table public.deck_cards     enable row level security;
alter table public.decks          enable row level security;
alter table public.legend_synergy enable row level security;
alter table public.legend_themes  enable row level security;
alter table public.legends        enable row level security;

-- ── Policies ─────────────────────────────────────────────────────────────────
-- The shared card knowledge base is world-readable on purpose: it is not user
-- data, it is expensive to rebuild, and every client needs it (007, 009, 011).
create policy card_tags_read on public.card_tags
  for select to public using (true);
create policy cards_read on public.cards
  for select to public using (true);
create policy legend_synergy_read on public.legend_synergy
  for select to public using (true);
create policy legend_themes_read on public.legend_themes
  for select to public using (true);

-- ⚠️ See finding #1 at the foot of this file. `with check (true)` and
-- `using (true)` mean ANY signed-in user may insert or overwrite ANY row in the
-- shared cache. Reproduced as-is; not a recommendation.
create policy cards_insert on public.cards
  for insert to authenticated with check (true);
create policy cards_update on public.cards
  for update to authenticated using (true) with check (true);

-- User data: ownership through user_id, or through a join to it (013).
create policy decks_own on public.decks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy legends_own on public.legends
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy deck_cards_own on public.deck_cards
  for all to authenticated
  using (exists (
    select 1 from public.decks d
    where d.id = deck_cards.deck_id and d.user_id = auth.uid()))
  with check (exists (
    select 1 from public.decks d
    where d.id = deck_cards.deck_id and d.user_id = auth.uid()));

create policy deck_card_tags_own on public.deck_card_tags
  for all to authenticated
  using (exists (
    select 1 from public.deck_cards dc
    join public.decks d on d.id = dc.deck_id
    where dc.id = deck_card_tags.deck_card_id and d.user_id = auth.uid()))
  with check (exists (
    select 1 from public.deck_cards dc
    join public.decks d on d.id = dc.deck_id
    where dc.id = deck_card_tags.deck_card_id and d.user_id = auth.uid()));

-- ── Grants ───────────────────────────────────────────────────────────────────
-- These are Supabase's DEFAULT grants on public-schema tables, never revoked on
-- this project. The introspection dump emitted 168 separate GRANT statements
-- saying exactly this; collapsed here without changing meaning.
--
-- ⚠️ See finding #2. The `truncate` in this list is not filtered by RLS.
grant select, insert, update, delete, truncate, references, trigger
  on all tables in schema public to anon, authenticated, service_role;

-- ── FINDINGS FROM THE INTROSPECTION ──────────────────────────────────────────
--
-- 1. ANY AUTHENTICATED USER CAN REWRITE THE ENTIRE SHARED CARD CACHE. LIVE.
--    `cards_update` is `for update to authenticated using (true) with check
--    (true)` — no ownership predicate at all. Any of the ~85 accounts can
--    overwrite any row in `cards`: names, oracle text, images, legality.
--    `cards_insert` is the same shape. This is reachable through the REST API
--    today with nothing but a signed-in session.
--
--    It is presumably deliberate — the client fills the cache on demand, which
--    needs a write path. But the blast radius is "one user corrupts the card
--    database for everyone", and the ingest scripts already use the service key,
--    so the client write may not be needed at all. Fix belongs in its own
--    migration: either move cache-fill to service_role, or narrow with check to
--    inserts of rows that do not yet exist.
--
-- 2. `truncate` IS GRANTED TO anon ON EVERY TABLE, AND RLS DOES NOT FILTER IT.
--    Row level security applies to SELECT/INSERT/UPDATE/DELETE. TRUNCATE is
--    checked only against table privileges, so no policy stands between anon and
--    an empty table.
--
--    NOT currently exploitable: PostgREST exposes no TRUNCATE verb, and the only
--    RPCs on this project are `tag_stack` and `brew_stack`. So this needs a SQL
--    path that does not exist yet. It is a loaded gun with no trigger attached —
--    the trigger being any future `security definer` function that takes
--    caller-supplied SQL, or a change to what anon may execute.
--
--    `revoke truncate on all tables in schema public from anon, authenticated;`
--    costs nothing and is not in this file because a baseline must match
--    production. Put it in the same follow-up as #1.
--
-- 3. `decks` AND `deck_cards` WERE THE ONLY MISSING TABLES. Six of the eight
--    live tables do have create-table DDL in the repo (002, 006, 007, 009, 011).
--    The gap was small; it was just load-bearing, since `decks` is what every
--    later migration alters and what `party_slot` was going to reference.
