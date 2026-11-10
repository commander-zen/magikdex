import atlasUrl from "../assets/sprites/legend-sprites.png";
import atlas from "../assets/sprites/legend-sprites.json";
import { legendSpriteId } from "../lib/legendSprite.js";

// Pixel-art creature sprite from the shared atlas (npm run build:sprites).
// Drawn at exactly 1 CSS px per sprite pixel: one shared scale for every
// creature (Ben, 2026-11-09), and a clean 2x/3x on retina screens. Every cell
// is the same size with the sprite bottom-centred, so creatures share a floor.
const [CW, CH] = atlas.cell;
const INDEX = new Map(atlas.ids.map((id, i) => [id, i]));

// Decorative: the slot's button carries the legend's name as its label.
export default function LegendSprite({ typeLine, style }) {
  const i = INDEX.get(legendSpriteId(typeLine)) ?? INDEX.get("legend");
  return (
    <div
      aria-hidden="true"
      style={{
        width: CW,
        height: CH,
        backgroundImage: `url(${atlasUrl})`,
        backgroundPosition: `-${(i % atlas.cols) * CW}px -${Math.floor(i / atlas.cols) * CH}px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
