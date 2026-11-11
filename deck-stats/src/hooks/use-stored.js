import { useCallback, useEffect, useState } from "react";
import { fontsReady, KEYS, loadPaper, store } from "@/lib/deck";

// "loading" | "ready" | "error": the card can't be drawn before its fonts.
export function useFonts() {
  const [state, setState] = useState("loading");
  useEffect(() => {
    let live = true;
    fontsReady.then(() => live && setState("ready"), () => live && setState("error"));
    return () => { live = false; };
  }, []);
  return state;
}

// Letter or A4, shared by every page.
export function usePaper() {
  const [paper, setPaperState] = useState(loadPaper);
  const setPaper = useCallback(p => { if (p) { setPaperState(p); store(KEYS.paper, p); } }, []);
  return [paper, setPaper];
}
