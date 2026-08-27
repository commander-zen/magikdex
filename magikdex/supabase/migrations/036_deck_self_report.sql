-- 036_deck_self_report.sql — how YOU describe the deck, next to how ScryCheck scores it
--
-- ⚠️ NOT YET APPLIED TO PRODUCTION.
--
-- Ben, looking at the printed Legend ID card: "below the box is the users self
-- report (jank or casual or trash magic or cEDH and then what the playstyle is
-- be it graveyard or tokens or counters)".
--
-- ── The card has two halves and this is the missing one ──────────────────────
-- The yellow tag is ScryCheck's reading: a power level and a bracket, computed
-- by somebody else from the decklist. Directly beneath it belongs YOUR reading:
-- the register you actually play the deck in, and what it does. Those are
-- different kinds of claim and the card keeps them visibly apart — an analysis
-- you can verify by tapping the QR, and an opinion its owner is standing behind.
--
-- Until now that slot printed the commander's name, which is already the largest
-- thing on the Box behind it. It said nothing the card did not already say.
--
-- ── Why not derive it ────────────────────────────────────────────────────────
-- magikdex has two taxonomies that LOOK like they could answer this and cannot.
-- WREC (006) measures functional coverage — ramp, card advantage, disruption —
-- which is a different question. legend_themes is EDHREC's aggregate view of the
-- COMMANDER, not of your build; two Meren decks with opposite gameplans share
-- every theme. A self-report is the only honest source for "how do I play this",
-- which is also exactly what 030 and 034 concluded about the ScryCheck numbers.

-- ── game style: the register ─────────────────────────────────────────────────
-- The same four values as trainer.profile.philosophy (025). Kept as a single
-- value, not an array: a deck is played in ONE register on a given night, even
-- though a person can honestly claim all four across their whole collection.
-- That asymmetry is the reason this is not just a copy of the profile column.
--
-- 'trash_magic' is stored snake_case and rendered "trash magic"; 'cedh' renders
-- "cEDH". Neither transform is derivable from the stored value, so the client
-- owns a small label map — same as trainer.js already does.
alter table public.decks
  add column if not exists self_game_style text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.decks'::regclass and conname = 'decks_self_game_style_valid'
  ) then
    alter table public.decks add constraint decks_self_game_style_valid
      check (self_game_style is null
             or self_game_style in ('jank', 'casual', 'trash_magic', 'cedh'));
  end if;
end $$;

-- ── play style: what the deck DOES ───────────────────────────────────────────
-- An array, because "graveyard // combo" is one deck and forcing a single value
-- would make people pick a half-truth. Capped at three: the card gives this line
-- one row at 32px across a 540px column, and a fourth entry does not fit — the
-- constraint is the layout, so the database enforces the layout's limit rather
-- than letting the client truncate silently at print time.
--
-- FREE TEXT, deliberately NOT an enum. The vocabulary of Commander playstyles is
-- not ours to close — 'lands matter' and 'chair tribal' are both real answers —
-- and an enum here would mean a migration every time somebody names a deck
-- honestly. The CHECK bounds the SHAPE (count and length) and nothing else.
--
-- ⚠️ NOT SORTABLE, NOT RANKABLE. This is a label on your own card. There is no
-- function that counts these across decks and there must not be one: the moment
-- it can answer "what is the most popular playstyle" it has become the aggregate
-- that 030 removed a trust_level() to avoid.
alter table public.decks
  add column if not exists self_play_style text[];

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.decks'::regclass and conname = 'decks_self_play_style_shape'
  ) then
    alter table public.decks add constraint decks_self_play_style_shape
      check (
        self_play_style is null
        or (
          array_length(self_play_style, 1) between 1 and 3
          and array_length(self_play_style, 1) = (
            select count(*) from unnest(self_play_style) v
            where v is not null and char_length(btrim(v)) between 1 and 24
          )
        )
      );
  end if;
end $$;

comment on column public.decks.self_game_style is
  'Self-reported register: jank | casual | trash_magic | cedh. One value — a deck is played in one register.';
comment on column public.decks.self_play_style is
  'Self-reported playstyle labels, 1-3 entries, <=24 chars each. Free text on purpose; never aggregated or ranked.';

-- ── Scope ────────────────────────────────────────────────────────────────────
-- Two columns on public.decks. No new table, no policy, no grant: decks_own
-- (001) is `for all` and column-agnostic, so ownership already covers these, and
-- 024 left privileges at table level. Same footprint as 034.
--
-- ⚠️ THE CLIENT MUST SURVIVE THIS BEING UNAPPLIED. Ben applies migrations by
-- hand, so a deployed build can be ahead of the database, and naming a missing
-- column fails the WHOLE select — which would blank the Box's detail pane for
-- every deck rather than just hiding one line. LegendIdentity's DECK_SELECTS
-- ladder gains a rung for this; do not collapse it.
