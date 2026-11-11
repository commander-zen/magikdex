import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const here = p => fileURLToPath(new URL(p, import.meta.url));

// Three real pages, so the old URLs (/, /sheet.html, /playtest.html) and the
// magikdex handoff link (/#bc=…) keep working.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": here("./src") } },
  build: {
    rollupOptions: {
      input: { main: here("index.html"), sheet: here("sheet.html"), playtest: here("playtest.html") },
    },
  },
  server: { port: 5173 },
});
