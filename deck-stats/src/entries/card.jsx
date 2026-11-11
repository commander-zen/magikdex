import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import CardPage from "@/pages/CardPage";

createRoot(document.getElementById("root")).render(<StrictMode><CardPage /></StrictMode>);
