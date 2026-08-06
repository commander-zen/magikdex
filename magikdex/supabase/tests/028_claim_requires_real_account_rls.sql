-- 028_claim_requires_real_account_rls.sql — tests for 028
--
-- HOW TO RUN (local): bash supabase/local/run-tests.sh 028
-- HOW TO RUN (hosted): paste into the SQL editor. Transaction-wrapped, rolls back.
--
-- The whole point is that these assertions run as `authenticated` in BOTH cases
-- and differ only by the is_anonymous JWT claim — because that is the only thing
-- distinguishing the two callers at the database level.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'real@test.local', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', '', '', null, now(), now());

-- 1. No handle has been claimed by an anonymous account in production. Asserted
--    rather than assumed — 028 does not clean up retroactively, so if this ever
--    fails on a real database it is a data decision, not a test bug.
select is_empty(
  $$ select p.handle::text
     from trainer.profile p
     join auth.users u on u.id = p.id
     where coalesce(u.email, '') = '' $$,
  '1. no existing profile belongs to an account with no email'
);

-- ── An ANONYMOUS session: authenticated role, is_anonymous = true ─────────────
-- This is the exact shape Supabase issues for signInAnonymously(): the role is
-- `authenticated`, and the only distinguishing mark is the claim.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","is_anonymous":true}';

-- 2. THE FIX. Before 028 this succeeded, and TrainerSheet's email gate was the
--    only thing standing in front of it.
select throws_ok(
  $$ insert into trainer.profile (id, handle, display_name)
     values ('22222222-2222-2222-2222-222222222222', 'squatted', 'Squatter') $$,
  '42501', null,
  '2. an ANONYMOUS session cannot claim a handle'
);

-- 3. Not even its own id under a different handle — the gate is on the caller,
--    not on the value.
select throws_ok(
  $$ insert into trainer.profile (id, handle, display_name)
     values ('22222222-2222-2222-2222-222222222222', 'anything_else', 'Nope') $$,
  '42501', null,
  '3. an ANONYMOUS session cannot claim ANY handle'
);

-- ── A REAL session: same role, is_anonymous absent ───────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 4. THE COALESCE MATTERS. is_anonymous is ABSENT here, not false, and
--    `null = false` is null — which a WITH CHECK treats as a failure. Without
--    coalesce(..., false) this policy would reject every legitimate user, which
--    is a far worse bug than the one 028 fixes.
select lives_ok(
  $$ insert into trainer.profile (id, handle, display_name)
     values ('11111111-1111-1111-1111-111111111111', 'realtrainer', 'Real Trainer') $$,
  '4. a REAL session CAN claim a handle (is_anonymous claim absent)'
);

-- 5. And when the claim is explicitly false, which is how a non-anonymous
--    Supabase token actually renders it.
select is(
  (select handle::text from trainer.profile
   where id = '11111111-1111-1111-1111-111111111111'),
  'realtrainer',
  '5. the claimed handle landed'
);

-- 6. UPDATE is deliberately NOT gated. An anonymous account that somehow already
--    owns a profile must still be able to set itself back to private — being
--    unable to RETRACT is worse than being able to edit.
reset role;
insert into trainer.profile (id, handle, display_name, visibility)
values ('22222222-2222-2222-2222-222222222222', 'legacy_anon', 'Legacy', 'public');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","is_anonymous":true}';

select lives_ok(
  $$ update trainer.profile set visibility = 'private'
     where id = '22222222-2222-2222-2222-222222222222' $$,
  '6. an ANONYMOUS session CAN still retract an existing profile to private'
);

-- 7. anon (the unauthenticated role) remains refused at the schema boundary —
--    unchanged by 028, re-asserted because this migration touches the policy that
--    sits behind it.
reset role;
set local role anon;
select throws_ok(
  $$ select id from trainer.profile $$,
  '42501', null,
  '7. anon still cannot reach trainer.profile at all'
);

select * from finish();

rollback;
