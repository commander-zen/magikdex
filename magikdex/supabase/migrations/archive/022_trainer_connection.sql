-- 022_trainer_connection.sql — the roster: who you've met, when, where
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- NOT APPLIED — written for review. Depends on 023_trainer_identity.sql, which
-- is ALSO not yet applied. Apply 023 first.
--
-- ⚠️ 018 IS SUPERSEDED — DO NOT APPLY IT. This file originally targeted 018,
-- which modelled the identity axis as two free-text columns (play_type,
-- play_type_secondary). 023 replaces those with identity_mode +
-- playstyle text[] + favorite_legends text[], so get_trainer_card() and
-- my_roster() below were rewritten to match. Nothing else changed: the privacy
-- design in this file (no event log, no public read on trainer_connection, no
-- mutuality flag, met_context/note owner-only) was already right and stands.
--
-- Numbered 022 because 019-021 landed while this thread was paused
-- (019 partner commanders, 020 legend consolidation, 021 the deck-data purge).
-- 023 is now the only unapplied migration ahead of this one.
--
-- Additive. Creates two tables, one enum, four functions, one trigger. Touches
-- no existing table; 018's `trainer_public` view is deliberately left exactly
-- as it is.
--
-- ── Why this exists ──────────────────────────────────────────────────────────
-- The initiative's evidence is a scheduling failure: four people, mutually
-- available, zero games. This table is for a different failure — the game
-- already happened, it was good, and there is no handle on the other player
-- afterward. Ben, on the LGS regular he played last week: "i dont remember his
-- name but i want to wish him well and play again if we can."
--
-- Nothing in Epics 1-8 covers that. Epic 3's buddy list is scoped to
-- communities joined, never global; there is no "add this person" anywhere.
-- This is that missing primitive.

-- ── Naming ───────────────────────────────────────────────────────────────────
-- 018 uses bare nouns (trainer, credential, party_slot). A bare `connection`
-- would be ambiguous in a database, so these two carry the `trainer_` prefix.

-- ── Types ────────────────────────────────────────────────────────────────────
-- How the edge was created, not what transport carried it. QR and NFC are the
-- same event — two people in the same room — so they are both `scan`. Splitting
-- them would rebuild the cross-product mistake that 018 avoids by keeping
-- credential.kind and credential.method orthogonal.
do $$ begin
  create type connection_source as enum ('scan', 'manual');
exception
  when duplicate_object then null;
end $$;

-- ── trainer_connection ───────────────────────────────────────────────────────
--
-- DIRECTIONAL AND UNILATERAL. A saving B needs no approval from B, because B's
-- card is already something B chose to hand out. There is no pending/accepted
-- state machine: an acceptance flow would add friction at precisely the moment
-- the product has to be frictionless — two people at a table at 11pm with one
-- of them already putting their deck away. Mutuality is derived from two rows
-- existing, never stored.
--
-- ONE ROW PER PAIR, NOT AN ENCOUNTER LOG. This is the load-bearing privacy
-- decision in this file. A log of every scan, carrying venue and timestamp,
-- would in aggregate be a movement history — the exact artifact ADR-3 says the
-- system must be structurally incapable of reconstructing. Instead the row
-- holds first_met_at, last_met_at, and a count. Re-scanning UPDATES; it never
-- appends. You can know you've played someone six times, first in March and
-- most recently Thursday. You cannot recover where either of you was on the
-- four nights in between, because that was never written down.
--
-- This is NFR-DATA-1 ("presence is ephemeral by construction") applied one
-- level up: keep the relationship, discard the event stream.
create table if not exists trainer_connection (
  trainer_id uuid not null references trainer(id) on delete cascade,
  connected_trainer_id uuid not null references trainer(id) on delete cascade,

  source connection_source not null default 'scan',

  first_met_at timestamptz not null default now(),
  last_met_at timestamptz not null default now(),
  met_count int not null default 1
    constraint trainer_connection_met_count_positive check (met_count >= 1),

  -- Free text, not a venue FK. OQ-4 (where venue records come from) is
  -- unresolved and belongs to Epic 2 — inventing a venue table here would
  -- prejudge it. When venues do get seeded, a nullable venue_id is an additive
  -- follow-up and this column stays as the human note.
  --
  -- It carries the SAME no-coordinates CHECK as trainer.home_region. Without
  -- it this field is the geo backdoor: the one place a client could start
  -- writing lat/long into a table that also holds a timestamp and a person.
  -- That is how the dangerous version gets built by accident.
  met_context text
    constraint trainer_connection_context_len check (char_length(met_context) <= 80)
    constraint trainer_connection_context_not_geo
      check (met_context !~ '[-+]?[0-9]{1,3}\.[0-9]{3,}'),

  -- The owner's private annotation. "played Voja, super nice, wants a rematch."
  -- Never exposed to the other party or to anyone else — see the RLS block.
  -- This is the only genuinely one-sided field in the schema.
  note text
    constraint trainer_connection_note_len check (char_length(note) <= 280),

  created_at timestamptz not null default now(),

  primary key (trainer_id, connected_trainer_id),
  constraint trainer_connection_not_self check (trainer_id <> connected_trainer_id)
);

-- ── trainer_block ────────────────────────────────────────────────────────────
-- A roster you cannot get out of is not a finished roster. NFR-SEC-2 already
-- establishes the principle for public pages ("report path exists before public
-- pages ship, not after"); the same applies to a social edge. Separate from
-- trainer_connection on purpose: a block has to keep working after the
-- connection row is gone, and it has to stop a NEW connection from forming,
-- which deleting a row cannot do.
create table if not exists trainer_block (
  trainer_id uuid not null references trainer(id) on delete cascade,
  blocked_trainer_id uuid not null references trainer(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (trainer_id, blocked_trainer_id),
  constraint trainer_block_not_self check (trainer_id <> blocked_trainer_id)
);

-- ── Helpers ──────────────────────────────────────────────────────────────────
-- Both SECURITY DEFINER for the reason 018 documents on trainer_is_public: an
-- inline `exists (select … from trainer)` inside a policy runs under the
-- CALLER's RLS, so it evaluates false for anyone who cannot read the row —
-- which is everyone but the owner. search_path pinned.

-- Reachable = public OR unlisted. This is where `unlisted` finally earns its
-- keep: it is exactly "someone handed me this card". Note this is a WIDER test
-- than 018's trainer_is_public(), and both are needed — enumerable listing
-- stays public-only, resolution by known handle allows unlisted.
create or replace function trainer_is_reachable(p_trainer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from trainer t
    where t.id = p_trainer
      and t.visibility in ('public', 'unlisted')
  );
$$;

revoke all on function trainer_is_reachable(uuid) from public;
grant execute on function trainer_is_reachable(uuid) to anon, authenticated;

create or replace function trainer_has_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from trainer_block b
    where b.trainer_id = p_blocker
      and b.blocked_trainer_id = p_blocked
  );
$$;

revoke all on function trainer_has_blocked(uuid, uuid) from public;
grant execute on function trainer_has_blocked(uuid, uuid) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table trainer_connection enable row level security;
alter table trainer_block enable row level security;

-- Supabase default-grants ALL on new public-schema tables, so without these
-- REVOKEs "no policy" only means "zero rows", not "denied".
revoke all on table trainer_connection from anon, authenticated;
grant select, insert, update, delete on table trainer_connection to authenticated;

revoke all on table trainer_block from anon, authenticated;
grant select, insert, delete on table trainer_block to authenticated;

-- ROSTERS ARE PRIVATE. There is no public read policy on either table, by
-- design and not by omission. B cannot see that A saved them, nobody can
-- enumerate anyone's roster, and the social graph is not a public object.
--
-- Consequence worth knowing: "we both saved each other" is NOT computable by
-- either party. Surfacing it would mean leaking one bit about B's roster to A.
-- That bit is deliberately withheld — it is a one-line addition later, and it
-- is unrecoverable once shipped. Same doctrine as ADR-3: do not build the
-- system so the dangerous version can be assembled later by accident.
drop policy if exists trainer_connection_own on trainer_connection;
create policy trainer_connection_own on trainer_connection
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (
    trainer_id = auth.uid()
    -- You may only save a card that is actually handed out. A private trainer
    -- cannot be added to anyone's roster.
    and trainer_is_reachable(connected_trainer_id)
    -- ...and not by someone they have blocked.
    and not trainer_has_blocked(connected_trainer_id, auth.uid())
  );

drop policy if exists trainer_block_own on trainer_block;
create policy trainer_block_own on trainer_block
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- ── Blocking severs the edge in both directions ──────────────────────────────
-- Blocking someone who has you saved has to remove you from their roster, not
-- just theirs from yours — otherwise "block" only means "I stopped looking at
-- you", which is not what anyone means by it. SECURITY DEFINER because the
-- blocker has no privilege on the blocked party's rows.
create or replace function trainer_block_severs_connection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from trainer_connection
   where (trainer_id = new.trainer_id and connected_trainer_id = new.blocked_trainer_id)
      or (trainer_id = new.blocked_trainer_id and connected_trainer_id = new.trainer_id);
  return new;
end;
$$;

drop trigger if exists trainer_block_severs_connection_trg on trainer_block;
create trigger trainer_block_severs_connection_trg
  after insert on trainer_block
  for each row execute function trainer_block_severs_connection();

-- ── get_trainer_card ─────────────────────────────────────────────────────────
-- UNLISTED IS A FUNCTION, NOT A VIEW. A view is a relation: anyone granted
-- SELECT can `select * from it` and enumerate every row, which is the one thing
-- "unlisted" must not permit. A lookup that takes a handle and returns at most
-- one row has no enumerable domain — you have to already know the handle,
-- which is precisely the state you're in after someone hands you their card.
--
-- 018's `trainer_public` view is UNCHANGED and still public-only. This function
-- is the second, narrower door. Callable by anon: an unlisted card handed over
-- in person should resolve for whoever is holding it, signed in or not.
--
-- Brute-forcing handles (3-20 chars) is possible in principle and is an
-- application rate-limit concern, not a schema one. Flagging it, not solving it.
create or replace function get_trainer_card(p_handle citext)
returns table (
  handle citext,
  display_name text,
  photo_url text,
  pronouns text,
  bio text,
  home_region text,
  -- identity_mode is declared text, not trainer_identity_mode, so a client
  -- reading this function never has to know the enum type exists. The cast in
  -- the body below is explicit for the same reason it is in my_roster(): relying
  -- on Postgres' assignment-context enum→text I/O coercion works but is a
  -- subtlety, and a wrong guess here is a create-time error, not a runtime one.
  identity_mode text,
  playstyle text[],
  favorite_legends text[],
  philosophy text[],
  visibility trainer_visibility,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    t.handle,
    t.display_name,
    t.photo_url,
    t.pronouns,
    t.bio,
    t.home_region,
    t.identity_mode::text,
    t.playstyle,
    t.favorite_legends,
    t.philosophy,
    t.visibility,
    t.created_at
  from trainer t
  where t.handle = p_handle
    and t.visibility in ('public', 'unlisted');
$$;

revoke all on function get_trainer_card(citext) from public;
grant execute on function get_trainer_card(citext) to anon, authenticated;

-- ── my_roster ────────────────────────────────────────────────────────────────
-- The read model. One call instead of N+1: RLS already scopes trainer_connection
-- to the caller, but joining out to card data needs privileges the caller does
-- not have on other people's trainer rows, so the join is only legal here.
--
-- VISIBILITY IS EVALUATED AT READ TIME, NOT FROZEN AT SCAN TIME. If someone was
-- public when you met and has since gone private, their card fields come back
-- NULL and `reachable` is false — you keep your own memory of the encounter
-- (when, where, your note) but their card is gone. Their later choice wins over
-- your earlier copy, without erasing your record that the game happened.
create or replace function my_roster()
returns table (
  connected_trainer_id uuid,
  handle citext,
  display_name text,
  photo_url text,
  -- All three identity columns come back, not just the one identity_mode
  -- selects. The roster list has to render each card the way its OWNER chose to
  -- be represented, which is a per-row decision the caller makes from
  -- identity_mode — so the data for both axes has to be here to make it.
  identity_mode text,
  playstyle text[],
  favorite_legends text[],
  philosophy text[],
  source connection_source,
  first_met_at timestamptz,
  last_met_at timestamptz,
  met_count int,
  met_context text,
  note text,
  reachable boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.connected_trainer_id,
    case when t.visibility in ('public', 'unlisted') then t.handle end,
    case when t.visibility in ('public', 'unlisted') then t.display_name end,
    case when t.visibility in ('public', 'unlisted') then t.photo_url end,
    case when t.visibility in ('public', 'unlisted') then t.identity_mode::text end,
    case when t.visibility in ('public', 'unlisted') then t.playstyle end,
    case when t.visibility in ('public', 'unlisted') then t.favorite_legends end,
    case when t.visibility in ('public', 'unlisted') then t.philosophy end,
    c.source,
    c.first_met_at,
    c.last_met_at,
    c.met_count,
    c.met_context,
    c.note,
    (t.visibility in ('public', 'unlisted'))
  from trainer_connection c
  join trainer t on t.id = c.connected_trainer_id
  where c.trainer_id = auth.uid()
  order by c.last_met_at desc;
$$;

revoke all on function my_roster() from public;
grant execute on function my_roster() to authenticated;

-- ── roster_count ─────────────────────────────────────────────────────────────
-- The ONE new piece of public surface. That a connection exists, and how many,
-- is a trust signal and is safe to publish. WHEN, WHERE, and WHAT WAS NOTED are
-- not, and none of them are reachable through this function — the return type is
-- a bare int, which is the enforcement. There is deliberately no companion
-- function returning handles or names in common: that is a materially larger
-- privacy surface than a count and stays deferred (see Known gaps #7).
--
-- SECURITY DEFINER because trainer_connection has no public read policy and must
-- not get one. The count is computed here, under the definer's privileges, and
-- only the integer crosses back out. This is the same shape as get_trainer_card:
-- a narrow function is the public door, never a relation.
--
-- ⚠️ THE GUARD RETURNS 0, NOT NULL. `trainer_is_reachable(p_trainer)` sits in
-- the WHERE clause, so for a private trainer every row is filtered out and
-- count(*) over zero rows is 0 — the function is still callable and still
-- returns a value. This is worth stating plainly because it is easy to misread
-- as a null/error guard, and the test file asserts the real behaviour.
--
-- 0-not-null is the better outcome anyway: a private trainer is
-- indistinguishable from a public trainer with an empty roster, so the response
-- leaks nothing about which of the two you are looking at. A null would itself
-- be the signal "this account is private", which is one bit more than 0 gives
-- away. Reachable = public OR unlisted, matching trainer_is_reachable's wider
-- test rather than trainer_is_public.
create or replace function roster_count(p_trainer uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from trainer_connection
  where trainer_id = p_trainer
    and trainer_is_reachable(p_trainer);
$$;

revoke all on function roster_count(uuid) from public;
grant execute on function roster_count(uuid) to anon, authenticated;

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- The primary key covers (trainer_id, connected_trainer_id). The reverse
-- direction is needed by the block trigger and by any future mutuality check.
create index if not exists trainer_connection_connected_idx
  on trainer_connection (connected_trainer_id);
-- The roster's natural read order: most recently played, first.
create index if not exists trainer_connection_recent_idx
  on trainer_connection (trainer_id, last_met_at desc);
create index if not exists trainer_block_blocked_idx
  on trainer_block (blocked_trainer_id);

-- ── Known gaps, deliberately left ────────────────────────────────────────────
--
-- 1. Re-scanning is a client-side upsert:
--       insert into trainer_connection (trainer_id, connected_trainer_id, met_context)
--       values (auth.uid(), $1, $2)
--       on conflict (trainer_id, connected_trainer_id) do update
--         set last_met_at = now(),
--             met_count   = trainer_connection.met_count + 1;
--    which means the client controls met_count. That is fine while met_count is
--    private data about your own history. It stops being fine the moment it
--    becomes a public trust signal — at that point the increment has to move
--    server-side.
--
-- 2. No messaging. "Wish him well" resolves to the handle, hence /t/<handle>,
--    hence whatever contact path that card chooses to expose. A DM subsystem is
--    not in this slice and should not be smuggled into it.
--
-- 3. No mutuality flag — see the RLS block for why it is withheld rather than
--    forgotten.
--
-- 4. No venue FK (OQ-4). met_context is free text until Epic 2 seeds venues.
--
-- 5. Blocking is enforced at INSERT. An existing connection is severed by the
--    trigger, but a block placed while a scan is mid-flight is a last-writer
--    race — acceptable, since the trigger's delete runs after.
--
-- 6. This slice ASSUMES 023's open decision #3 resolves as "unlisted is
--    resolvable by handle." get_trainer_card() is that resolution. If Ben
--    decides unlisted should stay dark, this function and the 'unlisted' arm of
--    trainer_is_reachable() both narrow to 'public' only.
--
-- 7. No "people you both know" list. roster_count() publishes the SIZE of a
--    roster and nothing about its membership. Names or handles in common is a
--    much larger privacy surface — it leaks who is on someone else's roster,
--    which is the object this whole file keeps private — so it is withheld on
--    the same doctrine as the mutuality flag in #3.
--
-- 8. roster_count() TAKES A uuid THAT NO PUBLIC SURFACE HANDS OUT. trainer_public
--    exposes no id (023's gap #2) and get_trainer_card() does not return one
--    either, so an anonymous caller who only knows a handle cannot reach this
--    function — it is currently callable in principle and unreachable in
--    practice. Whatever resolves 023 #2 (add id to the view, or return it from
--    get_trainer_card) also lights this up, which is precisely why that decision
--    should be made deliberately rather than as a convenience: the id is the
--    join key for every public read that follows.
