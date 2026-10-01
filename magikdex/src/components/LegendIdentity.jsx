import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { getCardData, getCardImage } from "../lib/scryfall.js";
// The same 3D flip the brew screens use — see the history at the top of that
// file for why this is not an image swap.
import FlipCard from "../brew-components/FlipCard.jsx";

// The detail pane of the storage-box Home: the selected legend's card art.
//
// It was a two-page pager (card art, then the ScryCheck radar) until
// 2026-10-01, when Ben moved all ScryCheck analysis out to the deck-stats app:
// "this ScryCheck panel can go I want the ScryCheck info on deck stats".
// One page needs no pager and no dots.

export default function LegendIdentity({ legend }) {
  const { theme } = useTheme();
  const [oracleCard, setOracleCard] = useState(null);
  const [flipped, setFlipped] = useState(false);

  const plateBg = theme.surface;

  // Cache-first (memoized) lookup — this used to hit live api.scryfall.com on
  // every legend select, which made the detail pane's sprite the slowest thing
  // on the Home surface. getCardData reads the local cards cache and only
  // falls to the live API on a true miss.
  useEffect(() => {
    let cancelled = false;
    // Clear the stale card immediately so the pane never shows the prior legend.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOracleCard(null);
    // A new legend opens on its front, not inheriting "flipped" from the last.
    setFlipped(false);
    getCardData(legend.name)
      .then(card => { if (!cancelled && card) setOracleCard(card); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [legend.name]);

  // ── Double-faced legends ────────────────────────────────────────────────────
  // getCardImage returns card_faces[0] — the FRONT — which is right for every
  // single-faced card and silently wrong for a transforming commander. Ral,
  // Monsoon Mage // Ral, Leyline Prodigy showed its front and offered no way to
  // see the other half; Ben's report was simply "ral doesn't flip".
  //
  // Only faces that carry their OWN image_uris count. Split and adventure cards
  // also populate card_faces, but they share one image — flipping them would
  // swap a picture for the identical picture.
  // ⚠️ USE FlipCard, not an image swap. The first pass here swapped the src,
  // which works but is not what the rest of the app does — the brew screens turn
  // the card over in 3D, and FlipCard.jsx carries the scar tissue from two
  // failed attempts at that (a dead flip shipped to prod, then a JS timer that
  // handed over at half the DURATION rather than half the ANGLE and read as a
  // visible cut). Ben noticed the home screen was the odd one out immediately.
  const faces = oracleCard?.card_faces ?? null;
  const backImage = faces?.[1]?.image_uris
    ? getCardImage({ ...oracleCard, image_uris: faces[1].image_uris }, "normal")
    : null;
  const canFlip = Boolean(backImage);

  const frontImage = oracleCard
    ? (getCardImage(oracleCard, "normal") ?? getCardImage(oracleCard, "large"))
    : null;
  const backAlt = faces?.[1]?.name ?? legend.name;

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: "6px 16px 2px",
      overflow: "hidden",
    }}>
      {/* The sprite. The card art already carries the name, type and
          mana cost in its own frame, so nothing is labelled here; this is
          the thing itself, at the largest size the pane allows. */}
      <section
        aria-label="Card"
        style={{
          flex: 1, minHeight: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          // A SIZE container, so the card box below can ask about BOTH of this
          // pane's axes in CSS. Without it there is no way to express "the
          // smaller of the two" and the ratio breaks on one shape or the other.
          containerType: "size",
        }}
      >
        {/* ⚠️ CONSTRAINED ON BOTH AXES, and it has to be.
            This was `height: 100%` + `aspect-ratio: 63/88`, which is only
            correct while the pane is the SHORTER constraint. Giving the pane
            more height (the tray dropping to one row) made the card
            width-bound instead: at 529px tall it wanted 378px of width inside
            343px, so the frame squashed to a 0.649 ratio and object-fit cover
            silently cropped the card's sides. It looked like a rendering bug
            and was a sizing one.
            Letting the IMAGE carry its own intrinsic ratio under max-width
            AND max-height is resolvable whichever axis binds — tall narrow
            phone, short wide one, or a future pane resize. object-fit
            contain is belt-and-braces for a non-standard source. */}
        {frontImage ? (
          // ⚠️ THE BOX HAS TO BE SIZED HERE, and naively is WRONG.
          // FlipCard's faces are both absolute, so they contribute nothing to
          // layout — an unsized parent collapses to zero. But the note above
          // still holds: this pane binds on EITHER axis depending on the tray.
          //
          // `height:100% + aspect-ratio + max-width:100%` looks like the
          // answer and is not: measured across pane shapes, the tall-narrow
          // case (a phone) came out 343×529 at ratio 0.648 instead of 0.718 —
          // max-width clamps the width without feeding back into the height,
          // so the card squashes. Width-driven sizing fails the mirror case.
          //
          // So the box asks for the SMALLER of the two axes directly, in
          // container-query units against the section above, and lets
          // aspect-ratio derive the other side. Verified correct at 343×529,
          // 343×300, 600×400, 200×800 and 500×500.
          <div style={{
            position: "relative",
            height: "min(100cqh, calc(100cqw * 680 / 488))",
            aspectRatio: "488 / 680",
          }}>
            <FlipCard
              frontSrc={frontImage}
              backSrc={backImage}
              alt={legend.name}
              backAlt={backAlt}
              flipped={flipped}
              containerStyle={{ width: "100%", height: "100%" }}
              faceStyle={{
                borderRadius: "4.8% / 3.4%",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              }}
            />
            {canFlip && (
              <button
                onClick={() => setFlipped(f => !f)}
                aria-label={flipped ? "Show front face" : "Show back face"}
                style={{
                  position: "absolute", right: 6, bottom: 6, zIndex: 5,
                  width: 36, height: 36, padding: 0, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(8,9,12,0.72)", border: `1px solid ${theme.muted}`,
                  color: theme.white, cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 20 }}>autorenew</span>
              </button>
            )}
          </div>
        ) : (
          // Pre-load plate. Sized the old way on purpose: it is a blank
          // rectangle for a few hundred milliseconds, so a momentarily
          // imperfect ratio is invisible, and this keeps the pane from
          // collapsing to nothing while the art resolves.
          <div style={{
            height: "100%",
            aspectRatio: "63 / 88",
            maxWidth: "100%",
            borderRadius: "4.8% / 3.4%",
            background: plateBg,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }} />
        )}
      </section>
    </div>
  );
}
