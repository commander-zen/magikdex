// The pill style for controls that sit ON a card — rotate / flip / meld.
//
// Its own module rather than a constant exported from FlipCard.jsx: mixing
// non-component exports into a component file breaks Fast Refresh
// (react-refresh/only-export-components), and this is shared by three call
// sites — the swipe carousel and BOTH commander overlays.
//
// Shared rather than copied on purpose. The last time card chrome was
// duplicated across those files, a fix landed in one and silently missed the
// other, and the bug shipped.
export const CARD_CONTROL_STYLE = {
  minHeight: 44, minWidth: 44,
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "rgba(0,0,0,0.6)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 20,
  padding: "6px 14px",
  fontFamily: "'Noto Sans Mono', monospace",
  fontSize: 12, letterSpacing: "0.1em",
  color: "rgba(255,255,255,0.55)",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};
