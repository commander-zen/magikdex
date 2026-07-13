-- 014_claim_my_data.sql — REPURPOSED (Ben 2026-07-03: "i dont care about
-- backing up my information... my decks are in moxfield. anything in here
-- is test data"): instead of claiming the pre-multi-user rows, PURGE them.
-- Run once after 013. Deletes only ownerless (user_id NULL) rows — anything
-- created by a signed-in account is untouched.
--
-- Child → parent order: deck_card_tags cascades off deck_cards (006);
-- deck_cards → decks has no cascade, so cards go first.

delete from deck_cards dc
using decks d
where d.id = dc.deck_id and d.user_id is null;

delete from decks where user_id is null;

delete from legends where user_id is null;
