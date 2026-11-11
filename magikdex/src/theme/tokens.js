// Single dark palette, shared with the Bracket Card site (2026-11-11): teal on
// black. ⚠️ Keep these in step with deck-stats/src/styles.css — the two apps
// are separate Vercel projects, so the values are copied, not imported.
// Hex on purpose: call sites append alpha ("${theme.white}80").
//
// Contrast on `base` / `surface` (WCAG 2.2 AA wants 4.5 for text, 3 for
// control edges): white 17.6 / 16.5, dim 9.5 / 8.9, accent 9.1 / 8.5,
// red 9.0 / 8.5, muted (control edges and rules) 3.8 / 3.6.
// `dim` was #5a6672, about 3:1 — too faint to read on a phone outdoors.
export const tokens = {
  base:    "#060a0a",
  surface: "#0c1414",
  accent:  "#2bc4ae",
  white:   "#e9f3f1",
  muted:   "#567371",
  border:  "#223232",
  dim:     "#a2b8b5",
  red:     "#ff8f85",
};
