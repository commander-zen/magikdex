import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./theme/ThemeContext";
import { ErrorBoundary } from "./CrashScreen.jsx";
import { installGlobalCrashHandler } from "./crashHandler.js";
import App from "./App.jsx";

// Installed before anything else renders: a crash during module evaluation or a
// mount that silently never happens both need to be caught, and neither is
// visible to a React error boundary.
installGlobalCrashHandler();

// The boundary wraps ThemeProvider, not just App — a throw inside the provider
// would otherwise escape it and leave a black screen.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
