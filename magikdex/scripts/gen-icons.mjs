// Generate favicon + PWA icon assets from the canonical magıcdex device mark.
// Source of truth: src/assets/magicdex-dex-v3.svg (flat vectors, no filters).
//
// Outputs (all into public/):
//   favicon.svg              modern browsers  (rounded tile, transparent corners)
//   favicon.ico              16/32/48 multi-res fallback
//   icon-192.png             manifest "any"   (transparent corners)
//   icon-512.png             manifest "any"   (transparent corners)
//   icon-maskable-512.png    manifest "maskable" (full-bleed dark, safe-zone inset)
//   apple-touch-icon.png     iOS home screen  (180, full-bleed dark)
//
// Native-shell sources (into assets/, consumed by `npx @capacitor/assets generate`):
//   icon.png                 1024, full-bleed dark — iOS/Android app icons
//   splash.png / splash-dark.png
//                            2732, dark canvas with the mark centered at ~30%
//
// Run: node scripts/gen-icons.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const SRC = join(root, 'src', 'assets', 'magicdex-dex-v3.svg');
const OUT = join(root, 'public');

const BODY_BG = '#1a1410'; // matches the device body fill — full-bleed for iOS/maskable

const source = readFileSync(SRC, 'utf8');

// Full-bleed variant: drop the inset rounded-rect body + its stroke and paint the
// whole 512 canvas with the body colour, so iOS/Android corner masks have no
// transparent gaps to fill. Interior art keeps its ~9% inset = maskable safe zone.
const fullBleed = source
  .replace(/\s*<!-- Body -->[\s\S]*?fill="none" stroke="#2a2018" stroke-width="4"\/>/, '')
  .replace(
    '<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">',
    `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">\n  <rect x="0" y="0" width="512" height="512" fill="${BODY_BG}"/>`
  );

const png = (svg, size, opts = {}) =>
  sharp(Buffer.from(svg), { density: 384 }).resize(size, size, opts).png().toBuffer();

async function main() {
  // Modern SVG favicon — canonical source verbatim.
  writeFileSync(join(OUT, 'favicon.svg'), source);

  // "any" PWA icons keep the rounded-tile look (transparent corners).
  await png(source, 192).then((b) => writeFileSync(join(OUT, 'icon-192.png'), b));
  await png(source, 512).then((b) => writeFileSync(join(OUT, 'icon-512.png'), b));

  // Maskable + Apple touch: full-bleed dark, no transparent corners.
  await png(fullBleed, 512).then((b) => writeFileSync(join(OUT, 'icon-maskable-512.png'), b));
  await png(fullBleed, 180).then((b) => writeFileSync(join(OUT, 'apple-touch-icon.png'), b));

  // Native-shell sources for @capacitor/assets (icon + splash, both platforms).
  const CAP_ASSETS = join(root, 'assets');
  mkdirSync(CAP_ASSETS, { recursive: true });
  await png(fullBleed, 1024).then((b) => writeFileSync(join(CAP_ASSETS, 'icon.png'), b));
  // Splash: 2732×2732 dark canvas, rounded-tile mark centered at ~30% width —
  // the mark floats on the dark field rather than stretching edge-to-edge.
  const mark = await png(source, 820);
  const splash = await sharp({
    create: { width: 2732, height: 2732, channels: 4, background: BODY_BG },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
  writeFileSync(join(CAP_ASSETS, 'splash.png'), splash);
  writeFileSync(join(CAP_ASSETS, 'splash-dark.png'), splash);

  // Multi-res .ico (16/32/48) from the rounded-tile source.
  const icoSizes = [16, 32, 48];
  const icoPngs = await Promise.all(icoSizes.map((s) => png(source, s)));
  const ico = await pngToIco(icoPngs);
  writeFileSync(join(OUT, 'favicon.ico'), ico);

  console.log('Icons generated into public/:');
  for (const f of [
    'favicon.svg',
    'favicon.ico',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
  ]) {
    console.log('  ' + f);
  }
  console.log('Native-shell sources generated into assets/:');
  for (const f of ['icon.png', 'splash.png', 'splash-dark.png']) {
    console.log('  ' + f);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
