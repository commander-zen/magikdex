// Slice a Gemini multi-sprite sheet (magenta bg) into individual true-pixel sprites.
// - finds sprites as connected blobs (with a little dilation so wings/wisps stay attached)
// - orders them in reading order (row clusters by y, then x)
// - per sprite, recovers the fake-pixel pitch AND phase from edge positions
//   (phase coherence |sum e^{2πi x/B}|), so fractional pitches like 3.4px snap cleanly
// - samples the median colour at each block centre; unifies near-black outline
// usage: node scripts/sprites/slice-sheet.mjs <sheet> <outDir> name1,name2,...
//   env KEY=green   sheet is on #00FF00 instead of magenta (use for purple art)
//   env PITCH=5.72  force the fake-pixel pitch when detection locks onto a harmonic
//                   (check: sprites should come out ~44-56 tall; doubled => halve it)
//   env COLGAP=2    min empty columns between sprites; NOISE=20 ignores glow speckle
import sharp from "sharp";

const [sheet, outDir, namesArg] = process.argv.slice(2);
const names = namesArg.split(",");
// KEY=green for sheets on #00FF00 (use it whenever the art has purples/magentas).
const isBg = process.env.KEY === "green"
  ? (r, g, b) => g > 150 && g - Math.max(r, b) > 80
  : (r, g, b) => r > 130 && b > 110 && g < 110 && b - g > 50;

const { data, info } = await sharp(sheet).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const px = (x, y) => { const i = (y * w + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const fg = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fg[y * w + x] = isBg(...px(x, y)) ? 0 : 1;

// Projection slicing: split into rows on empty horizontal bands, then each row
// into sprites on empty vertical bands. A line counts as empty with <= NOISE fg
// pixels (JPEG speckle). Gaps narrower than MINGAP are bridged so a sprite's own
// see-through bits (between legs, under wings) don't split it.
const NOISE = Number(process.env.NOISE ?? 2), MINGAP = Number(process.env.COLGAP ?? 6);
function runs(count, len, minGap = MINGAP) {
  const out = []; let start = -1, lastOn = -1;
  for (let i = 0; i <= len; i++) {
    const filled = i < len && count(i) > NOISE;
    if (filled) { if (start < 0) start = i; lastOn = i; }
    else if (start >= 0 && (i === len || i - lastOn >= minGap)) { out.push([start, lastOn]); start = -1; }
  }
  return out;
}
// Rows sit close together on Gemini sheets, so any clean line splits them.
const rowBands = runs(y => { let n = 0; for (let x = 0; x < w; x++) n += fg[y * w + x]; return n; }, h, 1);
const ordered = [], perRow = [];
for (const [ry0, ry1] of rowBands) {
  const cols = runs(x => { let n = 0; for (let y = ry0; y <= ry1; y++) n += fg[y * w + x]; return n; }, w)
    .filter(([a, b]) => b - a > 12);
  perRow.push(cols.length);
  for (const [cx0, cx1] of cols) {
    let y0 = ry1, y1 = ry0;   // tighten vertically to this sprite
    for (let y = ry0; y <= ry1; y++) { let n = 0; for (let x = cx0; x <= cx1; x++) n += fg[y * w + x]; if (n > NOISE) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    ordered.push({ x0: cx0, x1: cx1, y0, y1 });
  }
}
console.log(`found ${ordered.length} sprites in ${rowBands.length} rows (${perRow.join("/")}); ${names.length} names given`);

// Phase for a known pitch: where the block edges sit inside this sprite.
function phase(b, B) {
  const xs = [], ys = [];
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0 + 1; x <= b.x1; x++) if (diff(px(x, y), px(x - 1, y)) > 70) xs.push(x);
  for (let x = b.x0; x <= b.x1; x++) for (let y = b.y0 + 1; y <= b.y1; y++) if (diff(px(x, y), px(x, y - 1)) > 70) ys.push(y);
  const ph = pos => { let re = 0, im = 0; for (const p of pos) { re += Math.cos(2 * Math.PI * p / B); im += Math.sin(2 * Math.PI * p / B); } return ((Math.atan2(im, re) / (2 * Math.PI)) * B + B) % B; };
  return { phx: ph(xs), phy: ph(ys) };
}
// Pitch + phase from colour-edge positions along one axis.
function pitch(b) {
  const xs = [], ys = [];
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0 + 1; x <= b.x1; x++) if (diff(px(x, y), px(x - 1, y)) > 70) xs.push(x);
  for (let x = b.x0; x <= b.x1; x++) for (let y = b.y0 + 1; y <= b.y1; y++) if (diff(px(x, y), px(x, y - 1)) > 70) ys.push(y);
  const coh = (pos, B) => { let re = 0, im = 0; for (const p of pos) { re += Math.cos(2 * Math.PI * p / B); im += Math.sin(2 * Math.PI * p / B); } return [Math.hypot(re, im) / pos.length, Math.atan2(im, re)]; };
  let scores = [];
  for (let B = 2.5; B <= 9; B += 0.02) scores.push([B, coh(xs, B)[0] + coh(ys, B)[0]]);
  const max = Math.max(...scores.map(s => s[1]));
  // B/2 is as coherent as B; take the LARGEST pitch near the max.
  const B = scores.filter(s => s[1] > max * 0.92).map(s => s[0]).sort((a, b) => b - a)[0];
  const ph = (pos) => ((coh(pos, B)[1] / (2 * Math.PI)) * B + B) % B;
  return { B, phx: ph(xs), phy: ph(ys) };
}

const pitches = ordered.map(b => pitch(b).B).sort((a, c) => a - c);
const SHEET_B = Number(process.env.PITCH) || pitches[pitches.length >> 1]; // PITCH= overrides when detection locks onto a half-pitch harmonic
console.log(`sheet pitch ${SHEET_B.toFixed(2)}px (median of ${pitches.length})`);
const report = [];
for (let k = 0; k < ordered.length; k++) {
  const b = ordered[k], name = names[k] ?? `extra${k}`;
  const B = SHEET_B, { phx, phy } = phase(b, B);
  // Block grid aligned to the recovered phase, covering the bbox.
  const gx0 = Math.floor((b.x0 - phx) / B), gx1 = Math.ceil((b.x1 - phx) / B);
  const gy0 = Math.floor((b.y0 - phy) / B), gy1 = Math.ceil((b.y1 - phy) / B);
  const gw = gx1 - gx0, gh = gy1 - gy0, out = Buffer.alloc(gw * gh * 4);
  let minX = gw, minY = gh, maxX = -1, maxY = -1;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const cx = phx + (gx0 + gx + 0.5) * B, cy = phy + (gy0 + gy + 0.5) * B, samples = [];
    for (let dy = -0.25; dy <= 0.25; dy += 0.25) for (let dx = -0.25; dx <= 0.25; dx += 0.25) {
      const x = Math.round(cx + dx * B), y = Math.round(cy + dy * B);
      if (x >= b.x0 && y >= b.y0 && x <= b.x1 && y <= b.y1) samples.push(px(x, y));
    }
    const keep = samples.filter(c => !isBg(...c));
    if (keep.length * 2 <= samples.length || keep.length === 0) continue;
    const med = i => keep.map(c => c[i]).sort((p, q) => p - q)[keep.length >> 1];
    let c = [med(0), med(1), med(2)];
    if (c[0] + c[1] + c[2] < 120) c = [24, 20, 32];
    const o = (gy * gw + gx) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    minX = Math.min(minX, gx); maxX = Math.max(maxX, gx); minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
  }
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  await sharp(out, { raw: { width: gw, height: gh, channels: 4 } }).extract({ left: minX, top: minY, width: tw, height: th }).png().toFile(`${outDir}/${name}.png`);
  report.push(`${name.padEnd(13)} pitch ${B.toFixed(2)}px -> ${tw}x${th}`);
}
console.log(report.join("\n"));
