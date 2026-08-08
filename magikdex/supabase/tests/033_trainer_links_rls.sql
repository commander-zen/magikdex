-- 033_trainer_links_rls.sql — tests for the linktree, and a guard against the
-- class of bug 032 shipped
--
-- HOW TO RUN (hosted): paste into the Supabase SQL editor as one batch. Opens a
-- transaction, seeds, asserts, ROLLS BACK. Nothing persists.
--
-- HOW TO RUN (local): the shim, then 001 → 024 → … → 032 → 033 → this file.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  (repeat(i::text, 8) || '-' || repeat(i::text, 4) || '-' || repeat(i::text, 4)
    || '-' || repeat(i::text, 4) || '-' || repeat(i::text, 12))::uuid,
  'authenticated', 'authenticated', 'trainer' || i || '@test.local',
  '', now(), now(), now()
from generate_series(1, 2) as i;

insert into trainer.profile
  (id, handle, display_name, visibility, commander_name, commander_art_url, commander_artist)
values
  ('11111111-1111-1111-1111-111111111111', 'a_public', 'Trainer A', 'public',
     'Meren of Clan Nel Toth', 'https://cards.example/meren.jpg', 'Mark Winters'),
  ('22222222-2222-2222-2222-222222222222', 'b_private', 'Trainer B', 'private',
     'Prossh', 'https://cards.example/prossh.jpg', 'Todd Lockwood');

insert into trainer.link (trainer_id, position, label, kind, value) values
  ('11111111-1111-1111-1111-111111111111', 1, 'Moxfield', 'url',    'https://moxfield.com/users/zen'),
  ('11111111-1111-1111-1111-111111111111', 2, 'Discord',  'handle', 'zen#0001'),
  ('22222222-2222-2222-2222-222222222222', 1, 'Secret',   'url',    'https://example.com/hidden');

-- ── THE REGRESSION GUARD ─────────────────────────────────────────────────────
-- 1. This is the assertion that would have caught 032's bug and did not exist.
--    032 dropped get_trainer_card to add three columns, rebuilt the list from
--    025's shape, and silently lost the three commander columns 031 had added in
--    between. Nothing failed; the artist credit just stopped appearing.
--
--    Pinning the FULL signature is the fix. A drop-and-recreate that forgets a
--    column now fails here instead of in production. Note this asserts the whole
--    string on purpose — a `like '%commander_name%'` check would pass while some
--    other column went missing, which is exactly the failure being guarded.
select is(
  pg_get_function_result('public.get_trainer_card(extensions.citext)'::regprocedure),
  'TABLE(handle citext, display_name text, photo_url text, pronouns text, bio text, '
  || 'home_region text, philosophy text[], identity_mode text, playstyle text[], '
  || 'favorite_legends text[], commander_name text, commander_art_url text, '
  || 'commander_artist text, usually_found_at text, ready_to_pod boolean, '
  || 'ready_note text, visibility text, created_at timestamp with time zone)',
  '1. get_trainer_card''s FULL column list is pinned — 025 + 031 + 032, nothing lost'
);

set local role anon;

-- 2-4. The actual regression, end to end: the three columns 032 dropped are back
--      and carry real values. Assertion 4 is the one that matters beyond
--      tidiness — Scryfall asks that art be credited, and this is the credit.
select results_eq(
  $$ select commander_name from public.get_trainer_card('a_public') $$,
  $$ values ('Meren of Clan Nel Toth'::text) $$,
  '2. commander_name is back in the public card'
);

select results_eq(
  $$ select commander_art_url from public.get_trainer_card('a_public') $$,
  $$ values ('https://cards.example/meren.jpg'::text) $$,
  '3. commander_art_url is back in the public card'
);

select results_eq(
  $$ select commander_artist from public.get_trainer_card('a_public') $$,
  $$ values ('Mark Winters'::text) $$,
  '4. commander_artist is back — this one is a Scryfall attribution, not a nicety'
);

-- 5-6. And 032's columns did not get lost restoring 031's. Both eras coexist.
select results_eq(
  $$ select ready_to_pod from public.get_trainer_card('a_public') $$,
  $$ values (false) $$,
  '5. 032''s ready_to_pod survived the 033 recreate'
);

select is(
  (select count(*)::int from public.get_trainer_card('a_public')),
  1,
  '6. the card still resolves to exactly one row'
);

-- ── The linktree ─────────────────────────────────────────────────────────────
select results_eq(
  $$ select "position", label, kind, value from public.get_trainer_links('a_public') $$,
  $$ values (1, 'Moxfield'::text, 'url'::text,    'https://moxfield.com/users/zen'::text),
            (2, 'Discord'::text,  'handle'::text, 'zen#0001'::text) $$,
  '7. get_trainer_links returns the owner''s links in position order'
);

-- 8. Visibility is evaluated at READ time here too. A private trainer's links are
--    not a smaller disclosure than their card — they ARE the contact details.
select is_empty(
  $$ select label from public.get_trainer_links('b_private') $$,
  '8. a PRIVATE trainer''s links are not readable'
);

-- 9. Same non-oracle rule as every other public read: an unknown handle and a
--    private one are indistinguishable.
select is_empty(
  $$ select label from public.get_trainer_links('no_such_handle') $$,
  '9. an unknown handle returns nothing, identically to a private one'
);

-- 10. No uuid. `id` exists on the table and is deliberately withheld — it is a
--     permanent key that would survive a rename.
select doesnt_match(
  pg_get_function_result('public.get_trainer_links(extensions.citext)'::regprocedure),
  'uuid',
  '10. get_trainer_links returns NO uuid'
);

-- 11. anon cannot reach the table itself, only the function.
select throws_ok(
  $$ select label from trainer.link $$,
  '42501', null,
  '11. anon cannot reach trainer.link directly'
);

reset role;

-- ── Constraints ──────────────────────────────────────────────────────────────
-- 12. A 'url' row must actually be a URL, or the card renders a dead link.
select throws_ok(
  $$ insert into trainer.link (trainer_id, position, label, kind, value)
     values ('11111111-1111-1111-1111-111111111111', 5, 'Bad', 'url', 'moxfield.com/zen') $$,
  '23514', null,
  '12. a url row rejects a value with no scheme'
);

-- 13. ...but a 'handle' row has no shape requirement, because a username has no
--     shape worth asserting and guessing one would reject somebody's real Discord.
select lives_ok(
  $$ insert into trainer.link (trainer_id, position, label, kind, value)
     values ('11111111-1111-1111-1111-111111111111', 6, 'Discord', 'handle', 'not.a.url') $$,
  '13. a handle row accepts a value that is not a URL'
);

-- 14. 12 is the ceiling. The back scrolls, so this bounds abuse, not design.
select throws_ok(
  $$ insert into trainer.link (trainer_id, position, label, kind, value)
     values ('11111111-1111-1111-1111-111111111111', 13, 'Too many', 'url', 'https://example.com') $$,
  '23514', null,
  '14. position 13 is rejected — 12 links is the cap'
);

-- 15. One row per slot.
select throws_ok(
  $$ insert into trainer.link (trainer_id, position, label, kind, value)
     values ('11111111-1111-1111-1111-111111111111', 1, 'Dupe', 'url', 'https://example.com') $$,
  '23505', null,
  '15. two links cannot share a position'
);

-- ── Ownership ────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 3, not 4: the two seeded above plus the one assertion 13 inserted. B's link is
-- invisible, which is the point — an unfiltered count would be 4.
select results_eq(
  $$ select count(*)::int from trainer.link $$,
  $$ values (3) $$,
  '16. an owner sees only their OWN links, not B''s'
);

-- 17. And cannot write a row onto somebody else's card.
select throws_ok(
  $$ insert into trainer.link (trainer_id, position, label, kind, value)
     values ('22222222-2222-2222-2222-222222222222', 9, 'Hijack', 'url', 'https://evil.example') $$,
  '42501', null,
  '17. a trainer cannot add a link to another trainer''s card'
);

-- 18. Deleting the account takes the links with it. A contact list that outlives
--     the person it belongs to is the wrong kind of durable.
reset role;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';

select is_empty(
  $$ select label from trainer.link
     where trainer_id = '11111111-1111-1111-1111-111111111111' $$,
  '18. links cascade away when the account is deleted'
);

select * from finish();

rollback;
