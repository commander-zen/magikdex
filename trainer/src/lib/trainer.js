import { supabase } from "./supabase.js";

// Data layer for the Trainer app.
//
// Two doors, and which one you use is not a style choice:
//
//   PUBLIC reads → public.get_trainer_card(handle), an RPC. There is deliberately
//     NO view over profiles, so a card can only be resolved by someone who already
//     knows the handle. Nothing is enumerable and no uuid is ever published.
//
//   OWNER reads/writes → supabase.schema("trainer").from("profile"), scoped to
//     auth.uid() by row-level security.
//
// NEVER add a "list all trainers" call. That surface does not exist in the
// database on purpose; adding it is a migration plus a privacy decision, not a
// client convenience.

// Mirrors the profile_handle_shape CHECK in migration 025 exactly. The database
// is the authority and rejects anything invalid regardless — this only exists to
// turn a round-trip into instant feedback. If they ever disagree, the database
// wins and this is the bug.
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeHandle(raw) {
  // Lowercase rather than validate case: the column is citext so @Ben and @ben
  // collide anyway, and the shape CHECK is case-SENSITIVE (it casts to text), so
  // 'Ben' would be rejected outright. Silently lowercasing is kinder than an
  // error about a distinction the user cannot see.
  return (raw || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

export function handleProblem(h) {
  if (!h) return "pick a handle";
  if (h.length < 3) return "at least 3 characters";
  if (!HANDLE_RE.test(h)) return "letters, numbers and _ only";
  return null;
}

// PostgREST returns the Postgres SQLSTATE, so the database's own constraints
// produce these. Translating here keeps the copy human without duplicating the
// RULES — those live in the migrations.
function describeError(error) {
  if (!error) return null;
  const code = error.code || "";
  const msg = error.message || "";

  // Setup states. Both were checked against the live API rather than guessed,
  // because PostgREST's raw text for them is useless to a user.
  if (code === "PGRST106" || /invalid schema/i.test(msg)) {
    return "the trainer schema isn't exposed on this project — add it in Supabase API settings";
  }
  if (code === "PGRST202") return "the trainer functions aren't installed — apply migration 025";
  if (code === "42703" || code === "PGRST204" || /column .* does not exist/i.test(msg)) {
    return "the database is behind this app — a trainer migration hasn't been applied";
  }

  if (code === "23505") return "that handle is taken";
  // The reserved-handle trigger raises check_violation and names the handle, so
  // match the word rather than the code — 23514 is also every other CHECK.
  if (/reserved/i.test(msg)) return "that handle is reserved";
  if (/one change per 30 days/i.test(msg)) return "you can only change your handle once every 30 days";
  if (code === "23514") return "that doesn't fit — check the handle and name";
  // 028: the insert policy requires a non-anonymous session.
  if (code === "42501") return "you need to be signed in with an email to claim a handle";
  return msg || "something went wrong";
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user ?? null;
  return { userId: user?.id ?? null, email: user?.email || null };
}

// The caller's own profile, or null if they haven't claimed a handle.
//
// `*` on purpose. An explicit column list couples this file to WHICH MIGRATIONS
// ARE APPLIED — naming handle_changed_at (added by 027) once made the entire read
// fail with 42703 against a project that only had 025, and the claim form
// rendered a database error it had nothing to do with.
//
// Safe here specifically because this reads ONE row, the caller's own, enforced
// by RLS and by the filter. NOT a pattern for public reads: get_trainer_card's
// column list IS the privacy boundary and stays explicit.
export async function getMyProfile(userId) {
  if (!userId) return { profile: null, error: null };
  const { data, error } = await supabase
    .schema("trainer").from("profile")
    .select("*").eq("id", userId).maybeSingle();
  return { profile: data ?? null, error: describeError(error) };
}

// The row id IS auth.users.id — that is what the INSERT policy checks
// (with check (id = auth.uid())), so it has to be sent explicitly.
export async function claimHandle(userId, handle, displayName) {
  const { data, error } = await supabase
    .schema("trainer").from("profile")
    .insert({ id: userId, handle, display_name: (displayName || "").trim() || handle })
    .select().maybeSingle();
  return { profile: data ?? null, error: describeError(error) };
}

export async function updateMyProfile(userId, patch) {
  const { data, error } = await supabase
    .schema("trainer").from("profile")
    .update(patch).eq("id", userId).select().maybeSingle();
  return { profile: data ?? null, error: describeError(error) };
}

// Exactly what a stranger holding the handle gets. Used both for /t/<handle> and
// for the owner's own "check it" — showing a privacy setting any other way is a
// promise rather than a verification.
export async function getPublicCard(handle) {
  const { data, error } = await supabase.rpc("get_trainer_card", { p_handle: handle });
  return {
    card: Array.isArray(data) ? data[0] ?? null : data ?? null,
    error: describeError(error),
  };
}

export const VISIBILITY_CHOICES = [
  // Copy states the CONSEQUENCE, not the setting name. "unlisted" means nothing
  // to someone deciding whether to be findable.
  { value: "private",  label: "PRIVATE",  hint: "nobody can see your card" },
  { value: "unlisted", label: "UNLISTED", hint: "only people you give the handle to" },
  { value: "public",   label: "PUBLIC",   hint: "anyone with your handle" },
];
