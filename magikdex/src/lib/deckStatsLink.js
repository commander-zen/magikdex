// Hands a brewed deck to deckStats (the Bracket Card + proxies site).
//
// ⚠️ magikdex NEVER calls ScryCheck (Ben, 2026-11-10: the store app stays
// free of it). This only builds a link; deckStats does the analysis, and only
// when its user taps "analyze".
//
// The deck rides in the URL FRAGMENT (#bc=…), which browsers never send to a
// server: no upload, no account, nothing stored anywhere. deckStats' app.js
// (readHandoff) is the other half of this format, so change both together.
//
//   #bc=z.<base64url(deflate-raw(json))>   compressed, where the browser can
//   #bc=j.<base64url(json)>                plain, where it can't (older WebViews)
//   json = { v: 1, c: [commander, partner?], l: "1 Sol Ring\n…" }
//
// A full Commander list is ~2.5 KB of text, ~1.2 KB compressed: well inside
// any browser's URL limit either way.
export const DECKSTATS_URL = "https://deck-stats-mauve.vercel.app/";

const toBase64Url = bytes => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function deckStatsLink({ commanders, list }) {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, c: commanders.filter(Boolean), l: list }));
  if (typeof CompressionStream === "function") {
    try { return `${DECKSTATS_URL}#bc=z.${toBase64Url(await deflate(json))}`; }
    catch { /* fall through to plain */ }
  }
  return `${DECKSTATS_URL}#bc=j.${toBase64Url(json)}`;
}
