import { createContext, useContext, useEffect, useState } from "react";
import { tokens } from "./tokens";

const STORAGE_KEY = "mtgdna-theme";
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@400;700&family=Noto+Sans:wght@400;500&family=Noto+Sans+Mono:wght@400&display=swap";

const ThemeContext = createContext(null);

// Dark is the app default (matching the dark HTML shell and the always-dark
// brew face) — following a light system preference made first load flash
// light before the dark surfaces took over. Light remains an explicit
// settings choice.
function getInitialMode() {
  return localStorage.getItem(STORAGE_KEY) ?? "dark";
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(getInitialMode);

  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS_HREF}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const toggleTheme = () => setMode(m => (m === "light" ? "dark" : "light"));

  return (
    <ThemeContext.Provider value={{ theme: tokens[mode], mode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
