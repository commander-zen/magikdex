-- 022_trainer_connection_rls.sql — policy tests for 022_trainer_connection.sql
--
-- HOW TO RUN. Paste the whole file into the Supabase SQL editor and execute it
-- as one batch. It opens a transaction, seeds fixtures, asserts, and ROLLS
-- BACK. Both 018_trainer_identity.sql and 022_trainer_connection.sql must
-- already be applied.
--
-- Same approach as 018's test file: pgTAP, role-switched with `set local role`,
-- nothing persisted. Output is TAP — every line should start `ok`.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Seeded as the session superuser, which bypasses RLS.
--
--   1111… A → @a_public    (public)   — the one doing the saving
--   2222… B → @b_public    (public)   — saved by A
--   3333… C → @c_unlisted  (unlisted) — handed his card over in person
--   4444… D → @d_private   (private)  — must not be addable by anyone
--   5555… E → @e_public    (public)   — blocks A partway through

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  (repeat(i::text, 8) || '-' || repeat(i::text, 4) || '-' || repeat(i::text, 4)
    || '-' || repeat(i::text, 4) || '-' || repeat(i::text, 12))::uuid,
  'authenticated', 'authenticated', 'trainer' || i || '@test.local',
  '', now(), now(), now()
from generate_series(1, 5) as i;

insert into trainer (id, handle, display_name, visibility) values
  ('11111111-1111-1111-1111-111111111111', 'a_public',   'Trainer A', 'public'),
  ('22222222-2222-2222-2222-222222222222', 'b_public',   'Trainer B', 'public'),
  ('33333333-3333-3333-3333-333333333333', 'c_unlisted', 'Trainer C', 'unlisted'),
  ('44444444-4444-4444-4444-444444444444', 'd_private',  'Trainer D', 'private'),
  ('55555555-5555-5555-5555-555555555555', 'e_public',   'Trainer E', 'public');

-- ── Anonymous ────────────────────────────────────────────────────────────────
set local role anon;

-- 1. The social graph is not a public object. anon has no grant at all, so this
--    is denied outright rather than returning an empty set.
select throws_ok(
  $$ select trainer_id from trainer_connection $$,
  '42501', null,
  '1. anon SELECT on trainer_connection is denied outright'
);

-- ── Authenticated as A ───────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 2-3. The happy path: scan a public card, it lands, you can read it back.
select lives_ok(
  $$ insert into trainer_connection
       (trainer_id, connected_trainer_id, source, met_context, note)
     values ('11111111-1111-1111-1111-111111111111',
             '22222222-2222-2222-2222-222222222222',
             'scan', 'Gnome Games commander night', 'played Voja, wants a rematch') $$,
  '2. a trainer can save a public trainer they met'
);

select results_eq(
  $$ select connected_trainer_id from trainer_connection $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid) $$,
  '3. the owner reads back their own connection'
);

-- 8. A private trainer cannot be added to anyone's roster. The WITH CHECK calls
--    trainer_is_reachable(), which excludes 'private'.
select throws_ok(
  $$ insert into trainer_connection (trainer_id, connected_trainer_id)
     values ('11111111-1111-1111-1111-111111111111',
             '44444444-4444-4444-4444-444444444444') $$,
  '42501', null,
  '8. a trainer cannot save a PRIVATE trainer'
);

-- 9. An unlisted trainer CAN be saved — that is the whole point of unlisted:
--    you are holding a card that was handed to you.
select lives_ok(
  $$ insert into trainer_connection (trainer_id, connected_trainer_id, source)
     values ('11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333', 'scan') $$,
  '9. a trainer CAN save an UNLISTED trainer'
);

-- ── Authenticated as B ───────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 4. B was saved by A and cannot tell. Rosters are private in both directions —
--    this is also what makes "is it mutual?" uncomputable, deliberately.
select is_empty(
  $$ select connected_trainer_id from trainer_connection
     where trainer_id = '11111111-1111-1111-1111-111111111111' $$,
  '4. a trainer cannot see another trainer''s roster (not even their own inbound)'
);

-- ── Constraint checks (no role switch — isolates the constraint) ─────────────
-- Run as the superuser so RLS cannot fire first and mask the SQLSTATE we are
-- actually asserting on.
reset role;

-- 5. You are not someone you met.
select throws_ok(
  $$ insert into trainer_connection (trainer_id, connected_trainer_id)
     values ('11111111-1111-1111-1111-111111111111',
             '11111111-1111-1111-1111-111111111111') $$,
  '23514', null,
  '5. a trainer cannot connect to themselves'
);

-- 6. One row per pair. Re-scanning is an UPDATE via ON CONFLICT, never a second
--    row — this is what keeps the table a roster instead of an encounter log.
select throws_ok(
  $$ insert into trainer_connection (trainer_id, connected_trainer_id)
     values ('11111111-1111-1111-1111-111111111111',
             '22222222-2222-2222-2222-222222222222') $$,
  '23505', null,
  '6. a duplicate (trainer, connected_trainer) pair is rejected'
);

-- 7. met_context is the geo backdoor if left unguarded. Same CHECK as
--    trainer.home_region.
select throws_ok(
  $$ insert into trainer_connection (trainer_id, connected_trainer_id, met_context)
     values ('11111111-1111-1111-1111-111111111111',
             '55555555-5555-5555-5555-555555555555',
             '44.9778, -93.2650') $$,
  '23514', null,
  '7. coordinates in met_context are rejected'
);

-- ── Blocking ─────────────────────────────────────────────────────────────────
-- Set up a mutual pair between A and E, then have E block A.
insert into trainer_connection (trainer_id, connected_trainer_id) values
  ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555'),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
set local request.jwt.claims =
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

insert into trainer_block (trainer_id, blocked_trainer_id)
values ('55555555-5555-5555-5555-555555555555',
        '11111111-1111-1111-1111-111111111111');

reset role;

-- 10. Block means gone from both rosters, not just yours. Verified as superuser
--     because neither party can see the other's side.
select is_empty(
  $$ select trainer_id from trainer_connection
     where (trainer_id = '11111111-1111-1111-1111-111111111111'
            and connected_trainer_id = '55555555-5555-5555-5555-555555555555')
        or (trainer_id = '55555555-5555-5555-5555-555555555555'
            and connected_trainer_id = '11111111-1111-1111-1111-111111111111') $$,
  '10. a block severs the connection in BOTH directions'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 11. And it stops a new one forming — deleting a row alone could not do this.
select throws_ok(
  $$ insert into trainer_connection (trainer_id, connected_trainer_id)
     values ('11111111-1111-1111-1111-111111111111',
             '55555555-5555-5555-5555-555555555555') $$,
  '42501', null,
  '11. a blocked trainer cannot re-add the trainer who blocked them'
);

-- ── The unlisted door ────────────────────────────────────────────────────────
reset role;
set local role anon;

-- 12. Knowing the handle resolves the card...
select results_eq(
  $$ select handle::text from get_trainer_card('c_unlisted'::citext) $$,
  $$ values ('c_unlisted'::text) $$,
  '12. get_trainer_card resolves an UNLISTED trainer by exact handle'
);

-- 13. ...but the card is still not enumerable. This is the whole distinction:
--     018's view lists, this function resolves.
select is_empty(
  $$ select handle from trainer_public where handle = 'c_unlisted' $$,
  '13. trainer_public still does NOT list the unlisted trainer'
);

select * from finish();

rollback;
