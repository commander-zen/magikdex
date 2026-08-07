-- 026_trainer_connection_rls.sql — tests for the buddy list (026 + 029)
--
-- Names updated by 029, which renamed connection->buddy and roster->buddy. The
-- FILE keeps its number because tests assert the CURRENT schema, not the schema
-- as of one migration; 026 itself is left alone as history.
--
-- HOW TO RUN (local): supabase/local/00_supabase_shim.sql for the harness, then
--   001 → 024 → 025 → 026 → this file.
--
-- HOW TO RUN (hosted): paste into the Supabase SQL editor as one batch. Opens a
-- transaction, seeds, asserts, ROLLS BACK. Nothing persists.
--
-- Supersedes tests/022. Every assertion goes through the handle-keyed API rather
-- than touching tables, because that is the only path a client has.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
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

insert into trainer.profile (id, handle, display_name, visibility, identity_mode, playstyle) values
  ('11111111-1111-1111-1111-111111111111', 'a_public',   'Trainer A', 'public',   'playstyle', array['tokens']),
  ('22222222-2222-2222-2222-222222222222', 'b_public',   'Trainer B', 'public',   'playstyle', array['combo']),
  ('33333333-3333-3333-3333-333333333333', 'c_unlisted', 'Trainer C', 'unlisted', 'legends',   array['stax']),
  ('44444444-4444-4444-4444-444444444444', 'd_private',  'Trainer D', 'private',  'playstyle', array['chaos']),
  ('55555555-5555-5555-5555-555555555555', 'e_public',   'Trainer E', 'public',   'playstyle', array['aggro']);

-- ── Anonymous ────────────────────────────────────────────────────────────────
set local role anon;

-- 1-2. THE SCHEMA BOUNDARY. anon has no USAGE on trainer, so the social graph is
--      refused before RLS is even consulted.
select throws_ok(
  $$ select trainer_id from trainer.buddy $$,
  '42501', null,
  '1. anon cannot reach trainer.buddy at all'
);

select throws_ok(
  $$ select trainer_id from trainer.block $$,
  '42501', null,
  '2. anon cannot reach trainer.block at all'
);

-- 3. And cannot write one either — every mutation requires a session.
select throws_ok(
  $$ select public.add_buddy('b_public') $$,
  '42501', null,
  '3. anon cannot call add_buddy'
);

-- ── Authenticated as A ───────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 4-5. The happy path: scan a public card, it lands, you read it back.
select lives_ok(
  $$ select public.add_buddy('b_public', 'Gnome Games commander night') $$,
  '4. a trainer can save a public trainer they met'
);

select results_eq(
  $$ select handle::text, met_count, reachable from public.my_buddies() $$,
  $$ values ('b_public'::text, 1, true) $$,
  '5. the owner reads back their own buddy'
);

-- 6. An UNLISTED trainer CAN be saved — that is what unlisted means.
select lives_ok(
  $$ select public.add_buddy('c_unlisted') $$,
  '6. a trainer CAN save an UNLISTED trainer'
);

-- 7. A PRIVATE trainer cannot. Note the error is the same as for a nonexistent
--    handle, so this is not an oracle for "exists but private".
select throws_ok(
  $$ select public.add_buddy('d_private') $$,
  'P0002', null,
  '7. a trainer cannot save a PRIVATE trainer'
);

select throws_ok(
  $$ select public.add_buddy('no_such_handle') $$,
  'P0002', null,
  '8. a nonexistent handle fails identically to a private one'
);

-- 9. You are not someone you met.
select throws_ok(
  $$ select public.add_buddy('a_public') $$,
  '23514', null,
  '9. a trainer cannot add themselves'
);

-- 10-11. RE-SCANNING UPDATES, IT NEVER APPENDS. This is the whole privacy
--        design: the buddy list stays a list of people instead of a movement log.
select lives_ok(
  $$ select public.add_buddy('b_public') $$,
  '10. re-saving the same trainer succeeds'
);

select results_eq(
  $$ select count(*)::int from public.my_buddies() where handle = 'b_public' $$,
  $$ values (1) $$,
  '11. re-saving produced ONE row, not two (no encounter log)'
);

-- 12. And the counter moved — server-side, which is what makes it trustworthy.
select results_eq(
  $$ select met_count from public.my_buddies() where handle = 'b_public' $$,
  $$ values (2) $$,
  '12. met_count incremented to 2 on the re-save'
);

-- 13. A re-scan with no context must not erase the context you typed first time.
select results_eq(
  $$ select met_context from public.my_buddies() where handle = 'b_public' $$,
  $$ values ('Gnome Games commander night'::text) $$,
  '13. re-saving without context preserves the original met_context'
);

-- 14. met_context is the geo backdoor if left unguarded. Same CHECK as
--     profile.home_region.
select throws_ok(
  $$ select public.add_buddy('e_public', '44.9778, -93.2650') $$,
  '23514', null,
  '14. coordinates in met_context are rejected'
);

-- 15. Notes are yours and do not count as a meeting.
select lives_ok(
  $$ select public.set_buddy_note('b_public', 'played Voja, wants a rematch') $$,
  '15. the owner can annotate a buddy'
);

select results_eq(
  $$ select note, met_count from public.my_buddies() where handle = 'b_public' $$,
  $$ values ('played Voja, wants a rematch'::text, 2) $$,
  '16. writing a note did NOT bump met_count'
);

-- ── Authenticated as B ───────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 17. B was saved by A and cannot tell. Rosters are private in BOTH directions,
--     which is also what makes "is it mutual?" uncomputable — deliberately.
select is_empty(
  $$ select handle from public.my_buddies() $$,
  '17. a trainer cannot see inbound connections (no mutuality tell)'
);

-- ── Blocking ─────────────────────────────────────────────────────────────────
-- A saves E, then E blocks A.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.add_buddy('e_public');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
set local request.jwt.claims =
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select public.add_buddy('a_public');
select public.block_trainer('a_public');

-- 18. Block means gone from BOTH rosters, not just yours. Verified as superuser
--     because neither party can see the other's side.
reset role;
select is_empty(
  $$ select trainer_id from trainer.buddy
     where (trainer_id = '11111111-1111-1111-1111-111111111111'
            and connected_trainer_id = '55555555-5555-5555-5555-555555555555')
        or (trainer_id = '55555555-5555-5555-5555-555555555555'
            and connected_trainer_id = '11111111-1111-1111-1111-111111111111') $$,
  '18. a block severs the buddy edge in BOTH directions'
);

-- 19. And it stops a new one forming — which deleting a row alone could not do.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ select public.add_buddy('e_public') $$,
  '42501', null,
  '19. a blocked trainer cannot re-add the trainer who blocked them'
);

-- 20. Forgetting works, and is the owner's own call.
select lives_ok(
  $$ select public.remove_buddy('c_unlisted') $$,
  '20. the owner can forget a connection'
);

select is_empty(
  $$ select handle from public.my_buddies() where handle = 'c_unlisted' $$,
  '21. the forgotten connection is gone'
);

-- ── buddy_count ─────────────────────────────────────────────────────────────
reset role;
set local role anon;

-- 22. A's roster is {b_public} — c_unlisted was forgotten and e_public severed.
select is(
  public.buddy_count('a_public'),
  1,
  '22. buddy_count is public, callable by anon, and correct'
);

-- 23. ⚠️ 0, NOT NULL, FOR AN UNREACHABLE TRAINER — asserted so nobody "fixes" it
--     later. 0 makes a private trainer indistinguishable from a public trainer
--     with an empty roster; a null would itself announce "this one is private".
select is(
  public.buddy_count('d_private'),
  0,
  '23. buddy_count returns 0 (not null) for a PRIVATE trainer'
);

-- 24. The return type IS the privacy enforcement: a scalar int cannot carry
--     met_context, note or a timestamp no matter how the body is later edited.
select is(
  pg_get_function_result('public.buddy_count(extensions.citext)'::regprocedure),
  'integer',
  '24. buddy_count''s signature is exactly `returns int` — nothing wider'
);

select * from finish();

rollback;
