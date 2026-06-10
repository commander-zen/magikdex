import { useTheme } from "../theme/ThemeContext";
import ToolChips from "../components/ToolChips";
import PageHeader from "../components/PageHeader";
import { TOOLS } from "../data/tools";

export default function Vault() {
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
        <PageHeader eyebrow="Helix" title="vault" />
        <ToolChips tools={TOOLS} />
      </div>
    </div>
  );
}
