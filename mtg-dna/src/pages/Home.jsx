import { useTheme } from "../theme/ThemeContext";
import PageHeader from "../components/PageHeader";

const HOME_SECTIONS = [
  {
    label: "The problem.",
    body: "Dope EDH tools exist, but none of them \"talk\" to each other.",
  },
  {
    label: "What that means.",
    body: "You make the brutal decision to swap the hot new tech for a trusted card in your 99 and the result is... unsure. When you cut a card and your win rate moves, you need both events in sequence to learn anything.",
  },
  {
    label: "Mobile first.",
    body: "Our favorite EDH tools were built with a monitor and keyboard in mind. MTG DNA is here for the late night gremlin scrolling cards in bed (before their phone inevitably falls on their face).",
  },
  {
    label: "Zen.",
    body: "MTG DNA is an attempt to bring harmony to the lifecycle of your legend. It's the brainchild of a guy named Ben with a philosophy degree, a tech job and the demeanor of Mister Rodgers raised on Run the Jewels (ergo the online persona of Zen). I love schleppin shit together and promise you this will always be free & available & the best I can make it. To prove that promise I can only off you my word, but word is bond.",
  },
  {
    label: "How this was built.",
    body: "I consider myself an illiterate humane technologist, as my thwomp sized blocker to side projects has always been that despite knowing almost every phase of the SDLC, my coding expertise is limited to a python \"Hello World\" statement or a rudimentary understanding of an elif statement. Claude Code has enabled me to realize projects that before were just concepts. I believe in ethical LLM usage, with a human in the loop always. If you want to discuss (anything really) please feel free to reach out. I always love a good yap!",
  },
];

export default function Home() {
  const { theme, mode, toggleTheme } = useTheme();
  const mutedColor  = mode === "light" ? `${theme.ink}b3` : `${theme.white}99`;
  const borderColor = mode === "light" ? theme.border      : theme.muted;

  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      background: theme.base,
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{
        padding: "0 28px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}>
        <PageHeader eyebrow="MTG DNA" title="the helix" />
        {HOME_SECTIONS.map((section, i) => (
          <div key={i} style={{ marginBottom: i < HOME_SECTIONS.length - 1 ? 32 : 0 }}>
            <div style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: mode === "light" ? theme.muted : theme.dim,
            }}>
              {section.label}
            </div>
            <div style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 16,
              fontWeight: 300,
              lineHeight: 1.7,
              marginTop: 8,
              color: mutedColor,
            }}>
              {section.body}
            </div>
          </div>
        ))}

        <div style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: `1px solid ${borderColor}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <a
            href="https://bsky.app/profile/commanderzen.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 13,
              color: mutedColor,
              textDecoration: "none",
              letterSpacing: "0.01em",
            }}
          >
            @commanderzen.bsky.social
          </a>
          <button
            onClick={toggleTheme}
            style={{
              background: "none",
              border: "none",
              borderRadius: 0,
              padding: 0,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: 18,
                color: mutedColor,
                fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
              }}
            >
              {mode === "dark" ? "light_mode" : "dark_mode"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
