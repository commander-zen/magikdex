import { useState } from "react";

const UA = "DeckStack/1.0 (deck-stack.vercel.app)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const isBasicLand  = c => Boolean(c?.type_line?.includes("Basic Land"));
const isAnyNumber  = c => Boolean(c?.oracle_text?.includes("A deck can have any number of cards named"));
const isStackable  = c => isBasicLand(c) || isAnyNumber(c);

function parseMoxfieldId(url) {
  const m = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseDeckText(text) {
  const lines = text.split("\n");
  const cards = [];
  let nextIsCommander = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { nextIsCommander = false; continue; }

    if (trimmed === "// Commander" || trimmed === "# Commander") {
      nextIsCommander = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    let name, qty;
    const m = trimmed.match(/^(\d+)[xX]?\s+(.+)$/);
    if (m) {
      qty = parseInt(m[1], 10);
      name = m[2].trim();
    } else {
      qty = 1;
      name = trimmed;
    }

    // Strip trailing set codes: " (M21) 123" or " (M21)"
    name = name.replace(/\s+\([A-Z0-9]{2,6}\)\s+\d+$/, "").trim();
    name = name.replace(/\s+\([A-Z0-9]{2,6}\)$/, "").trim();

    if (name) cards.push({ name, qty, isCommander: nextIsCommander });
    nextIsCommander = false;
  }

  return cards;
}

async function resolveByCollection(names) {
  const BATCH = 75;
  const resolved = [];
  const notFound = [];

  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ identifiers: batch.map(n => ({ name: n })) }),
    });
    if (!res.ok) throw new Error(`Scryfall error: ${res.status}`);
    const json = await res.json();
    resolved.push(...(json.data ?? []));
    notFound.push(...(json.not_found ?? []).map(nf => nf.name ?? String(nf)));
    if (i + BATCH < names.length) await sleep(150);
  }

  return { resolved, notFound };
}

function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: "var(--font-size-sm)", fontWeight: "bold",
      letterSpacing: "0.12em", textTransform: "uppercase",
      color: "var(--color-text-secondary)", marginBottom: 6,
      fontFamily: "var(--font-system)",
    }}>
      {children}
    </div>
  );
}

export default function ImportSheet({ open, onClose, onImport }) {
  const [text,        setText]        = useState("");
  const [urlInput,    setUrlInput]    = useState("");
  const [status,      setStatus]      = useState("idle"); // idle | working | success
  const [statusLabel, setStatusLabel] = useState("");
  const [errorMsg,    setErrorMsg]    = useState("");
  const [warning,     setWarning]     = useState("");
  const [importCount, setImportCount] = useState(0);

  function resetState() {
    setStatus("idle");
    setStatusLabel("");
    setErrorMsg("");
    setWarning("");
  }

  function handleClose() {
    if (status === "working") return;
    resetState();
    onClose();
  }

  async function handleImport() {
    const hasUrl  = urlInput.trim().length > 0;
    const hasText = text.trim().length > 0;
    if (!hasUrl && !hasText) {
      setErrorMsg("Paste a decklist or enter a Moxfield URL.");
      return;
    }

    setStatus("working");
    setErrorMsg("");
    setWarning("");

    let deckText = text;

    // ── Moxfield fetch ────────────────────────────────────────────────────────
    if (hasUrl) {
      const deckId = parseMoxfieldId(urlInput.trim());
      if (!deckId) {
        setErrorMsg("Invalid Moxfield URL — paste the text export instead.");
        setStatus("idle");
        return;
      }
      try {
        setStatusLabel("Fetching deck…");
        const res = await fetch(`/api/moxfield?id=${encodeURIComponent(deckId)}`);
        if (!res.ok) throw new Error(`Moxfield error: ${res.status}`);
        const data = await res.json();
        console.log("[moxfield] raw response:", data);

        // Moxfield v2: boards.commanders.cards and boards.mainboard.cards
        // Each value is { quantity, card: { name, ... } } keyed by card ID.
        // Log a sample entry so we can see the actual shape in the console.
        const rawMainCards = data.boards?.mainboard?.cards ?? {};
        const rawCmdCards  = data.boards?.commanders?.cards ?? {};
        const sampleEntry  = Object.values(rawMainCards)[0] ?? Object.values(rawCmdCards)[0];
        if (sampleEntry) {
          console.log("[moxfield] sample card entry:", sampleEntry);
        } else {
          console.warn("[moxfield] no card entries found — board keys:", Object.keys(data.boards ?? {}));
        }

        const commanders = Object.values(rawCmdCards);
        const mainboard  = Object.values(rawMainCards);

        // Extract name and qty robustly: prefer nested card.name (v2 structure),
        // fall back to a flat name field on the entry itself.
        const entryName = e => e?.card?.name ?? e?.name ?? null;
        const entryQty  = e => e?.quantity ?? e?.qty ?? 1;

        let built = "";
        if (commanders.length > 0) {
          built += "// Commander\n";
          built += commanders
            .filter(e => entryName(e))
            .map(e => `1x ${entryName(e)}`)
            .join("\n") + "\n\n";
        }
        built += mainboard
          .filter(e => entryName(e))
          .map(e => `${entryQty(e)}x ${entryName(e)}`)
          .join("\n");

        if (!built.trim()) {
          console.warn("[moxfield] built decklist is empty — check sample entry above for correct field paths");
        }
        deckText = built;
      } catch {
        if (hasText) {
          setWarning("Couldn't fetch deck — using pasted text instead.");
        } else {
          setErrorMsg("Couldn't fetch deck — paste the text export instead.");
          setStatus("idle");
          return;
        }
      }
    }

    // ── Parse ─────────────────────────────────────────────────────────────────
    const parsed = parseDeckText(deckText);
    if (parsed.length === 0) {
      setErrorMsg("No cards found in the decklist.");
      setStatus("idle");
      return;
    }

    // ── Resolve via Scryfall /cards/collection ────────────────────────────────
    const uniqueNames = [...new Set(parsed.map(c => c.name))];
    setStatusLabel(`Resolving ${uniqueNames.length} cards…`);

    let resolved, notFound;
    try {
      ({ resolved, notFound } = await resolveByCollection(uniqueNames));
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("idle");
      return;
    }

    if (resolved.length === 0) {
      setErrorMsg("No cards could be matched.");
      setStatus("idle");
      return;
    }

    // ── Build pile ────────────────────────────────────────────────────────────
    // Stackable cards (basics + any-number) collapse into a single entry with qty.
    // Non-stackable cards get one entry per copy.
    const resolvedMap  = new Map(resolved.map(c => [c.name.toLowerCase(), c]));
    const pile         = [];
    const stackableIdx = new Map(); // name → pile index for merging
    let commanderCard  = null;

    for (const entry of parsed) {
      const card = resolvedMap.get(entry.name.toLowerCase());
      if (!card) continue;

      if (isStackable(card)) {
        if (stackableIdx.has(card.name)) {
          const i = stackableIdx.get(card.name);
          pile[i] = { ...pile[i], qty: pile[i].qty + entry.qty };
        } else {
          stackableIdx.set(card.name, pile.length);
          pile.push({ ...card, instanceId: crypto.randomUUID(), qty: entry.qty });
        }
        continue;
      }

      for (let q = 0; q < entry.qty; q++) {
        const cardEntry = { ...card, instanceId: crypto.randomUUID() };
        pile.push(cardEntry);
        if (entry.isCommander && !commanderCard) {
          commanderCard = cardEntry;
        }
      }
    }

    if (stackableIdx.size > 0) {
      const totalQty = [...stackableIdx.keys()].reduce((sum, name) => {
        const i = stackableIdx.get(name);
        return sum + pile[i].qty;
      }, 0);
      console.log(`Collapsed ${totalQty} stackable card${totalQty !== 1 ? "s" : ""} into ${stackableIdx.size} row${stackableIdx.size !== 1 ? "s" : ""} (import)`);
    }

    if (notFound.length > 0) {
      const names = notFound.join(", ");
      setWarning(`${notFound.length} card${notFound.length !== 1 ? "s" : ""} couldn't be found: ${names}`);
    }

    setImportCount(pile.length);
    setStatus("success");
    setStatusLabel("");

    onImport(pile, commanderCard);

    setTimeout(() => {
      resetState();
      setText("");
      setUrlInput("");
      onClose();
    }, 1500);
  }

  const isWorking = status === "working";
  const isSuccess = status === "success";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0, 0, 0, 0.75)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.28s",
        }}
      />

      {/* Sheet */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
        display: "flex", justifyContent: "center",
        transform: open ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        pointerEvents: open ? "auto" : "none",
      }}>
        <div style={{
          width: "100%", maxWidth: 600,
          maxHeight: "90dvh",
          background: "var(--color-surface)",
          borderStyle: "solid",
          borderWidth: "2px",
          borderTopColor: "var(--bevel-light)",
          borderLeftColor: "var(--bevel-light)",
          borderBottomColor: "var(--bevel-dark)",
          borderRightColor: "var(--bevel-dark)",
          borderRadius: 0,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>

          {/* Drag handle */}
          <div style={{ textAlign: "center", paddingTop: 12, paddingBottom: 2, flexShrink: 0 }}>
            <div style={{
              display: "inline-block",
              width: 36, height: 4, borderRadius: 0,
              background: "var(--color-chrome-mid)",
            }} />
          </div>

          {/* Title bar */}
          <div style={{
            background: "var(--color-titlebar)",
            color: "var(--color-titlebar-text)",
            fontFamily: "var(--font-system)",
            fontSize: "var(--font-size-base)",
            fontWeight: "bold",
            padding: "var(--space-1) var(--space-2)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}>
            <span>IMPORT DECK</span>
            <button
              onClick={handleClose}
              disabled={isWorking}
              style={{
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
                width: "20px",
                height: "20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: isWorking ? "default" : "pointer",
                borderRadius: 0,
                padding: 0,
                flexShrink: 0,
                opacity: isWorking ? 0.4 : 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div style={{
            flex: 1, overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "20px 18px 36px",
          }}>

            {/* Moxfield URL */}
            <div style={{ marginBottom: 16 }}>
              <FieldLabel>Moxfield URL (optional)</FieldLabel>
              <input
                type="url"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder="https://www.moxfield.com/decks/…"
                disabled={isWorking || isSuccess}
                style={{
                  width: "100%", boxSizing: "border-box",
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
                }}
              />
            </div>

            {/* Decklist textarea */}
            <div style={{ marginBottom: 16 }}>
              <FieldLabel>Paste decklist</FieldLabel>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={"1x Sol Ring\n1x Command Tower\n\n// or paste MTGO / Arena / Moxfield text export"}
                rows={9}
                disabled={isWorking || isSuccess}
                style={{
                  width: "100%", boxSizing: "border-box",
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
                  resize: "vertical", lineHeight: 1.65,
                }}
              />
              <div style={{ fontSize: "var(--font-size-sm)", fontFamily: "var(--font-system)", color: "var(--color-text-secondary)", marginTop: 6 }}>
                Accepts <code style={{ fontFamily: "inherit", opacity: 0.8 }}>1x Card Name</code>, <code style={{ fontFamily: "inherit", opacity: 0.8 }}>1 Card Name</code>, or plain names — MTGO, Arena, and Moxfield exports all work.
              </div>
            </div>

            {/* Error */}
            {errorMsg && (
              <div style={{
                background: "rgba(255,80,80,0.09)",
                border: "1px solid rgba(255,80,80,0.25)",
                borderRadius: 8, padding: "10px 14px",
                fontSize: 13, color: "#ff6868",
                marginBottom: 14, lineHeight: 1.5,
              }}>
                {errorMsg}
              </div>
            )}

            {/* Warning */}
            {warning && (
              <div style={{
                background: "rgba(255,180,60,0.08)",
                border: "1px solid rgba(255,180,60,0.22)",
                borderRadius: 8, padding: "10px 14px",
                fontSize: 13, color: "#ffb84a",
                marginBottom: 14, lineHeight: 1.5,
              }}>
                {warning}
              </div>
            )}

            {/* IMPORT button */}
            <button
              onClick={!isWorking && !isSuccess ? handleImport : undefined}
              style={{
                width: "100%",
                background: "var(--color-titlebar)",
                color: "var(--color-titlebar-text)",
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-sm)",
                borderStyle: "solid",
                borderWidth: "2px",
                borderTopColor: "#ffffff",
                borderLeftColor: "#ffffff",
                borderBottomColor: "#000040",
                borderRightColor: "#000040",
                padding: "16px 24px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                cursor: isWorking || isSuccess ? "default" : "pointer",
                borderRadius: 0,
                opacity: isWorking ? 0.6 : 1,
              }}
            >
              <span style={{
                fontFamily: "var(--font-system)",
                fontSize: "var(--font-size-xl)",
                letterSpacing: "0.12em",
                color: isSuccess ? "var(--success)" : "var(--color-titlebar-text)",
              }}>
                {isSuccess
                  ? `IMPORTED ${importCount} CARDS`
                  : isWorking
                    ? (statusLabel || "IMPORTING…")
                    : "IMPORT"
                }
              </span>
            </button>

          </div>
        </div>
      </div>
    </>
  );
}
