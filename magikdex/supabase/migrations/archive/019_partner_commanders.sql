-- 019_partner_commanders.sql — a deck may have a SECOND commander
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- APPLIED 2026-07-27. Verified against the live schema afterwards: the PostgREST
-- embed `legends!decks_partner_legend_id_fkey` resolves (HTTP 200, no
-- relationship error), confirming Postgres auto-named the FK constraint the way
-- fetchDeckPartner() in lib/legendDeck.js expects. That name matters — if it
-- differed, the partner lookup would fail silently and partners would simply
-- never load.
--
-- Commander's partner mechanics let a deck have two commanders. magikdex has
-- assumed exactly one since 002_legends, which makes partner decks silently
-- WRONG rather than broken: the colour identity is too narrow (legal cards are
-- hidden, illegal ones offered), and the card count is off by one (a partner
-- deck is 98 + 2, not 99 + 1).
--
-- SAFE TO APPLY ANY TIME. Purely additive: one nullable column, no backfill, no
-- data rewritten. Every existing read keeps working untouched, and a deck with
-- partner_legend_id IS NULL behaves exactly as it does today — so applying this
-- ahead of the app code changes nothing for anyone.
--
-- WHY A COLUMN AND NOT A JOIN TABLE: the rules cap a deck at two commanders,
-- full stop. A deck_commanders(deck_id, legend_id, slot) table would be the
-- textbook answer for "many", but here it buys no capability while forcing
-- every existing read to change. One nullable column is the honest shape.
--
-- The five partner variants this supports (they never combine with each other):
--   Partner              any two cards that both have plain "Partner"
--   Partner with [name]  only the specific named card
--   Friends forever      any two that both have it (Stranger Things SLD)
--   Choose a Background  a creature + a legendary Background enchantment
--   Doctor's companion   a card with the ability + a Time Lord Doctor
-- Validity is enforced in the app (it needs card oracle text), not here — the
-- schema only records THAT there is a second commander, not that the pairing is
-- legal. A CHECK can't read Scryfall.

alter table decks
  add column if not exists partner_legend_id uuid references legends(id);

-- A deck's two commanders must be different cards.
alter table decks
  drop constraint if exists decks_partner_differs;
alter table decks
  add constraint decks_partner_differs
  check (partner_legend_id is null or partner_legend_id <> legend_id);

-- NOTE on decks_legend_id_unique (migration 008): that constraint is on
-- legend_id ALONE, so it is unaffected — a legend can still be the primary
-- commander of exactly one deck, and nothing stops the same legend from also
-- appearing as another deck's partner. That is correct: partners are ordinary
-- legendary cards, and two different decks may legitimately share one.

-- Verify: expect the column present, nullable, and every existing row null.
--   select count(*) as decks, count(partner_legend_id) as with_partner
--   from decks;
