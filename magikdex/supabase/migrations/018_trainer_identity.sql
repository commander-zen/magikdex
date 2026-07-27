-- 018_trainer_identity.sql — Trainer: player identity, party, credentials + RLS
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- NOT APPLIED — written for review. TRAINER_INITIATIVE Epic 1, database slice
-- only: tables, constraints, policies. No UI, no signal, no Discord, no issuer.
--
-- Additive throughout. No existing table is altered; `decks` is referenced by
-- foreign key only.
--
-- Ordering follows NFR-SEC-1 (default deny): every table below has RLS enabled
-- and its policies written BEFORE any row is inserted. The handle_reservation
-- seed at the bottom is the only INSERT in this file, and it runs last.
--
-- Ownership model: trainer.id IS auth.users.id, so every owner check in this
-- file is a plain `= auth.uid()` — no join back through a user_id column like
-- legends/decks need (013_multi_user.sql).

-- ── Extensions ───────────────────────────────────────────────────────────────
-- citext gives case-insensitive handle uniqueness for free: @Ben and @ben
-- collide at the unique index instead of at some lower() call we forget to make.
create extension if not exists citext with schema extensions;

-- ── Types ────────────────────────────────────────────────────────────────────
-- Wrapped so re-running the migration is safe (idiom from 006_wrec_tags.sql).
do $$ begin
  create type trainer_visibility as enum ('public', 'unlisted', 'private');
exception
  when duplicate_object then null;
end $$;

-- kind and method are deliberately ORTHOGONAL columns, never one combined enum.
-- "an LGS visit" and "who vouched for it" are independent facts; fusing them
-- into `lgs_visit_verified` means every new verification method multiplies the
-- enum and every query that wants "all LGS visits" has to know the full cross
-- product. Per NFR-SEC-3 both self-reported and verified credentials take the
-- SAME write path with different `method` values — one path is auditable, two
-- are not.
do $$ begin
  create type credential_kind as enum ('scrycheck_rank', 'lgs_visit', 'event_finish');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type credential_method as enum ('self_reported', 'api_verified', 'venue_verified');
exception
  when duplicate_object then null;
end $$;

-- ── Tables ───────────────────────────────────────────────────────────────────

-- The private trainer record. Never read by anonymous traffic — the
-- `trainer_public` view at the bottom of this file is the only public path in.
create table if not exists trainer (
  id uuid primary key references auth.users(id) on delete cascade,

  -- handle::text is required in the shape CHECK: citext's `~` operator is
  -- case-INSENSITIVE, so an unqualified `handle ~ '^[a-z0-9_]{3,20}$'` would
  -- happily accept 'BenIsHere'. The cast forces a case-sensitive match, which
  -- is what actually pins handles to lowercase.
  handle citext not null unique
    constraint trainer_handle_shape
      check ((handle::text) ~ '^[a-z0-9_]{3,20}$'),

  display_name text not null
    constraint trainer_display_name_len
      check (char_length(display_name) between 1 and 40),

  photo_url text,

  pronouns text
    constraint trainer_pronouns_len check (char_length(pronouns) <= 30),

  bio text
    constraint trainer_bio_len check (char_length(bio) <= 280),

  -- Free text ("north side", "Twin Cities"). T-102 forbids coordinates, so the
  -- ban is a constraint rather than a code review note: reject anything shaped
  -- like a decimal degree (3+ digits after the point). "St. Louis" and
  -- "Route 66" pass; "44.9778, -93.2650" does not.
  home_region text
    constraint trainer_home_region_len check (char_length(home_region) <= 60)
    constraint trainer_home_region_not_geo
      check (home_region !~ '[-+]?[0-9]{1,3}\.[0-9]{3,}'),

  -- 24 chars because type is printed on the physical card (T-111 / ADR-4).
  play_type text
    constraint trainer_play_type_len check (char_length(play_type) <= 24),
  play_type_secondary text
    constraint trainer_play_type_secondary_len
      check (char_length(play_type_secondary) <= 24),

  -- Array, not enum-per-row: philosophies are a multi-select with no order and
  -- no scale (T-110). `<@` = "is contained by", so an empty array passes and
  -- anything outside the vocabulary fails.
  philosophy text[] not null default '{}'
    constraint trainer_philosophy_allowed
      check (philosophy <@ array['jank', 'casual', 'trash_magic', 'cedh']::text[]),

  visibility trainer_visibility not null default 'private',
  created_at timestamptz not null default now()
);

-- Blocks reuse of released handles and reserves system routes. Enforced by the
-- trigger further down, because a CHECK cannot reference another table.
create table if not exists handle_reservation (
  handle citext primary key,
  reason text not null default 'reserved'
    constraint handle_reservation_reason check (reason in ('reserved', 'released')),
  -- Deliberately NOT a foreign key: this is an audit pointer that has to keep
  -- meaning after the prior owner's auth.users row is gone.
  released_from uuid,
  created_at timestamptz not null default now()
);

-- What you'd actually sleeve up tonight (T-120). Distinct from the dex, and
-- mutable — deleting a slot does not touch the deck.
create table if not exists party_slot (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,

  -- The hard cap of 5 lives HERE, not in client validation (T-120 AC). With the
  -- unique(trainer_id, position) below, a 6th slot has nowhere to go: positions
  -- 1-5 are taken and 6 fails the range check.
  position int not null
    constraint party_slot_position_range check ("position" between 1 and 5),

  playstyle_note text
    constraint party_slot_note_len check (char_length(playstyle_note) <= 120),
  created_at timestamptz not null default now(),

  constraint party_slot_trainer_position_unique unique (trainer_id, position),
  constraint party_slot_trainer_deck_unique unique (trainer_id, deck_id)
);

-- Append-only claims about a player. No client role can write here at all (see
-- the policy section) — the issuer service holds service_role and is the single
-- write path. Revocation is `revoked_at`, never an edit or a delete.
create table if not exists credential (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer(id) on delete cascade,
  kind credential_kind not null,
  issuer text not null
    constraint credential_issuer_len check (char_length(issuer) between 1 and 120),
  method credential_method not null,
  payload jsonb not null,
  -- Surfaced in UI, never hidden (T-131). "Rank 7, verified 4 Mar" beats a bare
  -- number, and a stale ranking must read as stale rather than silently refresh.
  issued_at timestamptz not null,
  expires_at timestamptz,
  revoked_at timestamptz
);

-- ── Helper: is this trainer public? ──────────────────────────────────────────
-- SECURITY DEFINER on purpose. Public-read policies on party_slot and credential
-- need to look at trainer.visibility, but anon has no access to `trainer` at
-- all — an inline `exists (select 1 from trainer ...)` inside a policy runs
-- under the *caller's* RLS and would silently evaluate false for every
-- anonymous request, quietly breaking public party/credential reads.
-- search_path is pinned so the definer body can't be redirected.
create or replace function trainer_is_public(p_trainer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from trainer t
    where t.id = p_trainer and t.visibility = 'public'
  );
$$;

revoke all on function trainer_is_public(uuid) from public;
grant execute on function trainer_is_public(uuid) to anon, authenticated;

-- ── RLS: enabled and policied before the first insert ────────────────────────
alter table trainer enable row level security;
alter table handle_reservation enable row level security;
alter table party_slot enable row level security;
alter table credential enable row level security;

-- Supabase default-grants ALL on new public-schema tables to anon and
-- authenticated, so the grants below are not belt-and-braces — without the
-- REVOKEs, "no policy" only means "zero rows affected", not "denied". For
-- trainer and handle_reservation the requirement is no access at all, which is
-- a privilege statement, not a policy one.
revoke all on table trainer from anon;
revoke all on table trainer from authenticated;
grant select, update on table trainer to authenticated;

revoke all on table handle_reservation from anon, authenticated;

revoke all on table party_slot from anon, authenticated;
grant select on table party_slot to anon;
grant select, insert, update, delete on table party_slot to authenticated;

revoke all on table credential from anon, authenticated;
grant select on table credential to anon, authenticated;

-- trainer: owner reads and edits own row. No DELETE policy (accounts are
-- removed through auth.users, which cascades). No INSERT policy — see the
-- "Known gaps" note at the foot of this file.
drop policy if exists trainer_select_own on trainer;
create policy trainer_select_own on trainer
  for select to authenticated
  using (id = auth.uid());

drop policy if exists trainer_update_own on trainer;
create policy trainer_update_own on trainer
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- party_slot: owner does everything to their own slots.
drop policy if exists party_slot_own on party_slot;
create policy party_slot_own on party_slot
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- party_slot: anyone may read the slots of a public trainer (the podium).
drop policy if exists party_slot_public_read on party_slot;
create policy party_slot_public_read on party_slot
  for select to anon, authenticated
  using (trainer_is_public(trainer_id));

-- credential: readable when the parent trainer is public, or by the owner.
-- There is deliberately NO insert, update, or delete policy for any role
-- (NFR-SEC-3). service_role bypasses RLS and is the only writer.
drop policy if exists credential_read on credential;
create policy credential_read on credential
  for select to anon, authenticated
  using (trainer_is_public(trainer_id) or trainer_id = auth.uid());

-- handle_reservation: no policies at all. No client role reaches this table;
-- the reserved-handle check runs through the SECURITY DEFINER trigger below.

-- ── Reserved handle enforcement ──────────────────────────────────────────────
-- SECURITY DEFINER because the caller (authenticated, or service_role acting on
-- their behalf) has no privilege on handle_reservation and must not gain one —
-- the trigger needs to read a table the user can't enumerate.
create or replace function trainer_handle_not_reserved()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if exists (select 1 from handle_reservation r where r.handle = new.handle) then
    raise exception 'handle "%" is reserved and cannot be claimed', new.handle
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trainer_handle_not_reserved_trg on trainer;
create trigger trainer_handle_not_reserved_trg
  before insert or update of handle on trainer
  for each row execute function trainer_handle_not_reserved();

-- ── trust_level ──────────────────────────────────────────────────────────────
-- Derived, never stored. A stored column would go stale the moment a credential
-- expires or is revoked, and staleness in a trust signal is worse than no
-- signal. Weighting is venue > api > self-reported.
--
-- SECURITY INVOKER (the default) on purpose: it reads `credential` under the
-- caller's own RLS, so a stranger asking about a private trainer gets 0 rather
-- than a number derived from rows they cannot see.
create or replace function trust_level(trainer uuid)
returns int
language sql
stable
as $$
  select coalesce(sum(
    case c.method
      when 'venue_verified' then 4
      when 'api_verified'   then 2
      when 'self_reported'  then 1
    end
  ), 0)::int
  from credential c
  where c.trainer_id = trust_level.trainer
    and c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now());
$$;

revoke all on function trust_level(uuid) from public;
grant execute on function trust_level(uuid) to anon, authenticated;

-- ── trainer_public ───────────────────────────────────────────────────────────
-- The ONLY path by which unauthenticated traffic reads trainer data (T-140).
-- Not a filtered `select *` on the private table: the column list here is the
-- boundary, so adding a private column to `trainer` later cannot leak it by
-- default. A future email or last_seen column simply does not appear.
--
-- This view intentionally does NOT set security_invoker. Left at the default,
-- it evaluates `trainer` as its owner (postgres), which is exactly why anon can
-- be denied every privilege on the base table and still read this. Turning
-- security_invoker on would break public trainer pages outright.
drop view if exists trainer_public;
create view trainer_public
  with (security_barrier = true)
as
  select
    handle,
    display_name,
    photo_url,
    pronouns,
    bio,
    home_region,
    play_type,
    play_type_secondary,
    philosophy,
    created_at
  from trainer
  where visibility = 'public';

revoke all on trainer_public from public;
grant select on trainer_public to anon, authenticated;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists party_slot_trainer_idx on party_slot (trainer_id);
create index if not exists party_slot_deck_idx on party_slot (deck_id);
create index if not exists credential_trainer_idx on credential (trainer_id);
-- Partial: public trainers are the only ones ever scanned by handle from
-- unauthenticated traffic.
create index if not exists trainer_public_handle_idx
  on trainer (handle) where visibility = 'public';

-- ── Seed: reserved handles ───────────────────────────────────────────────────
-- System routes and impersonation targets. RLS is already on (above), so this
-- runs as the migration author (postgres/service_role) and no client role can
-- read or extend the list.
insert into handle_reservation (handle, reason) values
  ('admin', 'reserved'),
  ('api', 'reserved'),
  ('app', 'reserved'),
  ('support', 'reserved'),
  ('magikdex', 'reserved'),
  ('help', 'reserved'),
  ('about', 'reserved'),
  ('settings', 'reserved'),
  ('login', 'reserved'),
  ('signup', 'reserved'),
  ('t', 'reserved'),
  ('deck', 'reserved'),
  ('vault', 'reserved'),
  ('brew', 'reserved'),
  ('pod', 'reserved'),
  ('analysis', 'reserved')
on conflict (handle) do nothing;

-- ── Known gaps, deliberately left for the next slice ─────────────────────────
--
-- 1. No INSERT policy on `trainer`. The spec enumerates SELECT and UPDATE for
--    the owner and nothing else, so a trainer row can currently only be created
--    by service_role. If claiming a handle is meant to be a direct client
--    write, this needs `create policy trainer_insert_own on trainer for insert
--    to authenticated with check (id = auth.uid())` plus an INSERT grant.
--
-- 2. `trainer_public` exposes no id, and `party_slot` is keyed by trainer_id.
--    /t/<handle> can therefore read the trainer but cannot join to the podium.
--    Resolving it means either adding id to the view or exposing handle on the
--    public party read — a public-surface decision, not a mechanical one.
--
-- 3. `visibility = 'unlisted'` has no read path yet: the view filters to
--    'public' as specified, so unlisted cards are currently as unreachable as
--    private ones.
--
-- 4. No handle-change rate limit (T-101, 1 per 30 days). Needs a
--    handle_changed_at column and a trigger; OQ-7 has the policy unresolved.
--
-- 5. `philosophy` has no minimum-1 constraint — the spec's `default '{}'`
--    and T-110's "minimum 1" disagree. Empty is allowed here.
--
-- 6. `credential` append-only is enforced by the absence of write policies, not
--    by a trigger. service_role can still UPDATE, which is required for
--    revocation (setting revoked_at).
