import { useEffect, useState } from "react";
import { useTheme } from "./theme/ThemeContext";
import Home from "./pages/Home";
import Brew from "./pages/Brew";

// One concern: the Box is the root and the only home. There are no tabs — the
// root is a single scrolling surface (Home), and brewing opens Brew as a
// full-screen takeover over it.
export default function App() {
  const { theme } = useTheme();
  const [brewSession, setBrewSession] = useState(null);
  // Bumped when a brew session ends so the Box surface re-reads deck totals.
  const [reloadSignal, setReloadSignal] = useState(0);

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
