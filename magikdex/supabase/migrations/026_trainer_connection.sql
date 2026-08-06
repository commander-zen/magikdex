-- 026_trainer_connection.sql — the roster: who you've met, when, roughly where
--
-- NOT APPLIED — written for review. Verified locally against a fresh
-- 001 → 024 → 025 replay; see supabase/tests/026_trainer_connection_rls.sql.
--
-- Supersedes archive/022. Same privacy design, which was already right; what
-- changed is the schema it lives in and the shape of its API.
--
-- ── Why this exists ──────────────────────────────────────────────────────────
-- The backlog's evidence is a SCHEDULING failure: four people, mutually
-- available, zero games. This table is for a different failure — the game
-- already happened, it was good, and there is no handle on the other player
-- afterward. "i dont remember his name but i want to wish him well and play
-- again if we can." Nothing in the identity slice covers that.
--
-- ── THE PRIVACY DECISION THAT SHAPES THE TABLE ───────────────────────────────
-- ONE ROW PER PAIR, NOT AN ENCOUNTER LOG. This is the load-bearing choice.
--
-- A log of every scan, each carrying a venue and a timestamp, is in aggregate a
-- MOVEMENT HISTORY — the one artifact this system must be structurally incapable
-- of reconstructing. So the row holds first_met_at, last_met_at and a count.
-- Re-scanning UPDATES; it never appends.
--
-- You can know you have played someone six times, first in March and most
-- recently Thursday. You cannot recover where either of you was on the four
-- nights in between, because it was never written down. Not redacted, not
-- access-controlled — never recorded.
--
-- ── What changed from archive/022 ─────────────────────────────────────────────
-- 1. Lives in the `trainer` schema. No default grants to undo.
--
-- 2. THE ENTIRE API IS HANDLE-KEYED. 022 took uuids, which nothing publishes and
--    now nothing ever will (see 025). A QR code carries a URL containing a
--    handle, so a handle is what the client actually has in hand at the moment
--    of a scan.
--
-- 3. met_count IS INCREMENTED SERVER-SIDE. 022's known gap #1: re-scanning was a
--    client-side upsert, so the client controlled the counter. Fine while it is
--    private trivia about your own history; not fine the moment it is public
--    (and roster_count publishes it). The increment now happens inside a
--    SECURITY DEFINER function the client cannot reach around.
--
-- 4. roster_count returns 0 for an unreachable trainer BY DESIGN, not by
--    accident. See the function for why 0 beats null.

-- ── Types ────────────────────────────────────────────────────────────────────
-- How the edge was created, not what transport carried it. QR and NFC are the
-- same event — two people in the same room — so both are `scan`. Splitting them
-- would rebuild the cross-product mistake that credential.kind/method avoids.
do $$ begin
  create type trainer.connection_source as enum ('scan', 'manual');
exception when duplicate_object then null; end $$;

-- ── trainer.connection ───────────────────────────────────────────────────────
-- DIRECTIONAL AND UNILATERAL. A saving B needs no approval from B, because B's
-- card is already something B chose to hand out. There is no pending/accepted
-- state machine: an acceptance flow adds friction at exactly the moment the
-- product must be frictionless — two people at a table at 11pm, one of them
-- already putting their deck away.
--
-- Mutuality is DERIVED from two rows existing, and is never surfaced. See the
-- policy block.
create table if not exists trainer.connection (
  trainer_id           uuid not null references trainer.profile(id) on delete cascade,
  connected_trainer_id uuid not null references trainer.profile(id) on delete cascade,

  source trainer.connection_source not null default 'scan',

  first_met_at timestamptz not null default now(),
  last_met_at  timestamptz not null default now(),
  met_count    int not null default 1
    constraint connection_met_count_positive check (met_count >= 1),

  -- Free text, not a venue foreign key. Where venue records come from is
  -- unresolved and belongs to a later slice; inventing a venue table here would
  -- prejudge it. When venues exist, a nullable venue_id is an additive
  -- follow-up and this stays as the human note.
  --
  -- It carries the SAME no-coordinates CHECK as profile.home_region. Without it
  -- this column is the geo backdoor: the one place a client could start writing
  -- lat/long into a table that also holds a timestamp and a person. That is how
  -- the dangerous version gets built by accident.
  met_context text
    constraint connection_context_len check (char_length(met_context) <= 80)
    constraint connection_context_not_geo
      check (met_context !~ '[-+]?[0-9]{1,3}\.[0-9]{3,}'),

  -- The owner's private annotation. "played Voja, super nice, wants a rematch."
  -- Never exposed to the other party or to anyone else. The only genuinely
  -- one-sided field in the schema.
  note text
    constraint connection_note_len check (char_length(note) <= 280),

  created_at timestamptz not null default now(),

  primary key (trainer_id, connected_trainer_id),
  constraint connection_not_self check (trainer_id <> connected_trainer_id)
);

-- ── trainer.block ────────────────────────────────────────────────────────────
-- A roster you cannot get out of is not a finished roster. Separate from
-- connection on purpose: a block must keep working after the connection row is
-- gone, and it must stop a NEW connection forming — neither of which deleting a
-- row can do.
create table if not exists trainer.block (
  trainer_id         uuid not null references trainer.profile(id) on delete cascade,
  blocked_trainer_id uuid not null references trainer.profile(id) on delete cascade,
  created_at         timestamptz not null default now(),

  primary key (trainer_id, blocked_trainer_id),
  constraint block_not_self check (trainer_id <> blocked_trainer_id)
);

-- ── Helpers ──────────────────────────────────────────────────────────────────
-- Reachable = public OR unlisted. This is where `unlisted` earns its keep: it is
-- exactly "someone handed me this card". Note it is WIDER than 025's public-only
-- filter on enumeration — resolution by known handle allows unlisted, listing
-- never happens at all.
create or replace function trainer.is_reachable(p_trainer uuid)
returns boolean
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select exists (
    select 1 from trainer.profile p
    where p.id = p_trainer and p.visibility in ('public', 'unlisted')
  );
$$;

create or replace function trainer.has_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select exists (
    select 1 from trainer.block b
    where b.trainer_id = p_blocker and b.blocked_trainer_id = p_blocked
  );
$$;

-- ── RLS and privileges ───────────────────────────────────────────────────────
-- POLICIES WITH NO GRANTS. Deliberate, and worth understanding.
--
-- No client role is granted a single privilege on these two tables, so they are
-- unreachable no matter what any policy says — every read and write below goes
-- through a SECURITY DEFINER function.
--
-- The policies are written anyway. If someone later adds `trainer` to the
-- project's Exposed Schemas and grants table access for convenience, the tables
-- are already owner-scoped instead of wide open. Policy is the lock; the missing
-- grant is the door being bricked up. Bricks come out eventually.
alter table trainer.connection enable row level security;
alter table trainer.block      enable row level security;

-- ROSTERS ARE PRIVATE IN BOTH DIRECTIONS. There is no public read policy on
-- either table, by design and not by omission. B cannot see that A saved them,
-- and nobody can enumerate anyone's roster — the social graph is not a public
-- object.
--
-- Consequence worth knowing: "we both saved each other" is NOT computable by
-- either party. Surfacing it would leak one bit about B's roster to A. That bit
-- is deliberately withheld: it is a one-line addition later, and unrecoverable
-- once shipped.
drop policy if exists connection_own on trainer.connection;
create policy connection_own on trainer.connection
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (
    trainer_id = auth.uid()
    and trainer.is_reachable(connected_trainer_id)
    and not trainer.has_blocked(connected_trainer_id, auth.uid())
  );

drop policy if exists block_own on trainer.block;
create policy block_own on trainer.block
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- ── Blocking severs the edge in BOTH directions ──────────────────────────────
-- Blocking someone who has you saved has to remove you from their roster too,
-- not just them from yours — otherwise "block" only means "I stopped looking at
-- you", which is not what anyone means by it. SECURITY DEFINER because the
-- blocker has no privilege on the blocked party's rows.
create or replace function trainer.block_severs_connection()
returns trigger
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
begin
  delete from trainer.connection
   where (trainer_id = new.trainer_id and connected_trainer_id = new.blocked_trainer_id)
      or (trainer_id = new.blocked_trainer_id and connected_trainer_id = new.trainer_id);
  return new;
end;
$$;

drop trigger if exists block_severs_connection on trainer.block;
create trigger block_severs_connection
  after insert on trainer.block
  for each row execute function trainer.block_severs_connection();

-- ── The API: all handle-keyed, all in `public` ───────────────────────────────
-- In `public` so PostgREST can see them without the trainer schema being
-- exposed. Consequence: the entire connection feature works with no dashboard
-- change, unlike 025's owner-profile path.

-- Save (or re-save) a trainer you met. THE UPSERT LIVES HERE, NOT IN THE CLIENT.
-- That is what makes met_count trustworthy: a client that could run its own
-- upsert could set the counter to 400, and roster_count publishes it.
create or replace function public.save_connection(
  p_handle      extensions.citext,
  p_met_context text default null,
  p_source      text default 'scan'
)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare
  v_me     uuid := auth.uid();
  v_target uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select p.id into v_target
  from trainer.profile p
  where p.handle = p_handle and p.visibility in ('public', 'unlisted');

  -- A private trainer cannot be added to anyone's roster. Same message as a
  -- nonexistent handle on purpose: distinguishing them would turn this function
  -- into an oracle for "does this handle exist but is set to private".
  if v_target is null then
    raise exception 'no reachable trainer with that handle' using errcode = 'P0002';
  end if;

  if v_target = v_me then
    raise exception 'cannot save yourself' using errcode = '23514';
  end if;

  if trainer.has_blocked(v_target, v_me) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into trainer.connection
    (trainer_id, connected_trainer_id, source, met_context)
  values
    (v_me, v_target, p_source::trainer.connection_source, p_met_context)
  on conflict (trainer_id, connected_trainer_id) do update
    set last_met_at = now(),
        met_count   = connection.met_count + 1,
        -- A re-scan with no context must not erase the context you typed the
        -- first time.
        met_context = coalesce(excluded.met_context, connection.met_context);
end;
$$;

-- Your own annotation on a connection. Separate from save_connection because
-- writing a note is not a meeting and must not bump met_count or last_met_at.
create or replace function public.set_connection_note(
  p_handle extensions.citext,
  p_note   text
)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- No visibility filter on the target: this edits YOUR record of a meeting that
  -- happened. If they have since gone private you keep your own note.
  update trainer.connection c
     set note = p_note
   where c.trainer_id = v_me
     and c.connected_trainer_id = (
       select p.id from trainer.profile p where p.handle = p_handle
     );
end;
$$;

create or replace function public.forget_connection(p_handle extensions.citext)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from trainer.connection c
   where c.trainer_id = v_me
     and c.connected_trainer_id = (
       select p.id from trainer.profile p where p.handle = p_handle
     );
end;
$$;

create or replace function public.block_trainer(p_handle extensions.citext)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare
  v_me     uuid := auth.uid();
  v_target uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- No visibility filter: you must be able to block someone regardless of what
  -- their card is set to now. Blocking is a safety action, not a social one.
  select p.id into v_target from trainer.profile p where p.handle = p_handle;

  if v_target is null then
    raise exception 'no trainer with that handle' using errcode = 'P0002';
  end if;
  if v_target = v_me then
    raise exception 'cannot block yourself' using errcode = '23514';
  end if;

  insert into trainer.block (trainer_id, blocked_trainer_id)
  values (v_me, v_target)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_trainer(p_handle extensions.citext)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Unblocking does NOT restore the severed connections. They were deleted, and
  -- resurrecting them would be a surprise.
  delete from trainer.block b
   where b.trainer_id = v_me
     and b.blocked_trainer_id = (
       select p.id from trainer.profile p where p.handle = p_handle
     );
end;
$$;

-- ── my_roster ────────────────────────────────────────────────────────────────
-- The read model. One call instead of N+1: RLS would scope the connection rows
-- to the caller, but joining out to card data needs privileges the caller does
-- not have on other people's profiles, so the join is only legal in here.
--
-- VISIBILITY IS EVALUATED AT READ TIME, NOT FROZEN AT SCAN TIME. If someone was
-- public when you met and has since gone private, their card fields come back
-- NULL and `reachable` is false. You keep your own memory of the encounter —
-- when, roughly where, your note — but their card is gone. Their later choice
-- wins over your earlier copy, without erasing your record that the game
-- happened.
--
-- `handle` is the exception and returns regardless of visibility. It is how you
-- saved them, it is the key every function here takes, and without it you could
-- not forget a connection that went private. It is also not a new disclosure:
-- you necessarily knew the handle at save time.
create or replace function public.my_roster()
returns table (
  handle           extensions.citext,
  display_name     text,
  photo_url        text,
  identity_mode    text,
  playstyle        text[],
  favorite_legends text[],
  philosophy       text[],
  source           text,
  first_met_at     timestamptz,
  last_met_at      timestamptz,
  met_count        int,
  met_context      text,
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
    c.source::text,
    c.first_met_at,
    c.last_met_at,
    c.met_count,
    c.met_context,
    c.note,
    (p.visibility in ('public','unlisted'))
  from trainer.connection c
  join trainer.profile p on p.id = c.connected_trainer_id
  where c.trainer_id = auth.uid()
  order by c.last_met_at desc;
$$;

-- ── roster_count ─────────────────────────────────────────────────────────────
-- The only piece of connection data that is PUBLIC. That a roster exists and how
-- large it is, is a trust signal and safe to publish. WHEN, WHERE and WHAT WAS
-- NOTED are not, and none of them are reachable through this function — the
-- return type is a bare int, and that is the enforcement.
--
-- There is deliberately no companion returning handles or "people you both
-- know": that leaks roster MEMBERSHIP, which is the object this whole file keeps
-- private, and is a much larger surface than a size.
--
-- IT RETURNS 0, NOT NULL, FOR AN UNREACHABLE TRAINER — and that is the intended
-- behaviour, stated here so nobody later "fixes" it into a null.
--
-- 0 makes a private trainer indistinguishable from a public trainer with an
-- empty roster. A null would itself announce "this account is private", which is
-- one bit more than a count is allowed to give away. The guard sits in the WHERE
-- clause precisely so the answer is a number either way.
create or replace function public.roster_count(p_handle extensions.citext)
returns int
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select count(*)::int
  from trainer.connection c
  join trainer.profile p on p.id = c.trainer_id
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted');
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Every write requires a session, so those are authenticated-only. roster_count
-- is the sole anonymous-readable entry point.
revoke all on function public.save_connection(extensions.citext, text, text) from public;
revoke all on function public.set_connection_note(extensions.citext, text) from public;
revoke all on function public.forget_connection(extensions.citext) from public;
revoke all on function public.block_trainer(extensions.citext) from public;
revoke all on function public.unblock_trainer(extensions.citext) from public;
revoke all on function public.my_roster() from public;
revoke all on function public.roster_count(extensions.citext) from public;

grant execute on function public.save_connection(extensions.citext, text, text) to authenticated;
grant execute on function public.set_connection_note(extensions.citext, text) to authenticated;
grant execute on function public.forget_connection(extensions.citext) to authenticated;
grant execute on function public.block_trainer(extensions.citext) to authenticated;
grant execute on function public.unblock_trainer(extensions.citext) to authenticated;
grant execute on function public.my_roster() to authenticated;
grant execute on function public.roster_count(extensions.citext) to anon, authenticated;

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- The primary key covers (trainer_id, connected_trainer_id). The reverse
-- direction is needed by the block trigger.
create index if not exists connection_connected_idx
  on trainer.connection (connected_trainer_id);
-- The roster's natural read order: most recently played first.
create index if not exists connection_recent_idx
  on trainer.connection (trainer_id, last_met_at desc);
create index if not exists block_blocked_idx
  on trainer.block (blocked_trainer_id);

-- ── Known gaps, deliberately left ────────────────────────────────────────────
--
-- 1. No messaging. "Wish him well" resolves to a handle, hence /t/<handle>,
--    hence whatever contact path that card chooses to expose. A DM subsystem is
--    not in this slice and should not be smuggled into it.
--
-- 2. No mutuality flag — withheld rather than forgotten. See the policy block.
--
-- 3. No venue foreign key. met_context stays free text until venues exist.
--
-- 4. Blocking is enforced at INSERT, and an existing connection is severed by
--    the trigger. A block placed while a scan is mid-flight is a last-writer
--    race — acceptable, since the trigger's delete runs after.
--
-- 5. roster_count counts OUTBOUND edges: people this trainer saved. It does not
--    count who saved them, because that would be readable roster membership from
--    the other side.
--
-- 6. save_connection cannot be rate-limited here. A client could call it in a
--    loop against handles it guesses to inflate its own count, or to probe which
--    handles are reachable. Both are application rate-limit concerns; the
--    uniform "no reachable trainer" error at least keeps the probe from
--    distinguishing private from nonexistent.
