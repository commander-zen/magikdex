import { useState, useEffect } from "react";

let cached = null; // module-level — survives re-renders, cleared on hard reload

export function useGameChangers() {
  const [gameChangerIds, setGameChangerIds] = useState(cached ?? new Set());
  const [loading, setLoading]               = useState(cached === null);
  const [error, setError]                   = useState(null);

  useEffect(() => {
    // Cache hit — hydrate from the module-level set without a network round-trip.
    if (cached !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGameChangerIds(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      try {
        const ids = new Set();
        let url = "https://api.scryfall.com/cards/search?q=is%3AgameChanger&order=name";
        while (url) {
          const res  = await fetch(url, { headers: { "User-Agent": "DeckStack/1.0 (deck-stack.vercel.app)" } });
          const data = await res.json();
          if (data.object === "error") break;
          for (const card of data.data ?? []) {
            if (card.oracle_id) ids.add(card.oracle_id);
          }
          url = data.has_more ? data.next_page : null;
          if (url) await new Promise(r => setTimeout(r, 100)); // Scryfall rate limit
        }
        if (!cancelled) {
          cached = ids;
          setGameChangerIds(ids);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  return { gameChangerIds, loading, error };
}
