import { useState, useEffect, useRef } from "react";
import { getSettings } from "../../lib/settings.js";
import SearchChips from "../../components/SearchChips.jsx";
import { SEARCH_CHIPS } from "../../data/searchChips.js";

// Spine screens pad for the notch (top) and home indicator (bottom) now that
// no tab bar absorbs the bottom. The back chevron lives at the top-left inset.
const SAFE_TOP    = "calc(env(safe-area-inset-top) + 56px)";
const SAFE_BOTTOM = "calc(env(safe-area-inset-bottom) + 24px)";

const HISTORY_KEY = "helixbrew_search_history";
function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); }
  catch { return []; }
}
function saveToHistory(query) {
  const prev = readHistory();
  const next = [query, ...prev.filter(q => q !== query)].slice(0, 10);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

// Win98-style chunky segmented progress bar
const PROGRESS_SEGMENTS = 10;
function Win98ProgressBar({ active }) {
  const [pos, setPos] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!active) { setPos(0); return; }
    const id = setInterval(() => setPos(p => (p + 1) % (PROGRESS_SEGMENTS + 1)), 150);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        borderStyle: "solid",
        borderWidth: "2px",
        borderTopColor: "var(--bevel-dark)",
        borderLeftColor: "var(--bevel-dark)",
        borderBottomColor: "var(--bevel-light)",
        borderRightColor: "var(--bevel-light)",
        background: "var(--color-bg)",
        padding: 3,
      }}>
        <div style={{ display: "flex", gap: 2 }}>
          {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
            <div key={i} style={{
              flex: 1,
              height: 14,
              background: i < pos ? "var(--color-titlebar)" : "transparent",
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Split a stored query into the part the user sees/edits and whether lands
// are currently excluded — "-t:land" is the default-exclusion marker, never
// shown to the user as text they have to manage.
function splitLandFilter(q) {
  const has = /(^|\s)-t:land(\s|$)/.test(q ?? "");
  const clean = (q ?? "").replace(/(^|\s)-t:land(\s|$)/, " ").trim();
  return { clean, includeLands: !has };
}

// A chip's tags are OR'd together within the chip, parenthesized so the
// group binds as one unit once ANDed against the raw text and other chips.
function chipExpression(chip) {
  return `(${chip.tags.map(t => `otag:${t}`).join(" or ")})`;
}

export default function SearchScreen({ onSearch, loading, error, initialQuery, narrowStack = false }) {
  const initial = splitLandFilter(initialQuery);
  const [brewInput,     setBrewInput]     = useState(initial.clean);
  const [includeLands,  setIncludeLands]  = useState(initial.includeLands);
  const [historyIndex,  setHistoryIndex]  = useState(-1);
  const [draftInput,    setDraftInput]    = useState("");
  const [selectedChips, setSelectedChips] = useState(new Set());
  const [rawMode] = useState(() => getSettings().rawQueryMode);
  const inputRef = useRef(null);

  const isDisabled = loading;
  const hasChips = selectedChips.size > 0;
  // Narrow mode filters the current stack in place — an empty box is valid there
  // (it clears the filter / shows all), so SEARCH stays enabled regardless.
  const canSearch = !isDisabled && (narrowStack || !includeLands || Boolean(brewInput.trim()) || hasChips);

  function toggleChip(id) {
    setSelectedChips(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Pre-fill with the session's active query, cursor at the end — never a
  // blank box when a query is already active.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  function handleSearch() {
    if (isDisabled) return;
    const input = brewInput.trim();
    // Selected chips AND together (each chip's own tags OR'd within it), then
    // AND onto the raw text — the whole thing still flows through onSearch
    // exactly like a typed-only query, so the color-identity wrapper (applied
    // by the caller) and the lands toggle both still apply unchanged.
    const chipParts = SEARCH_CHIPS.filter(c => selectedChips.has(c.id)).map(chipExpression);
    const combined = [input, ...chipParts].filter(Boolean).join(" ");
    const finalQuery = includeLands ? combined : `${combined} -t:land`.trim();
    // Narrow mode allows an empty query — that's how you clear the filter.
    if (!finalQuery && !narrowStack) return;
    if (input) saveToHistory(input);
    setHistoryIndex(-1);
    setDraftInput("");
    onSearch(finalQuery);
  }

  function handleBrewKeyDown(e) {
    if (e.key === "Enter") { handleSearch(); return; }
    const history = readHistory();
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndex === -1) {
        setDraftInput(brewInput); setHistoryIndex(0); setBrewInput(history[0]);
      } else {
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next); setBrewInput(history[next]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex <= 0) { setHistoryIndex(-1); setBrewInput(draftInput); }
      else { const next = historyIndex - 1; setHistoryIndex(next); setBrewInput(history[next]); }
    } else {
      if (historyIndex !== -1) setHistoryIndex(-1);
    }
  }

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg)",
      color: "var(--text)",
      fontFamily: "'Noto Sans', sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      paddingTop: SAFE_TOP,
      paddingBottom: SAFE_BOTTOM,
      overflowY: "auto",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 430,
        padding: "0 20px",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: `calc(100dvh - ${SAFE_TOP} - ${SAFE_BOTTOM})`,
      }}>

        {/* ── Spacer ── */}
        <div style={{ flex: 1 }} />

        {/* ── Guided search chips — selected chips fold into the compiled
              query on SEARCH (see handleSearch); toggling alone runs nothing.
              Hidden in narrow mode: chips are otag theme filters, which can't be
              evaluated against the already-dealt relevance stack. ── */}
        {!narrowStack && (
          <div style={{ marginBottom: 12 }}>
            <SearchChips selected={selectedChips} onToggle={toggleChip} />
          </div>
        )}

        {/* ── Narrow-mode hint — this filters the current stack, not a new search ── */}
        {narrowStack && (
          <div style={{
            marginBottom: 8,
            fontFamily: "var(--font-system)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--color-text-secondary)",
          }}>
            Filter this stack — relevance order is kept.{" "}
            <span style={{ fontFamily: "'Noto Sans Mono', monospace" }}>-t:eldrazi</span>,{" "}
            <span style={{ fontFamily: "'Noto Sans Mono', monospace" }}>cmc&lt;=4</span>, or a word.
          </div>
        )}

        {/* ── Input ── */}
        <div style={{ marginBottom: 0 }}>
          <input
            ref={inputRef}
            type="text"
            value={brewInput}
            onChange={e => { if (!isDisabled) setBrewInput(e.target.value); }}
            onKeyDown={handleBrewKeyDown}
            onFocus={() => { setHistoryIndex(-1); setDraftInput(""); }}
            placeholder={narrowStack ? "-t:eldrazi  cmc<=4" : (rawMode ? "f:commander c:g cmc<=3 otag:ramp" : "What are you looking for?")}
            autoComplete="off" autoCorrect="off" spellCheck={false}
            readOnly={isDisabled}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "var(--color-bg)",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-system)",
              fontSize: 16,
              borderStyle: "solid",
              borderWidth: "2px",
              borderTopColor: "var(--bevel-dark)",
              borderLeftColor: "var(--bevel-dark)",
              borderBottomColor: "var(--bevel-light)",
              borderRightColor: "var(--bevel-light)",
              padding: "var(--space-1) var(--space-2)",
              borderRadius: 0,
              outline: "none",
              opacity: isDisabled ? 0.5 : 1,
            }}
          />
        </div>

        {/* ── Lands toggle — auto-seed/search exclude lands by default. Hidden in
              narrow mode: land inclusion is fixed by the seed, so the narrow can
              only ever remove lands, never add them back — a dead control. ── */}
        {!narrowStack && (
        <label style={{
          display: "flex", alignItems: "center", gap: 6,
          marginTop: 8, padding: "2px 0",
          fontFamily: "var(--font-system)",
          fontSize: 12,
          color: "var(--color-text-secondary)",
          cursor: isDisabled ? "default" : "pointer",
          userSelect: "none",
          opacity: isDisabled ? 0.5 : 1,
        }}>
          <input
            type="checkbox"
            checked={includeLands}
            onChange={e => { if (!isDisabled) setIncludeLands(e.target.checked); }}
            disabled={isDisabled}
            style={{ margin: 0 }}
          />
          include lands
        </label>
        )}

        {/* ── Win98 progress bar ── */}
        <Win98ProgressBar active={loading} />

        {/* ── Search error ── */}
        {error && !loading && (
          <div style={{
            fontSize: 12,
            color: "var(--danger)",
            lineHeight: 1.5,
            margin: "8px 0",
          }}>
            {error}
          </div>
        )}

        {/* ── SEARCH button ── */}
        <button
          onClick={handleSearch}
          disabled={!canSearch}
          style={{
            width: "100%",
            background: "var(--color-titlebar)",
            color: "var(--color-titlebar-text)",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-sm)",
            border: "none",
            padding: "18px 24px",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: canSearch ? "pointer" : "default",
            borderRadius: 0,
            opacity: canSearch ? 1 : 0.5,
            marginTop: 0,
          }}
        >
          <span style={{
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-xl)",
            letterSpacing: "0.12em",
            color: "var(--color-titlebar-text)",
          }}>
            {narrowStack ? (brewInput.trim() ? "FILTER" : "SHOW ALL") : "SEARCH"}
          </span>
        </button>

      </div>
    </div>
  );
}
