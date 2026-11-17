import ColorPips from "./ColorPips.jsx";
import { formatManaCost } from "../lib/scryfall.js";

// A rule 0 commander drawn as text, because there's no Scryfall scan to show.
// Fills whatever box it's given (the caller owns size + aspect ratio), so the
// Box detail pane and the brew commander overlay can both use it. The user's
// own art link, when they gave one, fills the art window; otherwise the
// colour pips sit there instead.
export default function CustomCardFace({ card, style }) {
  if (!card) return null;
  const art = card.image_uris?.normal ?? null;
  return (
    <div style={{
      width: "100%", height: "100%", boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: "2.5%",
      padding: "4.5%",
      borderRadius: "4.8% / 3.4%",
      background: "#141a1c",
      border: "1px solid #3a4447",
      boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      color: "#eef2f1",
      overflow: "hidden",
      ...style,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: "'Zilla Slab', serif", fontSize: 15, fontWeight: 600,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {card.name}
        </span>
        {card.mana_cost && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#a2b8b5", flexShrink: 0 }}>
            {formatManaCost(card.mana_cost)}
          </span>
        )}
      </div>

      <div style={{
        flex: "0 0 42%", minHeight: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0c1414", overflow: "hidden",
      }}>
        {art
          ? <img src={art} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <ColorPips identity={card.color_identity} size={18} gap={6} />}
      </div>

      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        color: "#a2b8b5", letterSpacing: "0.02em",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {card.type_line || "Legendary Creature"}
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto",
        fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
        fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap",
      }}>
        {card.oracle_text}
      </div>

      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
        letterSpacing: "0.14em", textTransform: "uppercase", color: "#2bc4ae",
      }}>
        rule 0 · not a scryfall card
      </div>
    </div>
  );
}
