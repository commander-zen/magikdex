import { C } from "../constants";

const HOME_SECTIONS = [
  {
    label: "Ben.",
    body: "I go by Commander Zen. You probably haven't heard of me but that's the point. This is just an EDH passion project schlepped together by a guy with a bit of professional knowledge, a very specific personal obsession, and the demeanor of Mister Rodgers raised on Run the Jewels. This will always be free and available and the best I can make it.",
  },
  {
    label: "MTG DNA.",
    body: "This intends to be the source of truth and connective tissue in terms of digital tooling for the EDH player. Current state, the tools in the EDH ecosystem are like loose draft chaff in your LGS bag. Nothing connects them. MTG DNA aims to bridge that gap.",
  },
  {
    label: "Always.",
    body: "Everyone has their own custom solution for how to track what they're up to at any given moment in regards to their commander career. MTG DNA intends to unify and standardize that process to ensure the EDH player has the best available option at any point in the lifecycle of your favorite legend in the zone from cradle to grave.",
  },
  {
    label: "Mobile.",
    body: "Love Scryfall but that's a bitch on mobile and a smartphone or similar device is the default option for users today. The one shortcoming IMO of the S tier options are mobile compatibility, with the exception of ManaBox.",
  },
  {
    label: "Fun.",
    body: "I consider myself an illiterate technologist in the sense that I am not able to code anything, yet I have an understanding of every other aspect of the SDLC. Claude Code has enabled me to realize projects that before were just concepts. I believe in ethical LLM usage, with a human in the loop always. If you wish to confirm or correct my understanding, please feel free to reach out. I would appreciate the discussion.",
  },
];

export default function HomeScreen() {
  return (
    <div style={{
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      background: C.base,
      fontFamily: "'Noto Sans', sans-serif",
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{
        padding: "24px 28px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}>
        {HOME_SECTIONS.map((section, i) => (
          <div key={i} style={{ marginBottom: i < HOME_SECTIONS.length - 1 ? 32 : 0 }}>
            <div style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: C.text,
              lineHeight: 1.2,
            }}>
              {section.label}
            </div>
            <div style={{
              fontSize: 14,
              fontWeight: 400,
              color: C.muted,
              lineHeight: 1.7,
              marginTop: 6,
            }}>
              {section.body}
            </div>
          </div>
        ))}

        <div style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: `1px solid ${C.border}`,
          textAlign: "center",
        }}>
          <a
            href="https://bsky.app/profile/commanderzen.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 13,
              color: C.muted,
              textDecoration: "none",
              letterSpacing: "0.01em",
            }}
          >
            @commanderzen.bsky.social
          </a>
        </div>
      </div>
    </div>
  );
}
