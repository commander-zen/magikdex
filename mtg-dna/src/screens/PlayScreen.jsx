import { C, PLAY_LIFE_TOOLS, PLAY_POD_TOOLS } from "../constants";
import ToolChips from "../components/ToolChips";
import SectionHeader from "../components/SectionHeader";
import TeaserCard from "../components/TeaserCard";

const PLAY_ACCENT = "#f87171";

export default function PlayScreen() {
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
          <SectionHeader label="Life Trackers" />
          <ToolChips tools={PLAY_LIFE_TOOLS} />
        </div>

        <div style={{ marginBottom: 28 }}>
          <SectionHeader label="Pod Balancing" />
          <ToolChips tools={PLAY_POD_TOOLS} />
        </div>

        <div>
          <SectionHeader label="Coming to MTG DNA" />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <TeaserCard
              accent={PLAY_ACCENT}
              name="Pod Check"
              desc="Four decks. One table. Real-time power balance before you sit down."
            />
            <TeaserCard
              accent={PLAY_ACCENT}
              name="Life Track"
              desc="Per-device life tracking synced to the pod. Live Activity on iPhone. No classic counter."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
