-- 029_buddy_rename.sql — the product calls them buddies, so the database should
--
-- ✅ APPLIED TO PRODUCTION 2026-08-06 (project iduoct…). The 026 suite was run
-- AGAINST PRODUCTION afterwards on the renamed objects: 24 ok. Verified live —
-- roster_count is gone, buddy_count answers, trainer.buddy exists with its data
-- intact (buddy_count('zen') = 1, the row that existed before the rename).
--
-- 026 shipped as "connection" / "roster". The product settled on BUDDY LIST: the
-- model is a Y2K AIM buddy list, not a card collection or a sports roster. Code
-- that disagrees with the product's own words is a tax paid at every future
-- reading, and the divergence was already forcing explanatory comments in the
-- client.
--
-- ⏱ WHY NOW AND NOT LATER. roster_count is a PUBLIC endpoint. The moment a
-- printed card, a QR code, or anything else outside this repo points at it, the
-- old name is pinned forever. Renaming is free today and impossible later.
--
-- SAFETY. `alter table ... rename` preserves data, indexes, constraints, RLS
-- policies and grants — nothing is dropped and nothing is copied. Functions are a
-- different story: Postgres stores their bodies as TEXT and resolves names at
-- call time, so every function referencing the old table has to be recreated or
-- it breaks silently at the next call. That is why they are all rewritten below
-- rather than left alone.

-- ── Table ────────────────────────────────────────────────────────────────────
-- trainer.block keeps its name: a block is a block in any vocabulary.
alter table if exists trainer.connection rename to buddy;

alter index if exists trainer.connection_connected_idx rename to buddy_connected_idx;
alter index if exists trainer.connection_recent_idx    rename to buddy_recent_idx;

-- Constraint names are cosmetic but they surface in error messages, and an error
-- naming a table that no longer exists is its own small confusion.
alter table trainer.buddy rename constraint connection_met_count_positive to buddy_met_count_positive;
alter table trainer.buddy rename constraint connection_context_len        to buddy_context_len;
alter table trainer.buddy rename constraint connection_context_not_geo    to buddy_context_not_geo;
alter table trainer.buddy rename constraint connection_note_len           to buddy_note_len;
alter table trainer.buddy rename constraint connection_not_self           to buddy_not_self;

-- The policy is renamed rather than recreated, so there is no window in which the
-- table sits unprotected.
alter policy connection_own on trainer.buddy rename to buddy_own;

-- ── Trigger: blocking severs the edge in BOTH directions ─────────────────────
-- Recreated because its body names the table. Behaviour is unchanged: blocking
-- someone who has you saved removes you from their list too, otherwise "block"
-- only means "I stopped looking at you", which is not what anyone means by it.
create or replace function trainer.block_severs_buddy()
returns trigger
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
begin
  delete from trainer.buddy
   where (trainer_id = new.trainer_id and connected_trainer_id = new.blocked_trainer_id)
      or (trainer_id = new.blocked_trainer_id and connected_trainer_id = new.trainer_id);
  return new;
end;
$$;

drop trigger if exists block_severs_connection on trainer.block;
drop trigger if exists block_severs_buddy on trainer.block;
create trigger block_severs_buddy
  after insert on trainer.block
  for each row execute function trainer.block_severs_buddy();

drop function if exists trainer.block_severs_connection();

-- ── Public API ───────────────────────────────────────────────────────────────
-- save_connection → add_buddy. THE UPSERT STAYS SERVER-SIDE: that is what makes
-- met_count trustworthy, since buddy_count publishes it and a client that could
-- run its own upsert could set the counter to anything.
create or replace function public.add_buddy(
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

  insert into trainer.buddy (trainer_id, connected_trainer_id, source, met_context)
  values (v_me, v_target, p_source::trainer.connection_source, p_met_context)
  on conflict (trainer_id, connected_trainer_id) do update
    set last_met_at = now(),
        met_count   = buddy.met_count + 1,
        met_context = coalesce(excluded.met_context, buddy.met_context);
end;
$$;

create or replace function public.set_buddy_note(
  p_handle extensions.citext,
  p_note   text
)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- No visibility filter: this edits YOUR record of a meeting that happened. If
  -- they have since gone private you keep your own note.
  update trainer.buddy b
     set note = p_note
   where b.trainer_id = v_me
     and b.connected_trainer_id = (select p.id from trainer.profile p where p.handle = p_handle);
end;
$$;

create or replace function public.remove_buddy(p_handle extensions.citext)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from trainer.buddy b
   where b.trainer_id = v_me
     and b.connected_trainer_id = (select p.id from trainer.profile p where p.handle = p_handle);
end;
$$;

-- my_roster → my_buddies. Visibility is evaluated at READ time, never frozen at
-- save time: someone who has gone private since you met comes back with null card
-- fields and reachable=false. You keep your own record of the encounter; their
-- card is theirs to withdraw.
--
-- handle is the exception and always returns — it is how you saved them and the
-- key every function here takes, and without it you could not remove someone who
-- went private. It is not a new disclosure: you knew it at save time.
create or replace function public.my_buddies()
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
    b.source::text, b.first_met_at, b.last_met_at, b.met_count, b.met_context, b.note,
    (p.visibility in ('public','unlisted'))
  from trainer.buddy b
  join trainer.profile p on p.id = b.connected_trainer_id
  where b.trainer_id = auth.uid()
  order by b.last_met_at desc;
$$;

-- roster_count → buddy_count. The ONLY public piece of buddy data: that a list
-- exists and how large it is. WHEN, WHERE and WHAT WAS NOTED are not reachable
-- through it, and the bare int return type is the enforcement.
--
-- STILL RETURNS 0, NOT NULL, for an unreachable trainer. 0 makes a private
-- trainer indistinguishable from a public one with an empty list; a null would
-- itself announce "this account is private".
create or replace function public.buddy_count(p_handle extensions.citext)
returns int
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select count(*)::int
  from trainer.buddy b
  join trainer.profile p on p.id = b.trainer_id
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted');
$$;

-- ── Grants, then drop the old names ──────────────────────────────────────────
revoke all on function public.add_buddy(extensions.citext, text, text) from public;
revoke all on function public.set_buddy_note(extensions.citext, text) from public;
revoke all on function public.remove_buddy(extensions.citext) from public;
revoke all on function public.my_buddies() from public;
revoke all on function public.buddy_count(extensions.citext) from public;

grant execute on function public.add_buddy(extensions.citext, text, text) to authenticated;
grant execute on function public.set_buddy_note(extensions.citext, text) to authenticated;
grant execute on function public.remove_buddy(extensions.citext) to authenticated;
grant execute on function public.my_buddies() to authenticated;
-- buddy_count is the one anonymous-readable entry point.
grant execute on function public.buddy_count(extensions.citext) to anon, authenticated;

-- Dropped LAST, so the new ones exist before the old ones stop.
drop function if exists public.save_connection(extensions.citext, text, text);
drop function if exists public.set_connection_note(extensions.citext, text);
drop function if exists public.forget_connection(extensions.citext);
drop function if exists public.my_roster();
drop function if exists public.roster_count(extensions.citext);

-- ── Known gaps ───────────────────────────────────────────────────────────────
--
-- 1. The enum is still trainer.connection_source. Renaming a type in use means
--    rewriting every column that references it, which is real risk for a word
--    that appears in no UI. Left alone deliberately.
--
-- 2. Migration 026 keeps its filename and its "connection" language. It is
--    history and it is applied; rewriting applied migrations to match today's
--    vocabulary is how a migration history stops being a record of what happened.
