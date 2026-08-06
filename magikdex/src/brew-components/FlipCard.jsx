import { useState } from "react";
import { rotationTransform } from "../lib/cardOrientation.js";

// A double-faced card that turns over in 3D instead of swapping its image.
//
// HOW IT WORKS: both faces stack, the back pre-rotated 180°, and
// backface-visibility hides whichever points away. Rotating their shared parent
// turns them together, so the browser animates one GPU transform rather than
// crossfading two images. Both faces resident also means the back is decoded
// before the turn starts — a lazily-swapped src would flash blank mid-flip.
//
// The container must be SIZED BY THE CALLER, because both faces are absolute
// and therefore contribute nothing to layout: either the caller already has a
// box (the carousel slot) or it takes the aspect-ratio default below.
//
// ── History, because two attempts failed in ways worth not repeating ─────────
// 1st (c173b43, reverted 25f6e93) shipped a DEAD flip to prod — the card never
//   showed its back. It left the front face in normal flow so it could size an
//   auto-height card, mixing an in-flow box with an absolute one in one
//   preserve-3d context, and backface-visibility had nothing reliable to hide.
//   Both faces are absolute now.
// 2nd replaced backface-visibility with a JS timer that swapped which face was
//   visible at half the transition's DURATION. Ben on device: "it does a cut, i
//   can tell at the midpoint the face of the card is just swapping." Half the
//   duration is not half the ANGLE under an eased curve, so the faces traded
//   places while the card still faced the viewer. Geometry has to decide the
//   handover, not a clock — which is precisely what backface-visibility does.
//
// Verified on device (Ben, 3rd pass pending): the rotation itself renders. Note
// that this environment CANNOT confirm that — its browser pane doesn't
// composite, so even a textbook pure-CSS flip card reports an identity
// transform and never reveals its back here. Property checks (preserve-3d set,
// transition present) are what produced false confidence the first time; they
// are not evidence that anything turns.

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
  // Degrees to turn each face so its text reads horizontally — 0 for the
  // overwhelming majority of cards. Per-face because a Battle is sideways on
  // its front and upright on its back. Callers resolve these from
  // lib/cardOrientation.js and pass 0 when the reader hasn't asked to rotate.
  frontRotate = 0,
  backRotate = 0,
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

  // Turning a face is its own transition so it reads as a separate gesture from
  // the flip, and so a rotate on a single-faced card still animates.
  const turn = deg => ({
    transform: rotationTransform(deg) ?? undefined,
    transition: reduceMotion ? "none" : "transform 320ms cubic-bezier(0.45, 0.05, 0.55, 0.95)",
  });

  // Single-faced card: no 3D machinery and no second <img>, so the carousel's
  // per-frame cost is unchanged for the vast majority of cards. Placed AFTER
  // every hook above — an early return in front of them would make the hook
  // order depend on whether a card happens to be double-faced.
  //
  // NOTE this is the path split and Kamigawa-flip cards take — they have one
  // shared image and no back face — so rotation has to be applied here, not
  // only in the 3D branch below. Those are the two layouts that need it most.
  if (!backSrc || !supports3d) {
    const showingBack = Boolean(backSrc) && flipped;
    return (
      <img
        src={!backSrc ? frontSrc : (flipped ? backSrc : frontSrc)}
        alt={showingBack ? (backAlt ?? alt) : alt}
        draggable={false}
        onError={onError}
        style={{
          ...faceStyle,
          ...containerStyle,
          ...turn(showingBack ? backRotate : frontRotate),
        }}
      />
    );
  }

  // backface-visibility is what hides the away-facing side, and it has to be
  // this rather than a JS timer swapping which face is visible.
  //
  // That timer WAS the previous version, as a hedge against 3D not rendering.
  // Ben on device: "it does a cut, i can tell at the midpoint the face of the
  // card is just swapping." The seam was the timer firing at half the DURATION
  // while the eased rotation was nowhere near half its ANGLE — so the faces
  // traded places with the card still turned toward the viewer, in full view.
  // backface-visibility can't have that bug: the browser decides from the real
  // geometry, so the handover always lands exactly at edge-on where there is
  // nothing to see. The same device pass also confirmed the rotation itself
  // works, which is what made the hedge unnecessary.
  const face = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
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
        // Symmetric ease-in-out: accelerate out of rest, decelerate into the
        // stop, which is how a hand actually turns a card. No bounce — a card
        // doesn't overshoot. The previous curve put its second control point
        // BEHIND its first (0.2 after 0.4), so it crawled, lunged through the
        // middle, then crawled again; that lunge is where the midpoint sat.
        transition: reduceMotion ? "none" : "transform 460ms cubic-bezier(0.45, 0.05, 0.55, 0.95)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        <img
          src={frontSrc}
          alt={alt}
          draggable={false}
          onError={onError}
          style={{ ...face, ...turn(frontRotate) }}
        />
        <img
          src={backSrc}
          alt={backAlt ?? alt}
          draggable={false}
          aria-hidden={!flipped}
          style={{
            ...face,
            // The pre-rotation that makes this the BACK comes first; any
            // reading-angle turn composes on top of it.
            transform: `rotateY(180deg)${rotationTransform(backRotate) ? ` ${rotationTransform(backRotate)}` : ""}`,
            WebkitTransform: `rotateY(180deg)${rotationTransform(backRotate) ? ` ${rotationTransform(backRotate)}` : ""}`,
            transition: reduceMotion ? "none" : "transform 320ms cubic-bezier(0.45, 0.05, 0.55, 0.95)",
          }}
        />
      </div>
    </div>
  );
}
