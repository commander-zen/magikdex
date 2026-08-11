import { supabase } from "./supabase.js";
import { SCRYCHECK_VECTORS } from "../components/ScryCheckRadar.jsx";

// The magikdex ↔ ScryCheck link, client half.
//
// Ben: "i want a link between magikdex and scrycheck so they have a one tap
// grade. and it links to scrycheck and gives credit and all that good stuff."
//
// One tap = this function. It sends the deck's PUBLIC SOURCE URL to our own
// server-side proxy (api/scrycheck.js — the API key never comes near the
// browser), then writes everything back onto the decks row so the radar fills
// in and the tap-through link exists.
//
// ⚠️ ScryCheck analyses a deck from a Moxfield/Archidekt URL. It does NOT take a
// card list. So a deck that only exists inside magikdex cannot be graded this
// way, and that is not a bug to route around — it is why the self-report sheet
// exists alongside this.

// Same rule lib/moxfieldImport.js uses for /api/deck: the Vite dev server and
// the Capacitor shell aren't the Vercel origin and have no serverless runtime
// of their own, so they call the deployed function absolutely. On the deployed
// site it's same-origin. (Deliberately NOT import.meta.env.DEV — a production
// Capacitor build is not "dev" but is still off-origin.)
const API_BASE =
  typeof window !== "undefined" && /\.vercel\.app$/.test(window.location.hostname)
    ? ""
    : "https://magikdex.vercel.app";

export function isSupportedDeckUrl(raw) {
  try {
    const host = new URL(String(raw).trim()).hostname.replace(/^www\./, "").toLowerCase();
    return host === "moxfield.com" || host === "archidekt.com";
  } catch {
    return false;
  }
}

// Which provider a URL belongs to, for public.decks.platform (001 constrains
// that column to exactly these two — the same pair ScryCheck accepts).
export function platformOf(raw) {
  try {
    const host = new URL(String(raw).trim()).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "moxfield.com") return "moxfield";
    if (host === "archidekt.com") return "archidekt";
    return null;
  } catch {
    return null;
  }
}

// Grade a deck and persist the result. Returns the patch that was written so a
// caller can update local state without re-reading the row.
//
// Throws with a human-readable message — every failure here is one a user needs
// to see. A silent catch on a primary control is the standing lesson of this
// codebase (see the QR/clipboard write-up in SESSION_STATE).
export async function gradeDeck(deckId, deckUrl) {
  if (!deckId) throw new Error("no deck to grade");
  if (!isSupportedDeckUrl(deckUrl)) {
    throw new Error("ScryCheck reads public Moxfield or Archidekt links");
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("not signed in yet — try again in a moment");

  // A network-level failure throws a bare "Failed to fetch", which is what the
  // browser calls it and not what a person calls it. Caught in testing against
  // a deploy that didn't have the function yet — the user saw those two words
  // and nothing actionable.
  let res;
  try {
    res = await fetch(`${API_BASE}/api/scrycheck`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ url: deckUrl }),
    });
  } catch {
    throw new Error("couldn't reach the grader — check your connection");
  }

  let json;
  try { json = await res.json(); }
  catch { throw new Error("the grader sent something unreadable"); }
  if (!res.ok) throw new Error(json?.error ?? `grading failed (${res.status})`);

  // Build the row patch. The five vectors come back already mapped from
  // ScryCheck's internal names (velocity/efficiency/lethality) to the labels
  // this app stores — api/scrycheck.js owns that seam.
  const patch = {
    url: deckUrl,
    platform: platformOf(deckUrl),
    scrycheck_url: json.deckUrl ?? null,
    scrycheck_score: json.score ?? null,
    scrycheck_bracket: json.bracket ?? null,
    scrycheck_version: json.scoringVersion ?? null,
    scrycheck_scored_at: new Date().toISOString(),
  };
  for (const v of SCRYCHECK_VECTORS) {
    patch[v.column] = json.vectors?.[v.key] ?? null;
  }

  const { error } = await supabase.from("decks").update(patch).eq("id", deckId);
  if (error) {
    // 035 not applied yet is the one failure with a specific, actionable cause.
    if (error.code === "PGRST204" || error.code === "42703") {
      throw new Error("this box is running ahead of its database — migration 035 hasn't been applied yet");
    }
    throw new Error(error.message);
  }

  return { patch, result: json };
}
