import { useEffect, useRef, useState } from "react";
import { useTheme } from "./theme/ThemeContext";
import Home from "./pages/Home";
import Landing from "./pages/Landing";
import AboutSheet from "./components/AboutSheet";
import Brew from "./pages/Brew";
import { supabase } from "./lib/supabase.js";

// Two root screens side by side on one sliding track: Landing (search-to-swipe,
// or go to your dex) and the dex (Home, the Box). Brewing and browsing open
// Brew as a full-screen takeover over both. The wordmark on either root screen
// opens the "what is magikdex" sheet.

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
  // Open browse: a Scryfall search with NO legend attached, swiped in the same
  // carousel. Deliberately NOT persisted the way an active session is — a brew
  // is a thing you are building and must survive a WebView reload; a browse is
  // a thing you are doing, and resuming it would be resuming a scroll position.
  // false, or { query } — the Landing search box's text ("" opens the search
  // screen, anything else lands straight on the carousel).
  const [browsing, setBrowsing] = useState(false);
  // Which root screen is showing. Always opens on Landing; an active brew
  // session still resumes over it.
  const [screen, setScreen] = useState("landing");
  const [aboutOpen, setAboutOpen] = useState(false);

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

  // One exit for both takeovers — a browse that saved its kept cards as a deck
  // lands back on a Box that re-reads and shows the new legend.
  function handleBrewSessionDone() {
    saveActiveSession(null);
    setBrewSession(null);
    setBrowsing(false);
    setReloadSignal(s => s + 1);
  }

  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.background = theme.base;
    document.body.style.fontFamily = "'Atkinson Hyperlegible Next Variable', sans-serif";
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
      {/* The two root screens on one track; the inactive one is inert so
          focus and taps can't reach it while it's slid off-screen.
          ⚠️ Slides with margin-left, NOT transform: a transformed ancestor
          becomes the containing block for position:fixed, which would pin the
          dex's sheets (settings, long-press, add legend) to the 200%-wide
          track instead of the screen. */}
      <div
        className="screen-track"
        style={{
          display: "flex", width: "200%", height: "100%",
          marginLeft: screen === "dex" ? "-100%" : 0,
        }}
      >
        <div style={{ width: "50%", height: "100%" }} inert={screen !== "landing"}>
          <Landing
            onSearch={q => setBrowsing({ query: q })}
            onOpenDex={() => setScreen("dex")}
            onAbout={() => setAboutOpen(true)}
            reloadSignal={reloadSignal}
            active={screen === "landing"}
          />
        </div>
        <div style={{ width: "50%", height: "100%" }} inert={screen !== "dex"}>
          <Home
            onLaunchBrew={handleLaunchBrew}
            onBack={() => setScreen("landing")}
            onAbout={() => setAboutOpen(true)}
            reloadSignal={reloadSignal}
          />
        </div>
      </div>

      {/* A real session always wins: if one is open both root screens are
          behind a takeover and unreachable anyway. */}
      {(brewSession || browsing) && (
        <div className="takeover-in" style={{ position: "fixed", inset: 0, zIndex: 100 }}>
          <Brew
            session={brewSession}
            browse={Boolean(browsing) && !brewSession}
            initialQuery={browsing?.query ?? ""}
            onSessionDone={handleBrewSessionDone}
          />
        </div>
      )}

      <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
