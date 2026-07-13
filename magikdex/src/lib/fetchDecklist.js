export async function fetchDecklist(url) {
  if (url.includes("moxfield.com")) {
    return fetchMoxfield(url);
  }
  if (url.includes("archidekt.com")) {
    return fetchArchidekt(url);
  }
  throw new Error("URL must be from moxfield.com or archidekt.com");
}

async function fetchMoxfield(url) {
  const match = url.match(/moxfield\.com\/decks\/([^/?#]+)/);
  if (!match) throw new Error("Could not extract deck ID from Moxfield URL");
  const deckId = match[1];

  const res = await fetch(`https://api2.moxfield.com/v3/decks/all/${deckId}`);
  if (!res.ok) throw new Error(`Moxfield API error: ${res.status}`);

  const data = await res.json();
  if (!data.boards) throw new Error("Unexpected Moxfield response shape");

  const cards = [];
  for (const [section, board] of Object.entries(data.boards)) {
    if (!board.cards) continue;
    for (const [, entry] of Object.entries(board.cards)) {
      cards.push({
        card_name: entry.card?.name ?? entry.name,
        quantity: entry.quantity,
        section,
      });
    }
  }

  return { deckName: data.name, platform: "moxfield", cards };
}

async function fetchArchidekt(url) {
  const match = url.match(/archidekt\.com\/decks\/(\d+)/);
  if (!match) throw new Error("Could not extract deck ID from Archidekt URL");
  const deckId = match[1];

  const res = await fetch(`https://archidekt.com/api/decks/${deckId}/`);
  if (!res.ok) throw new Error(`Archidekt API error: ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data.cards)) throw new Error("Unexpected Archidekt response shape");

  const cards = data.cards.map((entry) => ({
    card_name: entry.card?.oracleCard?.name ?? entry.card?.name,
    quantity: entry.quantity,
    section: entry.categories?.[0] ?? "mainboard",
  }));

  return { deckName: data.name, platform: "archidekt", cards };
}
