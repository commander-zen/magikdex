// Edge-only magenta-halo cleanup. A pixel is fringe when it touches transparency
// AND is magenta-ish (red and blue both well above green, red≈blue). Fringe is
// recoloured to the outline colour, never deleted, so purple sprites keep their
// silhouettes. Repeats twice to catch 2-px halos.
// usage: node scripts/sprites/defringe.mjs <png>...  (env KEY=green for green-screen art)
import sharp from "sharp";
const OUTLINE = [24, 20, 32];
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const a = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3];
  let fixed = 0;
  for (let pass = 0; pass < 2; pass++) {
    const hits = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; if (!data[i + 3]) continue;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const edge = !a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1);
      const magenta = process.env.KEY === "green" ? g - r > 40 && g - b > 40 : r - g > 40 && b - g > 40 && Math.abs(r - b) < 70;
      if (edge && magenta) hits.push(i);
    }
    for (const i of hits) { data[i] = OUTLINE[0]; data[i + 1] = OUTLINE[1]; data[i + 2] = OUTLINE[2]; }
    fixed += hits.length;
    if (!hits.length) break;
  }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(f + ".tmp.png");
  const { renameSync } = await import("node:fs"); renameSync(f + ".tmp.png", f);
  if (fixed) console.log(`${f.split(/[\/]/).pop()}: ${fixed} fringe px`);
}
