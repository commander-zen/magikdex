-- 027_handle_lifecycle_rls.sql — tests for 027_handle_lifecycle.sql
--
-- HOW TO RUN (local): bash supabase/local/run-tests.sh 027
-- HOW TO RUN (hosted): paste into the SQL editor. Transaction-wrapped, rolls back.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
--   1111… RENAMER  → @first_name  — does the renaming
--   2222… SQUATTER → @squatter    — tries to grab a released handle
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'renamer@test.local',  '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'squatter@test.local', '', now(), now(), now());

insert into trainer.profile (id, handle, display_name, visibility) values
  ('11111111-1111-1111-1111-111111111111', 'first_name', 'The Renamer', 'public'),
  ('22222222-2222-2222-2222-222222222222', 'squatter',   'The Squatter', 'public');

-- 1. A fresh profile is NOT inside a cooldown. handle_changed_at defaults to
--    NULL rather than now(), so somebody who typo'd their handle at signup can
--    fix it immediately instead of waiting a month.
select is(
  (select handle_changed_at from trainer.profile
   where id = '11111111-1111-1111-1111-111111111111'),
  null,
  '1. a new profile has a NULL handle_changed_at (not in cooldown)'
);

-- 2. The first rename is allowed.
select lives_ok(
  $$ update trainer.profile set handle = 'second_name'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '2. the first handle change succeeds'
);

-- 3. And stamps the clock.
select isnt(
  (select handle_changed_at from trainer.profile
   where id = '11111111-1111-1111-1111-111111111111'),
  null,
  '3. the rename stamped handle_changed_at'
);

-- 4-5. THE HALF THAT WAS MISSING. Before 027 the old handle was simply free, and
--      handle_reservation's `released` / `released_from` columns had no writer
--      anywhere in the schema.
select results_eq(
  $$ select reason, released_from from trainer.handle_reservation
     where handle = 'first_name' $$,
  $$ values ('released'::text, '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '4. the old handle was released, recording its prior owner'
);

select throws_ok(
  $$ update trainer.profile set handle = 'first_name'
     where id = '22222222-2222-2222-2222-222222222222' $$,
  '23514', null,
  '5. a stranger cannot claim the released handle'
);

-- 6. Nor at signup — the check fires on INSERT too, not only UPDATE.
select throws_ok(
  $$ insert into trainer.profile (id, handle, display_name)
     values ('33333333-3333-3333-3333-333333333333', 'first_name', 'Impostor') $$,
  '23514', null,
  '6. a released handle cannot be claimed by a NEW signup either'
);

-- 7. THE RATE LIMIT. Second rename inside 30 days is refused.
select throws_ok(
  $$ update trainer.profile set handle = 'third_name'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '23514', null,
  '7. a second handle change within 30 days is rejected'
);

-- 8. Non-handle edits are untouched by any of this. Worth asserting: a trigger
--    on `update of handle` that accidentally fired on every UPDATE would make
--    the whole profile read-only for a month.
select lives_ok(
  $$ update trainer.profile set bio = 'still me'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '8. editing a non-handle column is not rate limited'
);

-- 9. A no-op handle write is not a rename. Assigning the same value must not
--    consume the 30-day budget or release anything.
select lives_ok(
  $$ update trainer.profile set handle = 'second_name'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '9. setting the handle to its current value is not a rename'
);

-- 10. Reclaiming YOUR OWN released handle is allowed — otherwise renaming is a
--     one-way door and you get locked out of your own name by the mechanism
--     meant to protect it. Backdated past the cooldown so this tests the
--     reservation exception, not the rate limit.
update trainer.profile
   set handle_changed_at = now() - interval '31 days'
 where id = '11111111-1111-1111-1111-111111111111';

select lives_ok(
  $$ update trainer.profile set handle = 'first_name'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '10. the original owner CAN reclaim their own released handle'
);

-- 11. And a rename after the window has passed works in general.
select results_eq(
  $$ select handle::text from trainer.profile
     where id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('first_name'::text) $$,
  '11. a rename after 30 days succeeds'
);

-- 12. System reservations are still absolute — they have no released_from, so the
--     owner exception cannot match them however the caller is authenticated.
select throws_ok(
  $$ update trainer.profile set handle = 'admin'
     where id = '22222222-2222-2222-2222-222222222222' $$,
  '23514', null,
  '12. a system-reserved handle is still unclaimable'
);

select * from finish();

rollback;
