import SearchForm from "./SearchForm.jsx";
const NAV_HEIGHT = 60;

export default function SearchSheet({ open, onClose, onSearch, loading, error }) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0, 0, 0, 0.75)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.28s",
        }}
      />

      {/* Sheet — wrapper handles slide animation and centering */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
        display: "flex", justifyContent: "center",
        transform: open ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        pointerEvents: open ? "auto" : "none",
      }}>
        <div style={{
          width: "100%", maxWidth: 600,
          maxHeight: "90dvh",
          background: "var(--color-surface)",
          borderStyle: "solid",
          borderWidth: "2px",
          borderTopColor: "var(--bevel-light)",
          borderLeftColor: "var(--bevel-light)",
          borderBottomColor: "var(--bevel-dark)",
          borderRightColor: "var(--bevel-dark)",
          borderRadius: 0,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>

          {/* Drag handle */}
          <div style={{ textAlign: "center", paddingTop: 12, paddingBottom: 2, flexShrink: 0 }}>
            <div style={{
              display: "inline-block",
              width: 36, height: 4, borderRadius: 0,
              background: "var(--color-chrome-mid)",
            }} />
          </div>

          {/* Title bar */}
          <div style={{
            background: "var(--color-titlebar)",
            color: "var(--color-titlebar-text)",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-base)",
            fontWeight: "bold",
            padding: "var(--space-1) var(--space-2)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}>
            <span>NEW SEARCH</span>
            <button
              onClick={onClose}
              style={{
                background: "var(--color-chrome)",
                color: "var(--color-text-chrome)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "var(--bevel-light)",
                borderLeftColor: "var(--bevel-light)",
                borderBottomColor: "var(--bevel-dark)",
                borderRightColor: "var(--bevel-dark)",
                width: "20px",
                height: "20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                borderRadius: 0,
                padding: 0,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* Scrollable form */}
          <div style={{
            flex: 1, overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "20px 18px",
            paddingBottom: `calc(${NAV_HEIGHT}px + 32px)`,
          }}>
            <SearchForm onSearch={onSearch} loading={loading} error={error} />
          </div>

        </div>
      </div>
    </>
  );
}
