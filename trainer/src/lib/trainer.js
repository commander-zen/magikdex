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

  // 026's save_connection raises P0002 for BOTH a private trainer and a handle
  // that never existed — identical on purpose, so the API is not an existence
  // oracle. The copy has to stay vague for the same reason: saying "that person
  // is private" would leak exactly what the error code refuses to.
  if (code === "P0002" || /no reachable trainer|no trainer with/i.test(msg)) {
    return "no card found for that handle";
  }
  if (/cannot save yourself/i.test(msg)) return "that's you";
  if (/not permitted/i.test(msg)) return "can't add that trainer";
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

// Credentials for a public card, INDIVIDUALLY. One row per claim, each carrying
// its own issuer, method and date.
//
// There is no aggregate version of this and there must never be one. The database
// has no function that sums or ranks credentials — an earlier draft shipped a
// trust_level() that scored them (venue=4, api=2, self=1), it was removed, and a
// test now fails if anything like it reappears. A graded deck shows its own
// bracket and its own date; it does not contribute to a number.
//
// Expired and revoked credentials are filtered server-side, so anything returned
// here is currently valid.
export async function getPublicCredentials(handle) {
  const { data, error } = await supabase.rpc("get_trainer_credentials", { p_handle: handle });
  return {
    credentials: Array.isArray(data) ? data : [],
    error: describeError(error),
  };
}

// ── The buddy list (migrations 026 + 029) ────────────────────────────────────
// Every call is handle-keyed and goes through a SECURITY DEFINER function. The
// tables are granted to nobody: the social graph is not a public object and
// there is no read path to it other than your own list.
//
// 029 renamed these from connection/roster so the database says what the product
// says. There is no naming split left to remember.
//
// ONE ROW PER PAIR, NEVER AN ENCOUNTER LOG. Re-saving someone UPDATES — it bumps
// last_met_at and the count. It never appends. You can know you have played
// someone six times, first in March and most recently Thursday; you cannot
// recover where either of you was on the nights between, because that was never
// written down.
//
// Nothing here can tell you whether someone saved you back. Mutuality is
// deliberately uncomputable — surfacing it would leak one bit about their list.

export async function myBuddies() {
  const { data, error } = await supabase.rpc("my_buddies");
  return { buddies: Array.isArray(data) ? data : [], error: describeError(error) };
}

// The upsert lives server-side, which is what makes met_count trustworthy: a
// client that could run its own would be able to set the counter to anything,
// and buddy_count publishes it.
//
// 032 widened this: a venue, a DATE (no time of day — the column is `date`, so
// there is nothing finer to send) and in-person/online. metOn is a plain
// "YYYY-MM-DD" string, which is what <input type="date"> already gives us and
// what Postgres wants; building a Date object here would only introduce a
// timezone that then has to be removed again.
//
// Sending null for metOn means "today", decided server-side by current_date.
export async function addBuddy(handle, { venue, metOn, metMode } = {}) {
  const { error } = await supabase.rpc("add_buddy", {
    p_handle: handle,
    p_met_venue: venue?.trim() || null,
    p_source: "manual",
    p_met_on: metOn || null,
    p_met_mode: metMode || "in_person",
  });
  return { error: describeError(error) };
}

export async function setBuddyNote(handle, note) {
  const { error } = await supabase.rpc("set_buddy_note", {
    p_handle: handle, p_note: note?.trim() || null,
  });
  return { error: describeError(error) };
}

export async function removeBuddy(handle) {
  const { error } = await supabase.rpc("remove_buddy", { p_handle: handle });
  return { error: describeError(error) };
}

export async function blockTrainer(handle) {
  const { error } = await supabase.rpc("block_trainer", { p_handle: handle });
  return { error: describeError(error) };
}

// ── Deck grades (migration 030) ──────────────────────────────────────────────
// You grade a deck on ScryCheck, then record the result here yourself. We never
// touch their API — their rating, their site, their scale.
//
// issuer and method are set INSIDE the database function, not passed from here.
// That is the security property: this client cannot mint a verified badge or
// invent a voucher. It only supplies the deck name and the number you saw.
export const SCRYCHECK_URL = "https://scrycheck.com/";
export const MAX_GRADES = 4;
export const DECK_NAME_MAX = 40;
export const RATING_MAX = 12;

export async function addDeckGrade(deck, rating) {
  const { error } = await supabase.rpc("add_deck_grade", { p_deck: deck, p_rating: rating });
  return { error: describeError(error) };
}

// Removal is a REVOCATION, never a delete — the row survives as an audit record
// and stops being current.
export async function revokeDeckGrade(id) {
  const { error } = await supabase.rpc("revoke_deck_grade", { p_id: id });
  return { error: describeError(error) };
}

// The owner's own grades, including ids so they can be revoked. RLS scopes this
// to the caller; the public path (get_trainer_credentials) returns no ids.
export async function myDeckGrades() {
  const { data, error } = await supabase
    .schema("trainer").from("credential")
    .select("id, kind, issuer, method, payload, issued_at")
    .is("revoked_at", null)
    .order("issued_at", { ascending: false });
  return { grades: Array.isArray(data) ? data : [], error: describeError(error) };
}

// 032 renamed met_context to met_venue in the database. The constant follows,
// rather than leaving the client saying "context" about a column called venue —
// that divergence is the tax 029 was written to stop paying.
export const MET_VENUE_MAX = 80;
export const NOTE_MAX = 280;

// ── Where to find you, and whether you're free (migration 032) ───────────────
// THREE FIELDS, THREE DIFFERENT TENSES, and keeping them apart is the design:
//
//   usually_found_at  FORWARD.  "here is where to find me" — profile-level, and
//                               the thing that stops someone dissolving into a
//                               Discord server after one good game.
//   met_venue         BACKWARD. "here is where we crossed paths" — per buddy, a
//                               fact about a night that already happened. It must
//                               not change when they move.
//   ready_to_pod      NOW.      "I'm up for a game."
//
// ready_to_pod IS MANUAL AND NEVER EXPIRES. There is no last-seen, no timeout and
// no background job that clears it, in the client or the database. That is on
// purpose: anything that expires it has to know when you were last active, and
// that is a presence system — the one thing this schema has spent four migrations
// refusing to record. The cost is that a stale flag lies; the answer is making it
// one tap to turn off, which is the toggle in Settings.
export const FOUND_AT_MAX = 80;
export const READY_NOTE_MAX = 60;

export const MET_MODE_CHOICES = [
  ["in_person", "IN PERSON"],
  ["online",    "ONLINE"],
];

// Same CHECK as home_region — see GEO_RE below. Both new location fields carry it
// because a free-text "where am I" column next to a person is the geo backdoor.
export function foundAtProblem(v) {
  if (!v) return null;
  if (v.length > FOUND_AT_MAX) return `${FOUND_AT_MAX} characters max`;
  if (GEO_RE.test(v)) return "no coordinates — use a place or server name";
  return null;
}

export function readyNoteProblem(v) {
  if (!v) return null;
  if (v.length > READY_NOTE_MAX) return `${READY_NOTE_MAX} characters max`;
  if (GEO_RE.test(v)) return "no coordinates — use a place name";
  return null;
}


// ── The three decks + the commander (migration 031) ──────────────────────────
// The card's text box is three decks you CHOSE, not your most recent — a card is
// something you hand a stranger, not a log.
//
// The rating is self-reported and the ScryCheck link sits next to it, so a reader
// verifies in one tap. That is why we neither scrape their page nor call their API.
export const MAX_DECKS = 3;
export const DECK_NAME_LEN = 40;

export async function myDecks(userId) {
  if (!userId) return { decks: [], error: null };
  const { data, error } = await supabase
    .schema("trainer").from("deck")
    .select("*").eq("trainer_id", userId).order("position");
  return { decks: Array.isArray(data) ? data : [], error: describeError(error) };
}

// Upsert on (trainer_id, position) so editing a slot in place does not need to
// know whether a row is already there.
export async function saveDeck(userId, position, patch) {
  const { error } = await supabase
    .schema("trainer").from("deck")
    .upsert({ trainer_id: userId, position, ...patch },
            { onConflict: "trainer_id,position" });
  return { error: describeError(error) };
}

export async function clearDeck(userId, position) {
  const { error } = await supabase
    .schema("trainer").from("deck")
    .delete().eq("trainer_id", userId).eq("position", position);
  return { error: describeError(error) };
}

export async function getPublicDecks(handle) {
  const { data, error } = await supabase.rpc("get_trainer_decks", { p_handle: handle });
  return { decks: Array.isArray(data) ? data : [], error: describeError(error) };
}

// commander_scryfall_id is stored but never returned publicly — the card needs the
// art and the credit, not the identifier.
export async function setCommander(userId, c) {
  return updateMyProfile(userId, {
    commander_scryfall_id: c?.scryfall_id ?? null,
    commander_name:        c?.name ?? null,
    commander_art_url:     c?.art_url ?? null,
    commander_artist:      c?.artist ?? null,
  });
}

// ── Vocabularies ─────────────────────────────────────────────────────────────
// These mirror the CHECK constraints in migration 025. The DATABASE is the
// authority and rejects anything outside them regardless; these exist so the UI
// can offer the right options and cap selections before a round trip.
//
// If this list and the migration ever disagree, the migration wins and this is
// the bug. Adding a value means a new migration, not an edit here — that is
// deliberate, so the vocabulary stays a reviewed decision rather than a typo.
export const PLAYSTYLE_CHOICES = [
  "tokens", "plus_one_counters", "artifacts", "combo", "aggro",
  "lifegain", "spellslinger", "reanimator", "aristocrats", "lands_matter",
  "control", "burn", "equipment", "ramp", "enchantress",
  "voltron", "midrange", "treasure", "mill", "sacrifice",
  "blink", "wheels", "auras", "legends", "discard",
  "stax", "group_hug", "politics", "chaos", "battlecruiser",
];

// No cap on count — a trainer can honestly claim all four.
export const PHILOSOPHY_CHOICES = ["jank", "casual", "trash_magic", "cedh"];

export const MAX_PLAYSTYLE = 3;
export const MAX_LEGENDS = 3;
export const LEGEND_MAX_LEN = 60;
export const BIO_MAX = 280;
export const PRONOUNS_MAX = 30;
export const REGION_MAX = 60;

// Mirrors profile_home_region_not_geo. The column rejects anything shaped like a
// decimal degree, because a free-text "where do you play" field is the one place
// a client could start writing lat/long into a table that also holds a person.
// "St. Louis" and "Route 66" pass; "44.9778, -93.2650" does not.
export const GEO_RE = /[-+]?[0-9]{1,3}\.[0-9]{3,}/;

export function scrycheckProblem(url) {
  const v = (url || "").trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return "needs to start with https://";
  if (!/^https?:\/\/(www\.)?scrycheck\.com\//i.test(v)) return "that isn't a scrycheck.com link";
  return null;
}

export function deckUrlProblem(url) {
  const v = (url || "").trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return "needs to start with https://";
  return null;
}

export function regionProblem(v) {
  if (!v) return null;
  if (v.length > REGION_MAX) return `${REGION_MAX} characters max`;
  if (GEO_RE.test(v)) return "no coordinates — use a place name";
  return null;
}

export const VISIBILITY_CHOICES = [
  // Copy states the CONSEQUENCE, not the setting name. "unlisted" means nothing
  // to someone deciding whether to be findable.
  { value: "private",  label: "PRIVATE",  hint: "nobody can see your card" },
  { value: "unlisted", label: "UNLISTED", hint: "only people you give the handle to" },
  { value: "public",   label: "PUBLIC",   hint: "anyone with your handle" },
];
