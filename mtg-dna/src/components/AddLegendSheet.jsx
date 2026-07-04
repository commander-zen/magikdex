import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import { searchCommanders, getCardImage } from "../lib/scryfall.js";
import { prepareImport } from "../lib/moxfieldImport.js";

export default function AddLegendSheet({ open, onClose, onSelect, onImport }) {
  const { theme, mode } = useTheme();
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState([]);
  const [toast, setToast]     = useState(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const toastTimerRef = useRef(null);

  // ── Paste-import (Moxfield bulk-edit text → deck, WREC tags restored) ──────
  const [tab, setTab] = useState("search"); // "search" | "paste"
  const [pasteText, setPasteText]     = useState("");
  const [preview, setPreview]         = useState(null);   // prepareImport() result
  const [parsing, setParsing]         = useState(false);
  const [manualCommander, setManualCommander] = useState("");
  const [pickedKey, setPickedKey]     = useState(null);    // candidate name, when ambiguous
  const [importing, setImporting]     = useState(false);
  const [importResult, setImportResult] = useState(null);  // { cardCount, taggedCount } | { error }

  async function handleParse() {
    setParsing(true);
    setImportResult(null);
    try {
      const result = await prepareImport(pasteText);
      setPreview(result);
      setPickedKey(null);
      setManualCommander("");
    } finally {
      setParsing(false);
    }
  }

  // Resolution order matches pickCommander's own priority: an auto-detected
  // commander wins; else whichever candidate the user tapped; else whatever
  // they typed manually (resolved live at import time).
  const resolvedCommanderLine = preview?.commander
    ?? (pickedKey ? preview?.candidates.find(c => c.name === pickedKey) : null)
    ?? null;
  const commanderName = resolvedCommanderLine?.name ?? manualCommander.trim();
  const canImport = Boolean(preview) && Boolean(commanderName) && !importing;

  async function handleImport() {
    if (!canImport) return;
    setImporting(true);
    setImportResult(null);
    try {
      const lines = preview.resolvedLines.filter(
        l => l.name.toLowerCase() !== commanderName.toLowerCase()
      );
      const result = await onImport(commanderName, lines);
      setImportResult({
        cardCount: result.cardCount,
        taggedCount: result.taggedCount,
        unresolvedCount: preview.unresolved.length,
      });
    } catch (err) {
      setImportResult({ error: err.message ?? "import failed" });
    } finally {
      setImporting(false);
    }
  }

  // Brief dimmed flash. Only invalid syntax toasts here — a valid query with
  // no matches is the normal "still typing" state, shown as an empty list.
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2400);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const textColor   = mode === "light" ? theme.ink   : theme.white;
  const dimColor    = mode === "light" ? theme.muted : theme.dim;
  const borderColor = mode === "light" ? theme.border : theme.muted;

  // Reset the whole sheet each time it opens; abort any in-flight search on close.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setResults([]);
      setTab("search");
      setPasteText("");
      setPreview(null);
      setPickedKey(null);
      setManualCommander("");
      setImportResult(null);
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      abortRef.current?.abort();
    }
  }, [open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const data = await searchCommanders(query, {
          signal: ctrl.signal,
          onInvalid: (details) => {
            if (ctrl.signal.aborted) return;
            showToast(details && details.length <= 80 ? details : "invalid search");
          },
        });
        if (!ctrl.signal.aborted) setResults(data);
      } catch { /* aborted or network error */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function handleSelect(card) {
    abortRef.current?.abort();
    onSelect(card);
  }

  // iOS pans the visual viewport when the keyboard opens for an input near
  // the bottom of the screen, shoving the sheet's header up under the status
  // bar. html/body are overflow:hidden so nothing should scroll — pin the
  // window back to origin once the keyboard animation settles.
  function pinViewportOnFocus() {
    setTimeout(() => window.scrollTo(0, 0), 300);
  }

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 220,
          background: "rgba(0,0,0,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.28s",
        }}
      />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 221,
        display: "flex", justifyContent: "center",
        transform: open ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        pointerEvents: open ? "auto" : "none",
      }}>
        <div style={{
          width: "100%", maxWidth: 600,
          maxHeight: "70dvh",
          background: theme.base,
          borderTop: `1px solid ${borderColor}`,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Header — one obvious dismiss (the close ×), matching the app's
              overlay grammar; the backdrop tap also closes. */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 8px 0 20px",
          }}>
            <span style={{
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: dimColor,
            }}>
              add legend
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 44, height: 44,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: "none", padding: 0,
                color: dimColor, cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 22 }}>close</span>
            </button>
          </div>

          {/* Tabs — search Scryfall, or paste a Moxfield bulk-edit decklist. */}
          <div style={{ display: "flex", gap: 16, padding: "8px 20px 0" }}>
            {[["search", "search"], ["paste", "paste deck"]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  background: "transparent", border: "none", padding: "0 0 8px",
                  fontFamily: "'Noto Sans Mono', monospace",
                  fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
                  color: tab === key ? textColor : dimColor,
                  borderBottom: tab === key ? `2px solid ${textColor}` : "2px solid transparent",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "search" && (
          <div style={{ padding: "0 20px 8px" }}>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={pinViewportOnFocus}
              onKeyDown={e => { if (e.key === "Enter" && results[0]) handleSelect(results[0]); }}
              placeholder="search for a legend…"
              enterKeyHint="search"
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "transparent",
                color: textColor,
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 16,
                fontWeight: 300,
                border: "none",
                borderBottom: `1px solid ${borderColor}`,
                borderRadius: 0,
                padding: "12px 0",
                outline: "none",
              }}
            />
          </div>
          )}

          {/* Invalid-syntax flash — empty results stay a silent empty list. */}
          {tab === "search" && toast && (
            <div style={{
              margin: "0 20px 8px",
              fontFamily: "'Noto Sans Mono', monospace",
              fontSize: 11,
              letterSpacing: "0.06em",
              lineHeight: 1.4,
              color: dimColor,
            }}>
              {toast}
            </div>
          )}

          {tab === "search" && (
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "0 20px 20px" }}>
            {results.map(card => {
              // Same-named printings (six different Hawkeyes) are otherwise
              // indistinguishable rows — the art thumb plus the set name is
              // what tells them apart before picking.
              const thumb = getCardImage(card, "art_crop");
              return (
                <button
                  key={card.id}
                  onClick={() => handleSelect(card)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    width: "100%", textAlign: "left",
                    background: "transparent", border: "none", borderRadius: 0,
                    padding: "10px 0",
                    borderBottom: `1px solid ${borderColor}`,
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div style={{
                    width: 48, height: 48, flexShrink: 0,
                    overflow: "hidden",
                    background: borderColor,
                  }}>
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontFamily: "'Zilla Slab', serif",
                      fontSize: 15,
                      color: textColor,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {card.name}
                    </div>
                    <div style={{
                      fontFamily: "'Noto Sans Mono', monospace",
                      fontSize: 11,
                      color: dimColor,
                      marginTop: 2,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {[card.set_name, card.type_line?.toLowerCase()].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          )}

          {tab === "paste" && (
          <div style={{
            flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
            padding: "8px 20px 20px",
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              onFocus={pinViewportOnFocus}
              placeholder={"paste a Moxfield bulk-edit decklist…\n1 Sol Ring #ramp\n1 Cyclonic Rift #mass-disruption"}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              rows={6}
              style={{
                width: "100%", boxSizing: "border-box", resize: "vertical",
                background: "transparent",
                color: textColor,
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 13,
                border: `1px solid ${borderColor}`,
                padding: 10,
                outline: "none",
              }}
            />
            <button
              onClick={handleParse}
              disabled={!pasteText.trim() || parsing}
              style={{
                minHeight: 44,
                background: "transparent",
                border: `1px solid ${borderColor}`,
                color: textColor,
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                cursor: pasteText.trim() && !parsing ? "pointer" : "default",
                opacity: pasteText.trim() && !parsing ? 1 : 0.5,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {parsing ? "parsing…" : "parse"}
            </button>

            {preview && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 12, color: dimColor }}>
                  {preview.resolvedLines.length} card{preview.resolvedLines.length !== 1 ? "s" : ""} resolved
                  {" · "}{preview.unresolved.length} unresolved
                </div>

                {preview.unresolved.length > 0 && (
                  <div style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 11, color: dimColor, lineHeight: 1.5 }}>
                    unresolved: {preview.unresolved.map(l => l.raw).join(", ")}
                  </div>
                )}

                {/* Commander — auto-detected, pick from candidates, or type one. */}
                {preview.commander ? (
                  <div style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 12, color: textColor }}>
                    commander: {preview.commander.name}
                  </div>
                ) : preview.candidates.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontFamily: "'Noto Sans Mono', monospace", fontSize: 11, color: dimColor }}>
                      pick the commander:
                    </div>
                    {preview.candidates.map(c => (
                      <button
                        key={c.name}
                        onClick={() => setPickedKey(c.name)}
                        style={{
                          textAlign: "left", minHeight: 44,
                          background: pickedKey === c.name ? borderColor : "transparent",
                          border: `1px solid ${borderColor}`,
                          color: textColor,
                          fontFamily: "'Zilla Slab', serif", fontSize: 14,
                          padding: "0 10px",
                          cursor: "pointer",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={manualCommander}
                    onChange={e => setManualCommander(e.target.value)}
                    placeholder="commander name (no auto-match found)"
                    autoComplete="off" autoCorrect="off" spellCheck={false}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "transparent",
                      color: textColor,
                      fontFamily: "'Noto Sans', sans-serif",
                      fontSize: 14,
                      border: "none",
                      borderBottom: `1px solid ${borderColor}`,
                      padding: "8px 0",
                      outline: "none",
                    }}
                  />
                )}

                <button
                  onClick={handleImport}
                  disabled={!canImport}
                  style={{
                    minHeight: 44,
                    background: canImport ? textColor : "transparent",
                    color: canImport ? theme.base : dimColor,
                    border: `1px solid ${borderColor}`,
                    fontFamily: "'Noto Sans Mono', monospace",
                    fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                    cursor: canImport ? "pointer" : "default",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {importing ? "importing…" : "import"}
                </button>
              </div>
            )}

            {importResult && (
              <div style={{
                fontFamily: "'Noto Sans Mono', monospace",
                fontSize: 12,
                color: importResult.error ? theme.red ?? "#a04040" : dimColor,
                lineHeight: 1.5,
              }}>
                {importResult.error
                  ? `import failed: ${importResult.error}`
                  : `imported ${importResult.cardCount} card${importResult.cardCount !== 1 ? "s" : ""} · ${importResult.taggedCount} tagged${importResult.unresolvedCount ? ` · ${importResult.unresolvedCount} unresolved (skipped)` : ""}`}
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
