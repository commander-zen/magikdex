-- 034_scrycheck_vectors.sql — the five self-reported ScryCheck vectors
--
-- ✅ APPLIED TO PRODUCTION 2026-08-10 (project iduoct…). Suites run AGAINST
-- PRODUCTION afterwards: 034 13 ok, plus 030 (11 ok) and 031 (10 ok) re-checked
-- for regressions. Locally: `bash supabase/local/run-tests.sh 034`.
--
-- ── What this is, and what it is NOT ─────────────────────────────────────────
-- ScryCheck (https://scrycheck.com/, creator Adam) grades a Commander deck on
-- FIVE VECTORS — Speed, Consistency, Interaction, Mana base, Threats — and
-- separately gives an overall power level. Adam has approved Magikdex showing
-- those numbers on a SELF-REPORT basis with attribution and a link back.
--
-- Self-report is the whole model TODAY, exactly as 030 established for the
-- overall rating: you grade the deck on ScryCheck, then type what you were
-- shown. This migration's client never calls an API and never scrapes.
--
-- ⚠️ CORRECTION, same day: ScryCheck DOES have an API — a PRIVATE BETA, which
-- Ben has a key for and which `~/repos/pod-check` already calls
-- (`/api/v1/analyze`, server-side proxy, deck URL in). It is absent from their
-- public docs, which is why the first pass here concluded there wasn't one.
-- THESE COLUMNS DO NOT CHANGE when that lands — only the provenance of the
-- numbers does, and 030 already separated `kind` from `method` so a score can
-- move self_reported → api_verified with no schema change and no migration.
--
-- THIS IS NOT WREC. WREC (public.deck_card_tags, migration 006) measures
-- FUNCTIONAL COVERAGE — does this deck have enough ramp, card advantage,
-- disruption, mass disruption, and a plan. ScryCheck measures POWER LEVEL. The
-- two are orthogonal: a cEDH combo deck can be a 9 on ScryCheck while reading as
-- a disaster on WREC, and that is a true description of it, not a contradiction.
-- They are stored apart and rendered apart on purpose. Do not let a future
-- migration fold them into one score.
--
-- ── The scale is 0–100, NOT 0–10 ─────────────────────────────────────────────
-- Verified against https://scrycheck.com/docs rather than inferred, because the
-- two numbers ScryCheck publishes are easy to confuse:
--
--   * OVERALL POWER LEVEL — 1 to 10 with one decimal ("9.7"), jank at 1 through
--     cEDH at 10. THIS IS THE NUMBER ALREADY STORED, as free text, in
--     trainer.deck.rating (031) and in trainer.credential payloads (030).
--     A `9.7` seen in the wild is one of THESE.
--   * THE FIVE VECTORS — each "normalized to 0–100, where 100 represents a
--     ceiling that only the most optimized decks approach". Their published
--     bands: 85–100 exceptional, 65–84 strong, 45–64 moderate, 25–44 weak,
--     0–24 critical gap.
--
-- The radar plots the VECTORS, so the domain here is 0–100 and the constraint
-- says so. Writing 0–10 would have silently squashed every deck into the bottom
-- tenth of the chart and looked plausible while doing it.
--
-- WHY A CONSTRAINT AND NOT A COMMENT. The client is the only writer today, and a
-- client is one refactor away from sending an unclamped number. A range that
-- lives in the schema is enforced for every writer that will ever exist,
-- including a psql session. (Contrast trainer.deck.rating, which is TEXT
-- precisely because it mirrors ScryCheck's OVERALL rubric and that rubric may
-- restyle itself. The vectors are different: 0–100 is a normalisation, not a
-- notation, and a normalisation that changes is a different measurement.)
--
-- ── Nullable, all five, independently ────────────────────────────────────────
-- Null means "not graded", which is the state of every deck the moment this
-- lands and the honest state of most decks forever. It is NOT zero — zero is a
-- real ScryCheck reading meaning "virtually absent", and a chart that draws an
-- ungraded deck as five zeros would be asserting something false about it.
-- The radar renders only when all five are present; see the client.
--
-- ── Scope ────────────────────────────────────────────────────────────────────
-- Five columns on public.decks. Nothing else. No new table, no policy, no grant:
-- decks_own (001) is `for all` and column-agnostic, so ownership already covers
-- these, and 024 left privileges at table level. The trainer schema, the Pod
-- Check schema, and every WREC column are untouched.

alter table public.decks
  add column if not exists scrycheck_speed       smallint,
  add column if not exists scrycheck_consistency smallint,
  add column if not exists scrycheck_interaction smallint,
  add column if not exists scrycheck_mana_base   smallint,
  add column if not exists scrycheck_threats     smallint;

-- One constraint per column rather than one compound check: a compound check
-- reports the whole tuple as the violation and tells the user nothing about
-- WHICH field they fat-fingered. Five named constraints name the field.
--
-- `not valid` is deliberately NOT used — the table has no pre-existing values in
-- these columns to grandfather, so the check can be validated immediately.
do $$
declare
  v_col text;
begin
  foreach v_col in array array[
    'scrycheck_speed', 'scrycheck_consistency', 'scrycheck_interaction',
    'scrycheck_mana_base', 'scrycheck_threats'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.decks'::regclass
        and conname  = 'decks_' || v_col || '_range'
    ) then
      execute format(
        'alter table public.decks add constraint %I check (%I is null or (%I between 0 and 100))',
        'decks_' || v_col || '_range', v_col, v_col
      );
    end if;
  end loop;
end $$;

comment on column public.decks.scrycheck_speed is
  'Self-reported ScryCheck vector, 0-100: mana acceleration and development pace.';
comment on column public.decks.scrycheck_consistency is
  'Self-reported ScryCheck vector, 0-100: tutors and draw engine reliability.';
comment on column public.decks.scrycheck_interaction is
  'Self-reported ScryCheck vector, 0-100: disruption and protection capability.';
comment on column public.decks.scrycheck_mana_base is
  'Self-reported ScryCheck vector, 0-100: land quality and colour fixing.';
comment on column public.decks.scrycheck_threats is
  'Self-reported ScryCheck vector, 0-100: win conditions and combo potential.';

-- ── A note on public.decks.scrycheck_score ───────────────────────────────────
-- That column has existed since before 001 and is READ AND WRITTEN BY NOTHING in
-- the client (verified by search across magikdex/src). It presumably held the
-- overall power level for whatever predated the current app. It is left exactly
-- as it is: dropping a column nobody reads is still a destructive change to
-- production data, and it is not what this migration is for. If it is ever
-- revived it is the OVERALL rating, a sibling of these five and not a sixth
-- vector — do not plot it on the radar.
