import { C, BREW_TOOLS } from "../constants";
import ToolChips from "../components/ToolChips";
import SectionHeader from "../components/SectionHeader";
import TeaserCard from "../components/TeaserCard";

const BREW_ACCENT = "#4ade80";

export default function BrewScreen() {
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
          <SectionHeader label="Deck Builders" />
          <ToolChips tools={BREW_TOOLS} />
        </div>

        <div>
          <SectionHeader label="Deck Stack" />
          <TeaserCard
            accent={BREW_ACCENT}
            name="Deck Stack"
            desc="Tinder-style card swiping for Commander brewing. Search, swipe, build. Scryfall made fun."
          />
        </div>
      </div>
    </div>
  );
}
