import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme/ThemeContext";
import { searchCommanders, getCardImage } from "../lib/scryfall.js";
import { prepareImport, prepareImportFromUrl, isDeckUrl, canonicalDeckUrl } from "../lib/moxfieldImport.js";
import { WUBRG, deriveColorIdentity, cleanImageUrl } from "../lib/rule0.js";
import Icon from "./Icon.jsx";
import ColorPips from "./ColorPips.jsx";

const EMPTY_CUSTOM = { name: "", mana_cost: "", type_line: "Legendary Creature", oracle_text: "", image_uri: "" };

export default function AddLegendSheet({ open, onClose, onSelect, onImport, onCreateCustom }) {
  const { theme } = useTheme();
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState([]);
  const [toast, setToast]     = useState(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const closeTimerRef = useRef(null);

  // ── Paste-import (Moxfield bulk-edit text → deck, WREC tags restored) ──────
  // "rule0" types in a commander Scryfall doesn't have (a leak, a homebrew,
  // a table-agreed one). Deliberately NO "pick any real card" mode: live
  // lookups write back to the shared cards cache, and Ben wants that table to
  // stay a Scryfall mirror (2026-11-17).
  const [tab, setTab] = useState("search"); // "search" | "paste" | "rule0"
  const [custom, setCustom] = useState(EMPTY_CUSTOM);
  // null = follow the mana cost / rules text; an array = the user picked.
  const [customColors, setCustomColors] = useState(null);
  const [savingCustom, setSavingCustom] = useState(false);
  const [customError, setCustomError] = useState(null);
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
      // One box, two doors: a Moxfield/Archidekt deck URL goes through the
      // /api/deck proxy (tags never transfer — auto-tagging owns that now);
      // anything else parses as pasted decklist text, as ever.
      const result = isDeckUrl(pasteText)
        ? await prepareImportFromUrl(pasteText)
        : await prepareImport(pasteText);
      setPreview(result);
      setPickedKey(null);
      setManualCommander("");
    } catch (err) {
      setImportResult({ error: err.message ?? "import failed" });
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
      // Keep the URL this deck came from. It was being parsed for cards and then
      // dropped, which left decks.url empty for every deck in the app.
      // Canonicalised out of the pasted text so a
      // trailing "?utm=" or a stray word can't corrupt what gets stored.
      const sourceUrl = isDeckUrl(pasteText) ? canonicalDeckUrl(pasteText) : null;
      const result = await onImport(commanderName, lines, sourceUrl);
      setImportResult({
        cardCount: result.cardCount,
        taggedCount: result.taggedCount,
        unresolvedCount: preview.unresolved.length,
      });
      // UAT — the sheet is meant to close itself after the summary (the parent
      // never closes it on import). Flash the result briefly, then dismiss so
      // the new legend is visible in the box instead of leaving the modal up.
      closeTimerRef.current = setTimeout(() => onClose(), 1200);
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
  useEffect(() => () => { clearTimeout(toastTimerRef.current); clearTimeout(closeTimerRef.current); }, []);

  const textColor   = theme.white;
  const dimColor    = theme.dim;
  const borderColor = theme.muted;

  // Reset the whole sheet each time it opens; abort any in-flight search on close.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setResults([]);
      setTab("search");
      setCustom(EMPTY_CUSTOM);
      setCustomColors(null);
      setCustomError(null);
      setPasteText("");
      setPreview(null);
      setPickedKey(null);
      setManualCommander("");
      setImportResult(null);
      clearTimeout(closeTimerRef.current);
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

  // ── Rule 0 custom commander ────────────────────────────────────────────────
  const derivedColors = deriveColorIdentity(custom.mana_cost, custom.oracle_text);
  const colors = customColors ?? derivedColors;
  const imageUrl = cleanImageUrl(custom.image_uri);
  const imageInvalid = Boolean(custom.image_uri.trim()) && !imageUrl;
  const canSaveCustom = Boolean(custom.name.trim()) && !imageInvalid && !savingCustom;

  function toggleColor(c) {
    const next = colors.includes(c) ? colors.filter(x => x !== c) : [...colors, c];
    setCustomColors(WUBRG.filter(x => next.includes(x)));
  }

  async function handleSaveCustom() {
    if (!canSaveCustom) return;
    setSavingCustom(true);
    setCustomError(null);
    try {
      await onCreateCustom({
        name: custom.name.trim(),
        mana_cost: custom.mana_cost.trim() || null,
        type_line: custom.type_line.trim() || "Legendary Creature",
        oracle_text: custom.oracle_text.trim() || null,
        color_identity: colors,
        image_uri: imageUrl,
      });
    } catch (err) {
      setCustomError(err?.message ?? "couldn't save");
    } finally {
      setSavingCustom(false);
    }
  }

  const fieldStyle = {
    width: "100%", boxSizing: "border-box",
    background: "transparent",
    color: textColor,
    fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
    fontSize: 16, // 16 or iOS zooms the sheet on focus
    border: "none",
    borderBottom: `1px solid ${borderColor}`,
    borderRadius: 0,
    padding: "8px 0",
    outline: "none",
  };
  const labelStyle = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
    color: dimColor,
  };
  const r0Label = (text, el) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={labelStyle}>{text}</span>
      {el}
    </label>
  );

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
              fontFamily: "'JetBrains Mono', monospace",
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
              <Icon name="close" style={{ fontSize: 22 }} />
            </button>
          </div>

          {/* Tabs — search Scryfall, or paste a Moxfield bulk-edit decklist. */}
          <div style={{ display: "flex", gap: 16, padding: "8px 20px 0" }}>
            {[["search", "search"], ["paste", "paste deck"], ["rule0", "rule 0"]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  background: "transparent", border: "none", padding: "0 0 8px",
                  fontFamily: "'JetBrains Mono', monospace",
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
                fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
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
              fontFamily: "'JetBrains Mono', monospace",
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
                      fontFamily: "'JetBrains Mono', monospace",
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

          {tab === "rule0" && (
          <div style={{
            flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch",
            padding: "8px 20px 20px",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: dimColor, lineHeight: 1.5 }}>
              a commander that isn&apos;t out yet, or one your table agreed to. the deck still draws from legal cards in its colours.
            </div>
            {r0Label("name *", (
              <input
                value={custom.name}
                onChange={e => setCustom(c => ({ ...c, name: e.target.value }))}
                onFocus={pinViewportOnFocus}
                placeholder="card name"
                autoComplete="off" autoCorrect="off" spellCheck={false}
                style={fieldStyle}
              />
            ))}
            {r0Label("mana cost", (
              <input
                value={custom.mana_cost}
                onChange={e => setCustom(c => ({ ...c, mana_cost: e.target.value }))}
                onFocus={pinViewportOnFocus}
                placeholder="{1}{G}{U}{R}"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                style={{ ...fieldStyle, fontFamily: "'JetBrains Mono', monospace" }}
              />
            ))}
            {r0Label("type line", (
              <input
                value={custom.type_line}
                onChange={e => setCustom(c => ({ ...c, type_line: e.target.value }))}
                onFocus={pinViewportOnFocus}
                autoComplete="off" autoCorrect="off" spellCheck={false}
                style={fieldStyle}
              />
            ))}
            {r0Label("rules text", (
              <textarea
                value={custom.oracle_text}
                onChange={e => setCustom(c => ({ ...c, oracle_text: e.target.value }))}
                onFocus={pinViewportOnFocus}
                rows={4}
                autoComplete="off" spellCheck={false}
                style={{ ...fieldStyle, border: `1px solid ${borderColor}`, padding: 8, resize: "vertical" }}
              />
            ))}

            {/* Colour identity drives every stack and search in the deck, so it
                has to be right. Pre-filled from the mana cost + rules text; the
                first tap takes over from the auto-fill. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>
                colour identity{customColors ? "" : " (from the cost + text)"}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {WUBRG.map(c => (
                  <button
                    key={c}
                    onClick={() => toggleColor(c)}
                    aria-pressed={colors.includes(c)}
                    aria-label={`colour ${c}`}
                    style={{
                      width: 44, height: 44,
                      background: colors.includes(c) ? borderColor : "transparent",
                      border: `1px solid ${colors.includes(c) ? textColor : borderColor}`,
                      color: textColor,
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {c}
                  </button>
                ))}
                <ColorPips identity={colors} size={10} gap={3} />
              </div>
            </div>

            {r0Label("art link (optional)", (
              <input
                value={custom.image_uri}
                onChange={e => setCustom(c => ({ ...c, image_uri: e.target.value }))}
                onFocus={pinViewportOnFocus}
                placeholder="https://…"
                inputMode="url"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                style={fieldStyle}
              />
            ))}
            {imageInvalid && (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: theme.red, marginTop: -8 }}>
                needs to be an http(s) link
              </span>
            )}

            <button
              onClick={handleSaveCustom}
              disabled={!canSaveCustom}
              style={{
                minHeight: 44,
                background: canSaveCustom ? textColor : "transparent",
                color: canSaveCustom ? theme.base : dimColor,
                border: `1px solid ${borderColor}`,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
                cursor: canSaveCustom ? "pointer" : "default",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {savingCustom ? "adding…" : "add to dex"}
            </button>
            {customError && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: theme.red }}>
                {customError}
              </div>
            )}
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
              /* ⚠️ THE COPY NO LONGER PROMISES A URL. The URL path still EXISTS
                 (isDeckUrl → prepareImportFromUrl) and Archidekt works, but
                 Moxfield's bot filter 403s the fetch — the standing MOXFIELD_UA
                 gap — so the old placeholder advertised a route that fails on
                 the most common host. Ben, 2026-08-27: "my import function for
                 magikdex is plaintext only ... nah i dont wanna mess with that
                 until someone asks for it tbh."
                 The CODE stays (pasting a URL still tries, and still works for
                 Archidekt); only the promise goes. */
              placeholder={"paste a decklist — one card per line\n\n1 Sol Ring\n1 Arcane Signet\n1 Cultivate\n…"}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              rows={6}
              style={{
                width: "100%", boxSizing: "border-box", resize: "vertical",
                background: "transparent",
                color: textColor,
                fontFamily: "'JetBrains Mono', monospace",
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
                fontFamily: "'JetBrains Mono', monospace",
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
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: dimColor }}>
                  {preview.resolvedLines.length} card{preview.resolvedLines.length !== 1 ? "s" : ""} resolved
                  {" · "}{preview.unresolved.length} unresolved
                </div>

                {preview.unresolved.length > 0 && (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: dimColor, lineHeight: 1.5 }}>
                    unresolved: {preview.unresolved.map(l => l.raw).join(", ")}
                  </div>
                )}

                {/* Commander — auto-detected, pick from candidates, or type one. */}
                {preview.commander ? (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: textColor }}>
                    commander: {preview.commander.name}
                  </div>
                ) : preview.candidates.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: dimColor }}>
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
                      fontFamily: "'Atkinson Hyperlegible Next Variable', sans-serif",
                      fontSize: 16, // 16 or iOS zooms the sheet on focus
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
                    fontFamily: "'JetBrains Mono', monospace",
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
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: importResult.error ? theme.red : dimColor,
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
