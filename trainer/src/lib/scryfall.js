// Scryfall lookup for the art box.
//
// A commander, not a photo: no uploads means no storage, no moderation queue and
// no personal image on a public card — and across a table "the Prossh guy" reads
// faster than a face.
//
// We store the art URL and the ARTIST. Scryfall asks that art be credited, and a
// real card's collector line names the artist anyway, so the frame wants it.
//
// Fan Content Policy is the permission this operates under: free, no implied
// endorsement, notice displayed. Same footing as magikdex.
const API = "https://api.scryfall.com/cards/search";

export async function searchCommanders(query) {
  const q = (query || "").trim();
  if (q.length < 2) return { cards: [], error: null };
  try {
    // is:commander narrows to things that can actually head a deck, so the picker
    // does not offer Lightning Bolt as a signature card.
    const url = `${API}?q=${encodeURIComponent(`${q} is:commander`)}&unique=cards&order=name`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 404) return { cards: [], error: null }; // Scryfall's "no results"
    if (!res.ok) return { cards: [], error: "scryfall is not answering right now" };
    const json = await res.json();
    return { cards: (json.data || []).slice(0, 12).map(toCard), error: null };
  } catch {
    return { cards: [], error: "couldn't reach scryfall" };
  }
}

// Double-faced cards keep their art on the faces, not the top level — without
// this, every MDFC commander comes back with no image.
function toCard(c) {
  const face = c.card_faces?.[0];
  const img = c.image_uris ?? face?.image_uris ?? null;
  return {
    scryfall_id: c.id,
    name: c.name,
    art_url: img?.art_crop ?? null,
    artist: c.artist ?? face?.artist ?? null,
  };
}
