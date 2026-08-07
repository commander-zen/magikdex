-- 031_trainer_decks_rls.sql — tests for the three deck slots and the commander art
--
-- HOW TO RUN (local): bash supabase/local/run-tests.sh 031

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'pub@test.local',  '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'priv@test.local', '', now(), now(), now());

insert into trainer.profile
  (id, handle, display_name, visibility, commander_name, commander_art_url, commander_artist)
values
  ('11111111-1111-1111-1111-111111111111', 'pubtrainer', 'Public', 'public',
   'Prossh, Skyraider of Kher', 'https://cards.scryfall.io/art_crop/x.jpg', 'Todd Lockwood'),
  ('22222222-2222-2222-2222-222222222222', 'privtrainer', 'Private', 'private',
   'Kinnan, Bonder Prodigy', 'https://cards.scryfall.io/art_crop/y.jpg', 'Wisnu Tan');

insert into trainer.deck (trainer_id, position, name, deck_url, scrycheck_url, rating) values
  ('11111111-1111-1111-1111-111111111111', 1, 'Prossh Sacrifice',
   'https://moxfield.com/decks/abc', 'https://scrycheck.com/deck/dd6d0fcbb4524a1f', '7.2'),
  ('11111111-1111-1111-1111-111111111111', 2, 'Meren Reanimator',
   'https://archidekt.com/decks/123', null, null);

-- ── Public read ──────────────────────────────────────────────────────────────
set local role anon;

-- 1. The decks come back in slot order, with both links and the rating.
select results_eq(
  $$ select "position", name, rating from public.get_trainer_decks('pubtrainer') $$,
  $$ values (1, 'Prossh Sacrifice'::text, '7.2'::text),
            (2, 'Meren Reanimator'::text, null::text) $$,
  '1. get_trainer_decks returns the slots in order'
);

-- 2. A private trainer's decks are not reachable, same as their card.
select is_empty(
  $$ select name from public.get_trainer_decks('privtrainer') $$,
  '2. a private trainer''s decks are not readable'
);

-- 3. The commander reaches the card, WITH the artist credit — Scryfall asks for
--    it and the collector line of a real card carries it.
select results_eq(
  $$ select commander_name, commander_artist from public.get_trainer_card('pubtrainer') $$,
  $$ values ('Prossh, Skyraider of Kher'::text, 'Todd Lockwood'::text) $$,
  '3. the card carries the commander and its artist'
);

-- 4. STILL NO UUID ANYWHERE PUBLIC. commander_scryfall_id is stored but not
--    returned: the card needs the art and the credit, not the identifier.
select is_empty(
  $$ select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_trainer_card','get_trainer_decks','get_trainer_credentials')
       and pg_get_function_result(p.oid) ~ '\buuid\b' $$,
  '4. no public trainer function returns a uuid'
);

-- 5. The table itself stays unreachable — the function is the only door.
select throws_ok(
  $$ select id from trainer.deck $$,
  '42501', null,
  '5. anon cannot reach trainer.deck directly'
);

-- ── Owner ────────────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 6. Somebody else's decks are not yours to read.
select is_empty(
  $$ select name from trainer.deck
     where trainer_id = '11111111-1111-1111-1111-111111111111' $$,
  '6. authenticated cannot read another trainer''s decks'
);

-- 7. Nor to write.
select throws_ok(
  $$ insert into trainer.deck (trainer_id, position, name)
     values ('11111111-1111-1111-1111-111111111111', 3, 'Not Mine') $$,
  '42501', null,
  '7. authenticated cannot add a deck to another trainer'
);

-- ── Constraints ──────────────────────────────────────────────────────────────
reset role;

-- 8. THREE SLOTS. The text box of a card holds three, and the frame is the
--    product — a fourth has nowhere to go.
select throws_ok(
  $$ insert into trainer.deck (trainer_id, position, name)
     values ('11111111-1111-1111-1111-111111111111', 4, 'Fourth Deck') $$,
  '23514', null,
  '8. a fourth deck slot is rejected'
);

-- 9. A deck link has to be a link, or the card renders a dead affordance.
select throws_ok(
  $$ insert into trainer.deck (trainer_id, position, name, deck_url)
     values ('11111111-1111-1111-1111-111111111111', 3, 'Bad Link', 'moxfield.com/decks/x') $$,
  '23514', null,
  '9. a deck_url without a scheme is rejected'
);

-- 10. The ScryCheck field must actually point at ScryCheck — otherwise the label
--     next to the rating is a lie about where the number came from.
select throws_ok(
  $$ insert into trainer.deck (trainer_id, position, name, scrycheck_url)
     values ('11111111-1111-1111-1111-111111111111', 3, 'Wrong Host',
             'https://example.com/deck/1') $$,
  '23514', null,
  '10. a scrycheck_url pointing somewhere else is rejected'
);

select * from finish();

rollback;
