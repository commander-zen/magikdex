-- 034_scrycheck_vectors_rls.sql — tests for the five self-reported ScryCheck vectors
--
-- HOW TO RUN (local): bash supabase/local/run-tests.sh 034
-- HOW TO RUN (hosted): paste into the SQL editor. Transaction-wrapped, rolls back.
--
-- The point of this suite is the RANGE. The column type alone does not defend
-- the chart: smallint happily stores 4000, and a radar handed 4000 draws a spike
-- off the canvas. 0-100 has to be refused at the boundary, from BOTH ends, per
-- column — and it has to still be refused for the owner of the row, because the
-- owner is the only writer there is.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'brewer@test.local', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'other@test.local',  '', now(), now(), now());

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.legends (id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ral, Monsoon Mage');
insert into public.decks (id, legend, legend_id, status) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Ral, Monsoon Mage',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Active');

-- 1. A fresh deck is UNGRADED, and ungraded is null on all five — not zero.
--    Zero is a real ScryCheck reading ("virtually absent"), so a default of 0
--    would make every deck in the box assert something false about itself.
select results_eq(
  $$ select scrycheck_speed, scrycheck_consistency, scrycheck_interaction,
            scrycheck_mana_base, scrycheck_threats
     from public.decks where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  $$ values (null::smallint, null::smallint, null::smallint, null::smallint, null::smallint) $$,
  '1. a deck starts ungraded — all five vectors null, none defaulted to 0'
);

-- 2. The happy path: the owner records what ScryCheck showed them.
select lives_ok(
  $$ update public.decks
        set scrycheck_speed = 72, scrycheck_consistency = 64,
            scrycheck_interaction = 88, scrycheck_mana_base = 55,
            scrycheck_threats = 91
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '2. the owner can self-report all five vectors'
);

select results_eq(
  $$ select scrycheck_speed, scrycheck_threats
     from public.decks where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  $$ values (72::smallint, 91::smallint) $$,
  '3. the values come back exactly as written'
);

-- 4-5. THE BOUNDARIES ARE INCLUSIVE. 0 and 100 are both real readings on
--      ScryCheck's published bands (0-24 "critical gap", 85-100 "exceptional"),
--      so an off-by-one on either end would reject an honest report.
select lives_ok(
  $$ update public.decks set scrycheck_mana_base = 0
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '4. 0 is accepted — the bottom of the scale is a real reading'
);
select lives_ok(
  $$ update public.decks set scrycheck_mana_base = 100
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '5. 100 is accepted — the ceiling is a real reading'
);

-- 6-7. Out of range is refused at BOTH ends, for the row's own owner.
select throws_ok(
  $$ update public.decks set scrycheck_speed = -1
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '23514',
  null,
  '6. a negative vector is rejected'
);
select throws_ok(
  $$ update public.decks set scrycheck_speed = 101
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '23514',
  null,
  '7. a vector above 100 is rejected'
);

-- 8. THE SCALE MISTAKE THIS SUITE EXISTS TO CATCH. If anyone ever "corrects" the
--    range to 0-10 — reading ScryCheck's OVERALL power level (1-10, e.g. 9.7) as
--    though it were the vector scale — this assertion fails immediately. 47 is a
--    perfectly ordinary vector reading and must be storable.
select lives_ok(
  $$ update public.decks set scrycheck_consistency = 47
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '8. 47 is storable — the vectors are 0-100, not ScryCheck''s 1-10 overall rating'
);

-- 9. Every one of the five is constrained, not just the first one written. A
--    loop that added the constraint to only one column would still pass 6 and 7.
--
--    ⚠️ NAMES THE FIVE EXPLICITLY rather than counting `like 'decks_scrycheck_%_range'`.
--    The counting version passed until 035 added decks_scrycheck_bracket_range,
--    which matches the same wildcard — so a migration that touched a DIFFERENT
--    column broke this assertion while the thing it tests was still perfectly
--    fine. Same trap 033 wrote up: pin the expected list, never a count.
select set_eq(
  $$ select conname::text from pg_constraint
      where conrelid = 'public.decks'::regclass
        and conname in ('decks_scrycheck_speed_range', 'decks_scrycheck_consistency_range',
                        'decks_scrycheck_interaction_range', 'decks_scrycheck_mana_base_range',
                        'decks_scrycheck_threats_range') $$,
  $$ values ('decks_scrycheck_speed_range'), ('decks_scrycheck_consistency_range'),
            ('decks_scrycheck_interaction_range'), ('decks_scrycheck_mana_base_range'),
            ('decks_scrycheck_threats_range') $$,
  '9. all five vectors carry their own named range constraint'
);

-- 10. Named per column, so a violation tells the user WHICH field they
--     fat-fingered rather than reporting the whole tuple.
select throws_ok(
  $$ update public.decks set scrycheck_threats = 250
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '23514',
  null,
  '10. the threats column is constrained under its own name'
);

-- 11. RLS is untouched and still governs the new columns — they inherit
--     decks_own (001) rather than needing a policy of their own.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is_empty(
  $$ select scrycheck_speed from public.decks
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  '11. another user cannot read your self-reported vectors'
);

-- 12. THE SEPARATION FROM WREC, pinned. ScryCheck measures power level;
--     WREC measures functional coverage. They are orthogonal and they live in
--     different places. If a future migration ever folds a wrec column onto
--     public.decks — or a scrycheck column onto the tag tables — this fails.
select is_empty(
  $$ select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'decks'
        and column_name like '%wrec%' $$,
  '12. no WREC column has leaked onto the deck record'
);

-- 13. And nothing was added to the trainer schema, which owns the printed card
--     and the OVERALL rating (031) — a different number on a different surface.
--     Matched by NAME, not by prefix: trainer.deck legitimately has
--     `scrycheck_url` (031), so `like 'scrycheck%'` would fail for the one
--     column that is supposed to be there.
select is_empty(
  $$ select column_name from information_schema.columns
      where table_schema = 'trainer' and table_name = 'deck'
        and column_name in ('scrycheck_speed', 'scrycheck_consistency',
                            'scrycheck_interaction', 'scrycheck_mana_base',
                            'scrycheck_threats') $$,
  '13. the trainer schema gained no vector columns'
);

select * from finish();
rollback;
