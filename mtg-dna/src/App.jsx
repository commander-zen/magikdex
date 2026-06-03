import { useEffect, useState } from "react";
import { useTheme } from "./theme/ThemeContext";
import NavBar from "./components/NavBar";
import Home from "./pages/Home";

const PAGES = ["home", "vault", "brew", "table", "notebook"];

const NAV_HEIGHT = 60;

export default function App() {
  const { theme, mode } = useTheme();
  const [activePage, setActivePage] = useState("home");

  const textColor = mode === "light" ? theme.ink : theme.white;

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
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{
        flex: 1,
        overflow: "hidden",
        paddingBottom: NAV_HEIGHT,
      }}>
        {activePage === "home" && <Home />}
        {activePage !== "home" && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
          }}>
            <span style={{
              fontFamily: "'Zilla Slab', serif",
              fontSize: 28,
              color: textColor,
              textTransform: "capitalize",
            }}>
              {activePage}
            </span>
          </div>
        )}
      </div>

      <NavBar activePage={activePage} onNavigate={setActivePage} />
    </div>
  );
}
