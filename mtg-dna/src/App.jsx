import { useState } from "react";

// ─── Color tokens (Crystal/Suicune palette) ───────────────────────────────────
const C = {
  base:    "#06040f",
  surface: "#0d0a1a",
  border:  "#1a1530",
  blue:    "#5b8fff",
  purple:  "#a78bfa",
  cyan:    "#00c9ff",
  text:    "#e0f2ff",
  muted:   "#6b7fa8",
  dim:     "#2a2545",
};

// ─── Nav config ───────────────────────────────────────────────────────────────
const TABS = [
  { id: "home",     label: "Home",       icon: "home",           iconFilled: "home"           },
  { id: "collection", label: "Collection", icon: "style",        iconFilled: "style"          },
  { id: "brew",     label: "Brew",        icon: "science",       iconFilled: "science"        },
  { id: "play",     label: "Play",        icon: "person",        iconFilled: "person"         },
  { id: "analyze",  label: "Analyze",     icon: "bar_chart",     iconFilled: "bar_chart"      },
];

// ─── Home explainer screen ────────────────────────────────────────────────────
const HOME_SECTIONS = [
  {
    label: "Ben.",
    body: "I go by Commander Zen online. I understand I'm nobody but that's the point. This is just an EDH passion project schlepped together using what I know professionally and what I obsess about personally. It will always be free and available and the best I can make it.",
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

function HomeScreen() {
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
      </div>
    </div>
  );
}

// ─── Collection tool directory ────────────────────────────────────────────────
const TIER_COLORS = {
  S: { bg: "#f59e0b22", border: "#f59e0b55", badge: "#f59e0b", text: "#fde68a" },
  A: { bg: "#00c9ff18", border: "#00c9ff44", badge: "#00c9ff", text: "#bfefff" },
  B: { bg: "#5b8fff18", border: "#5b8fff44", badge: "#5b8fff", text: "#c7d7ff" },
};

const TOOLS = [
  { tier: "S", name: "ManaBox",           url: "https://manabox.app",              desc: "1M+ downloads. Scan physical cards. EDHREC integration." },
  { tier: "A", name: "GrimDeck",          url: "https://grimdeck.com",             desc: "Collection + deck builder integrated. Frank Karsten mana math." },
  { tier: "A", name: "Commander Template",url: "https://commandertemplate.com",    desc: "Variant-aware collection tracking. Owns which printing you have." },
  { tier: "B", name: "Archidekt",         url: "https://archidekt.com",            desc: "Collection tracking built into the deck builder." },
];

const BREW_TOOLS = [
  { tier: "S", name: "Moxfield",           url: "https://moxfield.com",            desc: "The de facto standard. Apple-polished deck storage and sharing." },
  { tier: "S", name: "Archidekt",          url: "https://archidekt.com",           desc: "More control, more customization. Flexible and powerful." },
  { tier: "A", name: "Commander Template", url: "https://commandertemplate.com",   desc: "Math-based recs, community hub, foil shimmer UI." },
  { tier: "A", name: "ScryCheck",          url: "https://scrycheck.com",           desc: "Power level analysis. 5 vectors, 93% bracket accuracy." },
  { tier: "B", name: "GrimDeck",           url: "https://grimdeck.com",            desc: "Best mana analysis in the landscape. Frank Karsten methodology." },
];

const PLAY_LIFE_TOOLS = [
  { tier: "S", name: "Lotus",         url: "https://lifecounter.app",  desc: "Cleanest life counter. No ads. Commander damage, all counter types, game timer." },
  { tier: "A", name: "Playgroup.gg",  url: "https://playgroup.gg",     desc: "ELO tracking, device-synced logging, Playscore system. 4.9★." },
];

const PLAY_POD_TOOLS = [
  { tier: "A", name: "ScryCheck",         url: "https://scrycheck.com",                desc: "Power level scoring. The gold standard for bracket assignment." },
  { tier: "B", name: "EDH Power Level",   url: "https://mtg-deck-comparator.com",      desc: "Pod Balance Checker. Paste all four lists, get balance read." },
];

const ANALYZE_TOOLS = [
  { tier: "S", name: "ScryCheck",     url: "https://scrycheck.com",      desc: "93% bracket accuracy. 5 scoring vectors. Every point traceable." },
  { tier: "S", name: "EDHREC",        url: "https://edhrec.com",         desc: "Card recommendation engine. Commander staples and synergy discovery." },
  { tier: "A", name: "Playgroup.gg",  url: "https://playgroup.gg",       desc: "Win rate tracking, matchup history, ELO over time." },
  { tier: "B", name: "Play Nice",     url: "https://playnicemtg.com",    desc: "MVP card tracking, seat analysis, 21-game rolling win rates." },
  { tier: "B", name: "MTG Master",    url: "https://mtgmaster.app",      desc: "Shareable power level report for Rule Zero conversations." },
];

const TIERS = ["S", "A", "B"];

// ─── Shared tool chip renderer ────────────────────────────────────────────────
function ToolChips({ tools }) {
  const grouped = TIERS.reduce((acc, t) => {
    acc[t] = tools.filter(tool => tool.tier === t);
    return acc;
  }, {});

  return (
    <>
      {TIERS.filter(t => grouped[t].length > 0).map(tier => {
        const tc = TIER_COLORS[tier];
        return (
          <div key={tier} style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: tc.badge,
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: 6,
                background: tc.bg,
                border: `1px solid ${tc.border}`,
                fontSize: 11,
                fontWeight: 800,
                color: tc.badge,
              }}>{tier}</span>
              Tier
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {grouped[tier].map(tool => (
                <a
                  key={tool.name}
                  href={tool.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 16px",
                    borderRadius: 14,
                    background: tc.bg,
                    border: `1px solid ${tc.border}`,
                    textDecoration: "none",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: `${tc.badge}22`,
                    border: `1px solid ${tc.badge}55`,
                    fontSize: 12,
                    fontWeight: 800,
                    color: tc.badge,
                    letterSpacing: 0,
                  }}>{tool.tier}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: tc.text,
                      lineHeight: 1.2,
                      marginBottom: 3,
                    }}>{tool.name}</div>
                    <div style={{
                      fontSize: 12,
                      color: C.muted,
                      lineHeight: 1.5,
                    }}>{tool.desc}</div>
                  </div>
                  <span className="material-symbols-rounded" style={{
                    flexShrink: 0,
                    fontSize: 18,
                    fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                    color: tc.badge,
                    opacity: 0.7,
                  }}>open_in_new</span>
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function CollectionScreen() {
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

// ─── Brew screen ──────────────────────────────────────────────────────────────
const BREW_ACCENT = "#4ade80";

function SectionHeader({ label }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: C.muted,
      marginBottom: 14,
      paddingBottom: 8,
      borderBottom: `1px solid ${C.border}`,
    }}>{label}</div>
  );
}

function TeaserCard({ accent, name, desc }) {
  return (
    <div style={{
      padding: "16px",
      borderRadius: 14,
      background: `${accent}10`,
      border: `1px solid ${accent}33`,
    }}>
      <div style={{
        fontSize: 15,
        fontWeight: 600,
        color: accent,
        marginBottom: 6,
      }}>{name}</div>
      <div style={{
        fontSize: 13,
        color: C.muted,
        lineHeight: 1.55,
        marginBottom: 12,
      }}>{desc}</div>
      <div style={{
        display: "inline-flex",
        padding: "4px 12px",
        borderRadius: 100,
        background: `${accent}14`,
        border: `1px solid ${accent}33`,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: accent,
      }}>Coming soon</div>
    </div>
  );
}

function BrewScreen() {
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

// ─── Play screen ──────────────────────────────────────────────────────────────
const PLAY_ACCENT = "#f87171";

function PlayScreen() {
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

// ─── Analyze screen ───────────────────────────────────────────────────────────
const ANALYZE_ACCENT = C.blue;
const GAP_ACCENT = "#ef4444";

function AnalyzeScreen() {
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

// ─── Placeholder screen component ─────────────────────────────────────────────
function PlaceholderScreen({ tab }) {
  const icons = {
    home:       { glyph: "home",    color: C.cyan,   desc: "Your Commander hub. Recent decks, pod history, and what's next." },
    collection: { glyph: "style",   color: C.purple, desc: "Every card you own. Scan, track, and deploy from your vault." },
    brew:       { glyph: "science", color: "#4ade80", desc: "Deck Stack lives here. Swipe, build, tune. Powered by Scryfall." },
    play:       { glyph: "person",  color: "#f87171", desc: "Pod Check and Life Track. Everything at the table." },
  };
  const info = icons[tab.id];

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "20px",
      padding: "40px 32px",
      fontFamily: "'Noto Sans', sans-serif",
      color: C.text,
      background: C.base,
    }}>
      {/* Big icon */}
      <div style={{
        width: 88,
        height: 88,
        borderRadius: 24,
        background: `${info.color}18`,
        border: `1px solid ${info.color}44`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 0 40px ${info.color}22`,
      }}>
        <span className="material-symbols-rounded" style={{
          fontSize: 40,
          fontVariationSettings: "'FILL' 0, 'wght' 200, 'GRAD' 0, 'opsz' 48",
          color: info.color,
        }}>{info.glyph}</span>
      </div>

      {/* Label */}
      <div style={{ textAlign: "center" }}>
        <div style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: C.text,
          marginBottom: 8,
        }}>
          {tab.label}
        </div>
        <div style={{
          fontSize: 14,
          color: C.muted,
          lineHeight: 1.6,
          maxWidth: 280,
        }}>
          {info.desc}
        </div>
      </div>

      {/* Coming soon pill */}
      <div style={{
        padding: "6px 16px",
        borderRadius: 100,
        background: `${info.color}14`,
        border: `1px solid ${info.color}33`,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: info.color,
      }}>
        Coming soon
      </div>
    </div>
  );
}

// ─── Glass Nav Bar ─────────────────────────────────────────────────────────────
function GlassNav({ active, onSelect }) {
  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 200,
      display: "flex",
      justifyContent: "center",
      paddingBottom: "env(safe-area-inset-bottom, 12px)",
      paddingTop: 8,
      // The blur backdrop behind the whole bar region
      background: "linear-gradient(to top, rgba(6,4,15,0.92) 60%, rgba(6,4,15,0))",
    }}>
      {/* The pill */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        background: "rgba(18, 14, 36, 0.72)",
        backdropFilter: "blur(24px) saturate(1.6)",
        WebkitBackdropFilter: "blur(24px) saturate(1.6)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 32,
        padding: "6px 8px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
        minWidth: 300,
        maxWidth: 420,
        width: "calc(100% - 40px)",
      }}>
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          // Pick accent color per tab
          const accent = {
            home:       C.cyan,
            collection: C.purple,
            brew:       "#4ade80",
            play:       "#f87171",
            analyze:    C.blue,
          }[tab.id];

          return (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                padding: "8px 4px 6px",
                borderRadius: 24,
                border: "none",
                cursor: "pointer",
                background: isActive ? `${accent}22` : "transparent",
                transition: "background 0.2s, transform 0.15s",
                transform: isActive ? "scale(1.05)" : "scale(1)",
                outline: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {/* Icon */}
              <span
                className="material-symbols-rounded"
                style={{
                  fontSize: 24,
                  fontVariationSettings: isActive
                    ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
                    : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
                  color: isActive ? accent : C.muted,
                  transition: "color 0.2s, font-variation-settings 0.2s",
                }}
              >
                {tab.icon}
              </span>
              {/* Label */}
              <span style={{
                fontSize: 10,
                fontFamily: "'Noto Sans', sans-serif",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? accent : C.muted,
                letterSpacing: "0.02em",
                lineHeight: 1,
                transition: "color 0.2s",
              }}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState("analyze");

  const navHeight = 90; // rough height to reserve at bottom

  const renderScreen = () => {
    const tab = TABS.find(t => t.id === activeTab);
    if (activeTab === "home") {
      return <HomeScreen />;
    }
    if (activeTab === "collection") {
      return <CollectionScreen />;
    }
    if (activeTab === "brew") {
      return <BrewScreen />;
    }
    if (activeTab === "play") {
      return <PlayScreen />;
    }
    if (activeTab === "analyze") {
      return <AnalyzeScreen />;
    }
    return <PlaceholderScreen tab={tab} />;
  };

  return (
    <div style={{
      height: "100dvh",
      width: "100%",
      display: "flex",
      flexDirection: "column",
      background: C.base,
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Screen content — padded above the nav */}
      <div style={{
        flex: 1,
        overflow: "hidden",
        paddingBottom: navHeight,
      }}>
        {renderScreen()}
      </div>

      {/* Glass nav */}
      <GlassNav active={activeTab} onSelect={setActiveTab} />
    </div>
  );
}
