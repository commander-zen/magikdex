// Makes the two Deck ID Card fonts visible to sharp, and refuses to render if
// they are not.
//
// ── Why this file exists at all ──────────────────────────────────────────────
// sharp rasterises SVG through librsvg → pango → fontconfig. fontconfig only
// knows about fonts it has been pointed at, and neither Archivo Black nor
// JetBrains Mono is installed on a normal Windows box (verified: 259 system
// families, neither present).
//
// The failure mode is the reason this is a hard gate rather than a warning.
// pango does NOT error on a missing family — it silently substitutes the
// default sans. Measured directly: at 80px, `Archivo Black`, `JetBrains Mono`
// and the deliberately fake `TotallyFakeFontXYZ` all produced a byte-identical
// PNG. So a missing font does not break the build, it ships a card that looks
// plausible and is wrong — on a print run you pay for. Hence assertFonts().
//
// ── Why a generated fonts.conf and not a checked-in one ──────────────────────
// fontconfig's <dir> wants an absolute path, and an absolute path in a repo is
// wrong on every machine except the one that wrote it. Generating the file into
// a cache dir at run time keeps the repo path-free.
//
// ⚠️ SETTING process.env IS NOT ENOUGH, AND FAILS SILENTLY. Assigning
// process.env.FONTCONFIG_FILE before dynamic-importing sharp looks like it
// should work and does not: on Windows the native library reads its own copy of
// the environment, so fontconfig never sees the value. Measured A/B on this
// machine, rendering "GRAVEYARD" at 86px and comparing ink widths:
//
//   env set in-process   Archivo Black 387px  ← system serif fallback, WRONG
//   env set externally   Archivo Black 583px  ← the real font
//                        (and Arial/Times stop resolving, proving isolation)
//
// So the process re-execs itself once with the variable in the child's
// environment. That is what ensureFontconfigEnv() is for, and it must run before
// anything imports sharp.

import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

export const FONT_DIR = join(ROOT, 'assets', 'fonts');
const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'deck-id-card');

// The family names as pango will resolve them — these are the names baked into
// the font files, not arbitrary labels, and they must match the font-family
// strings the SVG asks for.
export const DISPLAY_FAMILY = 'Archivo Black';
export const MONO_FAMILY = 'JetBrains Mono';

// One representative file per family is enough to prove the family is vendored.
// The mono family ships several weights (the card uses 500/600/700/800) and a
// variable font satisfies all of them from one file, so the check is on family
// presence rather than on an exact filename.
const REQUIRED = [
  { family: DISPLAY_FAMILY, match: /archivo.*black/i },
  { family: MONO_FAMILY, match: /jetbrains.*mono/i },
];

function vendoredFiles() {
  if (!existsSync(FONT_DIR)) return [];
  return readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f));
}

/**
 * Point fontconfig at assets/fonts. Call BEFORE importing sharp.
 * Returns the list of vendored font files it found.
 */
export function setupFonts() {
  mkdirSync(CACHE_DIR, { recursive: true });

  // <cachedir> is not optional: without a writable one fontconfig rescans every
  // font on every run, which turns a batch of 40 cards into a visibly slow one.
  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR.replace(/\\/g, '/')}</dir>
  <cachedir>${join(CACHE_DIR, 'fc').replace(/\\/g, '/')}</cachedir>
</fontconfig>
`;

  // NOTE: this config intentionally does NOT include the system font dirs. The
  // card must render identically on Ben's laptop and on a build box, and the
  // way to guarantee that is to let it see only the fonts the repo ships. A
  // system font leaking in as a substitute is the exact silent-wrong-output
  // failure this module exists to prevent.
  // Forward slashes: the value goes into the environment for a native library,
  // and that is the form verified to work.
  const confPath = join(CACHE_DIR, 'fonts.conf').replace(/\\/g, '/');
  writeFileSync(confPath, conf, 'utf8');

  return { confPath, files: vendoredFiles() };
}

/**
 * Guarantee fontconfig actually sees our config, re-execing once if it does not.
 *
 * Returns only in the child (or when the environment was already correct). In
 * the parent it never returns — it forwards the child's exit code, so a failed
 * render still fails the command.
 */
export function ensureFontconfigEnv(confPath) {
  if (process.env.FONTCONFIG_FILE === confPath) return;

  const r = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, FONTCONFIG_FILE: confPath },
  });
  process.exit(r.status ?? 1);
}

/**
 * Throw with actionable copy if either family is missing. Every failure here is
 * one a person has to act on, so none of them are swallowed.
 */
export function assertFonts() {
  const files = vendoredFiles();
  const missing = REQUIRED.filter((r) => !files.some((f) => r.match.test(f)));
  if (!missing.length) return files;

  throw new Error(
    `Deck ID Card fonts are not vendored: ${missing.map((m) => m.family).join(', ')}\n\n` +
      `  Expected .ttf/.otf files in:\n    ${FONT_DIR}\n` +
      `  Found: ${files.length ? files.join(', ') : '(nothing)'}\n\n` +
      `  Both are SIL Open Font License, so they can live in the repo.\n` +
      `  Without them pango silently substitutes a default sans and the card\n` +
      `  renders wrong WITHOUT failing — which is why this stops here.`
  );
}
