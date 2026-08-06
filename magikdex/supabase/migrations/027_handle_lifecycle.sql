-- 027_handle_lifecycle.sql — handle changes: rate limited, and released on rename
--
-- NOT APPLIED — written for review. Verified locally against a fresh
-- 001 → 024 → 025 → 026 replay; see supabase/tests/027_handle_lifecycle_rls.sql.
--
-- ── Two gaps, one mechanism ──────────────────────────────────────────────────
--
-- GAP 1 — NO RATE LIMIT ON HANDLE CHANGES. The requirement is one change per 30
-- days. 025 shipped without it and listed it as a known gap. A handle is the
-- primary key of a person's public identity: it is in their URL, on their
-- physical card, in every QR code they have ever handed out, and it is the key
-- every function in 026 takes. Letting it churn freely means every one of those
-- becomes a dangling pointer at the owner's whim.
--
-- GAP 2 — handle_reservation HAD A DEAD HALF. The table has carried `reason IN
-- ('reserved','released')` and a `released_from uuid` column since the first
-- draft, and NOTHING HAS EVER WRITTEN EITHER. The reserved-handle seed only ever
-- inserts reason='reserved'. So the entire released-handle mechanism — the thing
-- that stops @ben from being re-registered by a stranger ten minutes after Ben
-- renames — was schema with no behaviour behind it.
--
-- That is worth noticing as a pattern: a column whose only reader is a CHECK
-- constraint is a design intention, not a feature. Nothing enforces that the
-- intention was ever implemented, and it reads as finished when it isn't.
--
-- Both gaps close with the same trigger, because both are "what happens on
-- rename" — which is why they are one migration and not two.

-- ── handle_changed_at ────────────────────────────────────────────────────────
-- NULL means never renamed. A default of now() would have been wrong: it would
-- start every brand-new profile inside its own cooldown, so a user who typo'd
-- their handle at signup could not fix it for a month.
alter table trainer.profile
  add column if not exists handle_changed_at timestamptz;

-- ── Reclaiming your own released handle ──────────────────────────────────────
-- Replaces 025's version. The reserved-handle check now permits ONE exception:
-- a handle released by you, being re-claimed by you.
--
-- Without this, renaming would be a one-way door — release @ben, change your
-- mind an hour later, and you are locked out of your own name by the very
-- mechanism that exists to protect it. The reservation row records
-- released_from, so "is this the original owner" is a question the database can
-- already answer.
--
-- Note it stays SECURITY DEFINER with a pinned search_path: the caller has no
-- privilege on handle_reservation and must not gain one.
create or replace function trainer.handle_not_reserved()
returns trigger
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare
  r record;
begin
  select * into r
  from trainer.handle_reservation
  where handle = new.handle;

  if not found then
    return new;
  end if;

  -- Your own released handle, coming back to you.
  if r.reason = 'released' and r.released_from = new.id then
    return new;
  end if;

  raise exception 'handle "%" is reserved and cannot be claimed', new.handle
    using errcode = 'check_violation';
end;
$$;

-- ── The rename trigger ───────────────────────────────────────────────────────
-- Named `profile_handle_lifecycle` deliberately: Postgres fires BEFORE ROW
-- triggers in ALPHABETICAL ORDER BY TRIGGER NAME, and 'l' sorts before the 'n'
-- of profile_handle_not_reserved. So this one runs first — releasing the old
-- handle and stamping the clock — and the reservation check then evaluates the
-- NEW handle with the reservation table already up to date.
--
-- That ordering is load-bearing and invisible. If somebody renames this trigger
-- to something sorting after 'profile_handle_n...', a rename-and-immediately-
-- reclaim would start failing for reasons nobody would enjoy debugging.
create or replace function trainer.handle_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
begin
  -- citext comparison, so 'Ben' -> 'ben' is not a rename. Casing is already
  -- pinned to lowercase by the shape CHECK, but this keeps the guard honest if
  -- that ever loosens.
  if new.handle = old.handle then
    return new;
  end if;

  -- ONE CHANGE PER 30 DAYS. NULL handle_changed_at means never renamed, so the
  -- first rename is always allowed.
  if old.handle_changed_at is not null
     and old.handle_changed_at > now() - interval '30 days' then
    raise exception
      'handle was changed on % — one change per 30 days',
      old.handle_changed_at::date
      using errcode = 'check_violation';
  end if;

  -- Release the old handle. THIS is the half that was missing: without it the
  -- handle a person just gave up is immediately claimable by anyone, including
  -- someone who watched them give it up.
  --
  -- `on conflict do nothing` because the handle may already be listed — most
  -- likely from an earlier release by this same user. The existing row's
  -- released_from is then preserved, which is correct: the FIRST owner is the one
  -- with a claim to reclaim it.
  insert into trainer.handle_reservation (handle, reason, released_from)
  values (old.handle, 'released', old.id)
  on conflict (handle) do nothing;

  new.handle_changed_at := now();
  return new;
end;
$$;

drop trigger if exists profile_handle_lifecycle on trainer.profile;
create trigger profile_handle_lifecycle
  before update of handle on trainer.profile
  for each row execute function trainer.handle_lifecycle();

-- ── Index ────────────────────────────────────────────────────────────────────
-- Released handles are looked up by their prior owner when someone reclaims, and
-- partial because the overwhelming majority of rows are the system reservations.
create index if not exists handle_reservation_released_from_idx
  on trainer.handle_reservation (released_from)
  where reason = 'released';

-- ── Known gaps, deliberately left ────────────────────────────────────────────
--
-- 1. A released handle is reserved FOREVER. There is no expiry, so a handle
--    abandoned in 2026 is still unclaimable in 2030. That is the safe default —
--    it prevents impersonation of a departed user, which is why released_from is
--    deliberately not a foreign key and survives the account being deleted. If
--    handles ever become scarce enough to matter, an expiry is an additive
--    change and a policy decision, not a mechanical one.
--
-- 2. The 30-day window is a literal in the trigger body rather than a setting.
--    Making it configurable means a settings table or a GUC, and neither earns
--    its keep for a value that has changed zero times.
--
-- 3. Nothing rewrites the old handle in anyone's roster. 026 stores connections
--    by uuid and resolves the handle at read time, so my_roster() follows a
--    rename automatically — but a QR code or a printed card carrying the OLD
--    handle now resolves to nothing. That is inherent to renaming, and the rate
--    limit is the mitigation.
--
-- 4. No notification to anyone who saved you. Out of scope; there is no
--    messaging subsystem and this slice should not smuggle one in.
