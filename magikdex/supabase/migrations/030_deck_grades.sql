-- 030_deck_grades.sql — self-reported ScryCheck ratings, the first real credential
--
-- ✅ APPLIED TO PRODUCTION 2026-08-06 (project iduoct…). Suites run AGAINST
-- PRODUCTION afterwards: 030 11 ok, 025 21 ok (the no-aggregate guard still
-- holds with these functions present).
--
-- The credential table has existed since 025 with NO WRITE PATH: no insert policy,
-- no insert grant, service_role only. That was deliberate — a badge you award
-- yourself is not a badge — but it left the badge case on every card permanently
-- empty, which reads as broken rather than as unearned.
--
-- This opens exactly one door, and narrowly.
--
-- ── The model ────────────────────────────────────────────────────────────────
-- You grade a deck ON SCRYCHECK (https://scrycheck.com/), then record the result
-- here yourself. Magikdex sends them traffic and never touches their API — their
-- rating, their site, their scale.
--
-- THIS IS WHY kind AND method ARE SEPARATE COLUMNS, and 030 is where that pays
-- off. ScryCheck produced the number (kind = scrycheck_rank, issuer =
-- 'ScryCheck'), but nobody verified the user typed it honestly (method =
-- self_reported). Those are two different facts and the card states both.
--
-- The upgrade path is free: if ScryCheck ever offers an API, the same badge
-- becomes api_verified with no schema change and no migration.
--
-- ── The rating is TEXT, not a number ─────────────────────────────────────────
-- ScryCheck's scale belongs to ScryCheck. If it is "7.2" today and "B+" next
-- year, free text survives and a numeric column does not. We store and display
-- what the user was shown, and we do not model somebody else's rubric.
--
-- ⚠️ THE WORD "BRACKET" APPEARS NOWHERE. This product's power vocabulary is jank
-- / casual / trash_magic / cEDH (trainer.profile.philosophy). Brackets are a
-- different framework and naming them here would import it by the back door.

-- Four is the card's budget: the badge case renders a small grid that has to stay
-- readable across a table in bad light, and a scrolling grid is not.
create or replace function public.add_deck_grade(
  p_deck   text,
  p_rating text
)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare
  v_me    uuid := auth.uid();
  v_count int;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from trainer.profile p where p.id = v_me) then
    raise exception 'claim a screen name first' using errcode = 'P0002';
  end if;

  if coalesce(btrim(p_deck), '') = '' then
    raise exception 'name the deck' using errcode = '23514';
  end if;
  if coalesce(btrim(p_rating), '') = '' then
    raise exception 'add the rating' using errcode = '23514';
  end if;
  if char_length(btrim(p_deck)) > 40 then
    raise exception 'deck name is too long for the badge' using errcode = '23514';
  end if;
  if char_length(btrim(p_rating)) > 12 then
    raise exception 'that rating is too long' using errcode = '23514';
  end if;

  select count(*) into v_count
  from trainer.credential c
  where c.trainer_id = v_me
    and c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now());

  if v_count >= 4 then
    raise exception 'the badge case holds four — remove one first' using errcode = '23514';
  end if;

  -- method and issuer are set HERE, not passed in. That is the whole security
  -- property: a client calling this cannot mint a venue_verified badge or claim
  -- an issuer that never vouched for it. The only thing it controls is the deck
  -- name and the number it says it saw.
  insert into trainer.credential
    (trainer_id, kind, issuer, method, payload, issued_at)
  values
    (v_me, 'scrycheck_rank', 'ScryCheck', 'self_reported',
     jsonb_build_object('deck', btrim(p_deck), 'rating', btrim(p_rating)),
     now());
end;
$$;

-- Removal is a REVOCATION, never a delete — credential stays append-only, which
-- is what makes it an audit record rather than a mutable profile field.
--
-- Scoped to method='self_reported' on purpose: a user may retract something they
-- typed. If a venue or an API ever vouches for something, the subject of the
-- claim is not the one who gets to erase it.
create or replace function public.revoke_deck_grade(p_id uuid)
returns void
language plpgsql
security definer
set search_path = trainer, public, extensions
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update trainer.credential c
     set revoked_at = now()
   where c.id = p_id
     and c.trainer_id = v_me
     and c.method = 'self_reported'
     and c.revoked_at is null;
end;
$$;

revoke all on function public.add_deck_grade(text, text) from public;
revoke all on function public.revoke_deck_grade(uuid) from public;
grant execute on function public.add_deck_grade(text, text) to authenticated;
grant execute on function public.revoke_deck_grade(uuid) to authenticated;

-- ── What did NOT change ──────────────────────────────────────────────────────
--
-- 1. trainer.credential still has NO insert/update/delete POLICY and no write
--    GRANT for any client role. Everything above goes through SECURITY DEFINER
--    functions that control what gets written. A client still cannot touch the
--    table directly.
--
-- 2. Credentials are still read INDIVIDUALLY. No function sums, averages or
--    ranks them, and the test suite fails if one appears. Four badges are four
--    facts, not a score out of four.
--
-- 3. lgs_visit and event_finish remain in the enum with no UI. They cost nothing
--    and describe claims a venue could make later.
