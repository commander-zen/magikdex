-- 008_one_deck_per_legend.sql — enforce one-deck-per-legend at the schema level
-- Run manually in the Supabase SQL editor (this project's schema lives in the
-- dashboard; there is no CLI migration history).
--
-- APPLIED 2026-06-27. All legends/decks/deck_cards/deck_card_tags rows were
-- disposable test data (canonical decklists live in Moxfield), so rather than
-- reconcile the pre-existing duplicate-deck legends one by one, every row in
-- those four tables was wiped first and the constraint landed against a clean
-- slate. The `cards` Scryfall cache table was untouched.
--
-- A legend forked into two `decks` rows once already (the paste-import path
-- inserted a fresh deck instead of reusing the legend's existing one — fixed
-- in LegendBox.jsx's handleImportDeck, which now merges into the resolved
-- deck via lib/legendDeck.js instead of inserting a second row). This
-- constraint is the backstop: even if a future bug reintroduces a forking
-- write path, the database rejects it outright instead of silently creating
-- a second row for the same legend.

alter table decks
  add constraint decks_legend_id_unique unique (legend_id);
