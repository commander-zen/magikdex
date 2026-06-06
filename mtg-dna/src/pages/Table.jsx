import { useTheme } from "../theme/ThemeContext";
import ToolChips from "../components/ToolChips";
import TeaserCard from "../components/TeaserCard";
import PageHeader from "../components/PageHeader";
import { PLAY_LIFE_TOOLS } from "../data/tools";

export default function Table() {
  const { theme } = useTheme();

  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      background: theme.base,
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{ padding: "28px 20px 40px" }}>
        <PageHeader eyebrow="Helix" title="pod" />
        <div style={{ marginBottom: 28 }}>
          <ToolChips tools={PLAY_LIFE_TOOLS} />
        </div>

        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <TeaserCard
              accent="#f87171"
              name="Pod Check"
              desc="Four decks. One table. Real-time power balance before you sit down."
            />
            <TeaserCard
              accent="#f87171"
              name="Life Track"
              desc="Per-device life tracking synced to the pod. Live Activity on iPhone. No classic counter."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
