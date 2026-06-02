import { C, ANALYZE_TOOLS } from "../constants";
import ToolChips from "../components/ToolChips";
import SectionHeader from "../components/SectionHeader";

const GAP_ACCENT = "#ef4444";

export default function AnalyzeScreen() {
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
        <div style={{ marginBottom: 28 }}>
          <SectionHeader label="Analysis Tools" />
          <ToolChips tools={ANALYZE_TOOLS} />
        </div>

        <div>
          <SectionHeader label="The Gap" />
          <div style={{
            padding: "20px",
            borderRadius: 16,
            background: `${GAP_ACCENT}0d`,
            border: `1px solid ${GAP_ACCENT}44`,
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: GAP_ACCENT,
              marginBottom: 10,
              opacity: 0.8,
            }}>Coming to MTG DNA</div>
            <p style={{
              fontSize: 14,
              color: C.text,
              lineHeight: 1.7,
              margin: "0 0 16px",
            }}>
              ScryCheck tells you what your deck is. Playgroup.gg tells you how it performs. Nothing connects them. The feedback loop between construction and table results is unbuilt. That's what MTG DNA is building.
            </p>
            <div style={{
              display: "inline-flex",
              padding: "4px 12px",
              borderRadius: 100,
              background: `${GAP_ACCENT}14`,
              border: `1px solid ${GAP_ACCENT}44`,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: GAP_ACCENT,
            }}>Coming soon</div>
          </div>
        </div>
      </div>
    </div>
  );
}
