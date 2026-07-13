function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function stripToBasic(query) {
  const terms = query.split(/\s+/);
  const plain = terms.find(t => !t.includes(":") && !t.startsWith("-"));
  return plain ?? terms[0].split(":")[0];
}

async function tryQuery(q) {
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=edhrec`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data?.length) return null;
    return shuffle(data.data).slice(0, 22);
  } catch {
    return null;
  }
}

export async function executeBrewQuery(scryfallQuery) {
  const first = await tryQuery(scryfallQuery);
  if (first) return first;

  const basic = stripToBasic(scryfallQuery);
  if (basic === scryfallQuery) return null;
  return await tryQuery(basic);
}
