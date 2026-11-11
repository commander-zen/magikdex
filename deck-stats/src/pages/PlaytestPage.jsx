// The play test page (playtest.html): print one deck as play test cards,
// mtgprint-style (Ben's reference is mtgprint.net; see lib/proxies.js). One
// PDF: every card in the list at 63 × 88 mm, 9 per page, with the deck's
// Bracket Card riding in the first slot and the tokens the deck makes after
// its cards.
//
// It works on "your deck", the same one the card page shows. The resolved
// Scryfall cards live only in memory (refetched after a refresh); what is
// saved with the deck is its list, the cards left out, the printings picked
// and the token counts.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, Minus, Pencil, Plus, RefreshCw } from "lucide-react";
import { layoutCard, layoutSheet, renderSheetSVG, renderPDF, MAX_CARDS, PROXY_MM } from "@/lib/card";
import { parseList, resolveRows, tokensFor, printingsOf, proxyItems, fetchImages, faces, isBasicLand, nameKey } from "@/lib/proxies";
import { KEYS, load, store, slug, cardStats, cardSVG } from "@/lib/deck";
import { useFonts, usePaper } from "@/hooks/use-stored";
import { SiteShell, PageIntro, Step, StickyAction } from "@/components/site-shell";
import { DeckForm } from "@/components/deck-form";
import { StyleEditor } from "@/components/style-editor";
import { PaperPicker } from "@/components/paper-picker";
import { PrintPreview } from "@/components/print-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const MAX_TOKENS = 20;

const prefsOf = card => ({ exclude: [], picks: {}, tokens: {}, tokensOff: false, ...card?.proxy });

// The commander has to print too, and a pasted list often leaves it out,
// since the deck form asks for the commander in its own field.
function deckRows(card) {
  const rows = parseList(card.list);
  const have = new Set(rows.map(r => r.key));
  const missing = (card.stats.commanders ?? [])
    .filter(n => !have.has(nameKey(n)))
    .map(name => ({ key: nameKey(name), name, qty: 1, set: null, cn: null }));
  return [...missing, ...rows];
}

// The deck's Bracket Card rides in the first slot of the first page, turned
// to fit, so it never costs a sheet of its own.
function pagesFor(card, items, paper) {
  const all = [{ prims: layoutCard(cardStats(card)), turn: true }, ...items];
  const out = [];
  for (let i = 0; i < all.length; i += MAX_CARDS) {
    out.push(layoutSheet(all.slice(i, i + MAX_CARDS), paper,
      { card: PROXY_MM, ruler: false, note: i ? null : 'print at 100%, not "fit to page"' }));
  }
  return out;
}

export default function PlaytestPage() {
  const [card, setCardState] = useState(() => load(KEYS.deck)?.card ?? null);
  const [changing, setChanging] = useState(false);
  const [rows, setRows] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(() => !load(KEYS.deck)?.card?.list);
  const [draft, setDraft] = useState(() => load(KEYS.deck)?.card?.list ?? "");
  const [picking, setPicking] = useState(null);   // the row whose printings are open
  const [prints, setPrints] = useState(null);     // null = loading, [] = failed
  const [progress, setProgress] = useState(null); // download label while it runs
  const [paper, setPaper] = usePaper();
  const fonts = useFonts();
  const run = useRef(0);
  const opener = useRef(null);   // the art button that opened the picker

  const setCard = next => { setCardState(next); store(KEYS.deck, { card: next }); };
  const setPrefs = (c, patch) => setCard({ ...c, proxy: { ...prefsOf(c), ...patch } });

  // Straight to the cards if the deck's list is known, else to the paste box
  // (a deck added by link: our server can't read its list).
  async function start(c) {
    const id = ++run.current;
    setRows(null); setTokens(null); setError(null); setPicking(null);
    setEditing(!c?.list);
    setDraft(c?.list ?? "");
    if (!c?.list) return;
    setBusy(true);
    let resolved = null;
    try {
      resolved = await resolveRows(deckRows(c), prefsOf(c).picks);
      if (run.current === id) setRows(resolved);
    } catch (err) {
      if (run.current === id) setError(err.message);
    } finally {
      if (run.current === id) setBusy(false);
    }
    if (!resolved || run.current !== id) return;
    // The cards show first; the tokens follow. A token lookup that fails costs
    // the tokens, never the deck.
    let found = [];
    try { found = await tokensFor(resolved, prefsOf(c).picks); } catch { /* print without tokens */ }
    if (run.current === id) setTokens(found);
  }

  useEffect(() => { start(card); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  function applyList() {
    const text = draft.trim();
    if (!card || !text) return;
    const next = { ...card, list: text };
    setCard(next);
    start(next);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const prefs = prefsOf(card);
  const exclude = new Set(prefs.exclude);
  const shownRows = editing ? [] : (rows ?? []);
  const cardItems = proxyItems(shownRows, exclude);
  // The tokens worth showing: those made by at least one card that prints.
  // Leave out Krenko and his Goblins go with him.
  const liveTokens = editing ? [] : (tokens ?? []).filter(t => t.from.some(n => !exclude.has(nameKey(n))));
  const tokenCount = key => prefs.tokens[key] ?? 1;
  const tokenRows = prefs.tokensOff ? [] : liveTokens.map(t => ({ ...t, qty: tokenCount(t.key) })).filter(t => t.qty > 0);
  const tokenItems = proxyItems(tokenRows, new Set());
  const items = [...cardItems, ...tokenItems];
  const missing = shownRows.filter(r => !r.card);
  const pageCount = Math.ceil((items.length + 1) / MAX_CARDS);
  const basics = shownRows.filter(r => isBasicLand(r.card)).map(r => r.key);
  const basicsOut = basics.length > 0 && basics.every(k => exclude.has(k));

  const toggleExclude = (keys, out) => {
    const set = new Set(prefs.exclude);
    for (const k of keys) out ? set.add(k) : set.delete(k);
    setPrefs(card, { exclude: [...set] });
  };
  const setTokenCount = (key, n) =>
    setPrefs(card, { tokens: { ...prefs.tokens, [key]: Math.max(0, Math.min(MAX_TOKENS, n)) } });

  function openPicker(row) {
    opener.current = document.activeElement;
    setPicking(row);
    setPrints(null);
    printingsOf(row.card).then(setPrints, () => setPrints([]));
  }
  function choosePrinting(row, printing) {
    setPrefs(card, { picks: { ...prefs.picks, [row.key]: printing.id } });
    const swap = list => list?.map(r => (r.key === row.key ? { ...r, card: printing } : r)) ?? list;
    setRows(swap); setTokens(swap);
    setPicking(null);
  }

  async function download() {
    setError(null);
    try {
      const images = await fetchImages(items.map(i => i.img), (n, total) => setProgress(`Loading cards ${n} of ${total}…`));
      setProgress("Building the PDF…");
      await new Promise(r => setTimeout(r, 30));   // let the label paint first
      renderPDF(pagesFor(card, items, paper), images).save(`bracket-card-${slug(cardStats(card).title)}-play-test.pdf`);
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  // ── Status line (announced politely) ──────────────────────────────────────
  let status = "";
  if (busy) status = "Finding your cards on Scryfall…";
  else if (rows && !editing) {
    const t = tokenItems.length ? ` + ${tokenItems.length} ${tokenItems.length === 1 ? "token" : "tokens"}` : "";
    status = `${cardItems.length} play test cards${t} + the Bracket Card · ${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
    if (!tokens) status += " · finding tokens…";
  }

  const asking = !card || changing;
  const ready = fonts === "ready";
  const printable = !editing && Boolean(rows) && items.length > 0 && ready;

  return (
    <SiteShell page="playtest">
      <PageIntro title="Play test cards">
        <p>Print a deck to try it at the table: every card at real size, nine to a page, with its Bracket Card in the first slot and its tokens at the end.</p>
      </PageIntro>

      <Step n={1} id="step-deck" title="Your deck">
        {!asking && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 pl-4">
            <p className="min-w-0 flex-1 truncate font-semibold">{cardStats(card).title}</p>
            <Button variant="outline" onClick={() => setChanging(true)}><RefreshCw aria-hidden />Change</Button>
          </div>
        )}
        {asking && (
          <>
            <DeckForm submitLabel="Use this deck" onCard={c => { setCard(c); setChanging(false); start(c); }} />
            {card && (
              <Button variant="link" className="mt-2 px-0" onClick={() => setChanging(false)}>Keep {cardStats(card).title}</Button>
            )}
          </>
        )}
        {fonts === "error" && (
          <Alert variant="destructive" role="alert" className="mt-4">
            <AlertTriangle aria-hidden />
            <AlertDescription className="text-foreground">The card fonts failed to load. Refresh to try again.</AlertDescription>
          </Alert>
        )}
      </Step>

      {card && ready && (
        <div>
          <Step n={2} id="step-card" title="Its Bracket Card">
            <PrintPreview svg={cardSVG(card)} label={`Bracket Card for ${cardStats(card).title}`} className="max-w-xl" />
            <div className="mt-6"><StyleEditor card={card} onChange={setCard} /></div>
          </Step>

          <Step n={3} id="step-cards" title="Choose cards">
            {editing && (
              <div className="space-y-2">
                <Label htmlFor="proxy-list">Full deck list</Label>
                <Textarea id="proxy-list" rows={8} autoComplete="off" autoCapitalize="off" spellCheck={false}
                          placeholder={"1 Sol Ring (C21) 263\n1 Arcane Signet\n…"} value={draft}
                          onChange={e => setDraft(e.target.value)} aria-describedby="proxy-list-hint" />
                <p id="proxy-list-hint" className="text-sm text-muted-foreground">On Moxfield: Export → Copy for MTGA keeps the printings you chose.</p>
                <Button size="lg" className="mt-2 w-full" onClick={applyList} disabled={!draft.trim()}>Use this list</Button>
              </div>
            )}

            <p aria-live="polite" className="flex items-center gap-2 text-[15px] text-muted-foreground empty:hidden">
              {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {status}
            </p>
            {missing.length > 0 && !editing && (
              <p className="mt-1 text-sm text-destructive">
                Not found: {missing.slice(0, 3).map(r => r.name).join(", ")}{missing.length > 3 ? ` and ${missing.length - 3} more` : ""}
              </p>
            )}
            {error && (
              <Alert variant="destructive" role="alert" className="mt-3">
                <AlertTriangle aria-hidden />
                <AlertDescription className="text-foreground">{error}</AlertDescription>
              </Alert>
            )}

            {busy && (
              <div className="mt-4 space-y-2" aria-hidden>
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[76px]" />)}
              </div>
            )}

            {!editing && rows && (
              <>
                <div className="my-4 flex flex-wrap gap-2" role="group" aria-label="List tools">
                  {basics.length > 0 && (
                    <Toggle pressed={basicsOut} onPressedChange={on => toggleExclude(basics, on)}>Skip basic lands</Toggle>
                  )}
                  {liveTokens.length > 0 && (
                    <Toggle pressed={prefs.tokensOff} onPressedChange={on => setPrefs(card, { tokensOff: on })}>Skip tokens</Toggle>
                  )}
                  <Button variant="outline" className="rounded-full" onClick={() => { setEditing(true); setDraft(card.list ?? ""); }}>
                    <Pencil aria-hidden />Edit list
                  </Button>
                </div>

                <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label="Cards in this deck">
                  {rows.map((row, i) => (
                    <CardRow key={row.key} index={i} row={row} included={!exclude.has(row.key)}
                             onPick={() => openPicker(row)} onInclude={on => toggleExclude([row.key], !on)} />
                  ))}
                </ul>

                {liveTokens.length > 0 && (
                  <section aria-labelledby="tokens-h" className="mt-8">
                    <h3 id="tokens-h" className="text-lg font-bold">Tokens this deck makes</h3>
                    <p className="mb-3 mt-1 text-sm text-muted-foreground">One of each prints after your cards. Set any to 0 to leave it out.</p>
                    <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label="Tokens">
                      {liveTokens.map(row => (
                        <TokenRow key={row.key} row={row} count={tokenCount(row.key)} off={prefs.tokensOff}
                                  onPick={() => openPicker(row)} onCount={n => setTokenCount(row.key, n)} />
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </Step>

          {printable && (
            <>
              <Step n={4} id="step-print" title="Print">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {pagesFor(card, items, paper).map((sheet, i) => (
                    <PrintPreview key={i} svg={renderSheetSVG(sheet)} label={`Page ${i + 1} of ${pageCount}`} className="p-1 sm:p-1.5" />
                  ))}
                </div>
                <PaperPicker value={paper} onChange={setPaper} hint="Print at 100% / actual size, not “fit to page”. Hold a real card to any of them to check." />
              </Step>
              <StickyAction>
                <Button size="lg" className="w-full" onClick={download} disabled={Boolean(progress)}>
                  {progress ? <><Loader2 aria-hidden className="animate-spin" />{progress}</> : <><Download aria-hidden />Download {pageCount}-page PDF</>}
                </Button>
              </StickyAction>
            </>
          )}
        </div>
      )}

      <PrintingSheet row={picking} prints={prints} onClose={() => setPicking(null)} onChoose={choosePrinting}
                     returnFocus={e => { e.preventDefault(); opener.current?.focus(); }} />
    </SiteShell>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────
function Thumb({ row, onPick }) {
  const src = row.card ? faces(row.card)[0]?.small : null;
  return (
    <button type="button" onClick={onPick} disabled={!row.card}
            aria-label={row.card ? `Choose a printing of ${row.name}` : `${row.name} wasn't found`}
            className="h-[64px] w-[46px] shrink-0 overflow-hidden rounded-[4px] bg-raised ring-offset-2 ring-offset-card hover:ring-2 hover:ring-control disabled:cursor-default cursor-pointer">
      {src && <img src={src} alt="" loading="lazy" className="block h-full w-full object-cover" />}
    </button>
  );
}

function CardRow({ index, row, included, onPick, onInclude }) {
  const id = `include-${index}`;
  const out = !included || !row.card;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className={out ? "opacity-45" : undefined}><Thumb row={row} onPick={onPick} /></div>
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${out ? "text-muted-foreground" : ""}`}><span className="font-mono text-muted-foreground">{row.qty}×</span> {row.name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {row.card ? `${row.card.set.toUpperCase()} ${row.card.collector_number} · tap the art to change` : "Not found on Scryfall"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Label htmlFor={id} className="w-7 text-right text-sm font-medium text-muted-foreground">{included && row.card ? "In" : "Out"}</Label>
        <Switch id={id} checked={included && Boolean(row.card)} disabled={!row.card} onCheckedChange={onInclude}
                aria-label={`Print ${row.name}`} />
      </div>
    </li>
  );
}

// A token row: its art (tap for printings), what makes it, and − n + where 0
// leaves it out.
function TokenRow({ row, count, off, onPick, onCount }) {
  const out = off || count === 0;
  // P/T tells apart two tokens with one name (a 1/1 and a 2/2 Soldier).
  const pt = row.card.power != null ? `${row.card.power}/${row.card.toughness} · ` : "";
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className={out ? "opacity-45" : undefined}><Thumb row={row} onPick={onPick} /></div>
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${out ? "text-muted-foreground" : ""}`}>{row.name}</p>
        <p className="line-clamp-2 text-sm text-muted-foreground">{pt}from {row.from.join(", ")}</p>
      </div>
      <div className="flex shrink-0 items-center" role="group" aria-label={`${row.name} copies`}>
        <Button variant="outline" size="icon" className="rounded-full" disabled={off || count <= 0}
                onClick={() => onCount(count - 1)} aria-label={`One fewer ${row.name}`}>
          <Minus aria-hidden />
        </Button>
        <output aria-live="polite" className="w-8 text-center font-mono text-[17px] font-bold tabular-nums">{count}</output>
        <Button variant="outline" size="icon" className="rounded-full" disabled={off || count >= MAX_TOKENS}
                onClick={() => onCount(count + 1)} aria-label={`One more ${row.name}`}>
          <Plus aria-hidden />
        </Button>
      </div>
    </li>
  );
}

// Every paper printing of a card, as a bottom sheet.
function PrintingSheet({ row, prints, onClose, onChoose, returnFocus }) {
  return (
    <Sheet open={Boolean(row)} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent onCloseAutoFocus={returnFocus}>
        <SheetHeader>
          <SheetTitle>{row ? `Choose a printing: ${row.name}` : "Choose a printing"}</SheetTitle>
          <SheetDescription>
            {prints == null ? "Loading every printing…" : prints.length ? `${prints.length} printings, newest first.` : "Couldn't load the printings. Try again."}
          </SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto p-4">
          {prints == null && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-hidden>
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[63/88]" />)}
            </div>
          )}
          {prints?.length > 0 && (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {prints.map(p => {
                const on = p.id === row?.card?.id;
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => onChoose(row, p)} aria-pressed={on}
                            aria-label={`${p.set_name}, ${p.collector_number}${on ? " (current)" : ""}`}
                            className={`relative block w-full rounded-md p-1 text-left cursor-pointer ${on ? "bg-accent ring-2 ring-primary" : "hover:bg-raised"}`}>
                      <img src={faces(p)[0]?.small ?? ""} alt="" loading="lazy" className="block aspect-[63/88] w-full rounded-[4px] object-cover" />
                      <span className="mt-1 flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
                        {on && <Check aria-hidden className="size-3.5 text-primary" />}
                        {p.set.toUpperCase()} {p.collector_number}
                      </span>
                      {on && <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"><Check aria-hidden className="size-4" /></span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
