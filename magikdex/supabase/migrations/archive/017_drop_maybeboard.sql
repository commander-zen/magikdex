-- 017_drop_maybeboard.sql — delete the maybeboard's rows
-- Run manually in the Supabase SQL editor (this project has no CLI migration
-- history — same posture as every migration here).
--
-- Device UAT 2026-07-14: the maybeboard is gone from the app. It was the source
-- of two real problems — its cards polluted the WREC calculus and the deck
-- count, and ↓ (its swipe gesture) kept firing when people meant "close the
-- carousel". The deck is the only board now: a card is in it or it's cut.
--
-- Ben's call on the data was DELETE, not migrate-to-mainboard. This is
-- IRREVERSIBLE: every deck_cards row in the 'maybe' section goes, and migration
-- 006's on-delete-cascade takes their deck_card_tags with them. Nothing else
-- references those rows.
--
-- The app already ignores 'maybe' rows (it never reads or writes that section
-- since this batch), so they are inert until this runs — the only cost of not
-- running it is dead rows sitting in the table.

-- Sanity-check BEFORE deleting — this is what you're about to lose:
--   select d.legend, dc.card_name, dc.quantity
--   from deck_cards dc join decks d on d.id = dc.deck_id
--   where dc.section = 'maybe'
--   order by d.legend, dc.card_name;

delete from deck_cards
where section = 'maybe';

-- Verify: expect 0.
--   select count(*) from deck_cards where section = 'maybe';
