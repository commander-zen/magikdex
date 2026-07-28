// Backing up an anonymous box — when to ask, and how often.
//
// magikdex signs every visitor in anonymously so there is ZERO barrier to
// brewing (Ben 2026-07-03). Their decks are real rows in Postgres from the
// first swipe; what's missing is a CREDENTIAL. Without an email attached, the
// only proof of who they are is a token in browser storage, and when that goes
// — cleared data, new phone, evicted PWA storage — the account is not locked,
// it is GONE. The rows survive, RLS still scopes them to a user id nobody can
// ever sign in as again. Ben's own decks scattered across 17 anonymous
// accounts in three weeks this way.
//
// So the ask has to land BEFORE the loss, and the loss is invisible after the
// fact — there is nothing to detect once the identity is gone. That makes
// prompt timing the entire mitigation.
//
// WHY ESCALATING STEPS: the previous version asked once at 10 cards and, if
// dismissed, never asked again for that brew. Someone waving it off early and
// then building a 99-card deck over two hours was never asked again — exactly
// the user most worth converting. Dismiss is now a SNOOZE: the next threshold
// still fires. Bounded at three asks plus one on export, so it can never
// become nagging.
//
// PER-BROWSER, NOT PER-LEGEND: one anonymous account is one browser, and the
// credential covers the whole box, not one deck. Keying this by legend (as it
// was) meant no global "this box is unbacked" state for the Box to show.

const SNOOZE_KEY = "magikdex.backupSnooze";
const EXPORT_KEY = "magikdex.backupExportPrompted";

// Deck sizes worth interrupting at. 10 = "this is becoming something", 40 =
// half a deck, 75 = nearly done. Ascending; pendingStep relies on the order.
export const NUDGE_STEPS = [10, 40, 75];

function readNumber(key) {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Storage denied (private mode, embedded webview). Treating that as "never
    // snoozed" would re-ask on every render, so report the ceiling: no prompts.
    return Infinity;
  }
}

// The highest threshold the user has already waved off.
export function snoozeLevel() {
  return readNumber(SNOOZE_KEY);
}

// The threshold to prompt at for this deck size, or null for "don't ask".
// Returns the LARGEST crossed step so a deck resumed at 80 cards asks once at
// 75 rather than walking up through 10 and 40.
export function pendingStep(deckSize) {
  const snoozed = snoozeLevel();
  const crossed = NUDGE_STEPS.filter(s => deckSize >= s && s > snoozed);
  return crossed.length ? crossed[crossed.length - 1] : null;
}

// "not now" — silence this step, leave the higher ones armed.
export function snoozeStep(step) {
  try { localStorage.setItem(SNOOZE_KEY, String(step)); } catch { /* best-effort */ }
}

// Exporting is a stronger intent signal than any card count: the user is
// carrying this deck somewhere. Worth exactly one ask, independent of the
// step ladder, and never repeated.
export function exportPromptDue() {
  return readNumber(EXPORT_KEY) === 0;
}

export function markExportPrompted() {
  try { localStorage.setItem(EXPORT_KEY, "1"); } catch { /* best-effort */ }
}

// Once an email is attached there is nothing left to prompt for. Cleared
// rather than left behind so a later sign-out to a fresh anonymous box starts
// with its own full ladder instead of inheriting the previous account's.
export function clearBackupPrompts() {
  try {
    localStorage.removeItem(SNOOZE_KEY);
    localStorage.removeItem(EXPORT_KEY);
  } catch { /* best-effort */ }
}
