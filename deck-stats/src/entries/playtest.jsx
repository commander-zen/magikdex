import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import PlaytestPage from "@/pages/PlaytestPage";

createRoot(document.getElementById("root")).render(<StrictMode><PlaytestPage /></StrictMode>);
