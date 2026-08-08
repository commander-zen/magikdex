-- 032_trainer_directory.sql — where to find you, where we met, and are you free
--
-- ✅ APPLIED TO PRODUCTION 2026-08-07 (project iduoct…). Verified before and
-- after:
--
--   BEFORE — the migration was dry-run against the live schema inside a
--     BEGIN/ROLLBACK, then composed WITH its suite into a second rolled-back
--     transaction (the suite asserts the post-032 schema, so both had to run
--     together). 29/29 ok, including the destructive date narrowing.
--
--   AFTER — catalog check: both date columns are `date`, met_venue exists and
--     met_context is gone, met_mode is present, profile carries all three new
--     columns, add_buddy has the 5-arg signature and the 3-arg one is gone. The
--     existing buddy row and both profiles survived. No profile was opted into
--     ready_to_pod.
--
-- THE NARROWING COST NOTHING ON THIS DATA. The single existing row read
-- 2026-08-07 15:56:40+00 and became 2026-08-07 — mid-morning US Central, so no
-- day shift. The ±1 day hazard documented below is real for rows written late at
-- night; it simply did not bite anything that already existed.
--
-- ⚠️ SEPARATE FINDING, NOT CAUSED BY THIS FILE: the `revoke all on function …
-- from public` lines below (inherited from 026/029/031) do NOT remove anon's
-- EXECUTE grant. Supabase sets `alter default privileges in schema public grant
-- execute on functions to anon, authenticated, service_role`, and PUBLIC the
-- pseudo-role is not anon the role. Every trainer RPC in `public` has carried an
-- anon EXECUTE grant since 026. Not a live hole — the bodies raise 42501 when
-- auth.uid() is null and my_buddies matches no rows — but the grant layer has
-- never done its half. See SESSION_STATE; the fix is its own migration.
--
-- ── The failure this closes ──────────────────────────────────────────────────
-- 026 solved "I met someone good and lost their name." What it did not solve is
-- the step after: you have the handle, you remember the game, and you still have
-- no idea where that person actually is week to week. They dissolve into a
-- Discord server and the connection dies anyway.
--
-- Three fields fix it, and they are three DIFFERENT fields on purpose:
--
--   profile.usually_found_at  FORWARD-LOOKING. "here is where to find me."
--   buddy.met_venue           BACKWARD-LOOKING. "here is where we crossed paths."
--   profile.ready_to_pod      RIGHT NOW. "I'm up for a game."
--
-- Conflating the first two into one column was the obvious shortcut and it is
-- wrong: one is a standing invitation the owner maintains, the other is a fact
-- about a night that already happened and must never change when they move.
--
-- ── STILL NO DIRECTORY IN THE 025 SENSE ──────────────────────────────────────
-- 025 states, in writing, that browsing trainers is not merely unbuilt but
-- structurally impossible. NOTHING HERE ADDS ENUMERATION. There is no new view,
-- no list-all function, and no way to ask "who is ready tonight" across the
-- database.
--
-- ready_to_pod is readable exactly two ways, both of which already required
-- knowing the person:
--   1. get_trainer_card(handle) — you are holding their handle already.
--   2. my_buddies() — people YOU already saved.
--
-- So the "directory" is a directory of people you have personally met. That is
-- the whole scope, and widening it is a separate migration with a separate
-- privacy decision, not a convenience someone adds to this file later.
--
-- ── NO SCORES, STILL ─────────────────────────────────────────────────────────
-- ready_to_pod is a BOOLEAN and ready_note is FREE TEXT, and both are that way
-- deliberately. A structured "looking for" field sorts; a number ranks. The
-- moment this table can answer "who is the most active player" it has become the
-- thing 030 removed a trust_level() to avoid. my_buddies still orders by
-- last_met_at desc — recency of YOUR OWN meeting, which is not a property of the
-- other person at all.

-- ── Types ────────────────────────────────────────────────────────────────────
-- WHERE you were, kept ORTHOGONAL to buddy.source (HOW the edge was created).
-- Fusing them into 'scan_in_person' / 'manual_online' rebuilds exactly the cross
-- product that 025 kept out of credential.kind/method: every new source would
-- double the enum, and "all online games" would have to know the full matrix.
do $$ begin
  create type trainer.met_mode as enum ('in_person', 'online');
exception when duplicate_object then null; end $$;

-- ── trainer.profile: the two self-declared fields ────────────────────────────
-- Both carry the SAME no-coordinates CHECK as home_region. That is not
-- copy-paste diligence — a free-text "where am I" column next to a person is the
-- geo backdoor, and it is how the dangerous version of this product gets built
-- by accident rather than by decision.
--
-- 80 chars: enough for "Games Corner FLGS, Thursdays" or
-- "SpellTable / Discord: gnome-games", not enough for an address.
--
-- FREE TEXT, NOT A VENUE FOREIGN KEY. Same call 026 made for met_context and for
-- the same reason: where venue records would come from is unresolved, and
-- inventing a venue table here would prejudge it. Autocomplete against
-- previously-entered strings is the intended next step and is NOT in this file.
alter table trainer.profile
  add column if not exists usually_found_at text
    constraint profile_usually_found_at_len
      check (char_length(usually_found_at) <= 80)
    constraint profile_usually_found_at_not_geo
      check (usually_found_at !~ '[-+]?[0-9]{1,3}\.[0-9]{3,}'),

  -- MANUALLY TOGGLED. There is no last_seen column, no timeout, no expiry job and
  -- no trigger anywhere in this file that clears it. That is a product decision,
  -- not an omission: an auto-expiring flag is a presence system, and a presence
  -- system needs to know when you were last online, which is the one fact this
  -- schema has spent four migrations refusing to record.
  --
  -- The cost is real and accepted: a flag left on reads as a lie a week later.
  -- The UI's job is to make turning it off easy, not the database's job to guess.
  add column if not exists ready_to_pod boolean not null default false,

  -- "looking for: cEDH", "casual only tonight". 60 chars and free text.
  -- NOT an enum, NOT a filter vocabulary. The moment this is structured it can be
  -- matched on, and matching is one step from ranking.
  add column if not exists ready_note text
    constraint profile_ready_note_len
      check (char_length(ready_note) <= 60)
    constraint profile_ready_note_not_geo
      check (ready_note !~ '[-+]?[0-9]{1,3}\.[0-9]{3,}');

-- ── trainer.buddy: met_context → met_venue ───────────────────────────────────
-- A RENAME, NOT A NEW COLUMN. 026 already shipped this field; adding a parallel
-- `venue` beside it would leave two columns meaning the same thing and a client
-- guessing which one is filled. The new name says what it holds.
--
-- Guarded so a re-run is a no-op — `alter table ... rename column` has no
-- IF NOT EXISTS form.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'trainer' and table_name = 'buddy'
      and column_name = 'met_context'
  ) then
    alter table trainer.buddy rename column met_context to met_venue;
    alter table trainer.buddy rename constraint buddy_context_len     to buddy_venue_len;
    alter table trainer.buddy rename constraint buddy_context_not_geo to buddy_venue_not_geo;
  end if;
end $$;

-- ── trainer.buddy: timestamptz → date ────────────────────────────────────────
-- ⚠️ DESTRUCTIVE AND IRREVERSIBLE. Time-of-day is dropped from every existing
-- row and cannot be recovered. That is the intent, made on purpose after review.
--
-- 026's argument was that a venue plus a timestamp plus a person, in aggregate,
-- is a movement history — and its answer was to keep one row per pair so no
-- aggregate exists. This goes one step further and removes the precision itself.
-- The product never needed it: "we played on the 14th" is the whole use, and
-- 11:47pm is a detail nobody asked to store about themselves or anyone else.
--
-- It follows this codebase's own rule, stated in 026: not redacted, not
-- access-controlled, NEVER RECORDED. Date-only at the API with timestamps still
-- in the table would have been the weaker version of the same promise.
--
-- ⚠️ EXISTING ROWS SHIFT BY UP TO ONE DAY. The cast is pinned to UTC because it
-- has to be deterministic, and no timezone was ever stored alongside these
-- timestamps. A game that ended at 11pm US Central was written as 05:00 UTC the
-- next morning and will now read as the next day. There is no way to fix that
-- without a timezone we do not have; the alternative — casting in whatever
-- TimeZone the migration session happens to carry — is worse because it is not
-- even reproducible. Prod holds a handful of rows and this is stated rather than
-- silently absorbed.
--
-- The default is dropped BEFORE the type change: Postgres re-casts a column
-- default separately from the USING clause, and now() surviving that cast is not
-- something to leave to chance.
alter table trainer.buddy
  alter column first_met_at drop default,
  alter column last_met_at  drop default;

alter table trainer.buddy
  alter column first_met_at type date using (first_met_at at time zone 'UTC')::date,
  alter column last_met_at  type date using (last_met_at  at time zone 'UTC')::date;

-- current_date, not now()::date — same value, and it says what it means.
alter table trainer.buddy
  alter column first_met_at set default current_date,
  alter column last_met_at  set default current_date;

-- buddy_recent_idx (trainer_id, last_met_at desc) is rebuilt automatically by the
-- type change and needs no attention. Worth knowing rather than re-creating it by
-- hand and getting a duplicate.

-- ── trainer.buddy: how you played ────────────────────────────────────────────
-- Default 'in_person'. Not a coin flip: this product exists because of a game at
-- a table, the QR path is two people in the same room, and a default that matches
-- the common case is one less thing to set at 11pm while packing up.
alter table trainer.buddy
  add column if not exists met_mode trainer.met_mode not null default 'in_person';

-- ── add_buddy ────────────────────────────────────────────────────────────────
-- DROPPED FIRST, then recreated with a wider signature. Creating the 5-arg
-- version alongside the 3-arg one makes `add_buddy(handle, venue, source)`
-- AMBIGUOUS — Postgres cannot choose between an exact 3-arg match and a 5-arg
-- match with two defaults, and it raises 42725 instead of picking. The old one
-- has to be gone before the new one exists.
drop function if exists public.add_buddy(extensions.citext, text, text);

-- THE UPSERT STAYS SERVER-SIDE. That is still what makes met_count trustworthy,
-- since buddy_count publishes it.
--
-- p_met_on IS CLIENT-SUPPLIED AND UNVERIFIED, and that is fine: it is the owner's
-- private record of their own evening, readable by nobody else, and it feeds no
-- public number. met_count is the one field a client must not control and it
-- remains untouchable. A future date is not rejected — "we're playing Saturday"
-- is a legitimate thing to write down, and a CHECK against current_date would
-- also fail for anyone whose device clock is ahead of the server's.
create or replace function public.add_buddy(
  p_handle    extensions.citext,
  p_met_venue text default null,
  p_source    text default 'scan',
  p_met_on    date default null,
  p_met_mode  text default 'in_person'
)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare
  v_me     uuid := auth.uid();
  v_target uuid;
  v_on     date := coalesce(p_met_on, current_date);
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select p.id into v_target
  from trainer.profile p
  where p.handle = p_handle and p.visibility in ('public', 'unlisted');

  -- Same message for private and nonexistent, on purpose: distinguishing them
  -- would turn this function into an oracle for which screen names exist.
  if v_target is null then
    raise exception 'no reachable trainer with that handle' using errcode = 'P0002';
  end if;
  if v_target = v_me then
    raise exception 'cannot save yourself' using errcode = '23514';
  end if;
  if trainer.has_blocked(v_target, v_me) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into trainer.buddy
    (trainer_id, connected_trainer_id, source, met_venue, met_mode,
     first_met_at, last_met_at)
  values
    (v_me, v_target, p_source::trainer.connection_source, p_met_venue,
     p_met_mode::trainer.met_mode, v_on, v_on)
  on conflict (trainer_id, connected_trainer_id) do update
    -- least(), not "leave it alone": backfilling an older meeting you had
    -- forgotten should be able to move first_met_at EARLIER. greatest() on the
    -- other side stops a backfill from making a stale date look like the most
    -- recent game.
    set first_met_at = least(buddy.first_met_at, excluded.first_met_at),
        last_met_at  = greatest(buddy.last_met_at, excluded.last_met_at),
        met_count    = buddy.met_count + 1,
        -- A re-save with no venue must not erase the one you typed the first time.
        met_venue    = coalesce(excluded.met_venue, buddy.met_venue),
        met_mode     = excluded.met_mode;
end;
$$;

-- ── get_trainer_card ─────────────────────────────────────────────────────────
-- DROPPED AND RECREATED because the RETURNS TABLE list changes, which
-- `create or replace` cannot do.
--
-- ⚠️ THIS FUNCTION'S COLUMN LIST IS THE PRIVACY BOUNDARY, not RLS — it is
-- SECURITY DEFINER, so it sees every row regardless of policy. Adding a column
-- here PUBLISHES it to anyone holding the handle. Three are added and each was a
-- decision:
--
--   usually_found_at — the entire point. A card that cannot say where to find you
--     leaves the reader exactly where they started.
--   ready_to_pod / ready_note — useless private. The flag only does work when
--     someone who scanned your card can see it.
--
-- All three remain gated on visibility, evaluated at READ time as before: going
-- private removes them instantly and there is no cached copy anywhere.
drop function if exists public.get_trainer_card(extensions.citext);

create or replace function public.get_trainer_card(p_handle extensions.citext)
returns table (
  handle           extensions.citext,
  display_name     text,
  photo_url        text,
  pronouns         text,
  bio              text,
  home_region      text,
  philosophy       text[],
  identity_mode    text,
  playstyle        text[],
  favorite_legends text[],
  usually_found_at text,
  ready_to_pod     boolean,
  ready_note       text,
  visibility       text,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select p.handle, p.display_name, p.photo_url, p.pronouns, p.bio, p.home_region,
         p.philosophy, p.identity_mode::text, p.playstyle, p.favorite_legends,
         p.usually_found_at, p.ready_to_pod, p.ready_note,
         p.visibility::text, p.created_at
  from trainer.profile p
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted');
$$;

-- ── my_buddies ───────────────────────────────────────────────────────────────
-- Dropped and recreated: met_context is renamed, two date columns changed type,
-- and four columns are added.
--
-- THIS IS THE "DIRECTORY", AND IT IS SCOPED TO auth.uid(). You see where your
-- buddies say they can be found and whether they are up for a game, because you
-- already met them and saved them. Nobody appears here that you did not add
-- yourself, and there is still no way to ask the question across all trainers.
--
-- usually_found_at / ready_to_pod / ready_note are gated on reachability exactly
-- like the other card fields: someone who has gone private since you met comes
-- back null and reachable=false. ready_to_pod returns FALSE rather than null for
-- an unreachable trainer, matching buddy_count's rule — a null would itself
-- announce "this one went private" through a column that is supposed to be about
-- availability.
--
-- ORDER IS STILL last_met_at desc. That is recency of YOUR OWN meeting, not a
-- property of the other person, and it is deliberately NOT ready-first: sorting
-- people by availability is the first step toward sorting them by anything else.
-- Grouping the ready ones is the client's presentation choice over a boolean, and
-- it stays there.
drop function if exists public.my_buddies();

create or replace function public.my_buddies()
returns table (
  handle           extensions.citext,
  display_name     text,
  photo_url        text,
  identity_mode    text,
  playstyle        text[],
  favorite_legends text[],
  philosophy       text[],
  usually_found_at text,
  ready_to_pod     boolean,
  ready_note       text,
  source           text,
  met_mode         text,
  first_met_at     date,
  last_met_at      date,
  met_count        int,
  met_venue        text,
  note             text,
  reachable        boolean
)
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select
    p.handle,
    case when p.visibility in ('public','unlisted') then p.display_name end,
    case when p.visibility in ('public','unlisted') then p.photo_url end,
    case when p.visibility in ('public','unlisted') then p.identity_mode::text end,
    case when p.visibility in ('public','unlisted') then p.playstyle end,
    case when p.visibility in ('public','unlisted') then p.favorite_legends end,
    case when p.visibility in ('public','unlisted') then p.philosophy end,
    case when p.visibility in ('public','unlisted') then p.usually_found_at end,
    -- false, not null — see the note above.
    (p.visibility in ('public','unlisted') and p.ready_to_pod),
    case when p.visibility in ('public','unlisted') then p.ready_note end,
    b.source::text, b.met_mode::text,
    b.first_met_at, b.last_met_at, b.met_count, b.met_venue, b.note,
    (p.visibility in ('public','unlisted'))
  from trainer.buddy b
  join trainer.profile p on p.id = b.connected_trainer_id
  where b.trainer_id = auth.uid()
  order by b.last_met_at desc;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Re-granted because DROP took the old grants with it. The shape is unchanged
-- from 025/029: reads that anon may make, writes that require a session.
--
-- There is deliberately NO new function for setting ready_to_pod. The owner path
-- for profile fields is already `supabase.schema('trainer').from('profile')`
-- under profile_update_own, and adding an RPC would be a second write path to the
-- same column with its own set of mistakes available.
revoke all on function public.get_trainer_card(extensions.citext) from public;
revoke all on function public.add_buddy(extensions.citext, text, text, date, text) from public;
revoke all on function public.my_buddies() from public;

grant execute on function public.get_trainer_card(extensions.citext) to anon, authenticated;
grant execute on function public.add_buddy(extensions.citext, text, text, date, text) to authenticated;
grant execute on function public.my_buddies() to authenticated;

-- ── RLS review ───────────────────────────────────────────────────────────────
-- No policy is added, changed or dropped by this file, and that is a conclusion
-- rather than an oversight. Each surface, checked:
--
-- 1. trainer.profile — the three new columns fall under the EXISTING
--    profile_select_own / profile_update_own (id = auth.uid()) with no edit.
--
--    ⚠️ WORTH SAYING OUT LOUD: `authenticated` holds a TABLE-LEVEL update grant
--    on trainer.profile (025). Table grants are column-blind, so every new column
--    here is client-writable the moment it exists — including by a raw PostgREST
--    call that never touches this app's UI. For three self-declared fields about
--    yourself, that is exactly right. It would NOT be right for anything
--    attested, which is why credential has no write grant at all and never will.
--
-- 2. trainer.buddy — still granted to NO client role. Policies exist (buddy_own)
--    but no privilege does, so every read and write goes through the SECURITY
--    DEFINER functions above. The renamed column and the new one inherit that
--    with nothing to change. add_buddy re-checks trainer_id = auth.uid() inside
--    its own body, which is the real enforcement: definer bypasses the policy.
--
-- 3. The new publication surface is get_trainer_card's column list, above, and it
--    is visibility-gated. No view was added, so nothing became enumerable.

-- ── Known gaps, deliberately left ────────────────────────────────────────────
--
-- 1. NO VENUE NORMALIZATION. usually_found_at and met_venue are both free text
--    and will hold four spellings of the same shop. Autocomplete against strings
--    the user has already entered is the intended next step; a venue table with
--    identity of its own is a much larger decision and is not implied by this.
--
-- 2. NO EXPIRY ON ready_to_pod. It stays true until manually cleared. Deliberate
--    — see the column comment. Anything that clears it on a schedule needs to
--    know when you were last active, and that is a presence system.
--
-- 3. ready_note IS NOT A FILTER. Free text, unmatchable, unsortable. Structured
--    "looking for" belongs to a later slice if it is ever wanted at all.
--
-- 4. met_mode has no 'hybrid'. Two values cover the actual cases and a third that
--    means "sort of both" would be filled in by anyone unsure, which makes all
--    three useless.
--
-- 5. THE DATE NARROWING SHIFTS EXISTING ROWS BY UP TO A DAY. See the block above.
--    No backfill corrects it because the information required does not exist.
--
-- 6. The source enum is STILL trainer.connection_source (029 gap #1). Renaming a
--    type in use means rewriting every column that references it, for a word that
--    appears in no UI. Left alone again, on purpose.
