import { useState, useEffect } from "react";
import { getCardData, formatManaCost } from "../../lib/scryfall.js";

// Spine screens pad for the notch (top, clearing the back chevron) and the
// home indicator (bottom) now that no tab bar absorbs the bottom.
const SAFE_TOP    = "calc(env(safe-area-inset-top) + 56px)";
const SAFE_BOTTOM = "calc(env(safe-area-inset-bottom) + 24px)";

const DECK_GATE = 100;

// WREC tag chips, abbreviated to fit mobile. Values mirror the wrec_tag enum;
// the writes themselves live in Brew.jsx (this stays db-free).
const WREC_CHIPS = [
  { tag: "ramp",            label: "RAMP" },
  { tag: "card-advantage",  label: "CARD-ADV" },
  { tag: "disruption",      label: "DISRUPTION" },
  { tag: "mass-disruption", label: "MASS-DIS" },
  { tag: "plan",            label: "PLAN" },
];
const LABEL_BY_TAG = Object.fromEntries(WREC_CHIPS.map(c => [c.tag, c.label]));

// Type-line display rule (mirrors LegendIdentity): every legal commander is a
// "Legendary Creature — X", so the lead words are dead weight; show the subtypes
// after the em dash. Non-creatures (planeswalker/Background) keep the full line
// so nothing reads blank.
function displayType(typeLine) {
  if (!typeLine) return "";
  return (/creature/i.test(typeLine) && typeLine.includes("—"))
    ? (typeLine.split("—")[1]?.trim() || typeLine)
    : typeLine;
}

// Oracle text, DFC-aware: join both faces so the user judges the whole card.
function oracleOf(card) {
  if (!card) return "";
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces?.length)
    return card.card_faces.map(f => f.oracle_text).filter(Boolean).join("\n\n//\n\n");
  return "";
}

// Mana cost, DFC-aware — front face carries the cast cost.
function manaOf(card) {
  return formatManaCost(card?.mana_cost ?? card?.card_faces?.[0]?.mana_cost);
}

// Review the accumulated swipe results before saving. Purely presentational —
// the Supabase writes live in the page that owns the brew state (Brew.jsx),
// keeping brew-components free of db imports.

// Stackables (basic lands etc.) can repeat — collapse to name + quantity.
function groupByName(cards) {
  const counts = new Map();
  for (const c of cards) {
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, quantity]) => ({ name, quantity }));
}

export default function ReviewScreen({
  decklist, maybeboard,
  onConfirm, saving, error,
  live, onRemove,
  commander,
  cardTags, onToggleTag,
  onBack, onHome,
}) {
  const [commanderName, setCommanderName] = useState("");
  const [buildName, setBuildName] = useState("");
  // Tap-to-expand: only one card's WREC chip selector open at a time. Chosen
  // over always-on chips so five 44px targets fit mobile width cleanly and
  // untagged cards stay chip-free (no "uncategorized" noise).
  const [expandedKey, setExpandedKey] = useState(null);
  // Per-card gameplay data (type/mana/oracle), keyed by name. deck_cards only
  // stores name+quantity, so anything richer is fetched on demand — tagging a
  // card with no visible context is guesswork. undefined = not yet resolved,
  // null = name couldn't resolve (show "card data unavailable"), object = card.
  const [cardData, setCardData] = useState({});

  const groups = {
    decklist: groupByName(decklist),
    maybe: groupByName(maybeboard),
  };

  // Resolve every listed card's data through the one cache-ready helper. It
  // memoizes and throttles internally, so requesting the whole list here costs
  // each unique name a single (delayed) lookup — and slots behind the future
  // local cache without touching this screen.
  useEffect(() => {
    const names = [...groups.decklist, ...groups.maybe].map(c => c.name);
    let cancelled = false;
    for (const name of names) {
      if (cardData[name] !== undefined) continue;
      getCardData(name).then(card => {
        if (cancelled) return;
        setCardData(prev => (prev[name] !== undefined ? prev : { ...prev, [name]: card }));
      });
    }
    return () => { cancelled = true; };
    // groups is derived from decklist/maybeboard; cardData is intentionally
    // omitted (the setter guards against clobbering already-resolved entries).
  }, [decklist, maybeboard]); // eslint-disable-line react-hooks/exhaustive-deps
  // Count toward the 100-card gate, matching deckTotal everywhere else: every
  // instance across the boards + the commander (never written to deck_cards).
  const deckCount = decklist.length + maybeboard.length + 1;
  const totalCards = decklist.length + maybeboard.length;
  const canSave = Boolean(commanderName.trim()) && totalCards > 0 && !saving;

  // A live session anchored to a legend shows the commander header; the
  // non-session save flow has no legend yet, so it keeps the text header.
  const showAnchor = live && commander;

  // WREC composition counts (by card quantity). Multi-tag means these can sum
  // to more than the deck size — a composition view, not a partition. A zero
  // category is the dump-stat tell, so it renders dimmed.
  const wrecCounts = WREC_CHIPS.map(({ tag, label }) => {
    let n = 0;
    for (const k in (cardTags ?? {})) {
      const e = cardTags[k];
      if (e?.tags?.includes(tag)) n += (e.quantity ?? 1);
    }
    return { tag, label, n };
  });

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    fontFamily: "var(--font-system)",
    fontSize: 16,
    border: "1px solid var(--bevel-dark)",
    padding: "10px 12px",
    borderRadius: 0,
    outline: "none",
  };

  function renderSection(label, items, sectionKey) {
    return (
      <div key={sectionKey}>
        <div style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          color: "var(--muted)",
          borderBottom: "1px solid var(--bevel-dark)",
          paddingBottom: 6,
          marginBottom: 6,
        }}>
          {label} · {items.reduce((n, c) => n + c.quantity, 0)}
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>—</div>
        ) : (
          items.map(({ name, quantity }) => {
            const key = `${sectionKey}:${name}`;
            const tags = cardTags?.[key]?.tags ?? [];
            const expanded = expandedKey === key;
            const card = cardData[name];               // undefined | null | object
            const resolved = card !== undefined;       // a lookup has come back
            const unavailable = resolved && card === null;
            const type = card ? displayType(card.type_line) : "";
            const mana = card ? manaOf(card) : "";
            const oracle = card ? oracleOf(card) : "";
            return (
              <div key={name}>
                {/* Tapping the row (live) opens its WREC chip selector. */}
                <div
                  onClick={live ? () => setExpandedKey(k => (k === key ? null : key)) : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    minHeight: live ? 44 : undefined,
                    padding: "5px 0",
                    fontSize: 13,
                    color: "var(--text)",
                    cursor: live ? "pointer" : "default",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{
                    flex: 1, minWidth: 0,
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    <span style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>{name}</span>
                    {/* Context subline — type (subtypes per the display rule) +
                        mana, dimmed mono. A name that won't resolve says so
                        rather than reading as a blank/broken row. */}
                    {unavailable ? (
                      <span style={{
                        fontFamily: "'Noto Sans Mono', monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}>card data unavailable</span>
                    ) : (type || mana) ? (
                      <span style={{
                        fontFamily: "'Noto Sans Mono', monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}>
                        {type.toLowerCase()}{type && mana ? "  ·  " : ""}{mana}
                      </span>
                    ) : null}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {/* Active tags, compact, when collapsed — untagged shows nothing */}
                    {!expanded && tags.length > 0 && (
                      <span style={{
                        fontFamily: "'Noto Sans Mono', monospace",
                        fontSize: 9,
                        letterSpacing: "0.06em",
                        color: "var(--primary)",
                      }}>
                        {tags.map(t => LABEL_BY_TAG[t] ?? t).join(" · ")}
                      </span>
                    )}
                    {quantity > 1 && (
                      <span style={{ color: "var(--muted)" }}>×{quantity}</span>
                    )}
                    {live && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemove(name, sectionKey); }}
                        aria-label={`Remove ${name}`}
                        style={{
                          minHeight: 44, minWidth: 44,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          color: "var(--muted)",
                          fontFamily: "var(--font-system)",
                          fontSize: 16,
                          lineHeight: 1,
                          cursor: "pointer",
                        }}
                      >×</button>
                    )}
                  </div>
                </div>

                {/* Oracle text — shown only while tagging, so the WREC role can
                    be judged without leaving the screen. Body font for
                    readability, dimmed, line breaks preserved. */}
                {live && expanded && oracle && (
                  <div style={{
                    fontFamily: "'Noto Sans', sans-serif",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "var(--text2)",
                    whiteSpace: "pre-wrap",
                    padding: "2px 0 8px",
                  }}>
                    {oracle}
                  </div>
                )}

                {/* WREC chip selector — five 44px multi-select chips */}
                {live && expanded && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0 10px" }}>
                    {WREC_CHIPS.map(({ tag, label }) => {
                      const active = tags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={(e) => { e.stopPropagation(); onToggleTag?.(name, sectionKey, tag); }}
                          style={{
                            minHeight: 44,
                            padding: "0 12px",
                            display: "flex", alignItems: "center",
                            border: `1px solid ${active ? "var(--primary)" : "var(--muted)"}`,
                            background: active ? "var(--primary)" : "transparent",
                            color: active ? "var(--color-bg)" : "var(--muted)",
                            fontFamily: "'Noto Sans Mono', monospace",
                            fontSize: 10,
                            letterSpacing: "0.08em",
                            borderRadius: 0,
                            cursor: "pointer",
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >{label}</button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

  // Bottom thumb-zone nav, live sessions only — mirrors the swipe screen's
  // back-left pattern.
  const showBottomNav = live && (onBack || onHome);

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg)",
      color: "var(--text)",
      fontFamily: "'Noto Sans', sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      overflowY: "auto",
      paddingBottom: showBottomNav ? "calc(env(safe-area-inset-bottom) + 64px)" : SAFE_BOTTOM,
    }}>

      {/* Frozen header — the commander anchor AND the WREC band stay pinned to
          the top of the scrolling list (spreadsheet top-row behavior), so the
          deck stays identifiable and its composition readable as rows scroll
          beneath. Safe-area top inset respected; the content below clears it at
          rest so the first row is never hidden under the header. */}
      {live && (
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          alignSelf: "stretch",
          background: "var(--bg)",
          borderBottom: "1px solid var(--bevel-dark)",
        }}>
          {/* Commander anchor — padded left of the brew back chevron so the
              two never overlap. */}
          {showAnchor && (
          <div style={{
            maxWidth: 430,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
            paddingTop: "calc(env(safe-area-inset-top) + 10px)",
            paddingBottom: 12,
            paddingLeft: "calc(env(safe-area-inset-left) + 56px)",
            paddingRight: 20,
          }}>
            <div style={{
              width: 56, height: 56, flexShrink: 0,
              borderRadius: "5.5% / 4%",
              overflow: "hidden",
              background: "var(--color-surface)",
            }}>
              {commander.art && (
                <img
                  src={commander.art}
                  alt={commander.name}
                  draggable={false}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
            </div>
            <div style={{
              flex: 1, minWidth: 0,
              fontFamily: "'Zilla Slab', serif",
              fontSize: 18,
              letterSpacing: "0.02em",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {commander.name}
            </div>
            <div style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 13,
              color: deckCount >= DECK_GATE ? "var(--primary)" : "var(--muted)",
              flexShrink: 0,
            }}>
              {deckCount}/{DECK_GATE}
            </div>
          </div>
          )}

          {/* WREC composition band — frozen with the anchor. Counts per
              category (by quantity). Multi-tag so they can exceed deck size; a
              0 reads dimmed as a structural gap. */}
          <div style={{
            maxWidth: 430,
            margin: "0 auto",
            display: "flex", flexWrap: "wrap", alignItems: "center",
            fontFamily: "'Noto Sans Mono', monospace",
            fontSize: 11,
            paddingLeft: 20, paddingRight: 20,
            paddingTop: showAnchor ? 8 : "calc(env(safe-area-inset-top) + 10px)",
            paddingBottom: 8,
            borderTop: showAnchor ? "1px solid var(--bevel-dark)" : "none",
          }}>
            {wrecCounts.map(({ tag, label, n }, i) => (
              <span key={tag} style={{ whiteSpace: "nowrap" }}>
                {i > 0 && <span style={{ color: "var(--muted)", margin: "0 6px" }}>·</span>}
                <span style={{ color: n === 0 ? "var(--muted)" : "var(--text)" }}>{label} {n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{
        width: "100%",
        maxWidth: 430,
        padding: live ? "20px 20px 40px" : `${SAFE_TOP} 20px 40px`,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>

        {/* Text header only when there's no commander anchor (save flow). */}
        {!showAnchor && (
          <div style={{
            fontFamily: "var(--font-system)",
            fontSize: 20,
            letterSpacing: "0.08em",
            color: "var(--text)",
          }}>
            {live ? "DECK" : "REVIEW"} · {totalCards} CARD{totalCards !== 1 ? "S" : ""}
          </div>
        )}

        {/* DECKLIST always; MAYBEBOARD only when it holds cards. No pile. */}
        {renderSection("DECKLIST", groups.decklist, "decklist")}
        {maybeboard.length > 0 && renderSection("MAYBEBOARD", groups.maybe, "maybe")}

        {/* Name the brew — live sessions write on every flick, nothing to save */}
        {!live && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <input
              type="text"
              placeholder="Commander name"
              value={commanderName}
              onChange={e => setCommanderName(e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Build name (optional)"
              value={buildName}
              onChange={e => setBuildName(e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={inputStyle}
            />
            <button
              onClick={() => onConfirm(commanderName.trim(), buildName.trim())}
              disabled={!canSave}
              style={{
                width: "100%",
                background: "var(--color-titlebar)",
                color: "var(--color-titlebar-text)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-xl)",
                letterSpacing: "0.12em",
                border: "none",
                padding: "16px 24px",
                borderRadius: 0,
                cursor: canSave ? "pointer" : "default",
                opacity: canSave ? 1 : 0.5,
              }}
            >
              {saving ? "SAVING…" : "SAVE BREW"}
            </button>
            {error && (
              <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>
                {error}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Bottom thumb-zone nav — live sessions only. Mirrors the swipe screen's
          back-left pattern: BACK resumes the swipe session where it left off,
          HOME exits to the legend's DEX entry. Text labels, mono, ≥44px. */}
      {showBottomNav && (
        <div style={{
          position: "fixed",
          left: 0, right: 0,
          bottom: 0,
          zIndex: 5,
          display: "flex",
          justifyContent: "center",
          padding: "0 0 calc(env(safe-area-inset-bottom) + 8px)",
          background: "linear-gradient(to top, var(--bg) 60%, transparent)",
        }}>
          <div style={{
            width: "100%",
            maxWidth: 430,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
          }}>
            <button
              onClick={onBack}
              aria-label="Back to swipe"
              style={{
                minHeight: 44,
                display: "flex", alignItems: "center", gap: 6,
                background: "transparent", border: "none",
                color: "var(--text)",
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, letterSpacing: "0.08em",
                padding: "0 10px",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_back</span>
              back
            </button>
            <button
              onClick={onHome}
              aria-label="Home"
              style={{
                minHeight: 44,
                display: "flex", alignItems: "center", gap: 6,
                background: "transparent", border: "none",
                color: "var(--muted)",
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, letterSpacing: "0.08em",
                padding: "0 10px",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              home
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>home</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
