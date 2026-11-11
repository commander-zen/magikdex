import { createContext, useContext } from "react";
import { tokens } from "./tokens";

const ThemeContext = createContext(null);

// Dark-only (UAT batch 2, item 2): the light palette and the toggle were
// removed. The provider just hands down the one palette (fonts load from
// index.html and src/styles.css) — `mode` and `toggleTheme` are gone.
export function ThemeProvider({ children }) {
  return (
    <ThemeContext.Provider value={{ theme: tokens }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Co-located with the provider for ergonomics; the fast-refresh rule wants
// hooks in a separate module, but splitting this one isn't worth the churn.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  return useContext(ThemeContext);
}
