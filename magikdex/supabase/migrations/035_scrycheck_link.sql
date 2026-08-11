-- 035_scrycheck_link.sql — the link between magikdex and ScryCheck
--
-- ⚠️ NOT YET APPLIED TO PRODUCTION.
--
-- Ben: "i want a link between magikdex and scrycheck so they have a one tap
-- grade. and it links to scrycheck and gives credit and all that good stuff."
--
-- 034 gave the five vectors somewhere to live when a human TYPES them. This
-- migration is what lets the app FETCH them instead, and — the part Ben cares
-- most about — what lets a tap on the radar land the user on their own graded
-- deck page at scrycheck.com.
--
-- ── The one fact that made this migration necessary ──────────────────────────
-- ScryCheck's API analyses a deck from a PUBLIC MOXFIELD OR ARCHIDEKT URL. It
-- does not accept a card list (verified against the live endpoint and against
-- pod-check's proxy: the body is `{ url }`, host-bounded to those two domains).
--
-- AND MAGIKDEX WAS STORING NO SUCH URL. `decks.url` and `decks.platform` have
-- existed since before 001 and NOTHING has ever written them — the importer
-- fetches the URL through /api/deck, parses the cards out of it, and drops the
-- URL on the floor. Confirmed against production: zero rows with a non-null url.
--
-- So there was no link to follow, in either direction. This migration does not
-- add those two columns — they are already there — it puts them to work and
-- adds the four that hold what ScryCheck sends back.

-- ── What comes back from /api/v1/analyze ─────────────────────────────────────
-- Verified against the live endpoint on 2026-08-10.
--
--   scrycheck_url      data.deckUrl — the permanent, PUBLICLY VIEWABLE page of
--                      the finished analysis (e.g. .../deck/6d451f3d168b6b20).
--                      THIS IS THE TAP TARGET. Confirmed stable: the value the
--                      API returned matches the one stored months earlier in
--                      trainer.deck.scrycheck_url for the same deck.
--   scrycheck_score    data.powerLevel.level — the OVERALL 1–10 rating ("9.7").
--                      ⚠️ REUSES THE EXISTING COLUMN, which has been dead since
--                      before 001. It is text, and 030 explains why a rating
--                      that mirrors somebody else's rubric stays text. This is
--                      the sibling of the five vectors, NOT a sixth vector —
--                      never plot it on the radar.
--   scrycheck_bracket  data.bracket.number — the Commander bracket, 1–5.
--   scrycheck_version  data.scoringVersion — see below, this one earns its keep.
--   scrycheck_scored_at when the analysis ran.
--
-- ── WHY scoring_version IS NOT OPTIONAL ──────────────────────────────────────
-- ScryCheck re-scores. Observed directly on the deck page during verification:
-- a vector moved `Efficiency 88 → 87` between scoring versions. So a cached
-- score is only meaningful ALONGSIDE the version that produced it — without
-- this column the Box would confidently show a number the site no longer
-- agrees with, and nothing would ever reveal the drift.
--
-- Caching at all is a REQUIREMENT, not an optimisation: the key is a private
-- beta courtesy, and pod-check's own HARDENING.md H1 puts it plainly — the risk
-- of hammering it is "ScryCheck revoking your private-beta key or the
-- relationship". These columns ARE the cache. One analysis per deck, re-run
-- only when the user asks or the version moves.

alter table public.decks
  add column if not exists scrycheck_url       text,
  add column if not exists scrycheck_bracket   smallint,
  add column if not exists scrycheck_version   text,
  add column if not exists scrycheck_scored_at timestamptz;

-- The link has to actually point at ScryCheck. Same reasoning as 031's
-- constraint on trainer.deck.scrycheck_url: this value is rendered as a
-- credited link to a named third party, so a row that says "ScryCheck" while
-- pointing somewhere else is a lie the UI would tell on our behalf.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.decks'::regclass and conname = 'decks_scrycheck_url_host'
  ) then
    alter table public.decks add constraint decks_scrycheck_url_host
      check (scrycheck_url is null or scrycheck_url ~* '^https://(www\.)?scrycheck\.com/');
  end if;
end $$;

-- Brackets are 1–5 (B1 Casual … B5 cEDH). Bounded for the same reason 034's
-- vectors are: the client is one refactor away from writing something else.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.decks'::regclass and conname = 'decks_scrycheck_bracket_range'
  ) then
    alter table public.decks add constraint decks_scrycheck_bracket_range
      check (scrycheck_bracket is null or (scrycheck_bracket between 1 and 5));
  end if;
end $$;

-- ── The source URL: existing columns, finally written ────────────────────────
-- `platform` already carries a check constraint from 001 limiting it to
-- 'moxfield' | 'archidekt' — which happens to be EXACTLY the set ScryCheck
-- accepts. Nothing to change; the constraint was waiting for a writer.
--
-- No constraint is added tying `url` to those hosts. The importer validates it
-- (parseDeckUrl in api/deck.js), and a stricter rule here would reject the
-- legitimate case of a user recording a deck that lives somewhere else.

comment on column public.decks.url is
  'Source deck URL (Moxfield/Archidekt). Written on import from 035 onward; also what ScryCheck analysis is run against.';
comment on column public.decks.scrycheck_url is
  'Permanent public ScryCheck analysis page for this deck. The tap-through target on the Box radar.';
comment on column public.decks.scrycheck_score is
  'ScryCheck OVERALL power level, 1-10 one decimal (e.g. 9.7). Sibling of the five vectors, never a sixth vector.';
comment on column public.decks.scrycheck_bracket is
  'ScryCheck Commander bracket, 1-5 (B1 Casual through B5 cEDH).';
comment on column public.decks.scrycheck_version is
  'ScryCheck scoringVersion that produced the stored scores. A cached score is only valid for its version.';
comment on column public.decks.scrycheck_scored_at is
  'When the stored ScryCheck analysis was fetched.';

-- ── Still no policy, still no grant ──────────────────────────────────────────
-- decks_own (001) is `for all` and column-agnostic, so ownership already covers
-- every column added here, and 024 left privileges at table level. The writes
-- land through the client's own authenticated session, exactly as 034's do.
--
-- ⚠️ THE API KEY NEVER TOUCHES THE DATABASE OR THE CLIENT. It lives in Vercel
-- env as SCRYCHECK_API_KEY and is read only by api/scrycheck.js, server-side.
-- ScryCheck's terms forbid browser-side calls and committing the key.
