-- 033_trainer_links.sql — the back of the card is a linktree, and a fix for what
-- 032 quietly dropped
--
-- ⚠️ APPLY THIS ONE PROMPTLY. Half of it is a REGRESSION FIX for a bug 032 put
-- into production on 2026-08-07.
--
-- ── PART 1: the regression ───────────────────────────────────────────────────
-- 032 dropped and recreated public.get_trainer_card in order to add three
-- columns. It rebuilt the RETURNS TABLE list from 025's version and therefore
-- SILENTLY LOST the three columns 031 had added in between:
--
--     commander_name, commander_art_url, commander_artist
--
-- Live consequences since 032 applied: the art box lost its commander wash, the
-- back lost its "signature" field, and the collector line fell back to the string
-- "magikdex" instead of naming the artist. That last one is not cosmetic —
-- SCRYFALL ASKS THAT ART BE CREDITED, and the credit disappeared from every
-- public card without anything failing.
--
-- WHY NO TEST CAUGHT IT. 032's assertion 16 checks that get_trainer_card returns
-- no uuid — it guards against columns being ADDED. Nothing guarded against
-- columns being REMOVED. A drop-and-recreate needs the opposite assertion, and
-- this file's suite adds it: the full expected column list, pinned.
--
-- THE GENERAL LESSON, worth more than the fix: `create or replace` cannot change
-- a function's OUT columns, so every payload change is a DROP. A DROP starts the
-- column list from a blank page, and a blank page is where columns go to be
-- forgotten. Any future edit to a public payload must diff against the CURRENT
-- signature, not against whichever migration is open in the editor.
--
-- ── PART 2: trainer.link ─────────────────────────────────────────────────────
-- Ben's spec, 2026-08-08:
--
--   FRONT — static. Handle, QR, and how you enjoy the game. Nothing that changes.
--     It has to print once, go in a deck box, and still be true months later.
--   BACK  — scrolls, and is never printed. "Basically a linktree but for EDH."
--
-- That split is what this table serves. Everything mutable lives on the back:
-- links, ready_to_pod, usually_found_at, and — as of this migration — the DECKS,
-- which were on the front and should not have been. A deck list is the thing that
-- changes most about a player; a card carrying it is stale the next time they
-- brew. (The decks move in the CLIENT; trainer.deck itself is untouched.)
--
-- ── One table, two kinds of row ──────────────────────────────────────────────
-- Nearly everything on the back is a label plus a destination. Moxfield, a
-- Discord server, Bluesky — same shape. The exception is a Discord USERNAME,
-- which is not a URL and cannot be linked, only copied. Hence `kind`.
--
-- LABEL AND VALUE ARE BOTH FREE TEXT, and the platform list is deliberately NOT
-- closed. A fixed set of named slots renders more tidily and costs a migration
-- every time this hobby changes platform, which it does — and an unknown future
-- platform must not require a schema change to link to. Same reasoning 025 used
-- for favorite_legends (open, because the domain is unbounded) rather than
-- playstyle (closed, because it is a fixed vocabulary the card has to render).

do $$ begin
  create type trainer.link_kind as enum ('url', 'handle');
exception when duplicate_object then null; end $$;

create table if not exists trainer.link (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer.profile(id) on delete cascade,

  -- 12, not 3. The back SCROLLS and is never printed, so the tight cap that the
  -- front's fixed real estate would have forced does not apply. The cap that
  -- remains is a bound on abuse and on render cost, not a design constraint.
  position int not null
    constraint link_position_range check ("position" between 1 and 12),

  label text not null
    constraint link_label_len check (char_length(label) between 1 and 24),

  kind trainer.link_kind not null default 'url',

  -- 300 because Moxfield and Archidekt generate long opaque paths and truncating
  -- one produces a dead link, which is worse than a long one. Same call 031 made
  -- for deck_url.
  value text not null
    constraint link_value_len check (char_length(value) between 1 and 300),

  -- Shape is enforced only for 'url'. A 'handle' is a username — it has no shape
  -- worth asserting, and guessing one would reject somebody's real Discord.
  constraint link_url_shape
    check (kind <> 'url' or value ~* '^https?://'),

  created_at timestamptz not null default now(),

  constraint link_trainer_position_unique unique (trainer_id, position)
);

-- NOTE ON THE NO-GEO CHECK, which is deliberately ABSENT here. profile.home_region,
-- usually_found_at, ready_note and buddy.met_venue all carry it because they are
-- LOCATION fields, and a free-text location next to a person is the geo backdoor.
-- This column is a contact destination, not a location. Applying the same regex
-- would reject legitimate URLs that happen to contain a decimal, for no privacy
-- gain — the pattern is a guard on a specific risk, not a blanket string filter.

alter table trainer.link enable row level security;

grant select, insert, update, delete on trainer.link to authenticated;

drop policy if exists link_own on trainer.link;
create policy link_own on trainer.link
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- No public read policy and no grant to anon: the public path is the handle-keyed
-- definer function below. Same posture as trainer.deck in 031 and everything else
-- in this schema.

create index if not exists link_trainer_idx on trainer.link (trainer_id);

-- ── Public read ──────────────────────────────────────────────────────────────
-- Keyed by handle, visibility-gated at read time, returns no uuid. `id` is
-- withheld for the same reason every other public payload withholds one: it is a
-- permanent key that survives a rename.
create or replace function public.get_trainer_links(p_handle extensions.citext)
returns table (
  "position" int,
  label      text,
  kind       text,
  value      text
)
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select l.position, l.label, l.kind::text, l.value
  from trainer.profile p
  join trainer.link l on l.trainer_id = p.id
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted')
  order by l.position;
$$;

revoke all on function public.get_trainer_links(extensions.citext) from public;
grant execute on function public.get_trainer_links(extensions.citext) to anon, authenticated;

-- ── The regression fix ───────────────────────────────────────────────────────
-- get_trainer_card, with 031's three commander columns restored alongside 032's
-- three new ones. THIS LIST IS NOW THE UNION OF 025 + 031 + 032 and the suite
-- pins it, so the next drop-and-recreate fails loudly instead of losing columns.
--
-- Column order matches the historical order — 031's commander block before 032's
-- availability block — so a client reading positionally is not disturbed on top
-- of everything else.
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
  usually_found_at   text,
  ready_to_pod       boolean,
  ready_note         text,
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
         p.usually_found_at, p.ready_to_pod, p.ready_note,
         p.visibility::text, p.created_at
  from trainer.profile p
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted');
$$;

revoke all on function public.get_trainer_card(extensions.citext) from public;
grant execute on function public.get_trainer_card(extensions.citext) to anon, authenticated;

-- ── Known gaps, deliberately left ────────────────────────────────────────────
--
-- 1. trainer.link and trainer.deck are TWO TABLES rendered as one list on the
--    back. A deck is arguably just a link with a rating, and merging them is
--    defensible — but 031 is applied and carrying data, and merging it as a side
--    effect of adding a linktree is exactly the kind of unasked change this repo
--    has had to walk back before. If the merge is wanted it is its own decision.
--
-- 2. No link verification of any kind. A row claiming to be someone's Moxfield
--    can point anywhere. This is a good-faith system by design — the same reason
--    deck ratings are self-reported with a receipt rather than scraped.
--
-- 3. No favicon or platform detection. The client renders the host name from the
--    URL, as 031's deck rows already do; fetching icons would mean a third-party
--    request per link from a page that currently makes none.
--
-- 4. ⚠️ SEPARATE, PRE-EXISTING, UNFIXED: every trainer RPC in `public` is granted
--    EXECUTE to anon, because Supabase sets `alter default privileges in schema
--    public grant execute on functions to anon, authenticated, service_role`.
--    The `revoke all on function ... from public` lines in this file and its four
--    predecessors do NOT undo that — PUBLIC the pseudo-role is not anon the role.
--    Harmless for the two read functions here, which are meant to be anon-callable
--    anyway. Still wrong for add_buddy / my_buddies / set_buddy_note /
--    remove_buddy / block_trainer. Awaiting Ben's call; see SESSION_STATE.
