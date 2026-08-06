import { supabase } from "./supabase.js";

// Trainer identity — the player-facing half of the `trainer` schema (025).
//
// Two different doors into the same data, and which one you use is not a style
// choice:
//
//   OWNER reads/writes go through supabase.schema("trainer").from("profile").
//     Requires `trainer` in the project's Exposed Schemas (API settings).
//     Row-level security scopes every row to auth.uid().
//
//   PUBLIC reads go through public.get_trainer_card(handle) — an RPC, not a
//     table. There is deliberately NO view over profiles, so a public card can
//     only be resolved by someone who already knows the handle. Nothing is
//     enumerable, and no uuid is ever published.
//
// Never add a "list all trainers" call here. That surface does not exist in the
// database on purpose, and adding it is a migration plus a privacy decision, not
// a client convenience.

// Mirrors the trainer_handle_shape CHECK in 025 exactly. Duplicated on purpose:
// the database is the authority and rejects anything invalid regardless, but a
// client-side check turns a round-trip error into instant feedback while typing.
// If these ever disagree, the database wins and this is the bug.
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeHandle(raw) {
  // Force lowercase rather than validating case: the column is citext so @Ben
  // and @ben collide anyway, and the shape CHECK is case-SENSITIVE (it casts to
  // text), so 'Ben' would be rejected outright. Silently lowercasing is kinder
  // than an error about a distinction the user cannot see.
  return (raw || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

export function handleProblem(handle) {
  if (!handle) return "pick a handle";
  if (handle.length < 3) return "at least 3 characters";
  if (!HANDLE_RE.test(handle)) return "letters, numbers and _ only";
  return null;
}

// PostgREST hands back the Postgres SQLSTATE, so the database's own constraints
// are what produce these. Translating them here keeps the copy human without
// duplicating the RULES — the rules live in the migration.
function describeError(error) {
  if (!error) return null;
  const code = error.code || "";
  const msg = error.message || "";

  // Both of the next two are SETUP states, not code bugs, and both were checked
  // against the live API rather than guessed — PostgREST's raw text for them is
  // useless to a user ("...in the schema cache").
  //
  // PGRST106: the trainer schema isn't in Exposed Schemas. Real response is
  // {"code":"PGRST106","message":"Invalid schema: trainer"}.
  if (code === "PGRST106" || /invalid schema/i.test(msg)) {
    return "trainer isn't switched on for this project yet — add `trainer` to Exposed Schemas in the Supabase API settings";
  }
  // PGRST202: the RPC doesn't exist, which means migration 025 hasn't been
  // applied. Distinct from PGRST106 and a different fix, so it gets its own copy.
  if (code === "PGRST202") {
    return "trainer isn't installed on this project yet — apply migration 025";
  }
  // unique_violation on trainer.profile.handle
  if (code === "23505") return "that handle is taken";
  // The reserved-handle trigger raises check_violation. Its message names the
  // handle, so match on the word rather than the code — 23514 is also every
  // other CHECK on the table.
  if (/reserved/i.test(msg)) return "that handle is reserved";
  if (/one change per 30 days/i.test(msg)) return msg.replace(/^.*?handle/, "handle");
  if (code === "23514") return "that doesn't fit — check the handle and name";
  // No profile row and no INSERT permission means the account isn't allowed to
  // create one (service-role-only mode).
  if (code === "42501") return "not allowed — is this account signed in?";
  return msg || "something went wrong";
}

// The signed-in account, plus whether it is anonymous.
//
// WHY is_anonymous MATTERS HERE: every visitor gets an anonymous account on
// first load (App.jsx), and those live only in this browser's storage. A handle
// is a PUBLIC, PERMANENT identity — and 027 reserves a released handle forever
// so it cannot be re-registered by a stranger. Claiming one from a browser-only
// account means that if the browser is cleared, the handle is consumed by an
// account nobody can ever sign into again. So claiming requires a linked email.
export async function getTrainerAccount() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user ?? null;
  return {
    userId: user?.id ?? null,
    email: user?.email || null,
    // Supabase sets is_anonymous on the user. Fall back to "no email means
    // anonymous" so a client on an older auth version still gates correctly
    // rather than failing open.
    isAnonymous: user ? (user.is_anonymous ?? !user.email) : true,
  };
}

// The caller's own profile, or null if they haven't claimed a handle.
// RLS restricts this to their own row, so no filter is needed — but one is here
// anyway, because relying on an invisible policy for correctness makes the query
// impossible to read.
export async function getMyProfile(userId) {
  if (!userId) return { profile: null, error: null };
  const { data, error } = await supabase
    .schema("trainer")
    .from("profile")
    .select("id, handle, display_name, pronouns, bio, home_region, visibility, identity_mode, playstyle, favorite_legends, philosophy, created_at, handle_changed_at")
    .eq("id", userId)
    .maybeSingle();
  return { profile: data ?? null, error: describeError(error) };
}

// Claim a handle. The row id IS auth.users.id — that is what the INSERT policy
// checks (with check (id = auth.uid())), so it must be sent explicitly.
export async function claimHandle(userId, handle, displayName) {
  const { data, error } = await supabase
    .schema("trainer")
    .from("profile")
    .insert({
      id: userId,
      handle,
      display_name: (displayName || "").trim() || handle,
    })
    .select()
    .maybeSingle();
  return { profile: data ?? null, error: describeError(error) };
}

export async function updateMyProfile(userId, patch) {
  const { data, error } = await supabase
    .schema("trainer")
    .from("profile")
    .update(patch)
    .eq("id", userId)
    .select()
    .maybeSingle();
  return { profile: data ?? null, error: describeError(error) };
}

// The public card, exactly as a stranger holding the handle would see it.
// Used to show the owner their own card as others see it — which is the only
// honest way to render a privacy setting.
export async function getPublicCard(handle) {
  const { data, error } = await supabase.rpc("get_trainer_card", { p_handle: handle });
  // returns table(...) → an array. At most one row, since handle is unique.
  return { card: Array.isArray(data) ? data[0] ?? null : data ?? null, error: describeError(error) };
}

export const VISIBILITY_CHOICES = [
  // Copy states the CONSEQUENCE, not the setting name. "unlisted" means nothing
  // to someone deciding whether to be findable.
  { value: "private",  label: "PRIVATE",  hint: "nobody can see your card" },
  { value: "unlisted", label: "UNLISTED", hint: "only people you give the handle to" },
  { value: "public",   label: "PUBLIC",   hint: "anyone with your handle" },
];
