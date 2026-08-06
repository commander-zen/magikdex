-- 00_supabase_shim.sql — make a bare Postgres look enough like Supabase
--
-- LOCAL DEVELOPMENT ONLY. Never run this against the hosted project — Supabase
-- already provides every object in here, and re-creating them is at best a
-- no-op and at worst a downgrade of the real auth schema to this stub.
--
-- ── Why this exists ──────────────────────────────────────────────────────────
-- Docker Desktop cannot install on Windows 11 Home without WSL2, which is not
-- present on this machine. `supabase start` is therefore unavailable, but the
-- thing we actually need in order to verify a migration is a Postgres that can
-- execute pgTAP against RLS policies — not the full Supabase stack. PostgREST,
-- GoTrue, Studio and Realtime verify nothing about a CHECK constraint.
--
-- So: native Postgres 17, plus the four things the migrations and tests in this
-- repo genuinely depend on.
--
--   1. the anon / authenticated / service_role roles  (every `to anon` grant,
--      every `set local role anon` in the tests)
--   2. the `auth` schema                              (trainer.id references
--                                                      auth.users(id))
--   3. auth.uid()                                     (every RLS policy)
--   4. the `extensions` schema                        (001 and the trainer
--                                                      migration both install
--                                                      extensions into it)
--
-- ── Run order ────────────────────────────────────────────────────────────────
--   psql -U postgres -d magikdex -f supabase/local/00_supabase_shim.sql
--   psql -U postgres -d magikdex -f supabase/local/01_pgtap.sql      (see note)
--   psql -U postgres -d magikdex -f supabase/migrations/001_baseline.sql
--   psql -U postgres -d magikdex -f supabase/migrations/<trainer>.sql
--   psql -U postgres -d magikdex -f supabase/tests/<trainer>_rls.sql
--
-- pgTAP is pure SQL — no compilation, which is why this works on Windows at all.
-- If `create extension pgtap` fails because no control file is installed, load
-- the release's pgtap.sql directly instead and change the test files' line
-- `create extension if not exists pgtap with schema extensions;` to a no-op.

-- ── Roles ────────────────────────────────────────────────────────────────────
-- NOLOGIN on purpose: these are never connected to directly. The tests reach
-- them with `set local role`, which a superuser may do to any role. That is
-- exactly how Supabase's own roles behave — PostgREST connects as
-- `authenticator` and switches.
do $$ begin
  create role anon nologin noinherit;
exception when duplicate_object then null; end $$;

do $$ begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null; end $$;

-- BYPASSRLS is what makes service_role the credential-issuer path in the
-- trainer schema: `credential` has no write policy for anyone, and writes are
-- expected to arrive from a role that RLS does not apply to.
do $$ begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null; end $$;

-- ── Schemas ──────────────────────────────────────────────────────────────────
create schema if not exists auth;
create schema if not exists extensions;

grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
-- Deliberately NO `grant usage on schema auth`. Client roles cannot see the auth
-- schema on hosted Supabase either, and the trainer tests assert that a
-- foreign key to auth.users(id) works without the caller being able to read it.
-- Granting usage here would make a leak invisible locally and obvious in prod.

-- ── search_path ──────────────────────────────────────────────────────────────
-- Hosted Supabase puts `extensions` on the search path; a stock Postgres does
-- not. Without this, `handle citext` in the trainer migration fails locally with
-- "type citext does not exist" — a pure environment artefact that would never
-- happen in production, and exactly the kind of false failure that teaches you
-- to distrust your own test run.
--
-- Database-scoped, so it applies to every new connection to this database only.
do $$
begin
  execute 'alter database ' || quote_ident(current_database())
       || ' set search_path = "$user", public, extensions';
end $$;

-- ── auth.users ───────────────────────────────────────────────────────────────
-- A STUB, not a reproduction. Only the columns this repo's test fixtures
-- actually insert, plus the primary key that `trainer.id` and
-- `decks.user_id`-style ownership depend on. Real GoTrue has ~30 more columns
-- and none of them affect an RLS assertion.
create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key,
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz
);

-- ── auth.uid() ───────────────────────────────────────────────────────────────
-- The real one, not an approximation. Supabase's auth.uid() reads the JWT claim
-- out of a GUC, which is why the test files can impersonate a user with
--
--     set local request.jwt.claim.sub = '1111…';
--
-- Both spellings are checked because both are in circulation: the flat
-- `request.jwt.claim.sub` GUC and the JSON `request.jwt.claims` blob. The test
-- files in this repo set both, and the flat one wins here as it does upstream.
--
-- `true` as the second argument to current_setting means "return null if unset"
-- rather than raising — without it, every policy would error for an
-- unauthenticated caller instead of evaluating to null and denying.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text;
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text;
$$;

grant execute on function auth.uid()   to anon, authenticated, service_role;
grant execute on function auth.role()  to anon, authenticated, service_role;
grant execute on function auth.email() to anon, authenticated, service_role;

-- ── Default privileges ───────────────────────────────────────────────────────
-- Hosted Supabase default-grants ALL on new public-schema objects to the three
-- client roles. That default is the reason the trainer migration has to REVOKE
-- explicitly — without reproducing it locally, "no policy" would read as
-- "denied" here and as "zero rows" in production, and the RLS tests that assert
-- SQLSTATE 42501 would pass locally for the wrong reason.
--
-- This is the single most important line in the file for test fidelity.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ── Sanity check ─────────────────────────────────────────────────────────────
do $$
begin
  if auth.uid() is not null then
    raise exception 'auth.uid() should be null with no JWT GUC set, got %', auth.uid();
  end if;

  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  if auth.uid() <> '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'auth.uid() did not read the JWT GUC, got %', auth.uid();
  end if;
  perform set_config('request.jwt.claim.sub', '', true);

  raise notice 'shim ok: roles, auth schema, auth.uid() all behaving';
end $$;
