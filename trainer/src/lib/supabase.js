import { createClient } from "@supabase/supabase-js";

// Same Supabase project as magikdex. This app talks to the `trainer` schema and
// the handle-keyed public RPCs; it never touches decks, legends or cards.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: "public" } }
);
