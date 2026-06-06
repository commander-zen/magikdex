import { useTheme } from "../theme/ThemeContext";
import ToolChips from "../components/ToolChips";
import TeaserCard from "../components/TeaserCard";
import PageHeader from "../components/PageHeader";
import { BREW_TOOLS } from "../data/tools";

export default function Brew() {
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

        {/* Section A — Deck Stack teaser */}
        <div style={{ marginBottom: 36 }}>
          <PageHeader eyebrow="Helix" title="brew" />
          <TeaserCard
            accent="#4ade80"
            name="Deck Stack"
            desc="Tinder-style card swiping for Commander brewing. Search, swipe, build. Scryfall made fun."
          />
        </div>

        <ToolChips tools={BREW_TOOLS} />

      </div>
    </div>
  );
}
