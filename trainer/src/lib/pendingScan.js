// The scan has to survive the sign-up, and until now it did not.
//
// ── The failure this closes ──────────────────────────────────────────────────
// PublicCard's AfterScan already solved the first half: a stranger with no
// account can KEEP a card without being asked for anything. What it could not do
// is finish the thought. They tap "make your own card", go through email → code →
// pick a permanent screen name, land on their own card, and **the person they
// just met is gone**. No prompt, no pending anything. The reframe the product is
// built on — "add_buddy takes a handle, so the connection closes from either side
// at any time" — was true and yet nothing ever ASKED them to close it.
//
// So the handle is parked here, on their own device, and offered back the moment
// they have a profile to attach it to.
//
// ── Why localStorage and not a table ─────────────────────────────────────────
// There is nobody to write a row as. The whole problem is that this person has no
// account yet, and inventing a server-side "pending" identity for an anonymous
// scanner would mean writing down that a specific unidentified device looked at a
// specific player's card. That is a tracking record, and this product does not
// keep those. Local storage is the honest home: it is their device, their
// browsing, it never leaves, and clearing site data erases it completely.
//
// ── Recorded on INTENT, never on view ────────────────────────────────────────
// Nothing is stored just because a card was looked at. That would build a passive
// log of who someone browsed, which is exactly the thing the schema refuses to
// keep (025: no enumeration, no directory). It is written only when the visitor
// takes an action that means "I want to keep this" — saving the link, or heading
// off to make their own card.
//
// ⚠️ EVERY ACCESS IS WRAPPED. localStorage throws outright in some contexts, and
// this app specifically runs in the ones where it does: a QR scan routinely opens
// inside Instagram's or Discord's in-app browser, and Safari private mode throws
// on write. A failure here must never break the card — it is an affordance on
// top of the product, not the product.

const KEY = "ritual.pending_scans";

// A scan is a thing that happened on a night, not a standing intention. If it has
// been a month, they did not come back for that person and the prompt would just
// be clutter about a stranger they no longer remember.
const TTL_DAYS = 30;

// Enough for a whole event's worth of card swaps without letting a shared or
// long-lived device accumulate an unbounded list of who was looked at.
const MAX = 20;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const cutoff = Date.now() - TTL_DAYS * 86400_000;
    // Expiry is applied on READ rather than by a timer: there is no background
    // anywhere in this app to run one, and a stale entry that is never read has
    // never been shown to anybody.
    return list.filter(e => e && typeof e.handle === "string" && (e.at ?? 0) > cutoff);
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch { /* private mode, in-app browser, quota — all non-fatal by design */ }
}

/** Park a handle to offer back after they have a profile. */
export function rememberScan(handle) {
  const h = String(handle || "").toLowerCase();
  if (!h) return;
  const list = read().filter(e => e.handle !== h);
  list.push({ handle: h, at: Date.now() });
  write(list);
}

/** Handles seen recently, oldest first. Expired entries are already gone. */
export function pendingScans() {
  return read().map(e => e.handle);
}

export function forgetScan(handle) {
  const h = String(handle || "").toLowerCase();
  write(read().filter(e => e.handle !== h));
}

export function clearScans() {
  try { localStorage.removeItem(KEY); } catch { /* see write() */ }
}
