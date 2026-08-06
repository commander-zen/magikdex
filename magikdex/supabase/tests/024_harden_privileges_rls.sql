-- 024_harden_privileges_rls.sql — tests for 024_harden_privileges.sql
--
-- HOW TO RUN (local): see supabase/local/00_supabase_shim.sql for the harness.
--   001_baseline.sql → 024_harden_privileges.sql → this file.
--
-- HOW TO RUN (hosted): paste into the Supabase SQL editor. Opens a transaction,
-- asserts, ROLLS BACK. Nothing persists.
--
-- Every assertion here is a REGRESSION test, not a one-time check. The value is
-- not in confirming the fix landed today — it is in failing loudly the day
-- somebody re-adds a permissive policy or a fresh table re-inherits the default
-- grants.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- One real cached card to attempt overwriting, and one signed-in user to
-- attempt it as. Seeded as superuser, which bypasses RLS.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777',
   'authenticated', 'authenticated', 'attacker@test.local', '', now(), now(), now());

insert into cards (oracle_id, name, name_lower, type_line, legal_commander)
values ('11111111-aaaa-bbbb-cccc-000000000001', 'Sol Ring', 'sol ring',
        'Artifact', false);

-- ── Finding 1: the card cache is no longer client-writable ───────────────────
set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
set local request.jwt.claims =
  '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';

-- 1. THE FINDING ITSELF. Before 024 this succeeded and renamed Sol Ring for
--    every user of the app. 42501 rather than "0 rows" because the privilege is
--    revoked as well as the policy withheld — the stronger of the two answers.
select throws_ok(
  $$ update cards set name = 'Pwned Ring'
     where oracle_id = '11111111-aaaa-bbbb-cccc-000000000001' $$,
  '42501', null,
  '1. authenticated cannot UPDATE a cached card'
);

-- 2. Deleting is refused for the same reason.
select throws_ok(
  $$ delete from cards where oracle_id = '11111111-aaaa-bbbb-cccc-000000000001' $$,
  '42501', null,
  '2. authenticated cannot DELETE a cached card'
);

-- 3. THE FEATURE IS PRESERVED. This is the assertion that makes the fix
--    defensible rather than merely safe: writeBackToCache() only ever fires on a
--    cache MISS, so cold fills must keep working.
select lives_ok(
  $$ insert into cards (oracle_id, name, name_lower, type_line)
     values ('11111111-aaaa-bbbb-cccc-000000000002', 'Arcane Signet',
             'arcane signet', 'Artifact') $$,
  '3. authenticated CAN still insert an uncached card (cache fill preserved)'
);

-- 4. And reads are untouched — the shared knowledge base stays public.
select isnt_empty(
  $$ select oracle_id from cards
     where oracle_id = '11111111-aaaa-bbbb-cccc-000000000001' $$,
  '4. authenticated can still READ the card cache'
);

reset role;
set local role anon;

-- 5. Anonymous read is the whole point of a shared cache; not a regression.
select isnt_empty(
  $$ select oracle_id from cards $$,
  '5. anon can still READ the card cache'
);

-- ── Finding 2: TRUNCATE and TRIGGER are gone ─────────────────────────────────
-- Asserted with has_table_privilege rather than by attempting a TRUNCATE,
-- because a successful TRUNCATE inside this transaction would roll back and
-- prove nothing about the grant — and a failed one would be indistinguishable
-- from a dozen other errors.
reset role;

-- 6-7. THE POINT OF THE WHOLE FILE. RLS does not mediate TRUNCATE, so the only
--      thing that ever stood between anon and an empty table was this privilege.
select ok(
  not bool_or(has_table_privilege('anon', c.oid, 'TRUNCATE')),
  '6. anon has TRUNCATE on no table in public'
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

select ok(
  not bool_or(has_table_privilege('authenticated', c.oid, 'TRIGGER')),
  '7. authenticated has TRIGGER on no table in public'
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

-- ── Finding 3: both RPCs pin search_path ─────────────────────────────────────
-- proconfig holds per-function GUC settings. Checked in the catalog rather than
-- by reading the source, so this fails if someone recreates either function and
-- forgets the setting — which is exactly how it would be lost.
select ok(
  (select proconfig from pg_proc where oid =
     'public.brew_stack(text, text[], uuid, boolean, integer)'::regprocedure)
  @> array['search_path=public, extensions'],
  '8. brew_stack pins search_path'
);

select ok(
  (select proconfig from pg_proc where oid =
     'public.tag_stack(text[], text[], uuid, boolean, integer)'::regprocedure)
  @> array['search_path=public, extensions'],
  '9. tag_stack pins search_path'
);

select * from finish();

rollback;
