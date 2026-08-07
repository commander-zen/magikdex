-- 025_trainer_identity_rls.sql — policy + constraint tests for
-- 025_trainer_identity.sql
--
-- HOW TO RUN (local): supabase/local/00_supabase_shim.sql for the harness, then
--   001_baseline.sql → 024_harden_privileges.sql → 025_trainer_identity.sql →
--   this file.
--
-- HOW TO RUN (hosted): paste into the Supabase SQL editor as one batch. Opens a
-- transaction, seeds fixtures, asserts, ROLLS BACK. Nothing persists.
--
-- Supersedes tests/018 and tests/023. Those asserted against tables in the
-- public schema; these assert against the trainer schema and, crucially, against
-- the three handle-keyed functions that are now the only public read path.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Seeded as the session superuser, which bypasses RLS. Every assertion runs
-- after `set local role`, so nothing is asserted with these privileges.
--
--   1111… PUB   → @publictrainer   (public)   — both identity axes populated
--   2222… PRIV  → @privatetrainer  (private)  — must be invisible everywhere
--   3333… UNL   → @unlistedtrainer (unlisted) — resolvable only by exact handle
--   4444… SPARE → no profile row; used for constraint-rejection attempts

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pub@test.local',  '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'priv@test.local', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'unl@test.local',  '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
   'authenticated', 'authenticated', 'spare@test.local','', now(), now(), now());

-- PUB holds data on BOTH axes deliberately: identity_mode is a render flag, so a
-- row carrying playstyle AND favorite_legends must be legal.
insert into trainer.profile
  (id, handle, display_name, home_region, philosophy, identity_mode,
   playstyle, favorite_legends, visibility)
values
  ('11111111-1111-1111-1111-111111111111', 'publictrainer', 'Public Trainer',
   'Twin Cities', array['casual','jank'], 'playstyle',
   array['tokens','aristocrats','group_hug'],
   array['Prossh, Skyraider of Kher'], 'public'),
  ('22222222-2222-2222-2222-222222222222', 'privatetrainer', 'Private Trainer',
   null, array['cedh'], 'legends', array['stax'],
   array['Kinnan, Bonder Prodigy'], 'private'),
  ('33333333-3333-3333-3333-333333333333', 'unlistedtrainer', 'Unlisted Trainer',
   null, array['trash_magic'], 'legends', array['chaos'],
   array['Najeela, the Blade-Blossom'], 'unlisted');

-- Six decks: five fill PUB's party, the sixth proves the cap rejects it.
insert into public.decks (id, legend, status)
select ('aaaaaaaa-0000-0000-0000-00000000000' || i)::uuid, 'Test Legend ' || i, 'Active'
from generate_series(1, 6) as i;

insert into trainer.party_slot (trainer_id, deck_id, position)
select '11111111-1111-1111-1111-111111111111',
       ('aaaaaaaa-0000-0000-0000-00000000000' || i)::uuid, i
from generate_series(1, 5) as i;

insert into trainer.credential (trainer_id, kind, issuer, method, payload, issued_at)
values
  ('11111111-1111-1111-1111-111111111111', 'lgs_visit', 'Test LGS',
   'self_reported', '{"venue":"Test LGS"}'::jsonb, now()),
  ('22222222-2222-2222-2222-222222222222', 'lgs_visit', 'Secret LGS',
   'self_reported', '{"venue":"Secret LGS"}'::jsonb, now());

-- ── Anonymous: the schema is unreachable, the functions are the only door ────
set local role anon;

-- 1-2. THE SCHEMA BOUNDARY. anon was granted USAGE on nothing, so this is not
--      "no policy matched" — it is refused before RLS is consulted. That is the
--      whole reason the tables live outside public.
select throws_ok(
  $$ select id from trainer.profile $$,
  '42501', null,
  '1. anon cannot reach trainer.profile at all (no schema USAGE)'
);

select throws_ok(
  $$ select id from trainer.credential $$,
  '42501', null,
  '2. anon cannot reach trainer.credential at all'
);

-- 3. The public card resolves by handle.
select results_eq(
  $$ select display_name, home_region from public.get_trainer_card('publictrainer') $$,
  $$ values ('Public Trainer'::text, 'Twin Cities'::text) $$,
  '3. get_trainer_card resolves a PUBLIC trainer by handle'
);

-- 4. UNLISTED resolves too — that is what unlisted MEANS: you are holding a card
--    somebody handed you.
select results_eq(
  $$ select display_name, visibility from public.get_trainer_card('unlistedtrainer') $$,
  $$ values ('Unlisted Trainer'::text, 'unlisted'::text) $$,
  '4. get_trainer_card resolves an UNLISTED trainer by exact handle'
);

-- 5. PRIVATE does not, even with the exact handle.
select is_empty(
  $$ select display_name from public.get_trainer_card('privatetrainer') $$,
  '5. get_trainer_card returns nothing for a PRIVATE trainer'
);

-- 6. NO UUID IS PUBLISHED. The load-bearing privacy property of this migration:
--    a handle can change, a uuid cannot, so a published uuid would be a
--    permanent cross-scrape tracking key. Asserted against the catalog so it
--    fails if anyone adds an id column to any of the three functions.
--    Checks the rendered return signature rather than slicing proallargtypes —
--    same guarantee, and it stays readable when it fails at 2am.
select is_empty(
  $$ select p.proname
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_trainer_card','get_trainer_party','get_trainer_credentials')
       and pg_get_function_result(p.oid) ~ '\buuid\b' $$,
  '6. no public trainer function returns a uuid'
);

-- 7. THERE IS NO DIRECTORY. Enumeration is structurally impossible, not merely
--    unbuilt — no relation exists that anon could walk.
select is_empty(
  $$ select c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and c.relname like '%trainer%' $$,
  '7. no public trainer view exists (nothing is enumerable)'
);

-- 8-9 REMOVED. They asserted get_trainer_party, which 031 replaced with
-- get_trainer_decks when the card's text box moved off magikdex's `decks` table
-- and onto trainer.deck (Moxfield/Archidekt URLs). Equivalent coverage lives in
-- 031's suite, against the table that actually backs the card now — duplicating
-- it here would just be two places to update.

-- 10. Credentials come back INDIVIDUALLY, with their own issuer and date.
select results_eq(
  $$ select kind, issuer, method from public.get_trainer_credentials('publictrainer') $$,
  $$ values ('lgs_visit'::text, 'Test LGS'::text, 'self_reported'::text) $$,
  '10. get_trainer_credentials returns individual credentials'
);

-- 11. And not for a private trainer.
select is_empty(
  $$ select kind from public.get_trainer_credentials('privatetrainer') $$,
  '11. get_trainer_credentials returns nothing for a PRIVATE trainer'
);

-- 12. NO AGGREGATE EXISTS. Credentials are shown individually, always — a graded
--     deck displays its own bracket and date, never a rolled-up trust number.
--     archive/018 shipped exactly such a function (trust_level, venue=4 api=2
--     self=1) and this assertion exists to stop it coming back.
--
--     Matches on BEHAVIOUR, not on names: any function that both touches
--     trainer.credential and contains an aggregate call. The first draft matched
--     proname like '%trust%' and caught pgTAP's own language_is_trusted — a
--     naming convention is a proxy for the invariant, so test the invariant.
--     Reads prosrc (the raw body) rather than pg_get_functiondef, because
--     pg_get_functiondef THROWS on aggregates — and scanning all of public hits
--     pgTAP's own. prokind='f' is filtered too, belt and braces.
--
--     RETURNS VOID IS EXCLUDED, and that exclusion is the precise statement of
--     the rule. 030's add_deck_grade counts credentials to enforce the
--     four-badge cap and legitimately tripped the earlier version of this test.
--     Counting INTERNALLY to make a decision is fine; what must never exist is a
--     function that HANDS BACK a value derived from aggregating credentials.
--     archive/018's trust_level() returned int — it would still be caught.
select is_empty(
  $$ select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','trainer')
       and p.prokind = 'f'
       and p.prorettype <> 'void'::regtype
       and p.prosrc ~* 'trainer\.credential'
       and p.prosrc ~* '\y(sum|count|avg|max|min)\s*\(' $$,
  '12. no function returns a value aggregated from credentials'
);

-- ── Authenticated as a stranger ──────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
set local request.jwt.claims =
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- 13. Signing in buys you your own row and nobody else's.
select is_empty(
  $$ select id from trainer.profile
     where id = '22222222-2222-2222-2222-222222222222' $$,
  '13. authenticated cannot SELECT another user''s profile'
);

-- 14. Own row is readable — the positive case, so 13 is not passing because the
--     table is simply unreadable.
select isnt_empty(
  $$ select id from trainer.profile
     where id = '33333333-3333-3333-3333-333333333333' $$,
  '14. authenticated CAN select their own profile'
);

-- 15. Handle claim works, and only for your own id. This is the INSERT policy.
select throws_ok(
  $$ insert into trainer.profile (id, handle, display_name)
     values ('11111111-1111-1111-1111-111111111111', 'impostor', 'Impostor') $$,
  '42501', null,
  '15. authenticated cannot create a profile for someone else''s id'
);

-- 16-17. Credentials are issuer-written only. No client may forge one or destroy
--        one, including their own — "revocable, never editable" means revocation
--        is a service_role write of revoked_at, not a client UPDATE.
select throws_ok(
  $$ insert into trainer.credential
       (trainer_id, kind, issuer, method, payload, issued_at)
     values ('33333333-3333-3333-3333-333333333333', 'lgs_visit', 'Forged',
             'venue_verified', '{}'::jsonb, now()) $$,
  '42501', null,
  '16. authenticated cannot INSERT a credential'
);

select throws_ok(
  $$ delete from trainer.credential
     where trainer_id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  '17. authenticated cannot DELETE a credential'
);

-- ── Constraints ──────────────────────────────────────────────────────────────
-- As superuser so RLS cannot fire first and mask the SQLSTATE being asserted.
-- SPARE has an auth.users row but no profile, so each attempt is rejected on its
-- own merits rather than on a duplicate key.
reset role;

-- 18. The philosophy vocabulary is closed at the database, so client-side drift
--     cannot land a value the card cannot render.
select throws_ok(
  $$ insert into trainer.profile (id, handle, display_name, philosophy)
     values ('44444444-4444-4444-4444-444444444444', 'philtest', 'Phil',
             array['spike']) $$,
  '23514', null,
  '18. an invalid philosophy value is rejected'
);

-- 19. Three playstyles is the card's budget. All four below are LEGAL members,
--     which isolates the count cap from the membership check.
select throws_ok(
  $$ insert into trainer.profile (id, handle, display_name, playstyle)
     values ('44444444-4444-4444-4444-444444444444', 'captest', 'Cap',
             array['tokens','combo','aggro','voltron']) $$,
  '23514', null,
  '19. a 4th playstyle value is rejected'
);

-- 20. 'landfall' is a real Magic term and still not one of the 30 — precisely
--     the drift the closed vocabulary exists to stop.
select throws_ok(
  $$ insert into trainer.profile (id, handle, display_name, playstyle)
     values ('44444444-4444-4444-4444-444444444444', 'vocabtest', 'Vocab',
             array['tokens','combo','landfall']) $$,
  '23514', null,
  '20. a playstyle value outside the fixed 30-item list is rejected'
);

-- 21. Reserved handles are blocked by trigger, because a CHECK cannot see
--     another table. 'admin' is in the seeded list.
select throws_ok(
  $$ insert into trainer.profile (id, handle, display_name)
     values ('44444444-4444-4444-4444-444444444444', 'admin', 'Impostor') $$,
  '23514', null,
  '21. a handle matching handle_reservation is rejected'
);

select * from finish();

rollback;
