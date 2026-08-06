-- 028_claim_requires_real_account.sql — handle claims need a durable account
--
-- NOT APPLIED — written for review. Verified locally against a fresh
-- 001 → 024 → 025 → 026 → 027 replay; see
-- supabase/tests/028_claim_requires_real_account_rls.sql.
--
-- ── The gap this closes ──────────────────────────────────────────────────────
-- ANONYMOUS SESSIONS CARRY THE `authenticated` ROLE. `is_anonymous` is a JWT
-- CLAIM, not a separate Postgres role — which is why `anon` (the unauthenticated
-- role) is refused USAGE on this schema while an anonymous SESSION sails through
-- every policy written `to authenticated`.
--
-- Confirmed against production: with the trainer schema exposed, anon gets
-- `42501 permission denied for schema trainer`, but an anonymous session is a
-- first-class `authenticated` caller.
--
-- 025's profile_insert_own therefore let a browser-only account claim a handle,
-- and TrainerSheet's email gate was the only thing stopping it. A rule that
-- lives in the client is not a rule: anyone can POST to /rest/v1/profile with an
-- anonymous session JWT and skip the UI entirely.
--
-- ── Why that matters more here than usual ────────────────────────────────────
-- 027 reserves a released handle FOREVER so a stranger cannot re-register a name
-- somebody just gave up. Combined with anonymous claims, that becomes a
-- squatting weapon: burn @ben from a throwaway session and the name is
-- permanently unavailable to everyone, including Ben, held by an account nobody
-- can ever sign into.
--
-- The durability argument is the same one behind the deck-backup nudge, with a
-- much worse failure mode. A lost deck is sad. A lost handle is unrecoverable
-- AND blocks the name for every future user.

-- ── The fix ──────────────────────────────────────────────────────────────────
-- Replaces 025's insert policy. `auth.jwt()` returns the verified claims of the
-- current request, so `is_anonymous` is read from a SIGNED token — a client
-- cannot lie about it the way it could about a column value.
--
-- coalesce(..., false) because the claim is ABSENT on older tokens and on
-- non-anonymous sign-ins, and `null = false` is null, which a WITH CHECK treats
-- as a failure. Without the coalesce this policy would reject the very users it
-- is meant to allow.
drop policy if exists profile_insert_own on trainer.profile;
create policy profile_insert_own on trainer.profile
  for insert to authenticated
  with check (
    id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

-- UPDATE is deliberately NOT gated the same way.
--
-- If an anonymous session somehow already owns a profile — claimed before this
-- migration, or created by service_role — locking it out of its own row would
-- mean it could never set its visibility back to private. Being unable to
-- RETRACT is a worse outcome than being able to edit: the claim is the
-- irreversible act, so the claim is what gets gated.
--
-- 025's profile_update_own stands unchanged.

-- ── Known gaps, deliberately left ────────────────────────────────────────────
--
-- 1. This does not retroactively remove handles already claimed by anonymous
--    accounts. Nothing has shipped a claim path to production yet, so the
--    expected count is zero — the test file asserts that rather than assuming
--    it. If any exist later, releasing them is a data decision (and 027's
--    released_from would record the prior owner).
--
-- 2. An email is not verified to be DELIVERABLE, only attached. Supabase's OTP
--    flow means the address was confirmed by a code at link time, so this is
--    stronger than a typed string — but a since-abandoned mailbox still counts.
--
-- 3. The client gate in TrainerSheet stays. It is now redundant for SECURITY and
--    still valuable for UX: it explains WHY up front instead of letting someone
--    fill in a handle and hit a policy error. Redundant guards are fine when the
--    outer one exists to be kind rather than to be trusted.
