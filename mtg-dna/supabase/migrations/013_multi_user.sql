-- 013_multi_user.sql — per-user ownership + RLS across the board
-- Run manually in the Supabase SQL editor.
--
-- BEFORE this is useful, TWO dashboard actions (see SESSION_STATE):
--   1. Authentication → Sign In / Up → enable "Anonymous sign-ins".
--      The app signs every visitor in anonymously on load — zero UI, zero
--      personal info collected (Ben: lowest friction, most private; "i dont
--      want their info"). Each browser gets its own invisible account.
--   2. Future ingest runs need the real service_role key (bypasses RLS):
--      SUPABASE_SERVICE_KEY=<service_role secret> npm run ingest:...
--      The publishable key can no longer write the shared cache tables.
--
-- AFTER running this + first sign-in on your own device: claim your existing
-- legends/decks with 014_claim_my_data.sql (they carry user_id NULL until
-- then, visible to nobody but service_role — safe, not leaked).
--
-- Ownership model: user_id on legends AND decks (defaulted server-side to
-- auth.uid(), so the client never sends it); deck_cards/deck_card_tags derive
-- ownership through their deck. The card knowledge base (cards, card_tags,
-- legend_synergy, legend_themes) is SHARED: readable by everyone, written by
-- the ingest scripts (service_role) — except cards, where the app's
-- cache-on-miss write-back (writeBackToCache in scryfall.js) keeps working
-- for signed-in users.

-- ── Ownership columns ────────────────────────────────────────────────────────
alter table legends add column if not exists user_id uuid default auth.uid();
alter table decks   add column if not exists user_id uuid default auth.uid();

-- Legend names are now unique PER USER (two users can both box Krenko).
-- Existing NULL-user rows don't collide (NULLs are distinct in Postgres).
-- The app upserts onConflict "user_id,name" with a legacy "name" fallback,
-- so deploy order doesn't matter.
alter table legends drop constraint if exists legends_name_key;
alter table legends add constraint legends_user_name_unique unique (user_id, name);

create index if not exists legends_user_idx on legends (user_id);
create index if not exists decks_user_idx   on decks (user_id);

-- ── Per-user tables: owner-only, all verbs ───────────────────────────────────
alter table legends enable row level security;
drop policy if exists legends_own on legends;
create policy legends_own on legends
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table decks enable row level security;
drop policy if exists decks_own on decks;
create policy decks_own on decks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table deck_cards enable row level security;
drop policy if exists deck_cards_own on deck_cards;
create policy deck_cards_own on deck_cards
  for all to authenticated
  using (exists (
    select 1 from decks d where d.id = deck_cards.deck_id and d.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from decks d where d.id = deck_cards.deck_id and d.user_id = auth.uid()
  ));

alter table deck_card_tags enable row level security;
drop policy if exists deck_card_tags_own on deck_card_tags;
create policy deck_card_tags_own on deck_card_tags
  for all to authenticated
  using (exists (
    select 1 from deck_cards dc join decks d on d.id = dc.deck_id
    where dc.id = deck_card_tags.deck_card_id and d.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from deck_cards dc join decks d on d.id = dc.deck_id
    where dc.id = deck_card_tags.deck_card_id and d.user_id = auth.uid()
  ));

-- ── Shared card knowledge base: world-readable, ingest-written ───────────────
alter table cards enable row level security;
drop policy if exists cards_read on cards;
create policy cards_read on cards for select using (true);
-- cache-on-miss write-back from the app (upsert = insert + update on conflict)
drop policy if exists cards_insert on cards;
create policy cards_insert on cards for insert to authenticated with check (true);
drop policy if exists cards_update on cards;
create policy cards_update on cards for update to authenticated using (true) with check (true);

alter table card_tags enable row level security;
drop policy if exists card_tags_read on card_tags;
create policy card_tags_read on card_tags for select using (true);

alter table legend_synergy enable row level security;
drop policy if exists legend_synergy_read on legend_synergy;
create policy legend_synergy_read on legend_synergy for select using (true);

alter table legend_themes enable row level security;
drop policy if exists legend_themes_read on legend_themes;
create policy legend_themes_read on legend_themes for select using (true);

-- brew_stack / tag_stack are security-invoker sql functions: they read the
-- shared tables (world-readable above) and deck_cards (the p_deck_id
-- exclusion now naturally sees only the caller's own rows). No changes.
