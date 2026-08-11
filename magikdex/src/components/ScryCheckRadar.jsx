// The ScryCheck vector taxonomy is co-located with its renderer, the same way
// WREC_CHIPS lives in WrecBand.jsx — one canonical home per taxonomy. That trips
// react-refresh's component-only rule, which only costs HMR granularity in dev.
/* eslint-disable react-refresh/only-export-components */

// Self-reported ScryCheck power-level radar — the Box detail pane's readout.
//
// ⚠️ THIS IS NOT WREC, AND MUST NEVER BE MERGED WITH IT. WREC (WrecBand.jsx)
// measures FUNCTIONAL COVERAGE: does the deck have enough ramp, card advantage,
// disruption, mass disruption, a plan. ScryCheck measures POWER LEVEL. They are
// orthogonal axes — a cEDH combo deck reads as a disaster on WREC and a 9 on
// ScryCheck, and both readings are true. WREC lives inside the deck on the brew
// page (ReviewScreen); this lives on the Box. One readout per surface.
//
// The numbers are TYPED BY THE USER from a grading they ran themselves at
// scrycheck.com. Magikdex never calls their API and never scrapes it — same
// model migration 030 set for the overall rating. The attribution below the
// chart is not decoration; it is the terms.

// The five vectors, in render order around the pentagon starting at the top.
//
// `column` is the public.decks column (migration 034).
//
// The labels were abbreviated (CONS / INTER / THREAT) when this shared the
// detail pane with the card art and had about a third of a phone to work in.
// It owns a whole page now, so they are spelled out — the abbreviations were a
// symptom of the crowding, not a design choice, and "INTER" is not a word.
export const SCRYCHECK_VECTORS = [
  { key: "speed",       column: "scrycheck_speed",       label: "SPEED",       full: "Speed",       hint: "mana acceleration, development pace" },
  { key: "consistency", column: "scrycheck_consistency", label: "CONSISTENCY", full: "Consistency", hint: "tutors, draw engine reliability" },
  { key: "threats",     column: "scrycheck_threats",     label: "THREATS",     full: "Threats",     hint: "win conditions, combo potential" },
  { key: "manaBase",    column: "scrycheck_mana_base",   label: "MANA BASE",   full: "Mana base",   hint: "land quality, colour fixing" },
  { key: "interaction", column: "scrycheck_interaction", label: "INTERACTION", full: "Interaction", hint: "disruption, protection" },
];

// Verified at https://scrycheck.com/docs, not inferred: each vector is
// "normalized to 0–100". The 1–10 number people quote (a 9.7) is ScryCheck's
// separate OVERALL power level and is NOT what this chart plots. Getting this
// wrong squashes every deck into the bottom tenth of the pentagon and still
// looks plausible — which is exactly why migration 034 pins 0–100 in a CHECK
// constraint rather than trusting this constant to stay right.
export const SCRYCHECK_MAX = 100;

export const SCRYCHECK_URL = "https://scrycheck.com/";

// Pull the five values off a deck row into the shape this component wants.
// Anything missing stays null — see below on why null is not zero.
export function readVectors(deck) {
  if (!deck) return null;
  const out = {};
  for (const v of SCRYCHECK_VECTORS) {
    const n = deck[v.column];
    out[v.key] = n === null || n === undefined ? null : Number(n);
  }
  return out;
}

// A deck is GRADED only when all five are present. A partial grading cannot be
// plotted honestly: a pentagon with a missing vertex is a pentagon with a
// vertex at zero, and zero is a real ScryCheck reading ("virtually absent")
// rather than "unknown". Rather than draw a lie, we draw the empty grid.
export function isGraded(vectors) {
  return Boolean(vectors) && SCRYCHECK_VECTORS.every(v => typeof vectors[v.key] === "number");
}

// ── Geometry ─────────────────────────────────────────────────────────────────
// A regular pentagon, first vertex at the top (-90°), going clockwise. The
// viewBox is much wider than the polygon because the vertex LABELS live outside
// it: "CONSISTENCY" hangs off the right vertex and "INTERACTION" off the left,
// so the box has to hold R + LR + half a word on each side. The polygon itself
// stays centred and regular.
const CX = 140;
const CY = 96;
const R  = 58;   // radius at 100 — the outer ring
const LR = 74;   // radius the labels sit at

function vertex(i, radius) {
  const angle = (-90 + i * 72) * (Math.PI / 180);
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

function ring(radius) {
  return SCRYCHECK_VECTORS.map((_, i) => vertex(i, radius).map(n => n.toFixed(1)).join(",")).join(" ");
}

// Vertex 0 is dead top; 1–2 are on the right, 3–4 on the left. Anchoring the
// side labels outward (start on the right, end on the left) is what keeps them
// from overlapping the polygon they annotate.
const LABEL_ANCHOR = ["middle", "start", "start", "end", "end"];
const LABEL_DY     = [-10, -1, 8, 8, -1];
// The value sits on its OWN line under its label rather than trailing it. Run
// together ("CONSISTENCY 64") the longest label plus a number overflows the
// right edge of the viewBox, and the eye has to parse a word and a number out
// of one run anyway.
const VALUE_DY = 11;

export default function ScryCheckRadar({
  vectors, accent, text, dim, track, onEdit,
  // The link out to this deck's own graded page on ScryCheck (decks.scrycheck_url,
  // migration 035). When present, the CHART BODY becomes that link — Ben's whole
  // ask: "see the vectors, be like 'wtf is this... tap here', and it shoots them
  // to their decklist on scrycheck graded and everything."
  deckUrl = null,
  // One-tap grading, offered when we know a Moxfield/Archidekt link for this
  // deck but have never analysed it.
  onGrade = null,
  grading = false,
  score = null,
  bracket = null,
}) {
  const graded = isGraded(vectors);

  const shape = graded
    ? SCRYCHECK_VECTORS
        .map((v, i) => {
          // Clamped for drawing only. The database refuses anything outside
          // 0–100 (034), so this is belt-and-braces against a row written
          // before that constraint existed — an out-of-range value should
          // flatten against the outer ring, never spike off the canvas.
          const ratio = Math.max(0, Math.min(1, vectors[v.key] / SCRYCHECK_MAX));
          return vertex(i, R * ratio).map(n => n.toFixed(1)).join(",");
        })
        .join(" ")
    : null;

  const Chart = (
    <svg
      viewBox="0 0 280 200"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      role="img"
      // The provenance in here has to match the provenance on screen. It said
      // "self-reported" unconditionally, so once a deck was graded by the API
      // the visible label read VIA SCRYCHECK while the screen-reader label
      // still called the same numbers self-reported. Two different claims about
      // who computed them, which is the one distinction this feature exists to
      // keep straight.
      aria-label={
        graded
          ? `ScryCheck power level, ${deckUrl ? "graded by ScryCheck" : "self-reported"}: ${SCRYCHECK_VECTORS
              .map(v => `${v.full} ${vectors[v.key]} of ${SCRYCHECK_MAX}`).join(", ")}`
          : "ScryCheck power level: this deck has not been graded"
      }
    >
      {/* Grid. Two rings only — the ceiling and the midpoint. ScryCheck's own
          bands are five wide, but five rings inside 56px of radius reads as
          hatching rather than as a scale. */}
      <polygon points={ring(R)}       fill="none" stroke={track} strokeWidth="1" />
      <polygon points={ring(R * 0.5)} fill="none" stroke={track} strokeWidth="1" />
      {SCRYCHECK_VECTORS.map((v, i) => {
        const [x, y] = vertex(i, R);
        return <line key={v.key} x1={CX} y1={CY} x2={x} y2={y} stroke={track} strokeWidth="1" />;
      })}

      {/* The reading itself. Accent stroke, same accent at low alpha for the
          fill — one colour, so the shape reads as a single measurement. */}
      {graded && (
        <polygon
          points={shape}
          fill={accent}
          fillOpacity="0.18"
          stroke={accent}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      )}
      {graded && SCRYCHECK_VECTORS.map((v, i) => {
        const ratio = Math.max(0, Math.min(1, vectors[v.key] / SCRYCHECK_MAX));
        const [x, y] = vertex(i, R * ratio);
        return <circle key={v.key} cx={x} cy={y} r="2.2" fill={accent} />;
      })}

      {/* Vertex labels: the axis name over its number. Mono for both, because
          the number is the point and a proportional face makes a column of
          two-digit readings ragged. */}
      {SCRYCHECK_VECTORS.map((v, i) => {
        const [x, y] = vertex(i, LR);
        const value = graded ? vectors[v.key] : null;
        return (
          <g key={v.key}>
            <text
              x={x}
              y={y + LABEL_DY[i]}
              textAnchor={LABEL_ANCHOR[i]}
              fill={dim}
              style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 9, letterSpacing: "0.08em" }}
            >
              {v.label}
            </text>
            {value !== null && (
              <text
                x={x}
                y={y + LABEL_DY[i] + VALUE_DY}
                textAnchor={LABEL_ANCHOR[i]}
                fill={accent}
                style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 12 }}
              >
                {value}
              </text>
            )}
          </g>
        );
      })}

      {/* Ungraded is a legible state, not a blank pane: the grid stands empty
          and says what to do about it. "NOT GRADED" alone was the whole message
          at first, and it reads as a verdict — a thing the app has decided —
          rather than as the empty field it actually is. The accent line is the
          instruction, in the colour everything tappable uses. */}
      {!graded && (
        <>
          <text
            x={CX} y={CY - 3} textAnchor="middle"
            style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 9, letterSpacing: "0.14em" }}
            fill={dim}
          >
            {grading ? "GRADING…" : "NOT GRADED"}
          </text>
          {/* The invitation changes with what we can actually do. If a
              Moxfield/Archidekt link is on file, one tap really does grade the
              deck — so say GRADE, not ADD. If it isn't, the only honest offer
              is the manual sheet. Promising a grade we can't deliver would be
              the same sin as the invisible tap target. */}
          {!grading && (
            <text
              x={CX} y={CY + 11} textAnchor="middle"
              style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 9, letterSpacing: "0.1em" }}
              fill={accent}
            >
              {onGrade ? "TAP TO GRADE" : "TAP TO ADD"}
            </text>
          )}
        </>
      )}
    </svg>
  );

  return (
    <div style={{
      height: "100%", minHeight: 0,
      display: "flex", flexDirection: "column",
    }}>
      {/* Header. Zilla Slab, per the house rule that headers are the slab and
          numbers are the mono. */}
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6,
        flex: "0 0 auto",
      }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
          <span style={{
            fontFamily: "'Zilla Slab', serif",
            fontSize: 13,
            color: text,
            lineHeight: 1,
          }}>
            power level
          </span>
          {/* The OVERALL rating, when ScryCheck has given us one. It is the
              number people actually quote ("my deck's a 9.7") and it is NOT on
              the radar — the radar plots the five vectors, this is their
              sibling. Bracket rides along because ScryCheck returns both and
              they answer different questions at a table. */}
          {score && (
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 13,
              color: accent,
              whiteSpace: "nowrap",
            }}>
              {score}
              {bracket != null && (
                <span style={{ fontSize: 9, color: dim }}> · B{bracket}</span>
              )}
            </span>
          )}
        </span>
        {/* The edit glyph is not decoration. Shipped without it, the chart was a
            button with NO visual cue — Ben's first question on seeing it live was
            "where do i put in the vectors? i dont see an input." A tap target
            nobody can see is not a tap target.
            The LABEL states provenance, which is the whole point of 030 keeping
            `kind` and `method` apart: a number ScryCheck computed and a number
            somebody typed are two different claims, and the card says which. */}
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span style={{
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 8,
            letterSpacing: "0.12em",
            color: dim,
            whiteSpace: "nowrap",
          }}>
            {deckUrl ? "VIA SCRYCHECK" : "SELF-REPORTED"}
          </span>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={graded ? "Edit these scores by hand" : "Enter scores by hand"}
              style={{
                width: 28, height: 22, padding: 0, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", borderRadius: 0,
                cursor: "pointer", WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                className="material-symbols-rounded"
                style={{ fontSize: 13, color: accent, lineHeight: 1 }}
              >
                edit
              </span>
            </button>
          )}
        </span>
      </div>

      {/* THE CHART BODY IS THE LINK OUT once this deck has been graded — that is
          the interaction Ben described: see the vectors, wonder what they mean,
          tap, and land on your own graded deck at scrycheck.com. Editing moved
          to the explicit glyph above so the body could carry this.
          Before it has been graded the body is a button instead: one tap to
          grade when we know a deck link, otherwise the manual sheet. */}
      {deckUrl ? (
        <a
          href={deckUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open this deck's full analysis on ScryCheck"
          style={{
            flex: 1, minHeight: 0, width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "2px 0",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {Chart}
        </a>
      ) : (
        <button
          type="button"
          onClick={grading ? undefined : (onGrade ?? onEdit)}
          disabled={grading}
          aria-label={
            grading ? "Grading this deck on ScryCheck"
              : onGrade ? "Grade this deck with ScryCheck"
              : graded ? "Edit these scores by hand" : "Enter scores by hand"
          }
          style={{
            flex: 1, minHeight: 0, width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "none", borderRadius: 0,
            padding: "2px 0", margin: 0,
            opacity: grading ? 0.6 : 1,
            cursor: grading ? "default" : (onGrade || onEdit) ? "pointer" : "default",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {Chart}
        </button>
      )}

      {/* ATTRIBUTION — required, and deliberately in the layout rather than in a
          tooltip or a footer somewhere else. Adam approved the self-report use
          of ScryCheck's vectors on the condition of credit and a link; a credit
          you have to hover to find is not a credit. It is a SIBLING of the edit
          button, never a child of it — nesting it would have made the credit a
          dead zone inside the tap target, or the editor a trap around the link. */}
      <a
        href={SCRYCHECK_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          flex: "0 0 auto",
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 8,
          letterSpacing: "0.06em",
          lineHeight: 1.4,
          color: dim,
          textDecoration: "none",
          borderBottom: `1px solid transparent`,
        }}
      >
        power level data via <span style={{ color: accent }}>ScryCheck ↗</span>
      </a>
    </div>
  );
}
