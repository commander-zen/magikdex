import { useEffect, useState } from "react";
import BadgeCard from "../components/BadgeCard.jsx";
import { getPublicCard, getPublicDecks, getPublicLinks } from "../lib/trainer.js";

// /t/<handle> — what a stranger gets after a scan, a link, or the physical card.
// No auth. Renders only what the two public RPCs return.
//
// NOT-FOUND AND PRIVATE ARE IDENTICAL, deliberately. Distinguishing them would
// make this page an oracle for which handles exist.
const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

const page = {
  minHeight: "100dvh", background: "#000",
  display: "flex", flexDirection: "column", alignItems: "center",
  padding: "32px 16px 60px",
};

export default function PublicCard({ handle }) {
  const [s, setS] = useState({ loading: true, card: null, decks: [], links: [], error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setS({ loading: true, card: null, decks: [], links: [], error: null });
      try {
        const { card, error } = await getPublicCard(handle);
        if (cancelled) return;
        // Decks and links both live on the BACK, which is one tap away — but they
        // load with the card rather than after it, because a back that pops in
        // half-empty after the flip reads as broken. Fetched in parallel: they are
        // independent, and two round trips in series is a visible wait on a phone
        // in a game store.
        let decks = [], links = [];
        if (card) {
          const [d, l] = await Promise.all([getPublicDecks(handle), getPublicLinks(handle)]);
          decks = d.decks; links = l.links;
        }
        if (!cancelled) setS({ loading: false, card, decks, links, error });
      } catch (e) {
        if (!cancelled) setS({ loading: false, card: null, decks: [], links: [], error: e?.message || "couldn't reach the server" });
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  if (s.loading) return <div style={page}><span style={{ ...mono, fontSize: 12, color: "#6B6B6E" }}>loading…</span></div>;

  if (s.error) {
    return (
      <div style={page}>
        <span style={{ ...mono, fontSize: 12, color: "#e0555f", maxWidth: 340, lineHeight: 1.7, textAlign: "center" }}>
          {s.error}
        </span>
      </div>
    );
  }

  if (!s.card) {
    return (
      <div style={page}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ ...mono, fontSize: 13, color: "#EDEDED" }}>@{handle}</span>
          <span style={{ ...mono, fontSize: 12, color: "#6B6B6E" }}>no card here</span>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <BadgeCard card={s.card} decks={s.decks} links={s.links} />
      <span style={{ ...mono, fontSize: 10, color: "#6B6B6E", marginTop: 20 }}>tap the card to flip it.</span>
    </div>
  );
}
