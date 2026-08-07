-- 031_trainer_decks.sql — the three decks on the card, and the commander art
--
-- ✅ APPLIED TO PRODUCTION 2026-08-06 (project iduoct…). Suites run AGAINST
-- PRODUCTION afterwards: 031 10 ok, 025 19 ok. @zen's card still resolves.
--
-- The trainer card is a Magic card that happens to be a person: same frame, same
-- proportions, sits in a deck box. Its text box is the three decks you choose to
-- show, and its art box is your signature commander.
--
-- ── Why a new table and not party_slot ───────────────────────────────────────
-- party_slot (025) points at public.decks — a magikdex table. That coupling is
-- exactly what the standalone split removed, and it cannot represent a deck that
-- lives on Moxfield or Archidekt, which is where most people's decks actually
-- are. trainer.deck stores URLs instead, so it works for anyone whether or not
-- they use magikdex.
--
-- party_slot is left in place and unused rather than dropped — dropping a table
-- is a decision to make on purpose, not as a side effect of adding another one.
--
-- ── The rating is self-reported, with the receipt attached ───────────────────
-- You paste the ScryCheck URL and type the rating you saw. We do not scrape their
-- page and we do not call their API.
--
-- That is deliberate, not lazy. Scraping is heavier on their servers than an API
-- call, breaks silently when their markup changes, and is the one option that is
-- awkward to tell them about. Meanwhile a self-reported number NEXT TO A LINK is
-- verifiable: a reader who doubts it taps through and checks in a second. The
-- receipt does the work the verification would have.

create table if not exists trainer.deck (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer.profile(id) on delete cascade,

  -- Three is the card's text box. More would not fit in the frame, and the frame
  -- is the product.
  position int not null
    constraint deck_position_range check ("position" between 1 and 3),

  name text not null
    constraint deck_name_len check (char_length(name) between 1 and 40),

  -- Where the deck actually lives. Free-form host, because the list of deck sites
  -- is not ours to close — but it must be a URL, so the card can link it.
  deck_url text
    constraint deck_url_shape check (deck_url is null or deck_url ~* '^https?://'),
    -- No length cap beyond the shape: Moxfield and Archidekt both generate long
    -- opaque paths and truncating one produces a dead link, which is worse than a
    -- long one.

  -- ScryCheck's page for this deck. Separate from deck_url because they are two
  -- different destinations: one is the list, one is the grade.
  scrycheck_url text
    constraint deck_scrycheck_shape
      check (scrycheck_url is null or scrycheck_url ~* '^https?://(www\.)?scrycheck\.com/'),

  -- TEXT, not a number. ScryCheck's scale belongs to ScryCheck — if it is "7.2"
  -- today and "B+" next year, free text survives and an integer column does not.
  rating text
    constraint deck_rating_len check (rating is null or char_length(rating) <= 12),

  created_at timestamptz not null default now(),

  constraint deck_trainer_position_unique unique (trainer_id, position)
);

-- ── Signature commander: the art box ─────────────────────────────────────────
-- A commander, not a photo. No uploads means no storage, no moderation queue and
-- no personal image on a public card — and across a table "the Prossh guy" is
-- more recognisable than a face anyway.
--
-- Stored as the Scryfall id plus the two strings needed to render and credit it.
-- ARTIST IS NOT OPTIONAL DECORATION: Scryfall asks that art be credited, and the
-- collector line of a real card names the artist, so the frame wants it there
-- regardless.
alter table trainer.profile
  add column if not exists commander_scryfall_id text,
  add column if not exists commander_name text
    constraint profile_commander_name_len check (char_length(commander_name) <= 120),
  add column if not exists commander_art_url text,
  add column if not exists commander_artist text
    constraint profile_commander_artist_len check (char_length(commander_artist) <= 80);

alter table trainer.deck enable row level security;

grant select, insert, update, delete on trainer.deck to authenticated;

drop policy if exists deck_own on trainer.deck;
create policy deck_own on trainer.deck
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- No public read policy and no grant to anon: the public path is the handle-keyed
-- function below, which runs as definer. Same posture as every other public read
-- in this schema.

create index if not exists deck_trainer_idx on trainer.deck (trainer_id);

-- ── Public read ──────────────────────────────────────────────────────────────
-- Replaces get_trainer_party, which read party_slot and therefore magikdex decks.
-- Still keyed by handle, still returns no uuid.
drop function if exists public.get_trainer_party(extensions.citext);

create or replace function public.get_trainer_decks(p_handle extensions.citext)
returns table (
  "position"    int,
  name          text,
  deck_url      text,
  scrycheck_url text,
  rating        text
)
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select d.position, d.name, d.deck_url, d.scrycheck_url, d.rating
  from trainer.profile p
  join trainer.deck d on d.trainer_id = p.id
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted')
  order by d.position;
$$;

revoke all on function public.get_trainer_decks(extensions.citext) from public;
grant execute on function public.get_trainer_decks(extensions.citext) to anon, authenticated;

-- ── The card's public payload gains the commander ────────────────────────────
-- Dropped and recreated rather than replaced: the column list changes, and
-- `create or replace view`-style replacement is not available for a function
-- whose OUT parameters differ.
drop function if exists public.get_trainer_card(extensions.citext);

create or replace function public.get_trainer_card(p_handle extensions.citext)
returns table (
  handle             extensions.citext,
  display_name       text,
  photo_url          text,
  pronouns           text,
  bio                text,
  home_region        text,
  philosophy         text[],
  identity_mode      text,
  playstyle          text[],
  favorite_legends   text[],
  commander_name     text,
  commander_art_url  text,
  commander_artist   text,
  visibility         text,
  created_at         timestamptz
)
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select p.handle, p.display_name, p.photo_url, p.pronouns, p.bio, p.home_region,
         p.philosophy, p.identity_mode::text, p.playstyle, p.favorite_legends,
         p.commander_name, p.commander_art_url, p.commander_artist,
         p.visibility::text, p.created_at
  from trainer.profile p
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted');
$$;

revoke all on function public.get_trainer_card(extensions.citext) from public;
grant execute on function public.get_trainer_card(extensions.citext) to anon, authenticated;

-- ── Known gaps ───────────────────────────────────────────────────────────────
--
-- 1. Still no uuid in any public payload. commander_scryfall_id is stored but NOT
--    returned — the card needs the art and the credit, not the identifier.
--
-- 2. deck_url accepts any https host. Validating a list of deck sites would mean
--    owning that list, and a new one appearing should not require a migration.
--
-- 3. 030's add_deck_grade / credential badges are now redundant with deck.rating
--    and are left in place unused. Removing them is a deliberate cleanup, not a
--    side effect of this migration.
