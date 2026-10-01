import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@3.0.3/+esm";
import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm";

// THE deckStats CARD — the MSCHF-inspired landscape card lifted out of
// magikdex (LegendIdCard.jsx), now drawn ONCE as a list of primitives and
// rendered twice: SVG for the preview, vector PDF for the print.
//
// ── Why one layout and two dumb renderers ───────────────────────────────────
// The magikdex version was HTML sized in cqw and printed with window.print().
// That printed "a bit large", and two things caused it: the card's 10-unit
// border sat OUTSIDE its 3.5in width (CSS content-box), and the browser's print
// dialog is free to scale whatever it is given. Here the PDF page is authored in
// millimetres and the card is placed at an exact size, so the only way it can
// print wrong is "fit to page" in the dialog — and the sheet carries a 50 mm
// ruler so that is checkable with any ruler.
//
// ── Size: a Magic card, turned sideways ─────────────────────────────────────
// 63 × 88 mm is a Magic card. LANDSCAPE is kept on purpose (Ben's call in
// magikdex): it slides into the same sleeve, and it is the one thing in the box
// that does not read as another card when you flip through.
export const CARD_MM = { w: 88, h: 63 };

// Coordinates are the mockup's own numbers on its 1050-wide canvas, so the
// values below still match reference/deck-id-card-mockup-v4.html.
const W = 1050;
const K = CARD_MM.w / W;          // mm per unit
const H = CARD_MM.h / K;          // ≈ 751.7
const BORDER = 10;
const IW = W - BORDER * 2;        // inner box — every position below is inside it
const IH = H - BORDER * 2;

const PAPER = "#F5F1E6";
const INK = "#161311";
const YELLOW = "#F5C400";
const GRAY = "#6B6459";
const TRACK = "#E1DACB";

// One TTF per weight. JetBrains Mono ships as a variable font, which jsPDF
// cannot use, so these are static instances cut from the same file magikdex
// vendors (fontTools varLib.instancer at 500 / 700 / 800). `cap` is the OS/2
// cap height — text is positioned by the TOP of its capitals, which is what a
// layout measured off a mockup actually means by "top".
export const FONTS = {
  display: { file: "ArchivoBlack-Regular.ttf", pdf: "ArchivoBlack", css: "DS Archivo", cap: 0.688 },
  mono500: { file: "JetBrainsMono-Medium.ttf", pdf: "JBMono500", css: "DS Mono 500", cap: 0.73 },
  mono700: { file: "JetBrainsMono-Bold.ttf", pdf: "JBMono700", css: "DS Mono 700", cap: 0.73 },
  mono800: { file: "JetBrainsMono-ExtraBold.ttf", pdf: "JBMono800", css: "DS Mono 800", cap: 0.73 },
};

export const VECTORS = [
  { key: "speed", label: "SPEED" },
  { key: "consistency", label: "CONSISTENCY" },
  { key: "threats", label: "THREATS" },
  { key: "manaBase", label: "MANA BASE" },
  { key: "interaction", label: "INTERACTION" },
];

// ── Fonts: fetched once, shared by measurement, preview and PDF ─────────────
let fontData = null;

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export async function loadFonts() {
  if (fontData) return;
  const entries = await Promise.all(Object.values(FONTS).map(async f => {
    const res = await fetch(`fonts/${f.file}`);
    if (!res.ok) throw new Error(`font ${f.file} failed to load`);
    const buf = await res.arrayBuffer();
    // The preview uses the SAME files, so screen and paper share glyphs.
    const face = new FontFace(f.css, buf);
    await face.load();
    document.fonts.add(face);
    return [f.file, toBase64(buf)];
  }));
  fontData = Object.fromEntries(entries);
}

function makeDoc(opts) {
  const doc = new jsPDF(opts);
  for (const f of Object.values(FONTS)) {
    doc.addFileToVFS(f.file, fontData[f.file]);
    doc.addFont(f.file, f.pdf, "normal");
  }
  return doc;
}

// ⚠️ MEASURED FROM THE FONT FILE, not the browser. Line breaks and the hero's
// size are decided here, from the same metrics the PDF is set with, so the
// preview can never wrap differently from the print.
let measurer = null;
function measure(text, font, size, ls = 0) {
  measurer ??= makeDoc({ unit: "pt" });
  measurer.setFont(FONTS[font].pdf, "normal");
  const n = [...text].length;
  return measurer.getStringUnitWidth(text) * size + ls * size * Math.max(0, n - 1);
}

// Greedy word wrap; a single word wider than the column is broken by letters
// (the old overflowWrap: anywhere) rather than forcing the fit to its floor.
function wrap(text, font, size, maxW, ls = 0) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font, size, ls) <= maxW) { line = next; continue; }
    if (line) lines.push(line);
    line = "";
    let chunk = "";
    for (const ch of word) {
      if (measure(chunk + ch, font, size, ls) > maxW && chunk) { lines.push(chunk); chunk = ""; }
      chunk += ch;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

// ── THE HERO FITS. Inherited lesson from magikdex, do not undo ──────────────
// 86 is a ceiling, not a size. Clipping the name was tried twice for the
// oversized look and real names killed it both times ("second half of ral is
// missing and thranduil is clipped still"). The name is the one thing on this
// card that has to be correct.
const HERO = { x: 44, y: 82, w: 540, h: 270, max: 86, min: 30, lead: 0.94 };

function fitHero(name) {
  const text = name.toUpperCase();
  const cap = FONTS.display.cap;
  const words = text.split(/\s+/).filter(Boolean);
  for (let s = HERO.max; s >= HERO.min; s--) {
    // A size that has to split a word ("VIGORBLO / OM") is not a fit: shrink
    // until every word sits whole on a line. Splitting is only the fallback
    // at HERO.min, for a single word too long for the column at any size.
    if (words.some(w => measure(w, "display", s) > HERO.w)) continue;
    const lines = wrap(text, "display", s, HERO.w);
    if (cap * s + (lines.length - 1) * HERO.lead * s <= HERO.h) return { size: s, lines };
  }
  return { size: HERO.min, lines: wrap(text, "display", HERO.min, HERO.w) };
}

// ScryCheck publishes power as 1–10 next to the bracket. The tag prints the
// numbers they gave and never invents a band name ("cEDH") for them.
function tagText(stats) {
  const parts = [];
  if (stats.score) parts.push(`power ${stats.score}`);
  if (stats.bracket != null) parts.push(`bracket ${stats.bracket}`);
  return parts.join(" · ").toUpperCase();
}

// The owner's own claim, under ScryCheck's computed one — kept visibly apart.
function selfLine(gameStyleLabel, tags) {
  return [gameStyleLabel, ...tags].filter(Boolean).join(" · ");
}

// The magikdex card's decorative "no. 0042", hashed from the deck link here
// since there is no deck row. Printed on the owner's own card, never a URL.
function catalogNo(seed) {
  if (!seed) return null;
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(h % 10000).padStart(4, "0");
}

// QR as vector squares, not a bitmap: crisp at any print resolution. Runs of
// dark modules on a row are merged so the PDF is a few hundred rects, not 1k+.
function qrRects(url, x, y, size) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const QUIET = 4;                       // the spec's four-module quiet zone
  const m = size / (n + QUIET * 2);
  const out = [];
  for (let r = 0; r < n; r++) {
    let start = -1;
    for (let c = 0; c <= n; c++) {
      const dark = c < n && qr.modules.get(r, c);
      if (dark && start < 0) start = c;
      if (!dark && start >= 0) {
        out.push({ t: "rect", x: x + (QUIET + start) * m, y: y + (QUIET + r) * m, w: (c - start) * m, h: m, fill: INK });
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Build the card as primitives in card units (1050 × ~752).
 * @param stats  { title, score, bracket, vectors, qrUrl, gameStyle, tags }
 */
export function layoutCard(stats) {
  const P = [];
  const rect = (x, y, w, h, fill) => P.push({ t: "rect", x, y, w, h, fill });
  // `top` is the top of the capitals; `size` and `ls` are in units / em.
  const text = (str, x, top, font, size, fill, ls = 0) =>
    P.push({ t: "text", str, x, y: top + FONTS[font].cap * size, font, size, fill, ls });

  rect(0, 0, W, H, INK);
  rect(BORDER, BORDER, IW, IH, PAPER);

  // Everything below is in inner-box coordinates, shifted by the border once.
  const start = P.length;

  // The spine: the only part visible with the card slotted upright.
  rect(0, 0, IW, 16, YELLOW);
  // The one label on the card that is NOT uppercase: it's the name, styled
  // "deckStats" on purpose, and capitals would erase the styling.
  text("deckStats", 46, 44, "mono700", 22, GRAY, 0.14);

  const hero = fitHero(stats.title || "untitled deck");
  hero.lines.forEach((line, i) =>
    text(line, HERO.x, HERO.y + i * HERO.lead * hero.size, "display", hero.size, INK));

  const tag = tagText(stats);
  if (tag) {
    const size = 40, ls = 0.02, padX = 20, padY = 16;
    const h = FONTS.mono800.cap * size + padY * 2;
    const w = measure(tag, "mono800", size, ls) + padX * 2;
    rect(46, 352, w, h, INK);                    // a 3-unit ink border, as a fill
    rect(49, 355, w - 6, h - 6, YELLOW);
    text(tag, 46 + padX, 352 + padY, "mono800", size, INK, ls);
  }

  const line = selfLine(stats.gameStyleLabel, stats.tags ?? []);
  if (line) {
    // IT WRAPS (Ben: "we can have that wrap dont need to do the …"). Three
    // lines is only a backstop — the field holds a game style plus three tags.
    let lines = wrap(line, "mono500", 32, 540, 0.04);
    if (lines.length > 3) lines = [...lines.slice(0, 2), `${lines[2]}…`];
    lines.forEach((l, i) => text(l, 46, 434 + i * 32 * 1.3, "mono500", 32, GRAY, 0.04));
  }

  // ⚠️ ATTRIBUTION, NOT DECORATION. Adam approved showing these numbers with
  // attribution and a link back; this block plus the QR to scrycheck.com is
  // that term being met. It does not get dropped to free up space.
  const chipSize = 30, chipPadX = 16, chipPadY = 13;
  const chipH = FONTS.display.cap * chipSize + chipPadY * 2;
  const chipTop = IH - 34 - chipH;
  text("analysis powered by", 46, chipTop - 12 - FONTS.mono500.cap * 20, "mono500", 20, GRAY, 0.06);
  const chipW = measure("SCRYCHECK", "display", chipSize, 0.04) + chipPadX * 2;
  rect(46, chipTop, chipW, chipH, INK);
  text("SCRYCHECK", 46 + chipPadX, chipTop + chipPadY, "display", chipSize, PAPER, 0.04);
  const cat = catalogNo(stats.catalogSeed);
  if (cat) {
    text(`no. ${cat}`, 46 + chipW + 16, chipTop + (chipH - FONTS.mono500.cap * 22) / 2, "mono500", 22, GRAY, 0.06);
  }

  rect(612, 44, 2, IH - 88, TRACK);

  // ── Play profile: the five ScryCheck vectors ──────────────────────────────
  const colX = 640, colR = IW - 44;
  text("PLAY PROFILE", colX, 44, "mono700", 22, GRAY, 0.1);
  rect(colX, 82, colR - colX, 2, INK);

  const LABEL = 24, VALUE = 30, GAP = 14, VALUE_W = 56, ROW = 54;
  const labelW = Math.max(...VECTORS.map(v => measure(v.label, "mono700", LABEL, 0.02)));
  const barX = colX + labelW + GAP;
  const barW = colR - VALUE_W - GAP - barX;
  VECTORS.forEach((v, i) => {
    const mid = 100 + i * ROW + 20;
    text(v.label, colX, mid - (FONTS.mono700.cap * LABEL) / 2, "mono700", LABEL, INK, 0.02);
    rect(barX, mid - 8, barW, 16, TRACK);
    const n = stats.vectors?.[v.key];
    const has = typeof n === "number";
    if (has && n > 0) rect(barX, mid - 8, (barW * Math.min(100, n)) / 100, 16, INK);
    // Ungraded prints an em dash, never a zero: zero is a real ScryCheck
    // reading ("virtually absent"), so an unknown drawn as one is a false claim.
    const val = has ? String(Math.round(n)) : "—";
    const vw = measure(val, "mono800", VALUE);
    text(val, colR - vw, mid - (FONTS.mono800.cap * VALUE) / 2, "mono800", VALUE, has ? INK : GRAY);
  });

  // QR → the ScryCheck analysis page.
  const QR = 230;
  const qx = colR - QR, qy = IH - 34 - QR;
  rect(qx, qy, QR, QR, INK);
  rect(qx + 2, qy + 2, QR - 4, QR - 4, "#FFFFFF");
  if (stats.qrUrl) P.push(...qrRects(stats.qrUrl, qx + 2, qy + 2, QR - 4));

  for (let i = start; i < P.length; i++) { P[i].x += BORDER; P[i].y += BORDER; }
  return P;
}

// ── The sheet: up to nine cards, 3 × 3, like a proxy sheet ─────────────────
// Ben: "9 could fit on a page (i know this as i print proxy cards and its
// always 9 to a page)". Three 88 mm cards across is 264 mm and three 63 mm
// rows is 189 mm, so the page turns LANDSCAPE: that clears both Letter
// (279.4 × 215.9) and A4 (297 × 210). Cards sit edge to edge, so one cut
// serves two cards. A single card is simply a one-card sheet.
//
// ONE layout feeds both renderers, so the on-screen preview is the page you
// print, not an approximation of it.
export const MAX_CARDS = 9;
const COLS = 3;

export const PAPERS = {
  letter: { label: "US Letter", w: 279.4, h: 215.9 },
  a4: { label: "A4", w: 297, h: 210 },
};

const MARK = { gap: 1, len: 3, color: "#999999", width: 0.15 };
const CAPTION_PT = 6.5;
const PT = 72 / 25.4;   // points per mm

export function layoutSheet(cards, paper = "letter") {
  const pg = PAPERS[paper];
  const n = Math.min(cards.length, MAX_CARDS);
  const ox = (pg.w - COLS * CARD_MM.w) / 2;
  const oy = (pg.h - 3 * CARD_MM.h) / 2;
  const placed = cards.slice(0, n).map((prims, i) => ({
    x: ox + (i % COLS) * CARD_MM.w,
    y: oy + Math.floor(i / COLS) * CARD_MM.h,
    prims,
  }));

  // Crop marks on every grid line the used cards touch, kept in the margin so
  // a cut never shows a line.
  const cols = Math.min(n, COLS), rows = Math.ceil(n / COLS);
  const right = ox + cols * CARD_MM.w, bottom = oy + rows * CARD_MM.h;
  const lines = [];
  const mark = (x1, y1, x2, y2) => lines.push({ x1, y1, x2, y2, color: MARK.color, width: MARK.width });
  for (let c = 0; c <= cols; c++) {
    const x = ox + c * CARD_MM.w;
    mark(x, oy - MARK.gap, x, oy - MARK.gap - MARK.len);
    mark(x, bottom + MARK.gap, x, bottom + MARK.gap + MARK.len);
  }
  for (let r = 0; r <= rows; r++) {
    const y = oy + r * CARD_MM.h;
    mark(ox - MARK.gap, y, ox - MARK.gap - MARK.len, y);
    mark(right + MARK.gap, y, right + MARK.gap + MARK.len, y);
  }

  // The size check. "Fit to page" is the one print-dialog setting that ruins
  // this, so the sheet carries its own proof: measure the bar. It sits under
  // the last row, but never closer than EDGE to the paper's edge — a full A4
  // sheet leaves only 10.5 mm of margin, and most printers can't ink the last
  // few millimetres.
  const EDGE = 4.5;
  const ry = Math.min(bottom + 10, pg.h - EDGE);
  const rx = ox + 10;
  const ink = { color: INK, width: 0.3 };
  lines.push({ x1: rx, y1: ry, x2: rx + 50, y2: ry, ...ink });
  for (let i = 0; i <= 50; i += 10) {
    lines.push({ x1: rx + i, y1: ry, x2: rx + i, y2: ry - (i % 50 ? 1 : 2), ...ink });
  }
  const texts = [{
    str: "<- 50 mm. if it isn't, reprint at 100% / actual size, not \"fit to page\". cut on the marks, then sleeve.",
    x: rx + 54, y: ry, size: CAPTION_PT / PT, color: GRAY,
  }];

  return { w: pg.w, h: pg.h, cards: placed, lines, texts };
}

// ── Renderer 1: SVG preview of the whole page ───────────────────────────────
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function cardBody(prims) {
  return prims.map(p => p.t === "rect"
    ? `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.fill}"/>`
    // kerning off: jsPDF does not kern, so the preview must not either.
    : `<text x="${p.x}" y="${p.y}" font-family="${FONTS[p.font].css}" font-size="${p.size}" letter-spacing="${p.ls * p.size}" fill="${p.fill}" style="font-kerning:none" xml:space="preserve">${esc(p.str)}</text>`
  ).join("");
}

export function renderSheetSVG(sheet) {
  const cards = sheet.cards.map(c =>
    `<svg x="${c.x}" y="${c.y}" width="${CARD_MM.w}" height="${CARD_MM.h}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${cardBody(c.prims)}</svg>`,
  ).join("");
  const lines = sheet.lines.map(l =>
    `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${l.color}" stroke-width="${l.width}"/>`,
  ).join("");
  const texts = sheet.texts.map(t =>
    `<text x="${t.x}" y="${t.y}" font-family="${FONTS.mono500.css}" font-size="${t.size}" fill="${t.color}" style="font-kerning:none">${esc(t.str)}</text>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheet.w} ${sheet.h}" role="img" aria-label="Print preview">`
    + `<rect width="${sheet.w}" height="${sheet.h}" fill="#FFFFFF"/>${cards}${lines}${texts}</svg>`;
}

// ── Renderer 2: the print PDF ───────────────────────────────────────────────
export function renderSheetPDF(sheet) {
  const doc = makeDoc({ unit: "mm", format: [sheet.w, sheet.h], orientation: "landscape" });
  const mm = u => u * K;

  for (const card of sheet.cards) {
    for (const p of card.prims) {
      if (p.t === "rect") {
        doc.setFillColor(p.fill);
        doc.rect(card.x + mm(p.x), card.y + mm(p.y), mm(p.w), mm(p.h), "F");
      } else {
        doc.setFont(FONTS[p.font].pdf, "normal");
        doc.setFontSize(mm(p.size) * PT);
        doc.setTextColor(p.fill);
        doc.text(p.str, card.x + mm(p.x), card.y + mm(p.y), { charSpace: mm(p.ls * p.size), baseline: "alphabetic" });
      }
    }
  }
  for (const l of sheet.lines) {
    doc.setDrawColor(l.color);
    doc.setLineWidth(l.width);
    doc.line(l.x1, l.y1, l.x2, l.y2);
  }
  doc.setFont(FONTS.mono500.pdf, "normal");
  for (const t of sheet.texts) {
    doc.setFontSize(t.size * PT);
    doc.setTextColor(t.color);
    doc.text(t.str, t.x, t.y, { baseline: "alphabetic" });
  }
  return doc;
}
