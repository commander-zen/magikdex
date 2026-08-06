-- 025_trainer_identity.sql — Trainer identity, in its own schema
--
-- NOT APPLIED — written for review. Verified locally against a fresh
-- 001 → 024 replay; see supabase/tests/025_trainer_identity_rls.sql.
--
-- Supersedes archive/018 and archive/023. Identity only: profile, handles,
-- party, credentials. Connections/blocks/roster are a separate migration on top.
--
-- ── Why a `trainer` schema instead of public.trainer_* ───────────────────────
-- Two reasons, and the second is the one that actually pays.
--
-- 1. PostgREST only exposes schemas listed in the project's API settings —
--    `public` by default. Objects in `trainer` are unreachable over HTTP until
--    someone deliberately adds the schema to that list.
--
-- 2. SUPABASE'S DEFAULT GRANTS ARE SCOPED TO public. The dashboard runs
--    `alter default privileges in schema public grant all on tables to anon,
--    authenticated, service_role`. A new schema inherits none of that: no USAGE,
--    no table privileges, nothing. 023 needed ELEVEN revoke statements to claw
--    back defaults it never wanted. This file has zero, because there is nothing
--    to claw back — every privilege below is one somebody typed on purpose.
--
--    That is the difference between "locked after cleanup" and "never unlocked".
--
-- ── The public read path: functions keyed by HANDLE, never a view ────────────
-- A view is a relation: anyone granted SELECT can `select *` and walk every row.
-- A function taking a handle has no enumerable domain — you must already know
-- the handle, which is exactly your state after someone hands you their card or
-- you scan their QR.
--
-- The asymmetry that decided it: enumeration can be ADDED in one migration and
-- can never be REMOVED, because by then the profiles have been crawled. A
-- profile carries home_region, pronouns and bio; enumerated, that is a
-- downloadable dataset of every player and where they live.
--
-- Consequence worth stating: THERE IS NO DIRECTORY. "Browse trainers" is not
-- merely unbuilt, it is structurally impossible until a future migration adds a
-- view. That was the explicit call.
--
-- ── No uuid is ever published ────────────────────────────────────────────────
-- profile.id is auth.users.id and it never changes. A handle does. Publishing
-- the uuid would hand out a permanent cross-scrape tracking key that survives a
-- rename; publishing only the handle means a rename genuinely breaks the link.
--
-- This also resolves the gap 023 could not close. 023 kept id off its public
-- view and therefore had no way for /t/<handle> to reach the party slots — the
-- fix looked like "expose the id". Keying every public function on handle gets
-- the join without publishing anything.

create extension if not exists citext with schema extensions;

create schema if not exists trainer;

-- ── Types ────────────────────────────────────────────────────────────────────
-- In the trainer schema, not public: these are this feature's vocabulary and
-- nothing outside it has any business referencing them.
do $$ begin
  create type trainer.visibility as enum ('public', 'unlisted', 'private');
exception when duplicate_object then null; end $$;

-- Which axis this trainer chose to represent them. A RENDER FLAG, not a
-- constraint: both playstyle and favorite_legends may hold data at once and
-- neither is cleared when the mode flips, so switching back does not lose the
-- other answer. Exactly one is displayed, and that is a read-time decision.
do $$ begin
  create type trainer.identity_mode as enum ('playstyle', 'legends');
exception when duplicate_object then null; end $$;

-- kind and method stay ORTHOGONAL. Fusing them into `lgs_visit_verified` means
-- every new verification method multiplies the enum, and every query for "all
-- LGS visits" has to know the full cross product.
do $$ begin
  create type trainer.credential_kind as enum
    ('scrycheck_rank', 'lgs_visit', 'event_finish');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trainer.credential_method as enum
    ('self_reported', 'api_verified', 'venue_verified');
exception when duplicate_object then null; end $$;

-- ── Helper: per-element length cap for text arrays ───────────────────────────
-- A CHECK constraint cannot contain a subquery and Postgres has no "longest
-- element" array operator, so the unnest lives in a function instead. Legal in a
-- CHECK because it is IMMUTABLE. Defined before the table so a dump restores in
-- order.
create or replace function trainer.elements_within(arr text[], max_len int)
returns boolean
language sql
immutable
as $$
  -- unnest(null) and unnest('{}') both yield zero rows, so bool_and is NULL for
  -- either; coalesce turns "nothing to check" into a pass.
  select coalesce(bool_and(char_length(e) <= max_len), true)
  from unnest(arr) as e;
$$;

-- ── trainer.profile ──────────────────────────────────────────────────────────
-- Named `profile`, not `trainer`: inside the trainer schema, `trainer.trainer`
-- reads badly everywhere it appears.
create table if not exists trainer.profile (
  id uuid primary key references auth.users(id) on delete cascade,

  -- handle::text is required in the shape CHECK. citext's `~` operator is
  -- case-INSENSITIVE, so a bare `handle ~ '^[a-z0-9_]{3,20}$'` would happily
  -- accept 'BenIsHere'. The cast forces a case-sensitive match, which is what
  -- actually pins handles to lowercase. citext still gives case-insensitive
  -- UNIQUEness, so @Ben and @ben collide at the index.
  handle extensions.citext not null unique
    constraint profile_handle_shape
      check ((handle::text) ~ '^[a-z0-9_]{3,20}$'),

  display_name text not null
    constraint profile_display_name_len
      check (char_length(display_name) between 1 and 40),

  photo_url text,

  pronouns text
    constraint profile_pronouns_len check (char_length(pronouns) <= 30),

  bio text
    constraint profile_bio_len check (char_length(bio) <= 280),

  -- Free text ("north side", "Twin Cities"). Coordinates are forbidden, so it is
  -- a constraint rather than a code-review note: reject anything shaped like a
  -- decimal degree. "St. Louis" and "Route 66" pass; "44.9778, -93.2650" does
  -- not. This field is the geo backdoor if left unguarded.
  home_region text
    constraint profile_home_region_len check (char_length(home_region) <= 60)
    constraint profile_home_region_not_geo
      check (home_region !~ '[-+]?[0-9]{1,3}\.[0-9]{3,}'),

  -- Multi-select with no order and no scale, and deliberately NO cap on count —
  -- a trainer can honestly claim all four. `<@` is "is contained by", so an
  -- empty array passes and anything outside the vocabulary fails.
  philosophy text[] not null default '{}'
    constraint profile_philosophy_allowed
      check (philosophy <@ array['jank', 'casual', 'trash_magic', 'cedh']::text[]),

  identity_mode trainer.identity_mode not null default 'playstyle',

  -- Closed vocabulary of 30, same `<@` idiom as philosophy. Fixed on purpose: an
  -- open column drifts into forty spellings of "+1/+1 counters" inside a month
  -- and the card has to render every one. Adding a value is a follow-up
  -- migration, which is the point — it makes the vocabulary a reviewed decision
  -- instead of a client typo.
  playstyle text[] default '{}'
    constraint profile_playstyle_max
      check (playstyle is null or array_length(playstyle, 1) <= 3)
    constraint profile_playstyle_allowed
      check (playstyle <@ array[
        'tokens', 'plus_one_counters', 'artifacts', 'combo', 'aggro',
        'lifegain', 'spellslinger', 'reanimator', 'aristocrats', 'lands_matter',
        'control', 'burn', 'equipment', 'ramp', 'enchantress',
        'voltron', 'midrange', 'treasure', 'mill', 'sacrifice',
        'blink', 'wheels', 'auras', 'legends', 'discard',
        'stax', 'group_hug', 'politics', 'chaos', 'battlecruiser'
      ]::text[]),

  -- Free text per entry, unlike playstyle: there are ~2000 legendary creatures
  -- and more every set, so a closed list would be stale on release day.
  favorite_legends text[] default '{}'
    constraint profile_favorite_legends_max
      check (favorite_legends is null or array_length(favorite_legends, 1) <= 3)
    constraint profile_favorite_legends_elem_len
      check (trainer.elements_within(favorite_legends, 60)),

  visibility trainer.visibility not null default 'private',
  created_at timestamptz not null default now()
);

-- ── trainer.handle_reservation ───────────────────────────────────────────────
-- Blocks system routes and impersonation targets, and holds released handles so
-- they cannot be immediately re-claimed by someone else. Enforced by the trigger
-- below, because a CHECK cannot reference another table.
create table if not exists trainer.handle_reservation (
  handle extensions.citext primary key,
  reason text not null default 'reserved'
    constraint handle_reservation_reason check (reason in ('reserved', 'released')),
  -- Deliberately NOT a foreign key: an audit pointer has to keep meaning after
  -- the prior owner's auth.users row is gone.
  released_from uuid,
  created_at timestamptz not null default now()
);

-- ── trainer.party_slot ───────────────────────────────────────────────────────
-- What you would sleeve up tonight. Distinct from the dex and mutable —
-- deleting a slot does not touch the deck.
--
-- decks(id) is in the PUBLIC schema and is verified, not guessed: `decks` is
-- dashboard-created and now captured in 001_baseline.sql as a uuid primary key.
create table if not exists trainer.party_slot (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer.profile(id) on delete cascade,
  deck_id uuid not null references public.decks(id) on delete cascade,

  -- The hard cap of 5 lives HERE, not in client validation. Combined with
  -- unique(trainer_id, position) a sixth slot has nowhere to go: 1-5 are taken
  -- and 6 fails the range check.
  position int not null
    constraint party_slot_position_range check ("position" between 1 and 5),

  playstyle_note text
    constraint party_slot_note_len check (char_length(playstyle_note) <= 120),
  created_at timestamptz not null default now(),

  constraint party_slot_trainer_position_unique unique (trainer_id, position),
  constraint party_slot_trainer_deck_unique unique (trainer_id, deck_id)
);

-- ── trainer.credential ───────────────────────────────────────────────────────
-- Append-only claims about a player. No client role can write here at all — see
-- the policy section. The issuer service holds service_role and is the single
-- write path. Revocation is `revoked_at`, never an edit or a delete.
--
-- Credentials are read and displayed INDIVIDUALLY: a graded deck shows its own
-- bracket and its own date. There is deliberately nothing in this file that
-- reduces them to a score, rank or trust number.
create table if not exists trainer.credential (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainer.profile(id) on delete cascade,
  kind trainer.credential_kind not null,
  issuer text not null
    constraint credential_issuer_len check (char_length(issuer) between 1 and 120),
  method trainer.credential_method not null,
  payload jsonb not null,
  -- Surfaced, never hidden. "Rank 7, verified 4 Mar" beats a bare number, and a
  -- stale ranking must read as stale rather than silently refresh.
  issued_at timestamptz not null,
  expires_at timestamptz,
  revoked_at timestamptz
);

-- ── Reserved-handle enforcement ──────────────────────────────────────────────
-- SECURITY DEFINER because the caller has no privilege on handle_reservation and
-- must not gain one — the trigger reads a table the user cannot enumerate.
-- search_path pinned so the definer body cannot be redirected.
create or replace function trainer.handle_not_reserved()
returns trigger
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
begin
  if exists (select 1 from trainer.handle_reservation r where r.handle = new.handle) then
    raise exception 'handle "%" is reserved and cannot be claimed', new.handle
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_handle_not_reserved on trainer.profile;
create trigger profile_handle_not_reserved
  before insert or update of handle on trainer.profile
  for each row execute function trainer.handle_not_reserved();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Enabled before a single row is inserted. The seed at the foot of this file is
-- the only INSERT here and it runs last.
alter table trainer.profile            enable row level security;
alter table trainer.handle_reservation enable row level security;
alter table trainer.party_slot         enable row level security;
alter table trainer.credential         enable row level security;

-- ── Privileges ───────────────────────────────────────────────────────────────
-- Note what is absent: any REVOKE. A fresh schema has no default grants, so the
-- only privileges that exist are the ones granted below.
--
-- anon gets USAGE on nothing. Not one table in this schema is reachable by
-- anonymous traffic — the public read path is the three SECURITY DEFINER
-- functions in the `public` schema at the bottom of this file, and those need no
-- privilege on these tables at all.
grant usage on schema trainer to authenticated;

-- Owner reads and edits their own profile, and creates it. No DELETE: accounts
-- are removed through auth.users, which cascades.
grant select, insert, update on trainer.profile to authenticated;

-- Owner has full control of their own party.
grant select, insert, update, delete on trainer.party_slot to authenticated;

-- Read only, and only their own — see the policy. No write privilege of any
-- kind, for any client role.
grant select on trainer.credential to authenticated;

-- handle_reservation: no grant to anybody. The trigger reads it as definer.

grant execute on function trainer.elements_within(text[], int) to authenticated;

-- ── Policies ─────────────────────────────────────────────────────────────────
-- profile.id IS auth.users.id, so every owner check is a plain `= auth.uid()` —
-- no join back through a user_id column the way public.decks needs.

drop policy if exists profile_select_own on trainer.profile;
create policy profile_select_own on trainer.profile
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profile_update_own on trainer.profile;
create policy profile_update_own on trainer.profile
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Handle claim. A lock on the door, not a bouncer: the shape CHECK and the
-- reserved-handle trigger already enforce everything that matters, so the policy
-- only has to establish that you are creating YOUR row and nobody else's.
--
-- Swapping this for a SECURITY DEFINER claim_handle() RPC later — to add
-- rate limiting or per-reason error messages — changes no table and no data.
drop policy if exists profile_insert_own on trainer.profile;
create policy profile_insert_own on trainer.profile
  for insert to authenticated
  with check (id = auth.uid());

-- Party: owner does everything to their own slots. There is NO public read
-- policy here, deliberately — the public path is get_trainer_party(handle),
-- which runs as definer and never needs one.
drop policy if exists party_slot_own on trainer.party_slot;
create policy party_slot_own on trainer.party_slot
  for all to authenticated
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Credentials: the owner may read their own. No INSERT, UPDATE or DELETE policy
-- for any role, which together with the withheld privileges is what makes the
-- table append-only from every client's perspective.
drop policy if exists credential_select_own on trainer.credential;
create policy credential_select_own on trainer.credential
  for select to authenticated
  using (trainer_id = auth.uid());

-- handle_reservation: no policies at all, by design. No client role reaches it.

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists party_slot_trainer_idx on trainer.party_slot (trainer_id);
create index if not exists party_slot_deck_idx    on trainer.party_slot (deck_id);
create index if not exists credential_trainer_idx on trainer.credential (trainer_id);
-- The lookup every public read starts from. Partial to the two reachable states,
-- because a private profile is never resolved by handle.
create index if not exists profile_reachable_handle_idx
  on trainer.profile (handle) where visibility in ('public', 'unlisted');

-- ── The public read path ─────────────────────────────────────────────────────
-- Three functions, all in `public` so PostgREST can see them, all keyed by
-- handle, all SECURITY DEFINER, none returning a uuid. They are the ONLY way
-- unauthenticated traffic reaches anything in the trainer schema.
--
-- Each resolves at most one trainer and requires the caller to already know the
-- handle. Brute-forcing 3-20 character handles is possible in principle and is
-- an application rate-limit concern, not a schema one — flagging it, not
-- solving it here.
--
-- VISIBILITY IS EVALUATED AT READ TIME. A trainer who goes private disappears
-- from all three immediately; there is no cached copy of their card anywhere.

create or replace function public.get_trainer_card(p_handle extensions.citext)
returns table (
  handle           extensions.citext,
  display_name     text,
  photo_url        text,
  pronouns         text,
  bio              text,
  home_region      text,
  philosophy       text[],
  -- text, not the enum, so a client never needs to know the type exists. Cast
  -- explicitly in the body rather than leaning on assignment-context coercion.
  identity_mode    text,
  playstyle        text[],
  favorite_legends text[],
  -- Included so the client can mark an unlisted profile noindex. It reveals
  -- "this profile is unlisted" to someone who already holds the handle, which
  -- is a strictly smaller disclosure than the card they are already reading.
  visibility       text,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select p.handle, p.display_name, p.photo_url, p.pronouns, p.bio, p.home_region,
         p.philosophy, p.identity_mode::text, p.playstyle, p.favorite_legends,
         p.visibility::text, p.created_at
  from trainer.profile p
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted');
$$;

-- The podium. This is the join 023 could not make without publishing a uuid.
--
-- `"position"` is quoted because it is a reserved word in a RETURNS TABLE column
-- list — legal as a bare column name in CREATE TABLE, a syntax error here.
--
-- NO deck_id. It was in the first draft and the "no uuid" assertion in the test
-- file rejected it, correctly: a deck id is permanent and bound to this
-- trainer's public party, so publishing it is the same cross-rename tracking
-- vector as publishing the trainer's own uuid. It also has no use — `decks` is
-- not readable by anon (see decks_own in 001), so a client could not dereference
-- it anyway. The card needs the legend and the note, not the key.
create or replace function public.get_trainer_party(p_handle extensions.citext)
returns table (
  "position"     int,
  legend         text,
  build_name     text,
  playstyle_note text
)
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select s.position, d.legend, d.build_name, s.playstyle_note
  from trainer.profile p
  join trainer.party_slot s on s.trainer_id = p.id
  join public.decks d       on d.id = s.deck_id
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted')
  order by s.position;
$$;

-- Credentials, INDIVIDUALLY. One row per claim, each with its own issuer,
-- method and date. Expired and revoked rows are filtered rather than shown as
-- stale, and there is deliberately no sum, count, score or rank anywhere in
-- this function or this file.
create or replace function public.get_trainer_credentials(p_handle extensions.citext)
returns table (
  kind       text,
  issuer     text,
  method     text,
  payload    jsonb,
  issued_at  timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = trainer, public, extensions
as $$
  select c.kind::text, c.issuer, c.method::text, c.payload, c.issued_at, c.expires_at
  from trainer.profile p
  join trainer.credential c on c.trainer_id = p.id
  where p.handle = p_handle
    and p.visibility in ('public', 'unlisted')
    and c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now())
  order by c.issued_at desc;
$$;

revoke all on function public.get_trainer_card(extensions.citext) from public;
revoke all on function public.get_trainer_party(extensions.citext) from public;
revoke all on function public.get_trainer_credentials(extensions.citext) from public;

grant execute on function public.get_trainer_card(extensions.citext)
  to anon, authenticated;
grant execute on function public.get_trainer_party(extensions.citext)
  to anon, authenticated;
grant execute on function public.get_trainer_credentials(extensions.citext)
  to anon, authenticated;

-- ── Seed: reserved handles ───────────────────────────────────────────────────
-- System routes and impersonation targets. RLS is already on and no client role
-- has any privilege here, so this runs as the migration author and cannot be
-- read or extended from outside.
insert into trainer.handle_reservation (handle, reason) values
  ('admin', 'reserved'), ('api', 'reserved'), ('app', 'reserved'),
  ('support', 'reserved'), ('magikdex', 'reserved'), ('help', 'reserved'),
  ('about', 'reserved'), ('settings', 'reserved'), ('login', 'reserved'),
  ('signup', 'reserved'), ('t', 'reserved'), ('deck', 'reserved'),
  ('vault', 'reserved'), ('brew', 'reserved'), ('pod', 'reserved'),
  ('analysis', 'reserved')
on conflict (handle) do nothing;

-- ── Deployment notes ─────────────────────────────────────────────────────────
--
-- 1. THE PUBLIC PATH NEEDS NO DASHBOARD CHANGE. All three read functions live
--    in `public`, so anon can call them the moment this migration is applied.
--
-- 2. THE OWNER PATH DOES. For a signed-in user to read or edit their own
--    profile with `supabase.from(...)`, `trainer` has to be added to the
--    project's Exposed Schemas (API settings), and client calls become
--    `supabase.schema('trainer').from('profile')`. Until then the owner path is
--    reachable only via service_role.
--
--    That is a deliberate trade: the schema boundary is doing real work, and the
--    cost is one dashboard setting plus one client-side prefix.
--
-- ── Known gaps, deliberately left ────────────────────────────────────────────
--
-- 1. No handle-change rate limit. T-101 wants one per 30 days, which needs a
--    handle_changed_at column and a trigger. Nothing here prevents a user from
--    renaming in a loop, and no released handle is auto-reserved on rename.
--
-- 2. `philosophy` allows empty. The spec's `default '{}'` and the product's
--    "minimum 1" disagree; empty wins here.
--
-- 3. Append-only on `credential` is enforced by withheld privileges and absent
--    policies, not by a trigger. service_role can still UPDATE, which is
--    required for revocation.
--
-- 4. identity_mode is ADVISORY. A 'legends'-mode trainer may hold a populated
--    playstyle array by design, so every renderer must honour the flag itself.
--    get_trainer_card returns both axes and the flag; it does not choose.
--
-- 5. No directory, and that is the point. Adding one means adding a view over
--    visibility = 'public' — a deliberate, reviewable migration, not a
--    convenience someone reaches for at 2am.
