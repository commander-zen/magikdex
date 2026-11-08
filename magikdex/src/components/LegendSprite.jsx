import spriteSheet from "../assets/sprites/legend-sprites.svg?raw";
import { legendSpriteId } from "../lib/legendSprite.js";

// The sheet ships display:none, which some engines refuse to resolve <use>
// against. Zero-size and out of flow works everywhere.
const SHEET_HTML = spriteSheet.replace('style="display:none"', 'width="0" height="0" focusable="false"');

// Mount ONCE per screen, anywhere — <use href="#sprite-…"> resolves document-wide.
export function SpriteSheet() {
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      dangerouslySetInnerHTML={{ __html: SHEET_HTML }}
    />
  );
}

// Decorative: the legend's name is always rendered beside it, so it is hidden from AT.
export default function LegendSprite({ typeLine, color, style }) {
  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      style={{ color, display: "block", ...style }}
    >
      <use href={`#sprite-${legendSpriteId(typeLine)}`} />
    </svg>
  );
}
