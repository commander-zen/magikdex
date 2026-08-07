import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./CrashScreen.jsx";
import { installGlobalCrashHandler } from "./crashHandler.js";
import App from "./App.jsx";

// Same reporter as magikdex, for the same reason: a crash that paints nothing on
// a phone is unobservable, and unobservable bugs cost days. This app is MORE
// exposed to it, not less -- /t/<handle> is a link handed to strangers whose
// devices you will never see.
installGlobalCrashHandler();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
