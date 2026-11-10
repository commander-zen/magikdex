// A deck's colour identity as a row of mana-coloured dots, in WUBRG order.
// Drawn in CSS (no Scryfall symbol fetch) so it works offline in the native
// shell. Colourless (an empty identity) is a single grey dot. This replaced the
// creature-type pixel sprites in the Box (Ben, 2026-11-10: "crazy confusing").
const ORDER = ["W", "U", "B", "R", "G"];
const FILL = {
  W: "#f6f1d3",
  U: "#6fa8dc",
  B: "#3d3733",
  R: "#e07a55",
  G: "#6fa66a",
  C: "#bdb8b2",
};
const NAMES = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

export default function ColorPips({ identity, size = 12, gap = 4 }) {
  const colors = ORDER.filter(c => (identity ?? []).includes(c));
  const shown = colors.length ? colors : ["C"];
  const label = colors.length ? colors.map(c => NAMES[c]).join(", ") : "colorless";
  return (
    <span role="img" aria-label={label} style={{ display: "inline-flex", gap, flexShrink: 0 }}>
      {shown.map(c => (
        <span
          key={c}
          style={{
            width: size, height: size, borderRadius: "50%",
            background: FILL[c],
            // A light rim so black (and every colour) holds its edge on the
            // near-black app surfaces.
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.3)",
          }}
        />
      ))}
    </span>
  );
}
