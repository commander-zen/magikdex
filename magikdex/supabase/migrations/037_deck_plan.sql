-- 037_deck_plan.sql — the deck's PLAN, as otags, so one input feeds two things
--
-- ✅ APPLIED TO PRODUCTION 2026-08-27. Rehearsed in BEGIN…ROLLBACK first (all
-- four accept/reject behaviours proved against a real deck row), applied
-- single-transaction, then `notify pgrst, 'reload schema'`. Verified after:
-- column present, all 9 deck rows untouched, 0 carry a plan.
--
-- Ben: "i dont have a place to put in the decks plan (the tag that will go below
-- the box. and i guess also inform the plan tag in the WREC scoring. can we kill
-- two birds here?)"
--
-- ── Why otags and not a sentence ─────────────────────────────────────────────
-- A free-text plan ("reanimate a fatty and swing") prints beautifully and can
-- inform NOTHING — there is no way to get from a sentence to "which of my 99
-- cards execute this". Storing the plan as OTAGS makes the same input do both
-- jobs, because card_tags already knows which cards carry which otag:
--
--   the printed card   renders the plan slugs under the ScryCheck tag
--   the WREC band      autoWrecTags maps these otags to 'plan' on matching cards
--
-- The taxonomy has 35 otags; 11 already map to a WREC category (ramp, card
-- advantage, disruption, mass disruption) and the other 24 are unmapped and
-- plan-shaped — reanimate, mill, self-mill, blink, extra-turn, extra-combat,
-- landfall, sacrifice-outlet, burn. Those are the plan vocabulary. No new
-- ingest, no new table: the card→otag rows have been there since 006.
--
-- ── ⚠️ THIS OVERTURNS A STANDING RULE, DELIBERATELY ──────────────────────────
-- deckTags.js says of the WREC plan tag: "it stays at the user's discretion by
-- standing rule, so it can never be auto-applied", and WrecBand.jsx calls plan
-- "user-assigned only, never auto-derived". Ben was shown that this proposal
-- contradicts it and chose it anyway (2026-08-27), so the rule is now narrower
-- rather than absolute:
--
--   plan is never derived from a card's own tags ALONE — the old rule, intact.
--   It IS derived once the DECK'S OWNER has named the plan, which is still the
--   user exercising discretion, just once for the deck instead of 99 times.
--
-- The suggestion is written with source 'auto' (009) exactly like every other
-- auto tag, and applyAutoTags never overwrites a manual row — so a card the
-- user tagged by hand keeps their decision. That is what keeps this a
-- suggestion rather than a seizure.
--
-- If a future session finds those two comments and wants to "restore" the rule:
-- read this block first. It was a decision, not a drift.

alter table public.decks
  add column if not exists self_plan text[];

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.decks'::regclass and conname = 'decks_self_plan_shape'
  ) then
    -- Same shape rules as 036's self_play_style, and the same reason for the
    -- cap: the printed card has ONE ROW for this line. No subquery — a CHECK
    -- cannot contain one, which 036 learned the hard way.
    alter table public.decks add constraint decks_self_plan_shape
      check (
        self_plan is null
        or (
          array_length(self_plan, 1) between 1 and 3
          and array_position(self_plan, null) is null
          and array_position(self_plan, '') is null
          and char_length(array_to_string(self_plan, ' · ')) <= 74
        )
      );
  end if;
end $$;

comment on column public.decks.self_plan is
  'The deck plan as otag slugs (1-3). Printed on the ID card AND used to suggest the WREC plan tag on cards carrying those otags. Slugs are validated by the client against the shared taxonomy, not by a CHECK — the vocabulary lives in scripts/otag-taxonomy.mjs and adding one must not need a migration.';

-- ── Scope ────────────────────────────────────────────────────────────────────
-- One column on public.decks. No new table, no policy, no grant — decks_own
-- (001) is `for all` and column-agnostic. Same footprint as 034 and 036.
--
-- ⚠️ The client must survive this being unapplied: LegendIdentity's DECK_SELECTS
-- ladder (lib/deckSelect.js) gains a rung, so a missing column hides one line
-- instead of blanking the Box's detail pane.
