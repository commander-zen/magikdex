// Packs assets/sprites/<id>.png (the snapped, approved sprites) into ONE atlas
// the app ships: src/assets/sprites/legend-sprites.png + legend-sprites.json.
//
// Every cell is the same size (the largest sprite's width x height) and each
// sprite sits bottom-centred in its cell, so all creatures stand on one floor
// line and share one pixel scale — the Pokémon-box look (Ben, 2026-11-09).
//
// usage: npm run build:sprites   (re-run after adding/replacing any sprite)
import sharp from "sharp";
import { readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../../assets/sprites/", import.meta.url));
const OUT = fileURLToPath(new URL("../../src/assets/sprites/", import.meta.url));
const COLS = 8;

const ids = readdirSync(SRC).filter(f => f.endsWith(".png")).map(f => f.slice(0, -4)).sort();
const metas = await Promise.all(ids.map(id => sharp(join(SRC, `${id}.png`)).metadata()));
const cw = Math.max(...metas.map(m => m.width));
const ch = Math.max(...metas.map(m => m.height));
const rows = Math.ceil(ids.length / COLS);

await sharp({ create: { width: COLS * cw, height: rows * ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(ids.map((id, i) => ({
    input: join(SRC, `${id}.png`),
    left: (i % COLS) * cw + Math.floor((cw - metas[i].width) / 2),
    top: Math.floor(i / COLS) * ch + (ch - metas[i].height),
  })))
  .png({ compressionLevel: 9, palette: true })
  .toFile(join(OUT, "legend-sprites.png"));

writeFileSync(join(OUT, "legend-sprites.json"), JSON.stringify({ cell: [cw, ch], cols: COLS, ids }, null, 1) + "\n");
console.log(`atlas: ${ids.length} sprites, cell ${cw}x${ch}, ${COLS}x${rows}`);
