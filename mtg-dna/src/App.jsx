import { useEffect, useState } from "react";
import { useTheme } from "./theme/ThemeContext";
import Home from "./pages/Home";
import Brew from "./pages/Brew";
import { supabase } from "./lib/supabase.js";

// One concern: the Box is the root and the only home. There are no tabs — the
// root is a single scrolling surface (Home), and brewing opens Brew as a
// full-screen takeover over it.
export default function App() {
  const { theme } = useTheme();
  const [brewSession, setBrewSession] = useState(null);
  // Bumped when a brew session ends so the Box surface re-reads deck totals.
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

  function handleLaunchBrew(legend, deck, opts) {
    setBrewSession({ legend, deckId: deck?.id ?? null, startView: opts?.startView ?? null });
  }

  function handleBrewSessionDone() {
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
