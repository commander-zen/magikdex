-- 035_scrycheck_link_rls.sql — tests for the magikdex ↔ ScryCheck link
--
-- HOW TO RUN (local): bash supabase/local/run-tests.sh 035
-- HOW TO RUN (hosted): paste into the SQL editor. Transaction-wrapped, rolls back.
--
-- The load-bearing assertion here is the URL host check. `scrycheck_url` is
-- rendered as a CREDITED LINK to a named third party — a row that says
-- "ScryCheck" and points elsewhere is a lie the UI tells on ScryCheck's behalf,
-- and it is exactly the kind of thing that costs a private-beta relationship.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'grader@test.local', '', now(), now(), now());

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.legends (id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ral, Monsoon Mage');
insert into public.decks (id, legend, legend_id, status) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Ral, Monsoon Mage',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Active');

-- 1. The source URL columns exist and accept a real import. These are the 001
--    columns nothing ever wrote; 035 is where they start carrying weight.
select lives_ok(
  $$ update public.decks
        set url = 'https://moxfield.com/decks/SqpWSu4uLEKJdtCga5dcLg',
            platform = 'moxfield'
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '1. a deck can record the Moxfield URL it was imported from'
);

-- 2. platform is still bounded by 001's check — and that set happens to be
--    exactly what ScryCheck accepts, which is why nothing needed changing.
select throws_ok(
  $$ update public.decks set platform = 'tappedout'
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '23514',
  null,
  '2. platform is still restricted to moxfield/archidekt'
);

-- 3. The happy path: a full analysis result lands in one write.
select lives_ok(
  $$ update public.decks
        set scrycheck_url       = 'https://scrycheck.com/deck/6d451f3d168b6b20',
            scrycheck_score     = '9.7',
            scrycheck_bracket   = 5,
            scrycheck_version   = 'v2.1',
            scrycheck_scored_at = now(),
            scrycheck_speed = 96, scrycheck_consistency = 96,
            scrycheck_interaction = 88, scrycheck_mana_base = 87,
            scrycheck_threats = 94
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '3. a complete ScryCheck analysis stores in one update'
);

-- 4. THE CREDITED LINK MUST POINT AT SCRYCHECK. This is the assertion that
--    protects somebody else's name.
select throws_ok(
  $$ update public.decks set scrycheck_url = 'https://example.com/deck/abc'
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '23514',
  null,
  '4. a scrycheck_url pointing somewhere else is rejected'
);

-- 5. And it must be https. A credited link that downgrades to http is a
--    different failure with the same blast radius.
select throws_ok(
  $$ update public.decks set scrycheck_url = 'http://scrycheck.com/deck/abc'
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '23514',
  null,
  '5. a non-https scrycheck_url is rejected'
);

-- 6. A lookalike host must not pass. `scrycheck.com.evil.test` contains the
--    string but is not the site — anchoring the regex is what catches it.
select throws_ok(
  $$ update public.decks set scrycheck_url = 'https://scrycheck.com.evil.test/deck/abc'
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '23514',
  null,
  '6. a lookalike host (scrycheck.com.evil.test) is rejected'
);

-- 7. www is accepted — same site.
select lives_ok(
  $$ update public.decks set scrycheck_url = 'https://www.scrycheck.com/deck/abc'
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '7. the www host is accepted'
);

-- 8-9. Brackets are 1-5, inclusive at both ends.
select lives_ok(
  $$ update public.decks set scrycheck_bracket = 1
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '8. bracket 1 (Casual) is accepted'
);
select throws_ok(
  $$ update public.decks set scrycheck_bracket = 6
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '23514',
  null,
  '9. bracket 6 is rejected — the scale stops at 5'
);

-- 10. Null everywhere is legal: an ungraded deck is the normal state, and the
--     link is absent rather than empty.
select lives_ok(
  $$ update public.decks
        set scrycheck_url = null, scrycheck_bracket = null,
            scrycheck_version = null, scrycheck_scored_at = null
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '10. an ungraded deck may hold nulls across the whole analysis block'
);

-- 11. THE OVERALL RATING STAYS TEXT. 030's reasoning, restated as a guard: it
--     mirrors ScryCheck's rubric, and a rubric that restyles itself ("9.7" →
--     "A-") must not require a migration.
select is(
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'decks' and column_name = 'scrycheck_score'),
  'text',
  '11. scrycheck_score is still text, not a number'
);

-- 12. And the vectors are untouched by all of this — 035 adds the link and the
--     overall rating, it does not redefine what 034 established.
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.decks'::regclass
      and conname like 'decks_scrycheck!_%!_range' escape '!'),
  6,
  '12. five vector ranges plus the bracket range are all in force'
);

select * from finish();
rollback;
