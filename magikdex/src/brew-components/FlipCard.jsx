import { useState, useEffect } from "react";

// A double-faced card that turns over in 3D instead of swapping its image.
//
// SECOND ATTEMPT. The first (c173b43, reverted in 25f6e93) shipped a dead flip
// to prod: the card never showed its back. What was wrong is the thing this
// version is built around — in the canonical CSS flip-card, BOTH faces are
// absolutely positioned inside a container that has its own size, and the
// rotating element is absolute too. The first version left the front face in
// normal flow so it could size an auto-height card, which mixes an in-flow box
// with an absolute one inside the same preserve-3d context; backface-visibility
// then had nothing reliable to hide and the front stayed visible at 180°.
//
// So the container must be SIZED BY THE CALLER — either it already has a box
// (the carousel slot) or it gets an aspect-ratio (the commander overlays).
//
// HOW IT WORKS: both faces stack, the back pre-rotated 180°, and
// backface-visibility hides whichever points away. Rotating their shared parent
// turns them together, so the browser animates one GPU transform rather than
// crossfading two images. Both faces resident also means the back is decoded
// before the turn starts — a lazily-swapped src would flash blank mid-flip.
//
// NOT VERIFIED VISUALLY BY ME: this environment's browser pane does not
// composite frames, so screenshots fail and even a plain, demonstrably
// animating control element reports an identity transform. DOM-property checks
// (transition present, preserve-3d set) are what gave false confidence last
// time. This needs a real device pass before it goes near main.

// Scryfall's `normal` images are 488x680. Used only as the default box shape
// for callers with no intrinsic height; object-fit keeps any mismatch letterboxed
// rather than stretched.
const CARD_ASPECT = "488 / 680";

export default function FlipCard({
  frontSrc,
  backSrc,
  alt,
  backAlt,
  flipped,
  onError,
  faceStyle,
  containerStyle,
}) {
  const [reduceMotion] = useState(
    () => typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // If 3D isn't available the animation can't run, and a flip that visibly does
  // nothing is worse than an abrupt one — fall back to swapping the src, which
  // is the behaviour this replaced and is known to work.
  const [supports3d] = useState(
    () => typeof CSS === "undefined" || typeof CSS.supports !== "function"
      ? false
      : CSS.supports("transform-style", "preserve-3d")
  );

  // FAILSAFE, and the reason this can't ship dead twice. backface-visibility is
  // what SHOULD hide the away-facing side, but if it doesn't (the first attempt
  // failed exactly this way) the front stays on top and the flip visibly does
  // nothing. So which face is visible is ALSO switched outright, halfway through
  // the turn — where the card is edge-on and the swap can't be seen.
  //
  // If 3D works this is redundant. If 3D doesn't, the flip still WORKS; it just
  // reads as a cut instead of a turn. Worst case ugly, never broken.
  //
  // Driven by a TIMER, not `transition: visibility 0s 260ms`. That was the first
  // shape of this failsafe and it was worse than nothing: it made the swap
  // depend on the same CSS animation clock the flip already depends on, so
  // anywhere transitions stall, the computed visibility never advances and the
  // card is stuck showing its front. A timer shares no machinery with the
  // animation, which is the entire point of a fallback.
  //
  // visibility, not opacity: opacity below 1 is a grouping property that forces
  // flattening, which is the one thing that would break preserve-3d.
  const [showBack, setShowBack] = useState(flipped);
  useEffect(() => {
    // Always a timer (0ms when motion is reduced) so this never becomes a
    // synchronous setState in an effect body.
    const t = setTimeout(() => setShowBack(flipped), reduceMotion ? 0 : 260);
    return () => clearTimeout(t);
  }, [flipped, reduceMotion]);

  // Single-faced card: no 3D machinery and no second <img>, so the carousel's
  // per-frame cost is unchanged for the vast majority of cards. Placed AFTER
  // every hook above — an early return in front of them would make the hook
  // order depend on whether a card happens to be double-faced.
  if (!backSrc || !supports3d) {
    return (
      <img
        src={!backSrc ? frontSrc : (flipped ? backSrc : frontSrc)}
        alt={flipped && backSrc ? (backAlt ?? alt) : alt}
        draggable={false}
        onError={onError}
        style={{ ...faceStyle, ...containerStyle }}
      />
    );
  }

  // NO backface-visibility, deliberately. It's the usual way to hide the
  // away-facing side, but it only works if the 3D rotation is actually applied —
  // and when it isn't, it hides the BACK permanently (the back is pre-rotated
  // 180°, so it reads as facing away forever) and the flip goes blank. The
  // timer-driven visibility swap above already hides exactly one face at a
  // time, which makes backface-visibility redundant AND removes the only way
  // this can fail closed. The faces are coplanar, so leaving it off also avoids
  // relying on z-order between two overlapping siblings.
  const face = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    ...faceStyle,
  };

  return (
    <div style={{
      position: "relative",
      // Perspective belongs on the element that does NOT rotate; on the
      // rotating one it would be re-applied to the already-turned face and the
      // card would look like it was folding rather than turning.
      perspective: 1400,
      WebkitPerspective: 1400,
      aspectRatio: CARD_ASPECT,
      // Caller last: the carousel slot overrides this with a real width/height.
      ...containerStyle,
    }}>
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
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
          style={{ ...face, visibility: showBack ? "hidden" : "visible" }}
        />
        <img
          src={backSrc}
          alt={backAlt ?? alt}
          draggable={false}
          aria-hidden={!flipped}
          style={{
            ...face,
            transform: "rotateY(180deg)",
            WebkitTransform: "rotateY(180deg)",
            visibility: showBack ? "visible" : "hidden",
          }}
        />
      </div>
    </div>
  );
}
