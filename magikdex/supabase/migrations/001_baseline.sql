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
-- COMPLETE as of the second introspection pass: types, tables, constraints,
-- indexes, functions, RLS, policies, grants. There are NO triggers on any table
-- in this schema — the trigger section of the dump came back empty, which is
-- consistent with `prokind = 'f'` returning no trigger functions either.
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
-- GROUPED BY KIND, NOT BY TABLE, and the order is load-bearing. A foreign key
-- requires a unique index on the column it points at, so every PRIMARY KEY and
-- UNIQUE has to be in place before the first FOREIGN KEY is added. Grouping
-- these by table instead put `deck_card_tags`'s FK to `deck_cards(id)` ahead of
-- `deck_cards_pkey` and the migration died on it — caught by actually running
-- this file, which is the entire reason 001 exists.

-- 1. Keys and unique constraints — the targets every FK below depends on.
alter table public.card_tags add constraint card_tags_pkey
  primary key (oracle_id, tag);
alter table public.cards add constraint cards_pkey primary key (oracle_id);
alter table public.deck_card_tags add constraint deck_card_tags_pkey primary key (id);
alter table public.deck_cards add constraint deck_cards_pkey primary key (id);
alter table public.decks add constraint decks_pkey primary key (id);
alter table public.legend_synergy add constraint legend_synergy_pkey
  primary key (legend_oracle_id, name_lower);
alter table public.legend_themes add constraint legend_themes_pkey
  primary key (legend_oracle_id, theme_slug);
alter table public.legends add constraint legends_pkey primary key (id);

alter table public.deck_card_tags add constraint deck_card_tags_deck_card_id_tag_key
  unique (deck_card_id, tag);
-- One deck per legend (008). This is the constraint that is NOT idempotent on
-- replay, which is part of why 002-022 have to be archived rather than re-run.
alter table public.decks add constraint decks_legend_id_unique unique (legend_id);
alter table public.legends add constraint legends_user_name_unique
  unique (user_id, name);

-- 2. Foreign keys.
alter table public.deck_card_tags add constraint deck_card_tags_deck_card_id_fkey
  foreign key (deck_card_id) references public.deck_cards(id) on delete cascade;
alter table public.deck_cards add constraint deck_cards_deck_id_fkey
  foreign key (deck_id) references public.decks(id) on delete cascade;
alter table public.decks add constraint decks_legend_id_fkey
  foreign key (legend_id) references public.legends(id);
alter table public.decks add constraint decks_partner_legend_id_fkey
  foreign key (partner_legend_id) references public.legends(id);

-- 3. Check constraints — order-independent, so they come last.
alter table public.card_tags add constraint card_tags_source_check
  check (source = any (array['otag-search'::text, 'tagger-card-page'::text]));
alter table public.deck_card_tags add constraint deck_card_tags_source_check
  check (source = any (array['user'::text, 'auto'::text]));
alter table public.deck_cards add constraint deck_cards_ownership_check
  check (ownership = any (array['Own'::text, 'Missing'::text, 'Proxy'::text]));
alter table public.decks add constraint decks_partner_differs
  check ((partner_legend_id is null) or (partner_legend_id <> legend_id));
alter table public.decks add constraint decks_platform_check
  check (platform = any (array['moxfield'::text, 'archidekt'::text]));
alter table public.decks add constraint decks_status_check
  check (status = any (array['Active'::text, 'Shelved'::text, 'Retired'::text]));

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

-- ── Functions ────────────────────────────────────────────────────────────────
-- The two RPCs the client calls (010/012/015). Placed after the tables because
-- `language sql` bodies are parsed and validated at CREATE time — unlike
-- plpgsql, these cannot be created ahead of the relations they reference.
--
-- Both are SECURITY INVOKER (the default — neither declares SECURITY DEFINER),
-- so they read `cards` / `card_tags` / `deck_cards` under the CALLER's RLS. That
-- is why the `p_deck_id` exclusion is safe: a caller cannot use it to probe
-- someone else's deck contents, because `deck_cards_own` filters the subquery
-- for them. See finding #4 for the trap this creates if that ever changes.

CREATE OR REPLACE FUNCTION public.brew_stack(p_legend_oracle_id text, p_color_identity text[], p_deck_id uuid DEFAULT NULL::uuid, p_exclude_lands boolean DEFAULT true, p_limit integer DEFAULT 400)
 RETURNS TABLE(oracle_id text, scryfall_id text, name text, type_line text, oracle_text text, mana_cost text, cmc numeric, color_identity text[], layout text, card_faces jsonb, image_normal text, art_crop text, edhrec_rank integer, matched_tags text[], synergy numeric, theme_boost integer)
 LANGUAGE sql
 STABLE
AS $function$
  with themes as (
    select lt.theme_slug as otag, (5 - lt.rank)::int as boost
    from legend_themes lt
    where lt.legend_oracle_id = p_legend_oracle_id and lt.rank < 5
    union all
    select a.otag, (5 - lt.rank)::int
    from legend_themes lt
    join (values
      ('burn',                  'synergy-burn'),
      ('tokens',                'repeatable-token-generator'),
      ('aristocrats',           'sacrifice-outlet'),
      ('card-draw',             'card-advantage'),
      ('reanimator',            'reanimate'),
      ('spell-copy',            'copy'),
      ('clones',                'clone'),
      ('wheels',                'wheel'),
      ('anthems',               'anthem'),
      ('counterspells',         'counterspell'),
      ('extra-combats',         'extra-combat'),
      ('extra-turns',           'extra-turn'),
      ('plus-1-plus-1-counters','counters-matter')
    ) as a(theme_slug, otag) on a.theme_slug = lt.theme_slug
    where lt.legend_oracle_id = p_legend_oracle_id and lt.rank < 5
  ),
  legend_tags as (
    select ct.tag from card_tags ct
    where ct.oracle_id = p_legend_oracle_id
      and ct.source = 'tagger-card-page'
    union
    select t.otag from themes t
  ),
  tag_matches as (
    select ct.oracle_id,
           array_agg(ct.tag order by ct.tag) as matched_tags,
           max(t.boost) as theme_boost
    from card_tags ct
    join legend_tags lt on lt.tag = ct.tag
    left join themes t on t.otag = ct.tag
    group by ct.oracle_id
  ),
  syn as (
    select ls.name_lower, ls.synergy
    from legend_synergy ls
    where ls.legend_oracle_id = p_legend_oracle_id
  )
  select c.oracle_id, c.scryfall_id, c.name, c.type_line, c.oracle_text,
         c.mana_cost, c.cmc, c.color_identity, c.layout, c.card_faces,
         c.image_normal, c.art_crop, c.edhrec_rank, m.matched_tags, s.synergy,
         m.theme_boost
  from cards c
  left join tag_matches m on m.oracle_id = c.oracle_id
  left join syn s on s.name_lower = c.name_lower
  where (m.oracle_id is not null or s.name_lower is not null)
    and c.color_identity <@ p_color_identity
    and coalesce(c.legal_commander, false)
    and coalesce(c.layout, '') not in ('token', 'double_faced_token', 'emblem', 'art_series')
    and c.oracle_id <> p_legend_oracle_id
    and (not p_exclude_lands or c.type_line !~* '\yland\y')
    and (p_deck_id is null or not exists (
      select 1 from deck_cards dc
      where dc.deck_id = p_deck_id and dc.card_name = c.name
    ))
  order by s.synergy desc nulls last, m.theme_boost desc nulls last,
           c.edhrec_rank asc nulls last, c.name
  limit p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.tag_stack(p_tags text[], p_color_identity text[], p_deck_id uuid DEFAULT NULL::uuid, p_exclude_lands boolean DEFAULT true, p_limit integer DEFAULT 400)
 RETURNS TABLE(oracle_id text, scryfall_id text, name text, type_line text, oracle_text text, mana_cost text, cmc numeric, color_identity text[], layout text, card_faces jsonb, image_normal text, art_crop text, edhrec_rank integer, matched_tags text[])
 LANGUAGE sql
 STABLE
AS $function$
  with tag_matches as (
    select ct.oracle_id, array_agg(ct.tag order by ct.tag) as matched_tags
    from card_tags ct
    where ct.tag = any(p_tags)
    group by ct.oracle_id
  )
  select c.oracle_id, c.scryfall_id, c.name, c.type_line, c.oracle_text,
         c.mana_cost, c.cmc, c.color_identity, c.layout, c.card_faces,
         c.image_normal, c.art_crop, c.edhrec_rank, m.matched_tags
  from cards c
  join tag_matches m on m.oracle_id = c.oracle_id
  where c.color_identity <@ p_color_identity
    and coalesce(c.legal_commander, false)
    and coalesce(c.layout, '') not in ('token', 'double_faced_token', 'emblem', 'art_series')
    and (not p_exclude_lands or c.type_line !~* '\yland\y')
    and (p_deck_id is null or not exists (
      select 1 from deck_cards dc
      where dc.deck_id = p_deck_id and dc.card_name = c.name
    ))
  order by c.edhrec_rank asc nulls last, c.name
  limit p_limit;
$function$;

-- Both are called as PostgREST RPCs from the client, so anon and authenticated
-- need EXECUTE. Stated explicitly rather than leaning on Postgres' default of
-- granting EXECUTE to PUBLIC, so the baseline replays identically on a database
-- where that default has been tightened.
grant execute on function
  public.brew_stack(text, text[], uuid, boolean, integer) to anon, authenticated, service_role;
grant execute on function
  public.tag_stack(text[], text[], uuid, boolean, integer) to anon, authenticated, service_role;

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
-- 4. NEITHER RPC PINS ITS search_path, AND BOTH REFERENCE TABLES UNQUALIFIED.
--    `brew_stack` and `tag_stack` read `cards`, `card_tags`, `legend_themes`,
--    `legend_synergy` and `deck_cards` with no schema qualification and no
--    `set search_path`.
--
--    HARMLESS TODAY: both are SECURITY INVOKER, so a caller who redirects the
--    search_path only redirects it to tables they already have their own
--    privileges on — they gain nothing.
--
--    IT BECOMES A VULNERABILITY THE MOMENT EITHER IS MADE SECURITY DEFINER,
--    which is a one-word edit someone could plausibly make to "fix" a
--    permissions problem. At that point an unqualified reference under an
--    attacker-controlled search_path executes the definer's privileges against
--    the attacker's tables. The trainer migrations already pin search_path on
--    every definer function, so the pattern is established in this repo — these
--    two predate it and are the outliers. Add `set search_path = public` to
--    both; it is free and it removes the trap rather than documenting it.
--
-- 5. `decks` AND `deck_cards` WERE THE ONLY MISSING TABLES. Six of the eight
--    live tables do have create-table DDL in the repo (002, 006, 007, 009, 011).
--    The gap was small; it was just load-bearing, since `decks` is what every
--    later migration alters and what `party_slot` was going to reference.
