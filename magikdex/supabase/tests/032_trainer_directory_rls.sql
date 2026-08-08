-- 032_trainer_directory_rls.sql — tests for usually_found_at, met dates and
-- ready_to_pod (032)
--
-- ⚠️ THIS SUITE HAS NEVER BEEN RUN. It was written alongside 032 on a machine
-- with no psql, no Docker and no Supabase CLI. Treat a first run as debugging the
-- TESTS as much as the migration — the catalog assertions (5, 6, 16, 28, 29) lean
-- on pgTAP and pg_catalog output formats that are easy to get subtly wrong when
-- you cannot execute them.
--
-- HOW TO RUN (local): supabase/local/00_supabase_shim.sql for the harness, then
--   001 → 024 → 025 → 026 → 027 → 028 → 029 → 030 → 031 → 032 → this file.
--
-- HOW TO RUN (hosted): paste into the Supabase SQL editor as one batch. Opens a
-- transaction, seeds, asserts, ROLLS BACK. Nothing persists.
--
-- Every behavioural assertion goes through the handle-keyed API rather than
-- touching tables, because that is the only path a client has. The exceptions are
-- the catalog assertions, which are checking the shape of the API itself.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
--   1111… A → @a_public    (public)   — the one doing the saving
--   2222… B → @b_public    (public)   — saved, dates backfilled against
--   3333… C → @c_unlisted  (unlisted) — met online, goes private partway through
--   4444… D → @d_private   (private)  — must never resolve
--   5555… E → @e_public    (public)   — ready to pod, with a note

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  (repeat(i::text, 8) || '-' || repeat(i::text, 4) || '-' || repeat(i::text, 4)
    || '-' || repeat(i::text, 4) || '-' || repeat(i::text, 12))::uuid,
  'authenticated', 'authenticated', 'trainer' || i || '@test.local',
  '', now(), now(), now()
from generate_series(1, 5) as i;

-- E is the only one seeded ready. Note that A, B, C and D set NOTHING for
-- ready_to_pod — assertion 13 depends on that.
insert into trainer.profile
  (id, handle, display_name, visibility, identity_mode, playstyle,
   usually_found_at, ready_to_pod, ready_note)
values
  ('11111111-1111-1111-1111-111111111111', 'a_public',   'Trainer A', 'public',   'playstyle', array['tokens'], null, false, null),
  ('22222222-2222-2222-2222-222222222222', 'b_public',   'Trainer B', 'public',   'playstyle', array['combo'],  null, false, null),
  ('33333333-3333-3333-3333-333333333333', 'c_unlisted', 'Trainer C', 'unlisted', 'legends',   array['stax'],
     'SpellTable / Discord: gnome-games', false, null),
  ('44444444-4444-4444-4444-444444444444', 'd_private',  'Trainer D', 'private',  'playstyle', array['chaos'],  null, false, null),
  ('55555555-5555-5555-5555-555555555555', 'e_public',   'Trainer E', 'public',   'playstyle', array['aggro'],
     'Games Corner FLGS, Thursdays', true, 'looking for: cEDH');

-- ── The schema boundary is unchanged ─────────────────────────────────────────
-- 032 adds no view, no grant and no enumerable relation. These two assertions
-- exist so that stays true: they fail the moment someone "adds a directory".
select ok(
  not has_schema_privilege('anon', 'trainer', 'usage'),
  '1. anon still has NO usage on the trainer schema'
);

set local role anon;

select throws_ok(
  $$ select trainer_id from trainer.buddy $$,
  '42501', null,
  '2. anon still cannot reach trainer.buddy at all'
);

reset role;

-- ── Column shape ─────────────────────────────────────────────────────────────
-- met_context was RENAMED, not duplicated. Two columns meaning the same thing is
-- the failure mode this asserts against.
select has_column('trainer', 'buddy', 'met_venue',
  '3. buddy.met_venue exists');

select hasnt_column('trainer', 'buddy', 'met_context',
  '4. buddy.met_context is GONE — renamed, not duplicated');

-- ⚠️ The destructive half of this migration. If these two ever read timestamptz
-- again, somebody reintroduced time-of-day and the "never recorded" promise in
-- 026 quietly became "recorded but not displayed".
select col_type_is('trainer', 'buddy', 'first_met_at', 'date',
  '5. first_met_at is DATE — no time of day is stored');

select col_type_is('trainer', 'buddy', 'last_met_at', 'date',
  '6. last_met_at is DATE — no time of day is stored');

select has_column('trainer', 'buddy', 'met_mode',
  '7. buddy.met_mode exists');

select has_column('trainer', 'profile', 'usually_found_at',
  '8. profile.usually_found_at exists');

select has_column('trainer', 'profile', 'ready_to_pod',
  '9. profile.ready_to_pod exists');

select has_column('trainer', 'profile', 'ready_note',
  '10. profile.ready_note exists');

-- ── The geo backdoor stays shut ──────────────────────────────────────────────
-- Both new free-text location fields carry home_region's CHECK. Without these a
-- client could start writing lat/long into a table that also holds a person, and
-- that is how the dangerous version of this product gets built by accident.
select throws_ok(
  $$ update trainer.profile set usually_found_at = '44.9778, -93.2650'
     where handle = 'a_public' $$,
  '23514', null,
  '11. coordinates in usually_found_at are rejected'
);

select throws_ok(
  $$ update trainer.profile set ready_note = 'here: 44.9778, -93.2650'
     where handle = 'a_public' $$,
  '23514', null,
  '12. coordinates in ready_note are rejected'
);

-- 13. Nobody is ready by default. An opt-out default would have made every
--     existing profile announce availability the moment 032 applied.
select is(
  (select bool_or(ready_to_pod) from trainer.profile where handle <> 'e_public'),
  false,
  '13. ready_to_pod defaults to FALSE — nobody is opted in by the migration'
);

-- ── The public card ──────────────────────────────────────────────────────────
set local role anon;

select results_eq(
  $$ select usually_found_at, ready_to_pod, ready_note
     from public.get_trainer_card('e_public') $$,
  $$ values ('Games Corner FLGS, Thursdays'::text, true, 'looking for: cEDH'::text) $$,
  '14. get_trainer_card publishes usually_found_at, ready_to_pod and ready_note'
);

-- 15. Visibility is still evaluated at READ time and still wins over everything
--     added here. A private trainer publishes nothing, availability included.
select is_empty(
  $$ select handle from public.get_trainer_card('d_private') $$,
  '15. a PRIVATE trainer still resolves to nothing'
);

-- 16. No uuid was published. Adding three columns is exactly when this slips.
select doesnt_match(
  pg_get_function_result('public.get_trainer_card(extensions.citext)'::regprocedure),
  'uuid',
  '16. get_trainer_card still returns NO uuid'
);

-- ── Dates and mode, through the API ──────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.add_buddy('b_public', 'Gnome Games commander night', 'manual', '2026-03-14', 'in_person');

select results_eq(
  $$ select first_met_at, last_met_at, met_mode
     from public.my_buddies() where handle = 'b_public' $$,
  $$ values ('2026-03-14'::date, '2026-03-14'::date, 'in_person'::text) $$,
  '17. an explicit met date is stored as given, on both ends'
);

select public.add_buddy('c_unlisted', 'SpellTable', 'manual', '2026-02-01', 'online');

select results_eq(
  $$ select met_mode, met_venue from public.my_buddies() where handle = 'c_unlisted' $$,
  $$ values ('online'::text, 'SpellTable'::text) $$,
  '18. an ONLINE meeting is recorded as online — mode is orthogonal to source'
);

-- Backfill: A remembers an earlier game with B and records it after the fact.
select public.add_buddy('b_public', null, 'manual', '2026-01-02', 'in_person');

-- 19-20. least()/greatest(), not "first write wins". A backfilled earlier game
--        must be able to move first_met_at BACK, and must not be able to make a
--        stale date look like the most recent game.
select results_eq(
  $$ select first_met_at from public.my_buddies() where handle = 'b_public' $$,
  $$ values ('2026-01-02'::date) $$,
  '19. backfilling an EARLIER meeting moves first_met_at earlier'
);

select results_eq(
  $$ select last_met_at from public.my_buddies() where handle = 'b_public' $$,
  $$ values ('2026-03-14'::date) $$,
  '20. ...and does NOT drag last_met_at backwards'
);

-- 21-22. The load-bearing privacy design from 026, unchanged by any of this:
--        re-saving UPDATES, it never appends. Two meetings, one row, so no
--        movement history exists to be reconstructed.
select results_eq(
  $$ select count(*)::int from public.my_buddies() where handle = 'b_public' $$,
  $$ values (1) $$,
  '21. a second meeting produced ONE row, not two (still no encounter log)'
);

select results_eq(
  $$ select met_count from public.my_buddies() where handle = 'b_public' $$,
  $$ values (2) $$,
  '22. met_count incremented server-side'
);

-- 23. A re-save with no venue must not erase the one typed the first time.
select results_eq(
  $$ select met_venue from public.my_buddies() where handle = 'b_public' $$,
  $$ values ('Gnome Games commander night'::text) $$,
  '23. re-saving without a venue preserves the original met_venue'
);

-- 24. met_venue keeps met_context's no-geo CHECK through the rename.
select throws_ok(
  $$ select public.add_buddy('e_public', '44.9778, -93.2650') $$,
  '23514', null,
  '24. coordinates in met_venue are still rejected'
);

-- ── The scoped directory ─────────────────────────────────────────────────────
select public.add_buddy('e_public', 'Games Corner', 'manual', '2026-04-02', 'in_person');

-- 25. THE POINT OF THE MIGRATION. You can see where a buddy says they are found
--     and whether they are up for a game — because you already met them and
--     saved them yourself. There is still no way to ask this across all trainers.
select results_eq(
  $$ select usually_found_at, ready_to_pod, ready_note
     from public.my_buddies() where handle = 'e_public' $$,
  $$ values ('Games Corner FLGS, Thursdays'::text, true, 'looking for: cEDH'::text) $$,
  '25. my_buddies surfaces a reachable buddy''s found-at and ready status'
);

-- C goes private after the fact. Superuser, because no client can do this to
-- somebody else.
reset role;
update trainer.profile
   set visibility = 'private', ready_to_pod = true
 where handle = 'c_unlisted';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 26. Visibility is evaluated at READ time, never frozen at save time — and that
--     now covers availability. C is ready in the table and invisible through the
--     API. You keep your own record of the game; their card is theirs to withdraw.
--
--     ⚠️ FALSE, NOT NULL. A null would itself announce "this one went private"
--     through a column that is supposed to be about availability — the same
--     reasoning that keeps buddy_count returning 0 instead of null.
select results_eq(
  $$ select ready_to_pod, usually_found_at, reachable
     from public.my_buddies() where handle = 'c_unlisted' $$,
  $$ values (false, null::text, false) $$,
  '26. a buddy who went private reads ready_to_pod = FALSE (not null)'
);

-- 27. Their own record of the meeting survives — that is the difference between
--     "their card is withdrawn" and "the game never happened".
select results_eq(
  $$ select met_venue, first_met_at from public.my_buddies() where handle = 'c_unlisted' $$,
  $$ values ('SpellTable'::text, '2026-02-01'::date) $$,
  '27. ...but the owner keeps their own venue and date for that meeting'
);

-- ── Guards against the two things this file must never become ────────────────
reset role;

-- 28. NO SCORE, NO RANK. 030 removed a trust_level() that scored credentials and
--     left a test so it could not come back. Same guard here: the return type IS
--     the enforcement, and availability data is exactly the kind that grows a
--     "most active player" number if nobody is watching.
select doesnt_match(
  pg_get_function_result('public.my_buddies()'::regprocedure),
  '(?i)(score|rank|level|rating|activity|match)',
  '28. my_buddies returns no score, rank, level or match column'
);

-- 29. The old 3-argument add_buddy is gone rather than left beside the new one.
--     Both existing makes add_buddy(handle, venue, source) AMBIGUOUS — Postgres
--     raises 42725 instead of choosing, and the client's happy path is the call
--     that breaks.
select is_empty(
  $$ select p.oid::regprocedure::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'add_buddy'
       and pg_get_function_identity_arguments(p.oid) = 'citext, text, text' $$,
  '29. the old 3-arg add_buddy was dropped, not left to collide'
);

select * from finish();

rollback;
