import { C, TOOLS } from "../constants";
import ToolChips from "../components/ToolChips";

export default function CollectionScreen() {
  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      background: C.base,
      fontFamily: "'Noto Sans', sans-serif",
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ padding: "28px 20px 40px" }}>
        <p style={{
          fontSize: 13,
          color: C.muted,
          margin: "0 0 28px",
          letterSpacing: "0.01em",
          lineHeight: 1.5,
        }}>
          We don't store your cards. These do.
        </p>
        <ToolChips tools={TOOLS} />
      </div>
    </div>
  );
}
