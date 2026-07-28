import { useEffect, useRef, useState } from "react";
import { useTheme } from "./theme/ThemeContext";
import Home from "./pages/Home";
import Brew from "./pages/Brew";
import { supabase } from "./lib/supabase.js";

// One concern: the Box is the root and the only home. There are no tabs — the
// root is a single scrolling surface (Home), and brewing opens Brew as a
// full-screen takeover over it.

// UAT batch 2, item 5 — the active brew session is persisted so backgrounding
// (which reloads the Capacitor WebView) resumes the session instead of dumping
// to Home. This holds only the ROUTE (which legend's session is open); the
// in-session position — swipe index, decklist, coarse view — resumes from
// Brew's own per-legend record. Same 30-day TTL as that record.
const ACTIVE_SESSION_KEY = "magikdex-active-session";
const ACTIVE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadActiveSession() {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.legend?.id || typeof s.lastActive !== "number" ||
        Date.now() - s.lastActive > ACTIVE_SESSION_TTL_MS) {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      return null;
    }
    return s;
  } catch { return null; }
}

function saveActiveSession(sess) {
  try {
    if (sess) localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ ...sess, lastActive: Date.now() }));
    else localStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch { /* best-effort — resume just falls back to Home */ }
}

export default function App() {
  const { theme } = useTheme();
  // Restore a persisted session synchronously so the first paint is already the
  // session (no Home flash) when returning from the background.
  const [brewSession, setBrewSession] = useState(loadActiveSession);
  // Bumped when a brew session ends so the Box surface re-reads deck totals,
  // and whenever the signed-in account changes (see the auth listener below).
  const [reloadSignal, setReloadSignal] = useState(0);
  // Invisible sign-in: every visitor gets an anonymous Supabase account on
  // first load (no UI, no personal info — it exists only so RLS can scope
  // decks per user). The session persists in localStorage across visits.
  // Rendering waits on this so the first legends read runs with auth in
  // place; a failed sign-in (provider off, offline) proceeds anyway so the
  // app never hard-blocks on auth.
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) await supabase.auth.signInAnonymously();
      } catch { /* proceed — reads just return what RLS allows */ }
      if (!cancelled) setAuthReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Signing in swaps WHICH account's rows RLS will return, but every surface
  // that already queried is still holding the previous account's results — so
  // signing back in used to say "your box is here" over a Box that stayed
  // empty until a manual reload. Bump reloadSignal on a real account change so
  // the Box re-reads as the new user.
  //
  // Keyed on the user id, not the event: TOKEN_REFRESHED fires on a timer for
  // the SAME user and must not trigger a refetch. The first event only seeds
  // the ref — there is nothing stale to refresh at mount.
  const lastUserIdRef = useRef(undefined);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null;
      const prev = lastUserIdRef.current;
      lastUserIdRef.current = id;
      if (prev !== undefined && prev !== id) setReloadSignal(s => s + 1);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  function handleLaunchBrew(legend, deck, opts) {
    const sess = { legend, deckId: deck?.id ?? null, startView: opts?.startView ?? null };
    saveActiveSession(sess);
    setBrewSession(sess);
  }

  function handleBrewSessionDone() {
    saveActiveSession(null);
    setBrewSession(null);
    setReloadSignal(s => s + 1);
  }

  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.background = theme.base;
    document.body.style.fontFamily = "'Noto Sans', sans-serif";
  }, [theme.base]);

  // Bare themed frame while the (local, fast) session check runs — mounting
  // Home earlier would fire the legends read pre-auth and paint an empty Box.
  if (!authReady) {
    return <div style={{ height: "100dvh", width: "100%", background: theme.base }} />;
  }

  return (
    <div style={{
      height: "100dvh",
      width: "100%",
      background: theme.base,
      overflow: "hidden",
    }}>
      <Home onLaunchBrew={handleLaunchBrew} reloadSignal={reloadSignal} />

      {brewSession && (
        <Brew session={brewSession} onSessionDone={handleBrewSessionDone} />
      )}
    </div>
  );
}
