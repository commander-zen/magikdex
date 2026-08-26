// The Y2K AIM window — the visual language of ritual.
//
// One place, because every surface in Ben's mockups is the same object: a light
// beveled window with a chunky title bar, a body, and sometimes an action bar.
// If this file is right, every screen is right; if each screen rolls its own
// bevel they drift within a week.
//
// ── Light chrome on a dark page ──────────────────────────────────────────────
// The mocks are light and the page ground is #08090c. Not a contradiction — it
// is literally how AIM looked, a light window sitting on whatever desktop was
// behind it. The page stays dark, the windows are light.
//
// ── The one place border-radius is allowed ───────────────────────────────────
// The house rule is zero border-radius. The AIM window is the exception, the
// same way the card object already was: the soft-cornered beveled bar IS the
// reference, and squaring it off makes it a generic panel.

export const INK = "#111";
export const PAPER = "#fdfdfb";
export const CHROME_HI = "#fbfbf8";
export const CHROME_LO = "#d8d5cc";
export const SUBTLE = "#6b675e";

// Title and action bars are the same object. Two of these plus a border is the
// whole look — the inset white line along the top is what reads as "beveled"
// rather than "grey box", so it is not optional.
export const bevel = {
  background: `linear-gradient(${CHROME_HI}, ${CHROME_LO})`,
  border: `2px solid ${INK}`,
  borderRadius: 10,
  boxShadow: "inset 0 1px 0 #fff",
  display: "flex",
  alignItems: "center",
};

export function Window({ title, children, footer, titleFont }) {
  return (
    <div style={{
      background: PAPER, border: `2px solid ${INK}`, borderRadius: 12,
      padding: 10, display: "flex", flexDirection: "column", gap: 10,
      boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
      height: "100%", boxSizing: "border-box",
    }}>
      <div style={{ ...bevel, padding: "6px 14px", justifyContent: "center", flex: "none" }}>
        <span style={{
          fontFamily: titleFont ?? "'Zilla Slab', serif",
          fontSize: titleFont ? 34 : 22, fontWeight: titleFont ? 400 : 600,
          color: INK, lineHeight: 1.25,
        }}>
          {title}
        </span>
      </div>

      {/* The body scrolls, the chrome does not. A buddy list longer than the
          window must not push the action bar off the bottom of the card. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
        {children}
      </div>

      {footer && <div style={{ ...bevel, padding: "8px 14px", flex: "none" }}>{footer}</div>}
    </div>
  );
}

// A label above a value, the shape every row in the player-id mock takes.
export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 15, color: INK, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 17, color: INK, lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}

// "casual // trash magic // cEDH" — the separator in the mocks is a double
// slash, and it is not a comma with extra steps: it reads as "or", which is what
// a list of ways you like to play actually means.
export function Slashed({ items, empty = "—" }) {
  const list = (items ?? []).filter(Boolean);
  if (!list.length) return <span style={{ color: SUBTLE }}>{empty}</span>;
  return (
    <span>
      {list.map((x, i) => (
        <span key={`${x}-${i}`}>
          {i > 0 && <span style={{ color: SUBTLE }}> // </span>}
          {x}
        </span>
      ))}
    </span>
  );
}
