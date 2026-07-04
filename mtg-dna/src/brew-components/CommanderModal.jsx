import { useState, useEffect } from "react";
import { getCardImage } from "../lib/scryfall.js";

export default function CommanderModal({ card, onClose }) {
  const [faceIdx, setFaceIdx] = useState(0);

  // Reset to the front face whenever a different card opens.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setFaceIdx(0); }, [card]);

  if (!card) return null;

  const hasFaces = (card.card_faces?.length ?? 0) >= 2;
  const artUrl   = getCardImage(card, "art_crop");
  const fullUrl  = hasFaces
    ? (card.card_faces[faceIdx]?.image_uris?.normal ?? getCardImage(card, "normal"))
    : getCardImage(card, "normal");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 450,
        background: "rgba(0, 0, 0, 0.75)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "24px 20px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(88vw, 380px)",
          background: "var(--color-surface)",
          borderStyle: "solid",
          borderWidth: "2px",
          borderTopColor: "var(--bevel-light)",
          borderLeftColor: "var(--bevel-light)",
          borderBottomColor: "var(--bevel-dark)",
          borderRightColor: "var(--bevel-dark)",
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        {/* Title bar */}
        <div style={{
          background: "var(--color-titlebar)",
          color: "var(--color-titlebar-text)",
          fontFamily: "var(--font-system)",
          fontSize: "var(--font-size-base)",
          fontWeight: "bold",
          padding: "var(--space-1) var(--space-2)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>{card.name}</span>
          <button
            onClick={e => { e.stopPropagation(); onClose(); }}
            style={{
              background: "var(--color-chrome)",
              color: "var(--color-text-chrome)",
              fontFamily: "var(--font-system)",
              fontSize: "var(--font-size-sm)",
              borderStyle: "solid",
              borderWidth: "2px",
              borderTopColor: "var(--bevel-light)",
              borderLeftColor: "var(--bevel-light)",
              borderBottomColor: "var(--bevel-dark)",
              borderRightColor: "var(--bevel-dark)",
              width: "20px",
              height: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              borderRadius: 0,
              padding: 0,
              flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Modal body */}
        <div style={{
          background: "var(--color-surface)",
          borderStyle: "solid",
          borderWidth: "2px",
          borderTopColor: "var(--bevel-light)",
          borderLeftColor: "var(--bevel-light)",
          borderBottomColor: "var(--bevel-dark)",
          borderRightColor: "var(--bevel-dark)",
          borderRadius: 0,
          padding: "var(--space-4)",
          fontFamily: "var(--font-system)",
          fontSize: "var(--font-size-base)",
          color: "var(--color-text-primary)",
        }}>

        {/* Art crop as full-width hero image */}
        {artUrl && (
          <div style={{ position: "relative", width: "100%", aspectRatio: "4/3" }}>
            <img
              src={artUrl}
              alt={card.name}
              draggable={false}
              style={{
                width: "100%", height: "100%",
                objectFit: "cover",
                display: "block",
                borderRadius: 0,
              }}
            />
            {/* Flip button for DFCs */}
            {hasFaces && (
              <button
                onClick={() => setFaceIdx(f => f === 0 ? 1 : 0)}
                style={{
                  position: "absolute", bottom: 10, right: 10,
                  width: 34, height: 34,
                  background: "var(--color-chrome)",
                  color: "var(--color-text-chrome)",
                  borderStyle: "solid",
                  borderWidth: "2px",
                  borderTopColor: "var(--bevel-light)",
                  borderLeftColor: "var(--bevel-light)",
                  borderBottomColor: "var(--bevel-dark)",
                  borderRightColor: "var(--bevel-dark)",
                  cursor: "pointer", fontSize: 18,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  lineHeight: 1,
                  borderRadius: 0,
                  padding: 0,
                }}
              >↻</button>
            )}
          </div>
        )}

        {/* Full card image below for DFCs or as fallback */}
        {!artUrl && fullUrl && (
          <img
            src={fullUrl}
            alt={card.name}
            draggable={false}
            style={{
              width: "100%", display: "block",
              borderRadius: 0,
            }}
          />
        )}

        </div>
      </div>
    </div>
  );
}
