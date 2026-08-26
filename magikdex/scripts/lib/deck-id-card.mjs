// The Deck ID Card — a 1050×750 print-ready reference card that ships inside a
// deck box next to the physical deck.
//
// 1050×750px is 3.5in × 2.5in at true 300dpi. Nothing here resamples: the SVG is
// authored at exactly those pixel dimensions and sharp writes exactly those
// pixels out, so the PNG is 300dpi by construction rather than by metadata.
//
// ── Where the numbers come from ──────────────────────────────────────────────
// scripts/reference/deck-id-card-mockup-v4.html is the spec. Its values were NOT
// eyeballed or re-derived from the stylesheet — the mockup was served over HTTP
// with both webfonts confirmed loaded (document.fonts.check passed for Archivo
// Black and JetBrains Mono) and every box read back out of getBoundingClientRect.
// The constants below are those measurements.
//
// Two CSS facts drive the whole coordinate system, and both are easy to get
// wrong by reading the stylesheet alone:
//
//   1. `.card` is `box-sizing: border-box` with a 10px border, so the border is
//      INSIDE the 1050×750 and the visible paper is 1030×730.
//   2. An absolutely positioned child resolves against the PADDING box, so every
//      `top:44px` in the mockup is 54px from the card's outer edge. That +10 is
//      already baked into the constants here — do not add it again.
//
// ── Why SVG <text> and not paths ─────────────────────────────────────────────
// SVG's `y` on <text> IS the baseline, so this file never has to reproduce CSS's
// line-box model — it places baselines directly at the measured positions. That
// sidesteps the one genuinely fragile part of a CSS→SVG port.

import { MONO_FAMILY, DISPLAY_FAMILY } from './card-fonts.mjs';

// ── Canvas ───────────────────────────────────────────────────────────────────
export const CARD_W = 1050;
export const CARD_H = 750;
const BORDER = 10;

// ── Palette (mockup :root) ───────────────────────────────────────────────────
// Light on purpose and non-negotiable: full-bleed dark backgrounds are expensive
// and unreliable to print at volume, and dark-on-light is what makes the QR scan.
const PAPER = '#F5F1E6';
const INK = '#161311';
const YELLOW = '#F5C400';
const GRAY = '#6B6459';
const TRACK = '#E1DACB';

// ── Type metrics, measured from the mockup render ────────────────────────────
// Ascent as a multiple of font-size, used to convert a CSS box top into an SVG
// baseline. Measured via canvas fontBoundingBoxAscent against the real font
// files: JetBrains Mono 1.02 (22→22.44, 40→40.8), Archivo Black 1.035 (86→89.0).
const MONO_ASC = 1.02;
const MONO_DESC = 0.30;
const DISPLAY_ASC = 1.035;
const DISPLAY_DESC = 0.314;

const monoBaseline = (top, size) => top + MONO_ASC * size;

// ── Left column ──────────────────────────────────────────────────────────────
const KICKER = { x: 56, baseline: monoBaseline(54, 22), size: 22, weight: 700, ls: 3.08 };
const NAME = { x: 54, top: 92, width: 540, size: 86, lineHeight: 0.94 };
// The name may not grow down into the tag. 362 is the tag's measured top.
const NAME_MAX_H = 362 - NAME.top;

const DIVIDER_X = 622;

const TAG = { x: 56, top: 362, size: 40, weight: 800, ls: 0.8, padX: 20, padY: 10, border: 3 };

// The tag is shrink-wrapped to its text, which is fine for the mockup's short
// "cEDH · Bracket 5" and NOT fine for "trash magic · Bracket 1" — at 40px that
// is 598px wide and crosses the divider into the Play Profile column. The box
// therefore has a ceiling, 22px shy of the divider, and the type steps down to
// respect it. 26px is the floor: it is the readability minimum for print, and a
// tag that cannot fit at 26px is a data problem, not a layout one.
const TAG_MAX_W = DIVIDER_X - 22 - TAG.x;
const TAG_MIN_SIZE = 26;
const ARCHETYPE = { x: 56, baseline: monoBaseline(444, 32), size: 32, weight: 500, ls: 1.28 };
// `bottom:34px` → the box's bottom edge sits at 750-10-34 = 706.
const CATALOG = {
  x: 56,
  baseline: 706 - (MONO_ASC + MONO_DESC) * 26 + MONO_ASC * 26,
  size: 26, weight: 500, ls: 1.56,
};

const DIVIDER = { x: DIVIDER_X, y: 54, w: 2, h: 642 };

// ── Right column ─────────────────────────────────────────────────────────────
const SPEC_X = 650;
const SPEC_RIGHT = 996;            // 1030 padding box − 44 right inset + 10 border
const SPEC_W = SPEC_RIGHT - SPEC_X; // 346

const SPEC_HEAD = { baseline: monoBaseline(54, 22), size: 22, weight: 700, ls: 2.2, ruleY: 91.3 };

// Five rows on a 54px pitch, first at 109.33. Row box is 40px tall.
const ROW_Y0 = 109.33;
const ROW_PITCH = 54;
const ROW_H = 40;
const LBL_W = 170;
const NUM_W = 56;
const GAP = 14;
const TRACK_X = SPEC_X + LBL_W + GAP;              // 834
const TRACK_W = SPEC_W - LBL_W - GAP - GAP - NUM_W; // 92
const TRACK_H = 16;

// ── QR ───────────────────────────────────────────────────────────────────────
// 230×230 with a white quiet-zone box is the functional floor for a reliable
// phone-camera scan at close range. The 2px rule and 14px pad are the mockup's;
// what is left for the code itself is 198×198.
const QR = { x: 650, y: 476, box: 230, border: 2, pad: 14 };
const QR_INNER = QR.box - 2 * (QR.border + QR.pad); // 198
export const QR_INNER_PX = QR_INNER;

// ⚠️ QUIET ZONE IS UNDER SPEC, and it comes from the mockup. QR wants 4 clear
// modules on every side. The mockup's 14px pad is only 2.33 modules at a
// version-4 code (6px modules), and immediately outside it sits the 2px ink
// rule. Cream paper past that rule keeps it workable in practice, but this is
// the number to raise if cards scan unreliably: pad 24px instead of 14 buys the
// full 4 modules and costs 20px of code area.
const CAPTION = { x: 900, size: 24, weight: 400, ls: 0.48, lineHeight: 33.6 };

// ⚠️ THE CAPTION DOES NOT FIT, IN THE MOCKUP EITHER. The QR row is 346px wide
// and the QR takes 230 of it plus a 20px gap, which leaves the caption 96px.
// Its first authored line, "scan for full", measures ~193px at 24px JetBrains
// Mono. In the browser the mockup therefore wraps it to FOUR lines —
// "scan for / full / decklist / & notes" — not the two its <br> implies
// (measured: caption box 119px wide, 134.4px tall = 4 × 33.6px line-height).
//
// This reproduces that wrap rather than "fixing" it, because the mockup is the
// spec. Rendering the two authored lines instead pushes text off the card edge.
// Flagged for a real decision: the honest fixes are a shorter caption, the
// caption under the QR, or a wider right column — all of which are design
// changes, not implementation details.
export const CAPTION_TEXT = ['scan for full', 'decklist & notes'];

// 119px, not the 96px the column nominally leaves. `.qr-caption` is a flex item
// with `min-width: auto`, so it takes its min-content width and lets the ROW
// overflow rather than shrinking to fit — measured at 119px wide × 134.4px tall
// in the mockup. Wrapping at 96 would give six lines; wrapping at 119 gives the
// mockup's four ("scan for / full / decklist / & notes"). The 23px of overflow
// lands in the card's 44px right margin, so nothing clips.
export const CAPTION_MAX_W = 119;

// ── The five bars ────────────────────────────────────────────────────────────
// Order and labels are NOT invented here. They mirror SCRYCHECK_VECTORS in
// src/components/ScryCheckRadar.jsx, which is the one canonical home for this
// taxonomy — and the mockup's row order already matches it exactly.
//
// `column` is the public.decks column added by migration 034.
export const CARD_VECTORS = [
  { key: 'speed', column: 'scrycheck_speed', label: 'SPEED' },
  { key: 'consistency', column: 'scrycheck_consistency', label: 'CONSISTENCY' },
  { key: 'threats', column: 'scrycheck_threats', label: 'THREATS' },
  { key: 'manaBase', column: 'scrycheck_mana_base', label: 'MANA BASE' },
  { key: 'interaction', column: 'scrycheck_interaction', label: 'INTERACTION' },
];

export const VECTOR_MAX = 100;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ── Text measurement ─────────────────────────────────────────────────────────
// pango is the only thing that knows how wide a string actually is once shaping
// and kerning are applied, so the honest way to measure is to render and look.
//
// Everything is measured ONCE at MEASURE_SIZE and scaled. Text advance is linear
// in font-size, so a width at 200px divided by 200 is a width-per-px that holds
// at every size — which turns shrink-to-fit from "re-render at each candidate
// size" into arithmetic, and keeps a batch of forty cards fast.
const MEASURE_SIZE = 200;

export function createMeasurer(sharp) {
  const cache = new Map();

  return async function widthPerPx(text, { family, weight = 400, lsPerPx = 0 }) {
    const key = `${family}|${weight}|${lsPerPx}|${text}`;
    if (cache.has(key)) return cache.get(key);
    if (!text) return 0;

    const pad = 60;
    const w = Math.ceil(MEASURE_SIZE * (text.length + 2) * 1.2) + pad * 2;
    const h = MEASURE_SIZE * 3;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="100%" height="100%" fill="#fff"/>` +
      `<text x="${pad}" y="${MEASURE_SIZE * 2}" font-family="${esc(family)}" ` +
      `font-size="${MEASURE_SIZE}" font-weight="${weight}" ` +
      `letter-spacing="${lsPerPx * MEASURE_SIZE}" fill="#000" ` +
      `xml:space="preserve">${esc(text)}</text></svg>`;

    const { info } = await sharp(Buffer.from(svg))
      .trim({ threshold: 10 })
      .toBuffer({ resolveWithObject: true });

    const perPx = info.width / MEASURE_SIZE;
    cache.set(key, perPx);
    return perPx;
  };
}

// ── Shrink-to-fit deck name ──────────────────────────────────────────────────
// Real deck names run from "Slivers" to "Mishra, Claimed by Gix // Phyrexian
// Dragon Engine". A fixed 86px overflows the 540px column for anything long, so
// the name both wraps and steps down.
//
// Wrapping is greedy and measured on the real prefix string rather than by
// summing word widths — summing ignores the kerning across the space and drifts
// wide, which is the direction that overflows.
export async function fitDeckName(name, measure, opts = {}) {
  const maxW = opts.maxWidth ?? NAME.width;
  const maxH = opts.maxHeight ?? NAME_MAX_H;
  const startSize = opts.startSize ?? NAME.size;
  // 40px is the floor for the hero line. Well above the 26px readability floor —
  // this is the biggest thing on the card and a name that needs less than 40px
  // is better served by wrapping to another line.
  const minSize = opts.minSize ?? 40;

  const words = String(name || '').toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: startSize, lines: [], overflow: false };

  const font = { family: DISPLAY_FAMILY, weight: 400 };

  // Prefix widths are size-independent, so measure them once for the whole search.
  const prefixW = new Map();
  const measurePrefix = async (s) => {
    if (!prefixW.has(s)) prefixW.set(s, await measure(s, font));
    return prefixW.get(s);
  };

  for (let size = startSize; size >= minSize; size -= 1) {
    const lines = [];
    let cur = '';
    let fits = true;

    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      const w = (await measurePrefix(candidate)) * size;
      if (w <= maxW || !cur) {
        // `!cur` — a single word wider than the column still has to go on a line
        // of its own; there is nothing to break it against.
        cur = candidate;
        if (w > maxW) fits = false;
      } else {
        lines.push(cur);
        cur = word;
        if ((await measurePrefix(word)) * size > maxW) fits = false;
      }
    }
    if (cur) lines.push(cur);

    const blockH = lines.length * NAME.lineHeight * size;
    if (fits && blockH <= maxH) return { size, lines, overflow: false };
  }

  // Nothing fit even at the floor. Return the floor layout and SAY SO, rather
  // than quietly shipping a clipped name — the caller warns on this.
  const lines = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if ((await measurePrefix(candidate)) * minSize <= maxW || !cur) cur = candidate;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return { size: minSize, lines, overflow: true };
}

/**
 * Step the tag's type down until its shrink-wrapped box clears the divider.
 * Returns { size, widthPerPx, overflow }.
 */
export async function fitTag(text, measure) {
  if (!text) return { size: TAG.size, widthPerPx: 0, overflow: false };
  const widthPerPx = await measure(text, {
    family: MONO_FAMILY, weight: TAG.weight, lsPerPx: TAG.ls / TAG.size,
  });
  const boxAt = (size) => widthPerPx * size + 2 * TAG.padX + 2 * TAG.border;

  for (let size = TAG.size; size >= TAG_MIN_SIZE; size -= 1) {
    if (boxAt(size) <= TAG_MAX_W) return { size, widthPerPx, overflow: false };
  }
  return { size: TAG_MIN_SIZE, widthPerPx, overflow: true };
}

// Greedy word-wrap at a measured width, applied per authored line so the <br>
// is still a hard break. Same algorithm the browser applies to the mockup.
export async function wrapCaption(measure, maxW = CAPTION_MAX_W) {
  const font = { family: MONO_FAMILY, weight: CAPTION.weight, lsPerPx: CAPTION.ls / CAPTION.size };
  const out = [];
  for (const authored of CAPTION_TEXT) {
    let cur = '';
    for (const word of authored.split(/\s+/)) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (!cur || (await measure(candidate, font)) * CAPTION.size <= maxW) cur = candidate;
      else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

// ── QR ───────────────────────────────────────────────────────────────────────
// Drawn straight from the module bitmap into one <path>. Going through the
// module matrix rather than qrcode's own SVG string means no parsing of someone
// else's markup and exact control of the module size, which is what keeps the
// edges crisp at 300dpi instead of anti-aliased.
export function qrPath(qr, size) {
  const n = qr.modules.size;
  const data = qr.modules.data;
  const s = size / n;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!data[r * n + c]) continue;
      // Nudged out by 0.5/n of a module on each side so neighbouring modules
      // overlap fractionally: without it the rasteriser leaves hairline seams
      // between them that a phone camera reads as noise.
      const x = c * s, y = r * s;
      d += `M${x.toFixed(3)} ${y.toFixed(3)}h${(s + 0.02).toFixed(3)}v${(s + 0.02).toFixed(3)}h${(-s - 0.02).toFixed(3)}z`;
    }
  }
  return d;
}

// ── Playstyle / bracket tag ──────────────────────────────────────────────────
export const PLAYSTYLE_LABELS = {
  jank: 'jank',
  casual: 'casual',
  trash_magic: 'trash magic',
  'trash magic': 'trash magic',
  cedh: 'cEDH',
  cEDH: 'cEDH',
};

export function tagText(deck) {
  const style = PLAYSTYLE_LABELS[deck.playstyle] ?? deck.playstyle ?? '';
  const parts = [];
  if (style) parts.push(style);
  if (deck.bracket != null) parts.push(`Bracket ${deck.bracket}`);
  return parts.join(' · ').toUpperCase();
}

// ── The card ─────────────────────────────────────────────────────────────────
/**
 * @param deck   normalised deck record (see gen-deck-cards.mjs)
 * @param ctx    { nameFit, tagW, qr } precomputed async bits
 */
export function buildCardSvg(deck, ctx) {
  const { nameFit, tagW, qr } = ctx;
  const out = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">`);

  // Frame: ink underneath, paper inset by the 10px border.
  out.push(`<rect width="${CARD_W}" height="${CARD_H}" fill="${INK}"/>`);
  out.push(`<rect x="${BORDER}" y="${BORDER}" width="${CARD_W - 2 * BORDER}" height="${CARD_H - 2 * BORDER}" fill="${PAPER}"/>`);

  // The spine. This is the only part visible when the card is slotted upright in
  // a deck box, so it stays solid and carries no text.
  out.push(`<rect x="${BORDER}" y="${BORDER}" width="${CARD_W - 2 * BORDER}" height="16" fill="${YELLOW}"/>`);

  const monoAttrs = (size, weight, ls, fill) =>
    `font-family="${esc(MONO_FAMILY)}" font-size="${size}" font-weight="${weight}"` +
    (ls ? ` letter-spacing="${ls}"` : '') + ` fill="${fill}"`;

  // Kicker
  out.push(`<text x="${KICKER.x}" y="${KICKER.baseline.toFixed(2)}" ${monoAttrs(KICKER.size, KICKER.weight, KICKER.ls, GRAY)}>COMMANDER / DECK ID</text>`);

  // Deck name — shrink-to-fit, optional inverted accent on the final line.
  const { size: nameSize, lines } = nameFit;
  const lh = nameSize * NAME.lineHeight;
  const halfLeading = (lh - (DISPLAY_ASC + DISPLAY_DESC) * nameSize) / 2;
  lines.forEach((line, i) => {
    const baseline = NAME.top + halfLeading + DISPLAY_ASC * nameSize + i * lh;
    const isAccent = ctx.accentLine === i;
    if (isAccent) {
      // `padding: 0 8px` + box-decoration-break:clone in the mockup — an ink
      // block behind paper-coloured type.
      const w = ctx.accentW * nameSize;
      const top = baseline - DISPLAY_ASC * nameSize;
      const h = (DISPLAY_ASC + DISPLAY_DESC) * nameSize;
      out.push(`<rect x="${NAME.x}" y="${top.toFixed(2)}" width="${(w + 16).toFixed(2)}" height="${h.toFixed(2)}" fill="${INK}"/>`);
      out.push(`<text x="${NAME.x + 8}" y="${baseline.toFixed(2)}" font-family="${esc(DISPLAY_FAMILY)}" font-size="${nameSize}" fill="${PAPER}">${esc(line)}</text>`);
    } else {
      out.push(`<text x="${NAME.x}" y="${baseline.toFixed(2)}" font-family="${esc(DISPLAY_FAMILY)}" font-size="${nameSize}" fill="${INK}">${esc(line)}</text>`);
    }
  });

  // Playstyle / bracket tag — yellow block, ink rule, shrink-wrapped to its text.
  const tag = tagText(deck);
  if (tag) {
    const tagSize = ctx.tagSize ?? TAG.size;
    // letter-spacing is 0.02em in the mockup, so it scales with the stepped-down
    // size rather than staying at the 40px value.
    const tagLs = TAG.ls * (tagSize / TAG.size);
    const boxW = tagW * tagSize + 2 * TAG.padX + 2 * TAG.border;
    const boxH = (MONO_ASC + MONO_DESC) * tagSize + 2 * TAG.padY + 2 * TAG.border;
    out.push(`<rect x="${TAG.x + TAG.border / 2}" y="${TAG.top + TAG.border / 2}" width="${(boxW - TAG.border).toFixed(2)}" height="${(boxH - TAG.border).toFixed(2)}" fill="${YELLOW}" stroke="${INK}" stroke-width="${TAG.border}"/>`);
    const tagBaseline = TAG.top + TAG.border + TAG.padY + MONO_ASC * tagSize;
    out.push(`<text x="${TAG.x + TAG.border + TAG.padX}" y="${tagBaseline.toFixed(2)}" ${monoAttrs(tagSize, TAG.weight, tagLs, INK)}>${esc(tag)}</text>`);
  }

  // Archetype — lowercase, per the mockup's text-transform.
  if (deck.archetype) {
    out.push(`<text x="${ARCHETYPE.x}" y="${ARCHETYPE.baseline.toFixed(2)}" ${monoAttrs(ARCHETYPE.size, ARCHETYPE.weight, ARCHETYPE.ls, GRAY)}>${esc(String(deck.archetype).toLowerCase())}</text>`);
  }

  // Catalog number
  if (deck.catalog_number != null && deck.catalog_number !== '') {
    out.push(`<text x="${CATALOG.x}" y="${CATALOG.baseline.toFixed(2)}" ${monoAttrs(CATALOG.size, CATALOG.weight, CATALOG.ls, GRAY)}>no. ${esc(deck.catalog_number)}</text>`);
  }

  out.push(`<rect x="${DIVIDER.x}" y="${DIVIDER.y}" width="${DIVIDER.w}" height="${DIVIDER.h}" fill="${TRACK}"/>`);

  // Play Profile
  out.push(`<text x="${SPEC_X}" y="${SPEC_HEAD.baseline.toFixed(2)}" ${monoAttrs(SPEC_HEAD.size, SPEC_HEAD.weight, SPEC_HEAD.ls, GRAY)}>PLAY PROFILE</text>`);
  out.push(`<rect x="${SPEC_X}" y="${SPEC_HEAD.ruleY}" width="${SPEC_W}" height="2" fill="${INK}"/>`);

  CARD_VECTORS.forEach((v, i) => {
    const rowY = ROW_Y0 + i * ROW_PITCH;
    const value = deck.stats?.[v.key];
    const has = typeof value === 'number';

    out.push(`<text x="${SPEC_X}" y="${(rowY + 2.84 + MONO_ASC * 26).toFixed(2)}" ${monoAttrs(26, 600, 0.52, INK)}>${esc(v.label)}</text>`);
    out.push(`<rect x="${TRACK_X}" y="${(rowY + (ROW_H - TRACK_H) / 2).toFixed(2)}" width="${TRACK_W}" height="${TRACK_H}" fill="${TRACK}"/>`);

    if (has) {
      // Proportional, clamped to the 0–100 domain migration 034 pins in a CHECK.
      const pct = Math.max(0, Math.min(VECTOR_MAX, value)) / VECTOR_MAX;
      if (pct > 0) {
        out.push(`<rect x="${TRACK_X}" y="${(rowY + (ROW_H - TRACK_H) / 2).toFixed(2)}" width="${(TRACK_W * pct).toFixed(2)}" height="${TRACK_H}" fill="${INK}"/>`);
      }
    }

    // An ungraded vector prints an em dash, NOT a zero and NOT an empty bar.
    // Zero is a real ScryCheck reading meaning "virtually absent" — drawing an
    // unknown as zero asserts something false about the deck.
    const numText = has ? String(Math.round(value)) : '—';
    out.push(`<text x="${SPEC_RIGHT}" y="${(rowY + 0.2 + MONO_ASC * 30).toFixed(2)}" text-anchor="end" ${monoAttrs(30, 800, 0, has ? INK : GRAY)}>${numText}</text>`);
  });

  // QR + caption
  out.push(`<rect x="${QR.x + QR.border / 2}" y="${QR.y + QR.border / 2}" width="${QR.box - QR.border}" height="${QR.box - QR.border}" fill="#FFFFFF" stroke="${INK}" stroke-width="${QR.border}"/>`);
  if (qr) {
    const ix = QR.x + QR.border + QR.pad;
    const iy = QR.y + QR.border + QR.pad;
    out.push(`<g transform="translate(${ix} ${iy})"><path d="${qrPath(qr, QR_INNER)}" fill="${INK}" shape-rendering="crispEdges"/></g>`);
  }

  const capLines = ctx.captionLines ?? CAPTION_TEXT;
  const blockH = capLines.length * CAPTION.lineHeight;
  const capTop = QR.y + (QR.box - blockH) / 2;
  const capHalfLeading = (CAPTION.lineHeight - (MONO_ASC + MONO_DESC) * CAPTION.size) / 2;
  capLines.forEach((line, i) => {
    const baseline = capTop + capHalfLeading + MONO_ASC * CAPTION.size + i * CAPTION.lineHeight;
    out.push(`<text x="${CAPTION.x}" y="${baseline.toFixed(2)}" ${monoAttrs(CAPTION.size, CAPTION.weight, CAPTION.ls, GRAY)}>${esc(line)}</text>`);
  });

  out.push('</svg>');
  return out.join('\n');
}
