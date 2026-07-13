import WrecCategoryButtons from "./WrecCategoryButtons.jsx";

export default function WrecTagPicker({ card, wrecTags, onAssign, onClose }) {
  const oracleId = card.oracle_id ?? card.id;

  const currentTags = Object.entries(wrecTags)
    .filter(([, ids]) => ids.includes(oracleId))
    .map(([cat]) => cat);

  const mana = card.mana_cost?.replace(/\{([^}]+)\}/g, "$1 ").trim() ?? "";

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 398, background: "rgba(0,0,0,0.55)" }}
      />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 400,
        maxWidth: 600, margin: "0 auto",
        background: "var(--color-surface)",
        borderRadius: 0,
        borderTopStyle: "solid",
        borderTopWidth: "2px",
        borderTopColor: "var(--bevel-light)",
        borderLeftStyle: "solid",
        borderLeftWidth: "2px",
        borderLeftColor: "var(--bevel-light)",
        borderRightStyle: "solid",
        borderRightWidth: "2px",
        borderRightColor: "var(--bevel-dark)",
        padding: "0 16px calc(max(20px, env(safe-area-inset-bottom)) + 6px)",
        fontFamily: "var(--font-system)",
      }}>
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 0, background: "var(--color-chrome-mid)", margin: "14px auto 16px" }} />

        {/* Card identity */}
        <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ fontSize: "var(--font-size-base)", fontWeight: "bold", color: "var(--color-text-primary)", fontFamily: "var(--font-system)", marginBottom: 2 }}>
            {card.name}
          </div>
          {mana && (
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", fontFamily: "var(--font-system)" }}>
              {mana}
            </div>
          )}
        </div>

        <WrecCategoryButtons
          currentTags={currentTags}
          onToggle={cat => onAssign(oracleId, cat)}
        />
      </div>
    </>
  );
}
