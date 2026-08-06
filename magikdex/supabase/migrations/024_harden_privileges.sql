-- 024_harden_privileges.sql — close the three findings from the 001 introspection
--
-- NOT APPLIED — written for review. Verified locally against a fresh
-- 001_baseline replay; see supabase/tests/024_harden_privileges_rls.sql.
--
-- Numbered 024 rather than restarting at 002: the archived migrations still
-- carry 002-023, and reusing a number would make "which 002?" a real question
-- when reading git history. The sequence continues; only the replay path shrank.
--
-- ── The concept this file is built on ────────────────────────────────────────
-- GRANT and POLICY are two DIFFERENT locks and you need both.
--
--   GRANT  is table-level:  may this role touch this table at all?
--   POLICY is row-level:    which rows may it see or change?
--
-- Supabase default-grants everything to anon and authenticated on every new
-- public-schema table. So "RLS on, no policy" does not mean denied — it means
-- "you are allowed in, and zero rows matched." Those look identical right up
-- until the day they don't.
--
-- Two of the three fixes below are GRANT problems, not POLICY problems, and no
-- amount of policy review would have found them. That is the lesson: you cannot
-- reason about safety by reading policies alone.

-- ── Finding 1: any authenticated user could rewrite any cached card ──────────
-- `cards_update` was `for update to authenticated using (true) with check
-- (true)` — no ownership predicate of any kind. Any of the ~85 accounts could
-- overwrite any row in `cards`: names, oracle text, images, legality. Reachable
-- through the REST API with nothing but a signed-in session.
--
-- WHY IT EXISTED: src/lib/scryfall.js writeBackToCache() does a fire-and-forget
-- upsert so the next lookup of a name is instant.
--
-- WHY REMOVING THE UPDATE HALF COSTS NOTHING: write-back only runs on a cache
-- MISS. If a card is already cached the read path finds it and never writes, so
-- the DO UPDATE branch is only reachable in a race between two clients caching
-- the same new card at the same moment — and that call already swallows its
-- errors by design. The file says so out loud: "If anon writes are blocked by
-- RLS this simply no-ops."
--
-- Net effect: cold cache fills still work, existing rows become immutable to
-- clients, and `npm run ingest:cards` (service key) stays the refresh path.
drop policy if exists cards_update on public.cards;

-- Defence in depth: revoke the PRIVILEGE as well as withholding the policy.
-- With the grant left in place, an UPDATE would return "0 rows affected"; with
-- it revoked, the same statement is refused outright with SQLSTATE 42501. The
-- second is the honest answer and the one worth asserting on in a test.
revoke update, delete on table public.cards from anon, authenticated;

-- cards_insert stays. It is what makes the cache fill.
--
-- ⚠️ RESIDUAL RISK, deliberately accepted here and worth naming: insert-only
-- still lets a signed-in user create a row for an oracle_id that is not cached
-- yet, with fabricated contents, which then serves to everyone until the next
-- bulk ingest overwrites it. That is a smaller hole than "overwrite Sol Ring"
-- but it is not zero.
--
-- The real fix is a SECURITY DEFINER RPC that takes an oracle_id, fetches from
-- Scryfall server-side, and writes the result — so the client never supplies
-- card content at all. That touches client code, so it is out of scope for a
-- database migration and belongs in its own ticket.

-- ── Finding 2: TRUNCATE was granted to anon, and RLS does not mediate it ─────
-- This is the pure GRANT problem, and the reason this file exists.
--
-- Row level security applies to SELECT, INSERT, UPDATE and DELETE. TRUNCATE is
-- checked against table privileges ONLY. So every policy in 001_baseline stood
-- between anon and the rows, and none of them stood between anon and TRUNCATE.
--
-- It was not exploitable: PostgREST exposes no TRUNCATE verb and the only RPCs
-- on this project are brew_stack and tag_stack. It was a loaded gun with no
-- trigger attached — and the trigger would have been any future SECURITY
-- DEFINER function that takes caller-supplied SQL.
--
-- TRIGGER is revoked for the same reason: it lets a role attach a trigger to a
-- table, which is another privilege RLS has no opinion about.
revoke truncate, trigger on all tables in schema public from anon, authenticated;

-- And stop handing them out to tables created from here on. Without this, the
-- next `create table` in the public schema silently re-grants both.
alter default privileges in schema public
  revoke truncate, trigger on tables from anon, authenticated;

-- ── Finding 3: neither RPC pinned its search_path ────────────────────────────
-- brew_stack and tag_stack read cards, card_tags, legend_themes, legend_synergy
-- and deck_cards with no schema qualification and no pinned search_path.
--
-- Harmless while they are SECURITY INVOKER: redirecting the search_path only
-- points a caller at tables they already have their own privileges on, so they
-- gain nothing.
--
-- It becomes a real vulnerability the moment either is made SECURITY DEFINER —
-- a one-word edit somebody could plausibly make to "fix" a permissions problem.
-- At that point an unqualified reference under an attacker-controlled
-- search_path executes with the definer's privileges against the attacker's
-- tables.
--
-- ALTER FUNCTION ... SET rather than CREATE OR REPLACE on purpose: the bodies do
-- not change, and re-pasting 60 lines of query to add one setting is how you
-- introduce a typo into working code. The trainer migrations already pin
-- search_path on every definer function; these two predate that habit.
alter function public.brew_stack(text, text[], uuid, boolean, integer)
  set search_path = public, extensions;
alter function public.tag_stack(text[], text[], uuid, boolean, integer)
  set search_path = public, extensions;

-- ── Not changed, and why ─────────────────────────────────────────────────────
--
-- 1. `cards_read` / `card_tags_read` / `legend_synergy_read` / `legend_themes_read`
--    stay world-readable. That is the shared card knowledge base — not user
--    data, expensive to rebuild, and every client needs it. Public read is the
--    intended design, not an oversight.
--
-- 2. `insert` on the other knowledge-base tables (card_tags, legend_synergy,
--    legend_themes) is left alone. Nothing in the client writes to them — only
--    the service-key ingest scripts do — so the same insert-only reasoning does
--    not apply and there is no feature to preserve. Revoking client writes there
--    is a reasonable follow-up, but it is a different question from finding 1
--    and lumping it in would make this migration's test story muddier.
--
-- 3. The `decks` / `legends` / `deck_cards` / `deck_card_tags` ownership
--    policies are correct as they stand and are not touched.
