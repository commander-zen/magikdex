// Gemini fake-pixel image (magenta bg) -> true native-resolution pixel sprite.
// 1) key magenta, 2) take the LEFT-most figure (Gemini often draws two),
// 3) measure the fake-pixel block size from colour-run lengths, 4) sample the
// median colour at each block centre (kills JPEG noise), 5) snap near-black to
// one outline colour. Writes <name>.png (transparent, native size) + prints size.
// usage: node scripts/sprites/snap-single.mjs <outDir> name=file[#k] ...  (#k = k-th figure)
import sharp from "sharp";

const [outDir, ...jobs] = process.argv.slice(2);
const isBg = (r, g, b) => r > 130 && b > 110 && g < 110 && b - g > 50;     // magenta, with JPEG slop

for (const job of jobs) {
  const [name, spec] = job.split("="); const file = spec.split("#")[0];
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (x, y) => { const i = (y * w + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const fg = (x, y) => !isBg(...px(x, y));

  // Column occupancy -> split figures on wide magenta gaps. Default = left-most;
  // "name=file#k" picks the k-th figure (Gemini sometimes adds props beside it).
  const pick = Number(spec.split("#")[1] ?? 0);
  const colHas = Array.from({ length: w }, (_, x) => { let n = 0; for (let y = 0; y < h; y += 2) if (fg(x, y)) n++; return n > 2; });
  const figs = [];
  for (let x = 0, start = -1, last = -1; x <= w; x++) {
    if (x < w && colHas[x]) { if (start < 0) start = x; last = x; }
    else if (start >= 0 && (x === w || x - last > 40)) { figs.push([start, last]); start = -1; }
  }
  const [x0, x1] = figs[Math.min(pick, figs.length - 1)];
  let y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x += 2) if (fg(x, y)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }

  // Block size: mode of horizontal run lengths between colour changes, inside the figure.
  const runs = new Map();
  const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  for (let y = y0; y <= y1; y += 3) {
    let run = 1;
    for (let x = x0 + 1; x <= x1; x++) {
      if (diff(px(x, y), px(x - 1, y)) > 60) { if (run >= 6 && run <= 40) runs.set(run, (runs.get(run) ?? 0) + 1); run = 1; } else run++;
    }
  }
  // Smooth the histogram so 15/16/17 vote together, then take the smallest strong peak.
  const score = r => (runs.get(r - 1) ?? 0) + (runs.get(r) ?? 0) + (runs.get(r + 1) ?? 0);
  let best = 8; for (let r = 6; r <= 40; r++) if (score(r) > score(best)) best = r;
  const B = best;

  const gw = Math.round((x1 - x0 + 1) / B), gh = Math.round((y1 - y0 + 1) / B);
  const sx = (x1 - x0 + 1) / gw, sy = (y1 - y0 + 1) / gh;
  const out = Buffer.alloc(gw * gh * 4);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const samples = [];
    for (let dy = -0.25; dy <= 0.25; dy += 0.125) for (let dx = -0.25; dx <= 0.25; dx += 0.125) {
      const x = Math.min(w - 1, Math.round(x0 + (gx + 0.5 + dx) * sx)), y = Math.min(h - 1, Math.round(y0 + (gy + 0.5 + dy) * sy));
      samples.push(px(x, y));
    }
    const bgVotes = samples.filter(c => isBg(...c)).length;
    const i = (gy * gw + gx) * 4;
    if (bgVotes > samples.length / 2) continue;               // transparent
    const keep = samples.filter(c => !isBg(...c));
    const med = k => keep.map(c => c[k]).sort((a, b) => a - b)[keep.length >> 1];
    let c = [med(0), med(1), med(2)];
    if (c[0] + c[1] + c[2] < 120) c = [24, 20, 32];           // one outline colour
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  }
  await sharp(out, { raw: { width: gw, height: gh, channels: 4 } }).png().toFile(`${outDir}/${name}.png`);
  const drift = B < 9 || gw > 80 || gh > 80 ? "  <-- DRIFT: too detailed / not chibi, regenerate" : gh > 60 ? "  <-- TOO BIG: the set is ~48-59 tall, regenerate smaller" : "";
  console.log(`${name}: block ${B}px -> ${gw}x${gh} native pixels${drift}`);
}
