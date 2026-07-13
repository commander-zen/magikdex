import { useState, useMemo, useEffect } from "react";

// ── Constants ──────────────────────────────────────────────────────────────────
const COLORS = ["W", "U", "B", "R", "G", "C"];
const COLOR_STYLE = {
  W: "#f1f5f9", U: "#60a5fa", B: "#c084fc", R: "#f87171", G: "#4ade80", C: "#94a3b8",
};
const COLOR_MODES = [
  { id: "at",       label: "AT LEAST" },
  { id: "exactly",  label: "EXACTLY" },
  { id: "subset",   label: "SUBSET" },
  { id: "identity", label: "COLOR IDENTITY" },
];
const RARITIES = [
  { id: "C", label: "COMMON" },
  { id: "U", label: "UNCOMMON" },
  { id: "R", label: "RARE" },
  { id: "M", label: "MYTHIC" },
];
const OPERATORS  = ["=", "<=", ">=", "<", ">"];
const STATS_LIST = [
  { id: "pow", label: "Power" },
  { id: "tou", label: "Toughness" },
  { id: "loy", label: "Loyalty" },
];

// ── Style helpers ──────────────────────────────────────────────────────────────
const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-bg)",
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-system)",
  fontSize: "var(--font-size-base)",
  borderStyle: "solid",
  borderWidth: "2px",
  borderTopColor: "var(--bevel-dark)",
  borderLeftColor: "var(--bevel-dark)",
  borderBottomColor: "var(--bevel-light)",
  borderRightColor: "var(--bevel-light)",
  padding: "var(--space-1) var(--space-2)",
  borderRadius: 0,
  outline: "none",
};

function chip(active) {
  return {
    padding: "var(--space-1) var(--space-3)",
    borderRadius: 0,
    borderStyle: "solid",
    borderWidth: "2px",
    borderTopColor: active ? "var(--bevel-dark)" : "var(--bevel-light)",
    borderLeftColor: active ? "var(--bevel-dark)" : "var(--bevel-light)",
    borderBottomColor: active ? "var(--bevel-light)" : "var(--bevel-dark)",
    borderRightColor: active ? "var(--bevel-light)" : "var(--bevel-dark)",
    background: active ? "var(--color-chrome-mid)" : "var(--color-chrome)",
    color: "var(--color-text-chrome)",
    fontFamily: "var(--font-system)",
    fontSize: "var(--font-size-sm)", letterSpacing: 1.5,
    cursor: "pointer", flexShrink: 0,
    minHeight: 44, display: "flex", alignItems: "center",
  };
}

function opBtn(active) {
  return {
    padding: "0 10px",
    borderRadius: 0,
    borderStyle: "solid",
    borderWidth: "2px",
    borderTopColor: active ? "var(--bevel-dark)" : "var(--bevel-light)",
    borderLeftColor: active ? "var(--bevel-dark)" : "var(--bevel-light)",
    borderBottomColor: active ? "var(--bevel-light)" : "var(--bevel-dark)",
    borderRightColor: active ? "var(--bevel-light)" : "var(--bevel-dark)",
    background: active ? "var(--color-chrome-mid)" : "var(--color-chrome)",
    color: "var(--color-text-chrome)",
    fontFamily: "var(--font-system)",
    fontSize: "var(--font-size-sm)", cursor: "pointer",
    minHeight: 44, minWidth: 42,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  };
}

function FilterSectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600,
      fontFamily: "'Noto Sans', sans-serif",
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "var(--muted)",
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function RemovableChip({ label, onRemove }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 10px", borderRadius: 6,
      background: "rgba(91,143,255,0.12)",
      border: "1px solid rgba(91,143,255,0.25)",
      color: "var(--primary)", fontSize: 13,
      fontFamily: "'Noto Sans Mono', monospace",
    }}>
      {label}
      <button type="button" onClick={onRemove} style={{
        background: "var(--color-chrome)",
        color: "var(--color-text-chrome)",
        fontFamily: "var(--font-system)",
        fontSize: "var(--font-size-sm)",
        borderStyle: "solid",
        borderWidth: "2px",
        borderTopColor: "var(--bevel-light)",
        borderLeftColor: "var(--bevel-light)",
        borderBottomColor: "var(--bevel-dark)",
        borderRightColor: "var(--bevel-dark)",
        padding: "var(--space-1) var(--space-3)",
        cursor: "pointer",
        borderRadius: 0,
        lineHeight: 1,
        display: "flex", alignItems: "center",
      }}>✕</button>
    </div>
  );
}

function AddInputRow({ value, onChange, onAdd, placeholder, mono = false }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          ...inputStyle, flex: 1,
          fontFamily: mono ? "'Noto Sans Mono', monospace" : "'Noto Sans', sans-serif",
        }}
      />
      <button type="button" onClick={onAdd} style={{
        background: "var(--color-chrome)",
        color: "var(--color-text-chrome)",
        fontFamily: "var(--font-system)",
        fontSize: "var(--font-size-sm)",
        borderStyle: "solid",
        borderWidth: "2px",
        borderTopColor: "var(--bevel-light)",
        borderLeftColor: "var(--bevel-light)",
        borderBottomColor: "var(--bevel-dark)",
        borderRightColor: "var(--bevel-dark)",
        padding: "var(--space-1) var(--space-3)",
        cursor: "pointer",
        borderRadius: 0,
        letterSpacing: 2,
        flexShrink: 0, minHeight: 44,
      }}>
        + ADD
      </button>
    </div>
  );
}

// ── Query builder ──────────────────────────────────────────────────────────────
function buildQuery({
  selectedColors, colorMode, typeText, oracleTerms, manaCost,
  cmcConditions, selectedRarities, priceOp, priceVal,
  statType, statOp, statVal, setCode, artist,
}) {
  const parts = [];

  if (selectedColors.length > 0) {
    const letters      = selectedColors.filter(c => c !== "C").join("");
    const hasColorless = selectedColors.includes("C");
    if (colorMode === "identity") {
      if (letters)      parts.push(`id:${letters}`);
      if (hasColorless) parts.push("id=c");
    } else {
      const op = colorMode === "exactly" ? "=" : colorMode === "subset" ? "<=" : ":";
      if (letters)      parts.push(`c${op}${letters}`);
      if (hasColorless) parts.push("c:c");
    }
  }

  if (typeText.trim()) parts.push(`t:${typeText.trim()}`);
  for (const t of oracleTerms) if (t.trim()) parts.push(`o:"${t.trim()}"`);
  if (manaCost.trim()) parts.push(`m:${manaCost.trim()}`);
  for (const c of cmcConditions) if (c.val.trim()) parts.push(`cmc${c.op}${c.val.trim()}`);

  if (selectedRarities.length > 0) {
    const MAP = { C: "common", U: "uncommon", R: "rare", M: "mythic" };
    const rarParts = selectedRarities.map(r => `r:${MAP[r]}`);
    parts.push(rarParts.length === 1 ? rarParts[0] : `(${rarParts.join(" OR ")})`);
  }

  if (priceVal.trim()) parts.push(`usd${priceOp}${priceVal.trim()}`);
  if (statVal.trim())  parts.push(`${statType}${statOp}${statVal.trim()}`);
  if (setCode.trim())  parts.push(`s:${setCode.trim()}`);
  if (artist.trim())   parts.push(`a:"${artist.trim()}"`);

  parts.push("f:commander");
  return parts.join(" ");
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function SearchForm({ onSearch, onQueryChange, loading, error }) {
  const [rawQuery,         setRawQuery]         = useState("");
  const [advOpen,          setAdvOpen]          = useState(false);
  const [selectedColors,   setSelectedColors]   = useState([]);
  const [colorMode,        setColorMode]        = useState("at");
  const [typeText,         setTypeText]         = useState("");
  const [oracleTerms,      setOracleTerms]      = useState([]);
  const [oracleInput,      setOracleInput]      = useState("");
  const [manaCost,         setManaCost]         = useState("");
  const [cmcConditions,    setCmcConditions]    = useState([]);
  const [cmcOp,            setCmcOp]            = useState(">=");
  const [cmcVal,           setCmcVal]           = useState("");
  const [selectedRarities, setSelectedRarities] = useState([]);
  const [priceOp,          setPriceOp]          = useState("<=");
  const [priceVal,         setPriceVal]         = useState("");
  const [statType,         setStatType]         = useState("pow");
  const [statOp,           setStatOp]           = useState(">=");
  const [statVal,          setStatVal]          = useState("");
  const [setCode,          setSetCode]          = useState("");
  const [artist,           setArtist]           = useState("");

  const advancedQuery = useMemo(() => buildQuery({
    selectedColors, colorMode, typeText, oracleTerms, manaCost,
    cmcConditions, selectedRarities, priceOp, priceVal,
    statType, statOp, statVal, setCode, artist,
  }), [selectedColors, colorMode, typeText, oracleTerms, manaCost,
      cmcConditions, selectedRarities, priceOp, priceVal,
      statType, statOp, statVal, setCode, artist]);

  const assembledQuery = rawQuery.trim()
    ? `${rawQuery.trim()} ${advancedQuery}`
    : advancedQuery;

  useEffect(() => {
    onQueryChange?.(assembledQuery);
  }, [assembledQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilterCount =
    selectedColors.length +
    (typeText.trim() ? 1 : 0) +
    oracleTerms.length +
    (manaCost.trim() ? 1 : 0) +
    cmcConditions.length +
    selectedRarities.length +
    (priceVal.trim() ? 1 : 0) +
    (statVal.trim() ? 1 : 0) +
    (setCode.trim() ? 1 : 0) +
    (artist.trim() ? 1 : 0);

  function toggleColor(c) {
    setSelectedColors(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c]);
  }
  function toggleRarity(r) {
    setSelectedRarities(p => p.includes(r) ? p.filter(x => x !== r) : [...p, r]);
  }
  function addOracleTerm() {
    if (!oracleInput.trim()) return;
    setOracleTerms(p => [...p, oracleInput.trim()]);
    setOracleInput("");
  }
  function addCmcCondition() {
    if (!cmcVal.trim()) return;
    setCmcConditions(p => [...p, { op: cmcOp, val: cmcVal.trim() }]);
    setCmcVal("");
  }

  function handleSubmit(e) {
    e?.preventDefault();
    if (loading) return;
    onSearch(assembledQuery.trim());
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Hidden submit so Enter key works in inputs */}
      <button type="submit" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" />

      {/* Search input + filters toggle — unified row */}
      <div
        style={{
          display: "flex", alignItems: "center",
          background: "var(--color-surface)",
          borderStyle: "solid",
          borderWidth: "2px",
          borderTopColor: "var(--bevel-light)",
          borderLeftColor: "var(--bevel-light)",
          borderBottomColor: "var(--bevel-dark)",
          borderRightColor: "var(--bevel-dark)",
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        {/* Search icon + input */}
        <div style={{ display: "flex", alignItems: "center", flex: 1, gap: 10, padding: "14px 16px", minWidth: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, opacity: 0.5 }}>
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            value={rawQuery}
            onChange={e => setRawQuery(e.target.value)}
            placeholder="Scryfall syntax"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              background: "var(--color-bg)",
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-system)",
              fontSize: "var(--font-size-base)",
              borderStyle: "solid",
              borderWidth: "2px",
              borderTopColor: "var(--bevel-dark)",
              borderLeftColor: "var(--bevel-dark)",
              borderBottomColor: "var(--bevel-light)",
              borderRightColor: "var(--bevel-light)",
              padding: "var(--space-1) var(--space-2)",
              borderRadius: 0,
              outline: "none",
              minWidth: 0,
            }}
          />
        </div>

        {/* Divider */}
        <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.08)", flexShrink: 0, margin: "8px 0" }} />

        {/* Filters suffix button */}
        <button
          type="button"
          onClick={() => setAdvOpen(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "var(--color-chrome)",
            color: "var(--color-text-chrome)",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-sm)",
            borderStyle: "solid",
            borderWidth: "2px",
            borderTopColor: advOpen ? "var(--bevel-dark)" : "var(--bevel-light)",
            borderLeftColor: advOpen ? "var(--bevel-dark)" : "var(--bevel-light)",
            borderBottomColor: advOpen ? "var(--bevel-light)" : "var(--bevel-dark)",
            borderRightColor: advOpen ? "var(--bevel-light)" : "var(--bevel-dark)",
            padding: "var(--space-1) var(--space-3)",
            cursor: "pointer",
            borderRadius: 0,
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <path d="M1 3h12M3 7h8M5 11h4"
              stroke={advOpen || activeFilterCount > 0 ? "var(--primary)" : "rgba(255,255,255,0.45)"}
              strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {activeFilterCount > 0 && (
            <span style={{
              background: "rgba(91,143,255,0.2)",
              color: "var(--primary)",
              borderRadius: 10,
              padding: "1px 6px",
              fontSize: 11, fontWeight: 600,
              fontFamily: "'Noto Sans', sans-serif",
              lineHeight: 1.4,
            }}>
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "var(--danger)", paddingLeft: 2 }}>{error}</div>
      )}

      {/* Filters panel */}
      {advOpen && (
        <div style={{
          background: "var(--color-surface)",
          borderStyle: "solid",
          borderWidth: "2px",
          borderTopColor: "var(--bevel-light)",
          borderLeftColor: "var(--bevel-light)",
          borderBottomColor: "var(--bevel-dark)",
          borderRightColor: "var(--bevel-dark)",
          borderRadius: 0,
          padding: "20px 18px",
          display: "flex", flexDirection: "column", gap: 28,
        }}>

          {/* COLORS */}
          <div>
            <FilterSectionLabel>Colors</FilterSectionLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {COLORS.map(c => {
                const active = selectedColors.includes(c);
                const col    = COLOR_STYLE[c];
                return (
                  <button key={c} type="button" onClick={() => toggleColor(c)} style={{
                    width: 48, height: 48,
                    borderRadius: 0,
                    borderStyle: "solid",
                    borderWidth: "2px",
                    borderTopColor: active ? "var(--bevel-dark)" : "var(--bevel-light)",
                    borderLeftColor: active ? "var(--bevel-dark)" : "var(--bevel-light)",
                    borderBottomColor: active ? "var(--bevel-light)" : "var(--bevel-dark)",
                    borderRightColor: active ? "var(--bevel-light)" : "var(--bevel-dark)",
                    background: active ? "var(--color-chrome-mid)" : "var(--color-chrome)",
                    color: active ? col : "var(--color-text-chrome)",
                    fontFamily: "var(--font-system)", fontSize: 20, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {c}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {COLOR_MODES.map(({ id, label }) => (
                <button key={id} type="button" onClick={() => setColorMode(id)} style={chip(colorMode === id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* TYPE LINE */}
          <div>
            <FilterSectionLabel>Type Line</FilterSectionLabel>
            <input value={typeText} onChange={e => setTypeText(e.target.value)}
              placeholder="Legendary, Creature, Enchantment…" autoComplete="off"
              style={inputStyle} />
          </div>

          {/* ORACLE TEXT */}
          <div>
            <FilterSectionLabel>Oracle Text</FilterSectionLabel>
            {oracleTerms.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {oracleTerms.map((t, i) => (
                  <RemovableChip key={i} label={`"${t}"`}
                    onRemove={() => setOracleTerms(p => p.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            <AddInputRow value={oracleInput} onChange={setOracleInput}
              onAdd={addOracleTerm} placeholder="e.g. draw a card" />
          </div>

          {/* MANA COST */}
          <div>
            <FilterSectionLabel>Mana Cost</FilterSectionLabel>
            <input value={manaCost} onChange={e => setManaCost(e.target.value)}
              placeholder="{2}{G}{W}" autoComplete="off"
              style={{ ...inputStyle, fontFamily: "'Noto Sans Mono', monospace" }} />
          </div>

          {/* CMC */}
          <div>
            <FilterSectionLabel>CMC</FilterSectionLabel>
            {cmcConditions.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {cmcConditions.map((c, i) => (
                  <RemovableChip key={i} label={`cmc ${c.op} ${c.val}`}
                    onRemove={() => setCmcConditions(p => p.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {OPERATORS.map(op => (
                  <button key={op} type="button" onClick={() => setCmcOp(op)} style={opBtn(cmcOp === op)}>
                    {op}
                  </button>
                ))}
              </div>
              <input value={cmcVal} onChange={e => setCmcVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCmcCondition(); } }}
                type="number" min="0" placeholder="0"
                style={{ ...inputStyle, width: 70 }} />
              <button type="button" onClick={addCmcCondition} style={{
                background: "var(--color-chrome)",
                color: "var(--color-text-chrome)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "var(--bevel-light)",
                borderLeftColor: "var(--bevel-light)",
                borderBottomColor: "var(--bevel-dark)",
                borderRightColor: "var(--bevel-dark)",
                padding: "var(--space-1) var(--space-3)",
                cursor: "pointer",
                borderRadius: 0,
                letterSpacing: 2,
                flexShrink: 0, minHeight: 44,
              }}>
                + ADD
              </button>
            </div>
          </div>

          {/* RARITY */}
          <div>
            <FilterSectionLabel>Rarity</FilterSectionLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {RARITIES.map(({ id, label }) => (
                <button key={id} type="button" onClick={() => toggleRarity(id)} style={chip(selectedRarities.includes(id))}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* PRICE (USD) */}
          <div>
            <FilterSectionLabel>Price (USD)</FilterSectionLabel>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {OPERATORS.map(op => (
                  <button key={op} type="button" onClick={() => setPriceOp(op)} style={opBtn(priceOp === op)}>
                    {op}
                  </button>
                ))}
              </div>
              <input value={priceVal} onChange={e => setPriceVal(e.target.value)}
                type="number" min="0" step="0.01" placeholder="0.00"
                style={{ ...inputStyle, width: 90 }} />
            </div>
          </div>

          {/* STATS */}
          <div>
            <FilterSectionLabel>Stats</FilterSectionLabel>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {STATS_LIST.map(({ id, label }) => (
                  <button key={id} type="button" onClick={() => setStatType(id)}
                    style={{ ...chip(statType === id), padding: "9px 14px" }}>
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {OPERATORS.map(op => (
                  <button key={op} type="button" onClick={() => setStatOp(op)} style={opBtn(statOp === op)}>
                    {op}
                  </button>
                ))}
              </div>
              <input value={statVal} onChange={e => setStatVal(e.target.value)}
                type="number" min="0" placeholder="0"
                style={{ ...inputStyle, width: 70 }} />
            </div>
          </div>

          {/* SET */}
          <div>
            <FilterSectionLabel>Set</FilterSectionLabel>
            <input value={setCode} onChange={e => setSetCode(e.target.value)}
              placeholder="e.g. dsk, otj, mkm" autoComplete="off"
              style={{ ...inputStyle, fontFamily: "'Noto Sans Mono', monospace" }} />
          </div>

          {/* ARTIST */}
          <div>
            <FilterSectionLabel>Artist</FilterSectionLabel>
            <input value={artist} onChange={e => setArtist(e.target.value)}
              placeholder="Artist name" autoComplete="off" style={inputStyle} />
          </div>

        </div>
      )}
    </form>
  );
}
