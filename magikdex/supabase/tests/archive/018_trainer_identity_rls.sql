-- 018_trainer_identity_rls.sql — policy tests for 018_trainer_identity.sql
--
-- HOW TO RUN. Paste this whole file into the Supabase SQL editor and execute it
-- as one statement batch. It opens a transaction, seeds fixtures, asserts, and
-- ROLLS BACK — nothing it creates survives, including the pgTAP extension if
-- this is the first run. 018_trainer_identity.sql must already be applied.
--
-- WHY pgTAP. This repo has no SQL test harness at all (no supabase CLI, no
-- vitest, migrations 002-017 are hand-run in the dashboard), so there was no
-- existing approach to match. pgTAP is a Postgres extension rather than a new
-- toolchain — one `create extension`, no package.json change, no runner.
--
-- Output is TAP: every line should start `ok`. A `not ok` line names the
-- failing assertion.
--
-- These are the NFR-SEC-4 regression tests. They are cheap now and they are the
-- thing that catches the policy someone forgets when they add the next table.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Seeded as the session superuser, which bypasses RLS. Every assertion below
-- runs after `set local role`, so nothing is asserted with these privileges.
--
--   1111… u_pub    → @publictrainer   (visibility public)
--   2222… u_priv   → @privatetrainer  (visibility private)
--   3333… u_other  → @othertrainer    (the stranger doing the probing)
--   4444… u_spare  → no trainer row; used for constraint-rejection attempts

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pub@test.local',   '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'priv@test.local',  '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'other@test.local', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'spare@test.local', '', now(), now(), now());

insert into trainer (id, handle, display_name, philosophy, visibility) values
  ('11111111-1111-1111-1111-111111111111', 'publictrainer',  'Public Trainer',
   array['casual', 'jank'], 'public'),
  ('22222222-2222-2222-2222-222222222222', 'privatetrainer', 'Private Trainer',
   array['cedh'], 'private'),
  ('33333333-3333-3333-3333-333333333333', 'othertrainer',   'Other Trainer',
   array['trash_magic'], 'private');

-- Six decks: five to fill the party, one to prove the cap rejects a sixth.
insert into decks (id, legend, status)
select
  ('aaaaaaaa-0000-0000-0000-00000000000' || i)::uuid,
  'Test Legend ' || i,
  'Active'
from generate_series(1, 6) as i;

insert into party_slot (trainer_id, deck_id, position)
select
  '11111111-1111-1111-1111-111111111111',
  ('aaaaaaaa-0000-0000-0000-00000000000' || i)::uuid,
  i
from generate_series(1, 5) as i;

insert into credential (trainer_id, kind, issuer, method, payload, issued_at) values
  ('11111111-1111-1111-1111-111111111111', 'lgs_visit', 'Test LGS',
   'self_reported', '{"venue":"Test LGS"}'::jsonb, now()),
  ('22222222-2222-2222-2222-222222222222', 'lgs_visit', 'Secret LGS',
   'self_reported', '{"venue":"Secret LGS"}'::jsonb, now()),
  ('33333333-3333-3333-3333-333333333333', 'lgs_visit', 'Other LGS',
   'self_reported', '{"venue":"Other LGS"}'::jsonb, now());

-- ── Anonymous ────────────────────────────────────────────────────────────────
set local role anon;

-- 1. The private table is unreachable for anon. This asserts permission denied
--    rather than an empty result, which is the stronger of the two: the grant is
--    revoked as well as the policy withheld, so anon cannot even attempt a read.
select throws_ok(
  $$ select id from trainer $$,
  '42501', null,
  '1. anon SELECT on trainer is denied outright (no rows, no privilege)'
);

-- 2. The view is the public path, and it shows only public trainers.
select results_eq(
  $$ select handle::text from trainer_public order by handle $$,
  $$ values ('publictrainer'::text) $$,
  '2. anon SELECT on trainer_public returns only public trainers'
);

-- 3. A private trainer's credentials are invisible to anon, even though the
--    credential table itself is anon-readable for public trainers.
select is_empty(
  $$ select id from credential
     where trainer_id = '22222222-2222-2222-2222-222222222222' $$,
  '3. anon SELECT on credential for a private trainer returns zero rows'
);

-- ── Authenticated as a stranger (u_other) ────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
set local request.jwt.claims =
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- 4. Being signed in buys you your own row and nobody else's.
select is_empty(
  $$ select id from trainer
     where id = '22222222-2222-2222-2222-222222222222' $$,
  '4. authenticated user cannot SELECT another user''s trainer row'
);

-- 5-6. NFR-SEC-3: credentials are issuer-written only. A client cannot forge a
--      credential, cannot rewrite one, and cannot destroy one — including their
--      own, because "revocable, never editable" means revocation is a
--      service-role write of revoked_at, not a client UPDATE.
select throws_ok(
  $$ insert into credential (trainer_id, kind, issuer, method, payload, issued_at)
     values ('33333333-3333-3333-3333-333333333333', 'lgs_visit', 'Forged LGS',
             'venue_verified', '{}'::jsonb, now()) $$,
  '42501', null,
  '5. authenticated user cannot INSERT into credential'
);

select throws_ok(
  $$ update credential set issuer = 'Rewritten'
     where trainer_id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  '6a. authenticated user cannot UPDATE their own credential'
);

select throws_ok(
  $$ delete from credential
     where trainer_id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  '6b. authenticated user cannot DELETE their own credential'
);

-- ── Authenticated as the party owner (u_pub) ─────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 7. The cap of 5 is a database constraint, not client validation (T-120).
--    Positions 1-5 are taken, so a sixth slot has to claim position 6 and the
--    range check rejects it.
select throws_ok(
  $$ insert into party_slot (trainer_id, deck_id, position)
     values ('11111111-1111-1111-1111-111111111111',
             'aaaaaaaa-0000-0000-0000-000000000006', 6) $$,
  '23514', null,
  '7. inserting a 6th party_slot for one trainer fails'
);

-- ── Constraint checks (no role switch needed) ────────────────────────────────
reset role;

-- 8. The philosophy vocabulary is closed at the database, so a typo or a
--    client-side vocabulary drift cannot land a value the UI can't render.
select throws_ok(
  $$ insert into trainer (id, handle, display_name, philosophy)
     values ('44444444-4444-4444-4444-444444444444', 'philosophytest',
             'Philosophy Test', array['spike']) $$,
  '23514', null,
  '8. inserting an invalid philosophy value fails'
);

-- 9. Reserved handles are blocked by trigger — a CHECK cannot see another
--    table. 'admin' is in the seeded reservation list.
select throws_ok(
  $$ insert into trainer (id, handle, display_name)
     values ('44444444-4444-4444-4444-444444444444', 'admin', 'Impostor') $$,
  '23514', null,
  '9. inserting a handle matching a handle_reservation row fails'
);

select * from finish();

rollback;
