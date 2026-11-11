import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import SheetPage from "@/pages/SheetPage";

createRoot(document.getElementById("root")).render(<StrictMode><SheetPage /></StrictMode>);
