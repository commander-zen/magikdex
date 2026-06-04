import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import ToolChips from "../components/ToolChips";
import PageHeader from "../components/PageHeader";
import SectionHeader from "../components/SectionHeader";
import { supabase } from "../lib/supabase";
import { fetchDecklist } from "../lib/fetchDecklist";
import { TOOLS } from "../data/tools";

const STATUS_CYCLE = ["Active", "Shelved", "Retired"];

const STATUS_COLORS = {
  light: {
    Active:  { color: "#c8960c", border: "#c8960c" },
    Shelved: { color: "#1a141080", border: "#1a141040" },
    Retired: { color: "#c0392b", border: "#c0392b" },
  },
  dark: {
    Active:  { color: "#e8a020", border: "#e8a020" },
    Shelved: { color: "#3a4a5a", border: "#3a4a5a" },
    Retired: { color: "#a04040", border: "#a04040" },
  },
};

function favicon(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

async function loadDecks() {
  const { data: decks, error } = await supabase
    .from("decks")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  if (!decks.length) return [];

  const ids = decks.map((d) => d.id);
  const { data: counts, error: countError } = await supabase
    .from("deck_cards")
    .select("deck_id, quantity")
    .in("deck_id", ids);
  if (countError) throw countError;

  const countMap = {};
  for (const row of counts) {
    countMap[row.deck_id] = (countMap[row.deck_id] ?? 0) + row.quantity;
  }

  return decks.map((d) => ({ ...d, card_count: countMap[d.id] ?? 0 }));
}

export default function Vault() {
  const { theme, mode } = useTheme();

  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const [legend, setLegend] = useState("");
  const [url, setUrl] = useState("");
  const [scrycheckScore, setScrycheckScore] = useState("");
  const [status, setStatus] = useState("Active");

  const mutedColor  = mode === "light" ? `${theme.ink}80`  : `${theme.white}66`;
  const inkColor    = mode === "light" ? theme.ink          : theme.white;
  const paperColor  = mode === "light" ? theme.paper        : theme.surface;
  const borderColor = mode === "light" ? theme.border       : theme.muted;
  const goldColor   = mode === "light" ? theme.gold         : theme.amber;

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px",
    background: theme.base,
    border: `1px solid ${borderColor}`,
    color: inkColor,
    fontFamily: "'Noto Sans', sans-serif",
    fontSize: 14,
    outline: "none",
    borderRadius: 0,
  };

  useEffect(() => {
    loadDecks()
      .then(setDecks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const { deckName, platform, cards } = await fetchDecklist(url.trim());

      const { data: deck, error: insertError } = await supabase
        .from("decks")
        .insert({
          legend: legend.trim(),
          url: url.trim(),
          platform,
          deck_name: deckName,
          scrycheck_score: scrycheckScore.trim() || null,
          status,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const cardRows = cards.map((c) => ({
        deck_id: deck.id,
        card_name: c.card_name,
        quantity: c.quantity,
        section: c.section,
      }));

      // Insert in batches of 100
      for (let i = 0; i < cardRows.length; i += 100) {
        const { error: cardError } = await supabase
          .from("deck_cards")
          .insert(cardRows.slice(i, i + 100));
        if (cardError) throw cardError;
      }

      const refreshed = await loadDecks();
      setDecks(refreshed);
      setLegend("");
      setUrl("");
      setScrycheckScore("");
      setStatus("Active");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function cycleStatus(deck) {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(deck.status) + 1) % STATUS_CYCLE.length];
    const { error } = await supabase
      .from("decks")
      .update({ status: next })
      .eq("id", deck.id);
    if (!error) {
      setDecks((prev) => prev.map((d) => d.id === deck.id ? { ...d, status: next } : d));
    }
  }

  const statusColors = STATUS_COLORS[mode];

  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      background: theme.base,
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ padding: "28px 20px 40px" }}>

        {/* Section A — Deck Registry */}
        <PageHeader title="VAULT" />

        {/* Add Deck form */}
        <form onSubmit={handleSubmit} style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="text"
              placeholder="Legend (your name for this deck)"
              value={legend}
              onChange={(e) => setLegend(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Moxfield or Archidekt URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="ScryCheck score (optional)"
              value={scrycheckScore}
              onChange={(e) => setScrycheckScore(e.target.value)}
              style={inputStyle}
            />

            {/* Status selector */}
            <div style={{ display: "flex", gap: 0, border: `1px solid ${borderColor}` }}>
              {STATUS_CYCLE.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  style={{
                    flex: 1,
                    padding: "9px 0",
                    background: status === s ? paperColor : "transparent",
                    border: "none",
                    borderRight: s !== "Retired" ? `1px solid ${borderColor}` : "none",
                    color: status === s ? inkColor : mutedColor,
                    fontFamily: "'Noto Sans', sans-serif",
                    fontSize: 12,
                    fontWeight: status === s ? 600 : 400,
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                padding: "10px",
                background: mode === "light" ? theme.gold : theme.amber,
                color: theme.base,
                border: "none",
                borderRadius: 0,
                fontFamily: "'Zilla Slab', serif",
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Fetching decklist…" : "Add to Vault"}
            </button>
          </div>

          {formError && (
            <div style={{
              marginTop: 10,
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 12,
              color: mode === "light" ? theme.stamp : "#a04040",
              lineHeight: 1.5,
            }}>
              {formError}
            </div>
          )}
        </form>

        {/* Deck list */}
        {loading && (
          <div style={{ fontFamily: "'Noto Sans', sans-serif", fontSize: 13, color: mutedColor }}>
            Loading vault…
          </div>
        )}

        {error && (
          <div style={{ fontFamily: "'Noto Sans', sans-serif", fontSize: 13, color: mode === "light" ? theme.stamp : "#a04040" }}>
            {error}
          </div>
        )}

        {!loading && !error && decks.length === 0 && (
          <div style={{ fontFamily: "'Noto Sans', sans-serif", fontSize: 13, color: mutedColor }}>
            No decks in the vault yet.
          </div>
        )}

        {!loading && !error && decks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {decks.map((deck) => {
              const sc = statusColors[deck.status] ?? statusColors.Active;
              const domain = deck.platform === "moxfield" ? "moxfield.com" : "archidekt.com";
              return (
                <div
                  key={deck.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 0",
                    borderBottom: `1px solid ${borderColor}`,
                  }}
                >
                  {/* Platform favicon */}
                  <img
                    src={favicon(domain)}
                    width={16}
                    height={16}
                    alt={deck.platform}
                    style={{ flexShrink: 0 }}
                  />

                  {/* Legend + card count */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: "'Zilla Slab', serif",
                      fontSize: 15,
                      fontWeight: 700,
                      color: inkColor,
                      lineHeight: 1.2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {deck.legend}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 2, alignItems: "center" }}>
                      <span style={{
                        fontFamily: "'Noto Sans Mono', monospace",
                        fontSize: 11,
                        color: mutedColor,
                      }}>
                        {deck.card_count} cards
                      </span>
                      {deck.scrycheck_score && (
                        <span style={{
                          fontFamily: "'Noto Sans Mono', monospace",
                          fontSize: 11,
                          color: goldColor,
                        }}>
                          {deck.scrycheck_score}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status badge */}
                  <button
                    onClick={() => cycleStatus(deck)}
                    style={{
                      padding: "2px 8px",
                      border: `1px solid ${sc.border}`,
                      borderRadius: 0,
                      background: "transparent",
                      color: sc.color,
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      flexShrink: 0,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {deck.status}
                  </button>

                  {/* External link */}
                  <a
                    href={deck.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: mutedColor,
                      textDecoration: "none",
                      fontSize: 14,
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    ↗
                  </a>
                </div>
              );
            })}
          </div>
        )}

        {/* Divider before Section B */}
        <div style={{ marginTop: 40, marginBottom: 28, borderTop: `1px solid ${borderColor}` }} />

        {/* Section B — Collection trackers */}
        <SectionHeader label="Collection Trackers" />
        <p style={{
          fontFamily: "'Noto Sans', sans-serif",
          fontSize: 13,
          color: mutedColor,
          margin: "0 0 16px",
          lineHeight: 1.5,
        }}>
          DNA doesn't store your cards. These do.
        </p>
        <ToolChips tools={TOOLS} />

      </div>
    </div>
  );
}
