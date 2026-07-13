# magıcdex (React + Vite)

## Card cache ingestion (manual)

`npm run ingest:cards` downloads Scryfall's `oracle_cards` bulk file (~168 MB)
and upserts it into the Supabase `cards` table (migration 007) — the local
gameplay cache that name lookups read before falling back to the live API.

Run it **manually from a dev machine** after a set release to refresh the cache.
It is **not** wired to any cron or deploy. It requires:

- `SUPABASE_URL` (or the existing `VITE_SUPABASE_URL` is reused), and
- `SUPABASE_SERVICE_KEY` — the Supabase **service-role** key (this is a
  server-side bulk write that bypasses RLS; the anon key is not used).

The service key must be supplied via env and **must never be committed** (`.env`
is gitignored). Example:

```sh
SUPABASE_SERVICE_KEY=... npm run ingest:cards
```

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
