import { useState } from "react";

// A double-faced card that turns over in 3D instead of swapping its image.
//
// Swapping the src was abrupt — the card teleported to its other face with no
// sense that it had been TURNED (Ben: "the flip for all cards is pretty
// aggressive"). A physical DFC rotates, so this does too.
//
// ONE component for all three flip sites (the swipe carousel and BOTH commander
// overlays). Those overlays were separate copies of the same markup, and that
// duplication is exactly why the commander flip shipped broken once already —
// fixing one file left the other untouched.
//
// HOW IT WORKS: both faces are in the DOM at once, stacked. The back is
// pre-rotated 180°, and `backface-visibility: hidden` hides whichever face is
// currently pointing away. Rotating the shared parent turns them together, so
// the browser animates one GPU transform rather than crossfading two images.
// Both faces being resident also means the back is already decoded when the
// flip starts — a lazily-swapped src would flash blank mid-turn.

export default function FlipCard({
  frontSrc,
  backSrc,
  alt,
  backAlt,
  flipped,
  imgStyle,
  onError,
  containerStyle,
}) {
  // Read once. Someone who asks the OS for less motion gets the instant swap,
  // which is the old behaviour and perfectly usable — the flip is delight, not
  // information.
  const [reduceMotion] = useState(
    () => typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // Single-faced card: no 3D machinery, no second <img>. Most cards take this
  // path, and it keeps the carousel's per-frame cost exactly what it was.
  if (!backSrc) {
    return (
      <img
        src={frontSrc}
        alt={alt}
        draggable={false}
        onError={onError}
        style={imgStyle}
      />
    );
  }

  // The back tracks whatever box the front established, so this works for both
  // the carousel (fixed width/height) and the overlays (width-only, natural
  // height) without either caller changing how it sizes its card.
  const backStyle = {
    ...imgStyle,
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    transform: "rotateY(180deg)",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  };

  const frontStyle = {
    ...imgStyle,
    position: "relative",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  };

  return (
    <div style={{
      // Perspective lives on the OUTER element: on the rotating one it would
      // be re-applied to the already-turned face and the card would look like
      // it was folding rather than turning.
      perspective: 1400,
      display: "inline-flex",
      lineHeight: 0,
      ...containerStyle,
    }}>
      <div style={{
        position: "relative",
        width: "100%",
        height: "100%",
        transformStyle: "preserve-3d",
        WebkitTransformStyle: "preserve-3d",
        // Eases out slower than it starts, which reads as weight rather than a
        // snap. No bounce — a card doesn't overshoot when you turn it.
        transition: reduceMotion ? "none" : "transform 520ms cubic-bezier(0.4, 0.12, 0.2, 1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        <img
          src={frontSrc}
          alt={alt}
          draggable={false}
          onError={onError}
          style={frontStyle}
        />
        <img
          src={backSrc}
          alt={backAlt ?? alt}
          draggable={false}
          aria-hidden={!flipped}
          style={backStyle}
        />
      </div>
    </div>
  );
}
