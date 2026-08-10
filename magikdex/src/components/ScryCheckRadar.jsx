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
// `column` is the public.decks column (migration 034). `label` is ABBREVIATED
// on purpose: these sit at the pentagon's vertices inside a column roughly a
// third of a phone wide, and the full names ("CONSISTENCY", "INTERACTION")
// collide with their neighbours at any legible size. The sheet shows the full
// names, where there is room to read them.
export const SCRYCHECK_VECTORS = [
  { key: "speed",       column: "scrycheck_speed",       label: "SPEED", full: "Speed",       hint: "mana acceleration, development pace" },
  { key: "consistency", column: "scrycheck_consistency", label: "CONS",  full: "Consistency", hint: "tutors, draw engine reliability" },
  { key: "threats",     column: "scrycheck_threats",     label: "THREAT", full: "Threats",    hint: "win conditions, combo potential" },
  { key: "manaBase",    column: "scrycheck_mana_base",   label: "MANA",  full: "Mana base",   hint: "land quality, colour fixing" },
  { key: "interaction", column: "scrycheck_interaction", label: "INTER", full: "Interaction", hint: "disruption, protection" },
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
// viewBox is wider than it is tall because the vertex LABELS live outside the
// polygon and the left/right ones need the room; the polygon itself stays
// centred and regular.
const CX = 100;
const CY = 92;
const R  = 56;   // radius at 100 — the outer ring
const LR = 70;   // radius the labels sit at

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
const LABEL_DY     = [-4, 3, 10, 10, 3];

export default function ScryCheckRadar({ vectors, accent, text, dim, track, onEdit }) {
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
      viewBox="0 0 200 184"
      style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
      role="img"
      aria-label={
        graded
          ? `ScryCheck power level, self-reported: ${SCRYCHECK_VECTORS
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
          <text
            key={v.key}
            x={x}
            y={y + LABEL_DY[i]}
            textAnchor={LABEL_ANCHOR[i]}
            style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 8, letterSpacing: "0.08em" }}
          >
            <tspan fill={dim}>{v.label}</tspan>
            {value !== null && (
              <tspan fill={accent} style={{ fontSize: 9 }}> {value}</tspan>
            )}
          </text>
        );
      })}

      {/* Ungraded is a legible state, not a blank pane: the grid stands empty
          and says so. */}
      {!graded && (
        <text
          x={CX} y={CY + 3} textAnchor="middle"
          style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 8, letterSpacing: "0.14em" }}
          fill={dim}
        >
          NOT GRADED
        </text>
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
        <span style={{
          fontFamily: "'Zilla Slab', serif",
          fontSize: 13,
          color: text,
          lineHeight: 1,
        }}>
          power level
        </span>
        <span style={{
          fontFamily: "'Noto Sans Mono', monospace",
          fontSize: 8,
          letterSpacing: "0.12em",
          color: dim,
          whiteSpace: "nowrap",
        }}>
          SELF-REPORTED
        </span>
      </div>

      {/* The chart. The whole area is the edit affordance — the pane had no tap
          target before this, so there is nothing to conflict with. A button, not
          a div with onClick, so it is reachable by keyboard and announced. */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={graded ? "Edit the self-reported ScryCheck scores" : "Add self-reported ScryCheck scores"}
        style={{
          flex: 1, minHeight: 0, width: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", borderRadius: 0,
          padding: "2px 0", margin: 0,
          cursor: onEdit ? "pointer" : "default",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {Chart}
      </button>

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
