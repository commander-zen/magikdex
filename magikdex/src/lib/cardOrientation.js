// Cards whose printed content is rotated inside the frame.
//
// Scryfall ALWAYS returns 488x680 portrait images — verified against the live
// API for every layout below. It never hands back a landscape image for a
// landscape card; it rotates the artwork inside a portrait frame instead. So
// these cards arrive unreadable and the only fix is to rotate them back.
//
// This matters more here than on desktop: manifest.webmanifest sets
// "orientation": "portrait", so the installed PWA is orientation-locked and
// turning the phone does nothing.
//
// ROTATION IS PER-FACE, NOT PER-CARD. A Battle is the proof — Invasion of
// Segovia is sideways, but Caetus on its back is upright. A card-level flag
// would rotate both and break the back.

// A 90°-turned portrait card has to shrink to fit back inside a portrait box:
// its height becomes its width, so it scales by the card's own aspect ratio.
// Cards end up at ~72% — smaller, but readable, which is the whole point.
export const ROTATED_FIT_SCALE = 488 / 680;

// Degrees to turn a given face so its text reads horizontally. 0 = leave alone.
//
// Deliberately NOT automatic: on Aftermath cards (Commit // Memory) only the
// BOTTOM half is sideways — the main spell on top is already upright, so
// auto-rotating would fix one half and break the other. Callers use this to
// decide whether to OFFER a rotate control, and the reader chooses.
export function faceRotation(card, faceIndex = 0) {
  if (!card) return 0;
  const layout = card.layout;

  // Split covers three printings that all share one sideways image: plain
  // splits (Fire // Ice), Aftermath (Commit // Memory), and Rooms (Charred
  // Foyer // Warped Space). Scryfall gives them all layout "split" — Aftermath
  // is marked by keywords, Rooms by their type line, neither by layout.
  if (layout === "split") return 90;

  // Kamigawa flip cards: the lower half is printed upside down. One image, so
  // the face index is irrelevant.
  if (layout === "flip") return 180;

  // Battles are layout "transform" (there is no "battle" layout), which is why
  // they already flip correctly — only their front is printed sideways.
  if (layout === "transform" || layout === "modal_dfc") {
    const type = card.card_faces?.[faceIndex]?.type_line ?? "";
    if (/\bBattle\b/.test(type)) return 90;
  }

  return 0;
}

// The CSS transform for a face, or null when it needs none. Kept next to the
// rule above so the fit-scale can never drift out of sync with the angle.
export function rotationTransform(deg) {
  if (!deg) return null;
  // Only quarter turns change the bounding box; 180° keeps it and needs no scale.
  return deg % 180 === 0
    ? `rotate(${deg}deg)`
    : `rotate(${deg}deg) scale(${ROTATED_FIT_SCALE})`;
}
