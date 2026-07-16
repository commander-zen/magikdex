// The WREC taxonomy constants are co-located with their renderer on purpose
// (one canonical home). That trips react-refresh's component-only rule, which
// only affects HMR granularity in dev — the same trade-off ThemeContext makes.
/* eslint-disable react-refresh/only-export-components */

// Shared WREC composition band — five EQUAL cells, a count over a micro label.
// Extracted from ReviewScreen (Change 12) so the deck view and the Box detail
// pane render the SAME readout, not two look-alikes.
//
// Palette is passed as PROPS, not read from CSS vars, because this renders in
// two different color contexts: the always-dark brew takeover (where the callers
// pass var(--primary)/var(--muted)/var(--text) from the BREW_VARS bridge) and
// the theme-aware Box (where LegendIdentity passes useTheme() values). Pass
// onTapTag to make the cells filter (deck view); omit it for a read-only
// readout (Box). A 0 renders dimmed — the dump-stat tell — and stays tappable.

import { CATEGORY_META } from "../lib/wrec.js";

// The current WREC tag set (values mirror the wrec_tag enum, migration 006),
// abbreviated to fit mobile. Canonical home for the taxonomy; ReviewScreen
// imports these rather than keeping its own copy.
export const WREC_CHIPS = [
  { tag: "ramp",            label: "RAMP" },
  { tag: "card-advantage",  label: "CARD-ADV" },
  { tag: "disruption",      label: "DISRUPTION" },
  { tag: "mass-disruption", label: "MASS-DIS" },
  { tag: "plan",            label: "PLAN" },
];
export const LABEL_BY_TAG = Object.fromEntries(WREC_CHIPS.map(c => [c.tag, c.label]));

// Vault spec §4 — the icon-chip vocabulary. Icon carries the EXACT category,
// color carries the FAMILY: warm amber = build yourself up (ramp, card
// advantage), cool green = stop the table (disruption, mass disruption),
// standout red = your payoff (plan — user-assigned only, never auto-derived).
// Geometry lifted verbatim from the design reference (wrec-icons-preview.html):
// stroke-based 24×24 glyphs, per-glyph stroke weight, legible at 13px in-row.
const WREC_GLYPHS = {
  // double chevron up — acceleration, "get ahead of the curve"
  "ramp":            { sw: 2.4, circles: [], paths: ["M5 13 L12 6 L19 13", "M5 18 L12 11 L19 18"] },
  // bold plus — gain, not selection
  "card-advantage":  { sw: 2.8, circles: [], paths: ["M12 5 L12 19 M5 12 L19 12"] },
  // circle + slash — negate ONE (covers counters, deliberately not a sword)
  "disruption":      { sw: 2.4, circles: [{ cx: 12, cy: 12, r: 7.5 }], paths: ["M6.7 6.7 L17.3 17.3"] },
  // three targets in a triangle, one slash through the cluster — the whole table
  "mass-disruption": { sw: 2,   circles: [{ cx: 12, cy: 6.5, r: 2.9 }, { cx: 6.5, cy: 16, r: 2.9 }, { cx: 17.5, cy: 16, r: 2.9 }], paths: ["M4 19.5 L20 5.5"] },
  // planted flag — yours
  "plan":            { sw: 2.2, circles: [], paths: ["M7 4 L7 20", "M7 5 L18 5 L14.5 9 L18 13 L7 13"] },
};

export const WREC_CHIP_COLORS = {
  "ramp":            { stroke: "#e8a020", border: "#5a4a1e", bg: "#1a1608" },
  "card-advantage":  { stroke: "#d4a838", border: "#5a4a1e", bg: "#1a1608" },
  "disruption":      { stroke: "#7ab89a", border: "#2c4a3c", bg: "#0c1712" },
  "mass-disruption": { stroke: "#5a9d80", border: "#2c4a3c", bg: "#0c1712" },
  "plan":            { stroke: "#c0392b", border: "#4a2420", bg: "#170a08" },
};

export function WrecIcon({ tag, size = 13 }) {
  const g = WREC_GLYPHS[tag];
  if (!g) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size} height={size}
      fill="none"
      stroke={WREC_CHIP_COLORS[tag]?.stroke}
      strokeWidth={g.sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {g.circles.map((c, i) => <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />)}
      {g.paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export default function WrecBand({ counts, accent, muted, text, activeTag = null, onTapTag }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)" }}>
      {counts.map(({ tag, label, n }) => {
        const active = activeTag === tag;
        const dim = n === 0;
        return (
          <button
            key={tag}
            onClick={onTapTag ? () => onTapTag(tag) : undefined}
            style={{
              minHeight: 44,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 2,
              background: "transparent", border: "none", padding: 0,
              borderBottom: `2px solid ${active ? accent : "transparent"}`,
              cursor: onTapTag ? "pointer" : "default",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Device UAT — the band doubles as the icon KEY: each role shows
                its glyph over the count + label, so the badges used elsewhere
                (row chips, review carousel) are self-explanatory. A zero cell
                dims its icon too. */}
            <span style={{ opacity: dim ? 0.4 : 1, lineHeight: 0 }}>
              <WrecIcon tag={tag} size={15} />
            </span>
            {/* Device UAT — the count alone gave nothing to measure against, so
                each cell reads count/target (Rachel's template). Deliberately
                plain: no on/over/under tint — the band is busy enough open. */}
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 13,
              color: dim ? muted : active ? accent : text,
            }}>
              {n}
              <span style={{ color: muted }}>/{CATEGORY_META[tag]?.target ?? 0}</span>
            </span>
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 8,
              letterSpacing: "0.1em",
              color: muted,
            }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
