// Generate print-ready Deck ID Cards — one 1050×750 PNG per deck, plus batch.
//
//   node scripts/gen-deck-cards.mjs
//   node scripts/gen-deck-cards.mjs --from scripts/deck-cards.sample.json
//   node scripts/gen-deck-cards.mjs --out dist/deck-cards --only 0042
//
// Output is 1050×750 pixels at 300dpi — 3.5in × 2.5in, landscape, the size that
// sits in a deck box next to the deck. The pixel dimensions ARE the resolution;
// nothing is resampled or scaled on the way out. The PNG also carries a 300
// density tag so that a print shop's software lays it out at physical size
// instead of guessing 72dpi and printing a card the size of a postage stamp.
//
// ⚠️ FONT SETUP MUST HAPPEN BEFORE SHARP LOADS. fontconfig latches its config on
// first use, so setupFonts() runs at the top and sharp is pulled in by dynamic
// import afterwards. Converting these to static imports will silently reinstate
// the default-sans substitution that card-fonts.mjs exists to prevent.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { setupFonts, assertFonts, ensureFontconfigEnv, DISPLAY_FAMILY } from './lib/card-fonts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { from: join(ROOT, 'scripts', 'deck-cards.sample.json'), out: join(ROOT, 'dist', 'deck-cards'), only: null, svg: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = resolve(argv[++i]);
    else if (a === '--out') out.out = resolve(argv[++i]);
    else if (a === '--only') out.only = argv[++i];
    else if (a === '--svg') out.svg = true;       // keep the intermediate, for debugging
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

// ── deck normalisation ───────────────────────────────────────────────────────
// Accepts either a hand-written record or a raw public.decks row, so the same
// generator works against the sample file today and against a Supabase query
// once migration 035 is applied.
//
// The five vectors are read by their migration-034 column names first, falling
// back to a plain `stats` object. NULL IS PRESERVED AS NULL — see below.
function normalise(raw, index) {
  const stats = {};
  const src = raw.stats ?? {};
  for (const v of VECTORS) {
    const fromColumn = raw[v.column];
    const fromStats = src[v.key] ?? src[v.column];
    const n = fromColumn ?? fromStats;
    // Null means "not graded", which is a different fact from zero and must not
    // be collapsed into one. isGraded() in ScryCheckRadar.jsx draws the same
    // distinction for the same reason.
    stats[v.key] = n === null || n === undefined || n === '' ? null : Number(n);
  }

  return {
    name: raw.name ?? raw.deck_name ?? '(untitled deck)',
    playstyle: raw.playstyle ?? null,
    bracket: raw.bracket ?? raw.scrycheck_bracket ?? null,
    archetype: raw.archetype ?? null,
    catalog_number: raw.catalog_number ?? String(index + 1).padStart(4, '0'),
    decklist_url: raw.decklist_url ?? raw.scrycheck_url ?? raw.url ?? raw.deck_url ?? null,
    accent: raw.accent ?? undefined,
    stats,
  };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';

let VECTORS;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node scripts/gen-deck-cards.mjs [--from data.json] [--out dir] [--only <catalog|slug>] [--svg]');
    return;
  }

  // Fonts first, then sharp. Order matters — see the header.
  // assertFonts() runs before the re-exec so a missing font fails immediately
  // rather than after spawning a child that would fail anyway.
  const { confPath, files: vendored } = setupFonts();
  assertFonts();
  ensureFontconfigEnv(confPath);   // in the parent process this does not return

  const [{ default: sharp }, { default: QRCode }, card] = await Promise.all([
    import('sharp'),
    import('qrcode'),
    import('./lib/deck-id-card.mjs'),
  ]);

  VECTORS = card.CARD_VECTORS;

  const raw = JSON.parse(readFileSync(args.from, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.decks;
  if (!Array.isArray(list)) throw new Error(`${args.from} must be an array of decks, or { "decks": [...] }`);

  let decks = list.map(normalise);
  if (args.only) {
    const q = String(args.only).toLowerCase();
    decks = decks.filter((d) => String(d.catalog_number).toLowerCase() === q || slug(d.name).includes(q));
    if (!decks.length) throw new Error(`--only ${args.only} matched no deck`);
  }

  mkdirSync(args.out, { recursive: true });
  const measure = card.createMeasurer(sharp);

  console.log(`fonts: ${vendored.join(', ')}`);
  console.log(`decks: ${decks.length}  →  ${args.out}\n`);

  const warnings = [];

  for (const deck of decks) {
    const nameFit = await card.fitDeckName(deck.name, measure);
    if (nameFit.overflow) {
      warnings.push(`${deck.name}: too long to fit the 540px column even at the 40px floor — it is clipped`);
    }

    // Accent: the mockup inverts the final word of the name. Applied only when
    // there is more than one line or word to invert, so a one-word deck name is
    // not rendered as a single solid ink block.
    let accentLine = -1;
    let accentW = 0;
    const wantAccent = deck.accent !== null && nameFit.lines.length > 1;
    if (wantAccent) {
      accentLine = nameFit.lines.length - 1;
      accentW = await measure(nameFit.lines[accentLine], { family: DISPLAY_FAMILY, weight: 400 });
    }

    // The tag box is shrink-wrapped to its text and must not cross the divider,
    // so the type steps down when the playstyle name is long.
    const tag = card.tagText(deck);
    const tagFit = await card.fitTag(tag, measure);
    if (tagFit.overflow) {
      warnings.push(`${deck.name}: playstyle/bracket tag "${tag}" does not fit the left column even at 26px`);
    }

    let qr = null;
    if (deck.decklist_url) {
      // errorCorrectionLevel M is the balance the mockup implies: enough
      // redundancy to survive a scuffed card out of a deck box without inflating
      // the module count to the point the modules get small at 198px.
      qr = QRCode.create(deck.decklist_url, { errorCorrectionLevel: 'M' });

      // A longer URL means a higher QR version, more modules, and SMALLER
      // modules inside the fixed 198px code area — which is how a card that
      // scanned fine in testing stops scanning once someone pastes a long
      // Archidekt link. 5px at 300dpi is ~0.42mm, around the floor print QR
      // guidance uses, so anything under that gets said out loud.
      const modulePx = card.QR_INNER_PX / qr.modules.size;
      if (modulePx < 5) {
        warnings.push(
          `${deck.name}: QR is version ${qr.version} (${qr.modules.size}×${qr.modules.size}), ` +
          `so modules are only ${modulePx.toFixed(2)}px (~${(modulePx / 300 * 25.4).toFixed(2)}mm) — ` +
          `shorten the URL or enlarge the QR before printing`
        );
      }
    } else {
      warnings.push(`${deck.name}: no decklist_url — the QR box prints empty`);
    }

    const captionLines = await card.wrapCaption(measure);
    const svg = card.buildCardSvg(deck, {
      nameFit, qr, accentLine, accentW, captionLines,
      tagW: tagFit.widthPerPx, tagSize: tagFit.size,
    });

    const base = `${String(deck.catalog_number)}-${slug(deck.name)}`;
    if (args.svg) writeFileSync(join(args.out, `${base}.svg`), svg, 'utf8');

    const file = join(args.out, `${base}.png`);
    await sharp(Buffer.from(svg), { density: 72 })   // 1 SVG px → 1 PNG px, no scaling
      .png({ compressionLevel: 9 })
      .withMetadata({ density: 300 })                // 1050px / 300dpi = 3.5in
      .toFile(file);

    const ungraded = VECTORS.filter((v) => deck.stats[v.key] === null).length;
    const note = ungraded ? `  (${ungraded}/5 ungraded)` : '';
    console.log(`  ✓ ${base}.png   ${nameFit.size}px name, ${nameFit.lines.length} line(s)${note}`);
  }

  if (warnings.length) {
    console.log('\nwarnings:');
    for (const w of warnings) console.log(`  ! ${w}`);
  }
  console.log(`\ndone — ${decks.length} card(s), 1050×750 @ 300dpi`);
}

main().catch((e) => {
  console.error(`\n${e.message}\n`);
  process.exit(1);
});
