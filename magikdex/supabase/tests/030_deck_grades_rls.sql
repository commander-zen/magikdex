-- 030_deck_grades_rls.sql — tests for self-reported deck grades
--
-- HOW TO RUN (local): bash supabase/local/run-tests.sh 030
-- HOW TO RUN (hosted): paste into the SQL editor. Transaction-wrapped, rolls back.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'grader@test.local', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'other@test.local', '', now(), now(), now());

insert into trainer.profile (id, handle, display_name, visibility) values
  ('11111111-1111-1111-1111-111111111111', 'grader', 'Grader', 'public'),
  ('22222222-2222-2222-2222-222222222222', 'otherguy', 'Other', 'public');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1. The happy path.
select lives_ok(
  $$ select public.add_deck_grade('Sisay Ramp', '7.2') $$,
  '1. a trainer can record a deck grade'
);

-- 2-3. THE SECURITY PROPERTY. issuer and method are set inside the function, not
--      passed in, so a client cannot mint a verified badge or invent a voucher.
select results_eq(
  $$ select kind::text, issuer, method::text
     from trainer.credential
     where trainer_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('scrycheck_rank'::text, 'ScryCheck'::text, 'self_reported'::text) $$,
  '2. it is stored as a self-reported ScryCheck rating, not a verified one'
);

select results_eq(
  $$ select payload->>'deck', payload->>'rating'
     from trainer.credential
     where trainer_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('Sisay Ramp'::text, '7.2'::text) $$,
  '3. the deck name and rating round-trip'
);

-- 4. The rating is TEXT, so a non-numeric scale works. ScryCheck owns its rubric;
--    modelling it as a number here would break the day they change it.
select lives_ok(
  $$ select public.add_deck_grade('Meren Reanimator', 'B+') $$,
  '4. a non-numeric rating is accepted (their scale, not ours)'
);

-- 5-6. Validation.
select throws_ok(
  $$ select public.add_deck_grade('   ', '7.2') $$,
  '23514', null,
  '5. a blank deck name is rejected'
);
select throws_ok(
  $$ select public.add_deck_grade('Krenko', repeat('x', 13)) $$,
  '23514', null,
  '6. an over-long rating is rejected'
);

-- 7. FOUR IS THE BADGE CASE. Two exist; add two more, then the fifth fails.
select lives_ok(
  $$ select public.add_deck_grade('Krenko Goblins', '5');
     select public.add_deck_grade('Voja Tokens', '6') $$,
  '7. four grades fit'
);

select throws_ok(
  $$ select public.add_deck_grade('One Too Many', '4') $$,
  '23514', null,
  '8. a fifth grade is rejected'
);

-- 9. Removal is a REVOCATION, not a delete — the row survives as an audit record
--    and simply stops being current.
select lives_ok(
  $$ select public.revoke_deck_grade(
       (select id from trainer.credential
        where trainer_id = '11111111-1111-1111-1111-111111111111'
          and payload->>'deck' = 'Krenko Goblins')) $$,
  '9. the owner can revoke their own grade'
);

select results_eq(
  $$ select count(*)::int from trainer.credential
     where trainer_id = '11111111-1111-1111-1111-111111111111'
       and revoked_at is null $$,
  $$ values (3) $$,
  '10. the revoked grade no longer counts, and the row still exists'
);

-- 11. You cannot revoke somebody else's. Scoped by trainer_id inside the
--     function, so this is a silent no-op rather than an error — asserted as a
--     count so a future change that widens the scope fails here.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- The attempt runs on its own: results_eq opens a CURSOR, and a cursor cannot
-- take a multi-statement query. The id is resolved BEFORE the role switch,
-- because credential_select_own hides other people's rows — the stranger cannot
-- even see the id they are trying to revoke, which is itself the first line of
-- defence.
select public.revoke_deck_grade(
  (select id from trainer.credential where payload->>'deck' = 'Sisay Ramp'));

-- Verified as superuser. Asserting this while still ROLE authenticated measured
-- the wrong thing: RLS hides the row from the stranger, so a count of 0 would
-- have meant "invisible", not "revoked", and the test would have passed for a
-- reason that has nothing to do with the function.
reset role;
select results_eq(
  $$ select count(*)::int from trainer.credential
     where payload->>'deck' = 'Sisay Ramp' and revoked_at is null $$,
  $$ values (1) $$,
  '11. a stranger cannot revoke someone else''s grade'
);

select * from finish();

rollback;
