import PublicCard from "./screens/PublicCard.jsx";
import MyCard from "./screens/MyCard.jsx";

// Two routes, so no router library. Adding one would mean a dependency, a
// provider, and a mental model, to distinguish between exactly two paths.
//
//   /t/<handle>  → the public card. Works signed out; that is the point.
//   anything else → your own card.
//
// Read once at module scope: neither route changes without a navigation, and
// there is no in-app link that needs to avoid a reload. vercel.json rewrites
// everything to index.html so /t/<handle> is served by this app rather than 404.
function route() {
  const m = location.pathname.match(/^\/t\/([^/?#]+)\/?$/);
  // decodeURIComponent because a handle arrives from a URL, and normalising to
  // lowercase matches the citext column — @Zen and @zen are the same trainer, so
  // a link with the wrong case must still resolve rather than 404.
  return m ? { name: "public", handle: decodeURIComponent(m[1]).toLowerCase() } : { name: "me" };
}

export default function App() {
  const r = route();
  return r.name === "public" ? <PublicCard handle={r.handle} /> : <MyCard />;
}
