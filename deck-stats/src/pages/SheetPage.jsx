// The sheet page (sheet.html): up to nine decks' Bracket Cards on one page,
// 3 × 3, like a proxy sheet (Ben: "i print proxy cards and its always 9 to a
// page"). Its own list, separate from the card page's deck.
import { useState } from "react";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import { renderPDF, renderSheetSVG, MAX_CARDS } from "@/lib/card";
import { KEYS, load, store, cardStats, sheetFor, saidAbout } from "@/lib/deck";
import { useFonts, usePaper } from "@/hooks/use-stored";
import { SiteShell, PageIntro, Step, StickyAction } from "@/components/site-shell";
import { DeckForm } from "@/components/deck-form";
import { StyleEditor } from "@/components/style-editor";
import { PaperPicker } from "@/components/paper-picker";
import { PrintPreview } from "@/components/print-preview";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PRINT_HINT = "Print at 100% / actual size, not “fit to page”. Measure the 50 mm bar to check, cut on the marks, then sleeve.";

// Each deck gets a stable key for the accordion, kept out of storage.
let nextKey = 0;
const keyed = card => ({ key: `d${nextKey++}`, card });

export default function SheetPage() {
  const [decks, setDecksState] = useState(() => {
    const saved = load(KEYS.sheet);
    return (Array.isArray(saved?.cards) ? saved.cards : []).slice(0, MAX_CARDS).map(keyed);
  });
  // The deck whose game style and play style are open: the newest, at first.
  const [open, setOpen] = useState(() => decks.at(-1)?.key ?? "");
  const [paper, setPaper] = usePaper();
  const fonts = useFonts();

  const setDecks = next => { setDecksState(next); store(KEYS.sheet, { cards: next.map(d => d.card) }); };
  const n = decks.length;
  const cards = decks.map(d => d.card);

  function onCard(card) {
    const d = keyed(card);
    setDecks([...decks, d]);
    setOpen(d.key);
  }

  const download = () => renderPDF([sheetFor(cards, paper)]).save(`bracket-card-sheet-${n}.pdf`);

  return (
    <SiteShell page="sheet">
      <PageIntro title="Sheet of 9">
        <p>Up to nine decks&rsquo; Bracket Cards on one page. Grade your shelf, or your whole playgroup&rsquo;s, and cut them all at once.</p>
      </PageIntro>

      <Step n={1} id="step-add" title="Add a deck">
        <DeckForm
          ariaLabel="Add a deck"
          submitLabel={n ? "Add to sheet" : "Add the first deck"}
          // Checked before calling ScryCheck, so a full sheet never spends a request.
          check={() => (n >= MAX_CARDS ? `The sheet is full (${MAX_CARDS}). Remove a deck to add another.` : null)}
          onCard={onCard}
        />
        {fonts === "error" && (
          <Alert variant="destructive" role="alert" className="mt-4">
            <AlertTriangle aria-hidden />
            <AlertDescription className="text-foreground">The card fonts failed to load. Refresh to try again.</AlertDescription>
          </Alert>
        )}
      </Step>

      {n > 0 && (
        <>
          <Step n={2} id="step-decks" title="On this sheet" aside={<Badge aria-label={`${n} of ${MAX_CARDS} decks`}>{n} of {MAX_CARDS}</Badge>}>
            <p className="-mt-2 mb-3 text-sm text-muted-foreground">Open a deck to set its game style and play style.</p>
            <Accordion type="single" collapsible value={open} onValueChange={setOpen} className="space-y-2">
              {decks.map(({ key, card }, i) => {
                const title = cardStats(card).title || "Untitled deck";
                return (
                  <AccordionItem key={key} value={key}>
                    <AccordionTrigger
                      aside={
                        <Button variant="ghost" size="icon" className="m-2 shrink-0 self-center text-muted-foreground hover:text-destructive"
                                aria-label={`Remove ${title}`}
                                onClick={() => setDecks(decks.filter(d => d.key !== key))}>
                          <Trash2 aria-hidden />
                        </Button>
                      }
                    >
                      <span className="block truncate font-semibold"><span className="font-mono text-muted-foreground">{i + 1}.</span> {title}</span>
                      <span className="block truncate text-sm text-muted-foreground">{saidAbout(card) || "No game style or play style yet"}</span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <StyleEditor card={card} onChange={next => setDecks(decks.map(d => (d.key === key ? { key, card: next } : d)))} />
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </Step>

          {fonts === "ready" && (
            <div>
              <Step n={3} id="step-print" title="Print">
                <PrintPreview svg={renderSheetSVG(sheetFor(cards, paper))} label={`Print preview: ${n} Bracket Cards on one page`} />
                <PaperPicker value={paper} onChange={setPaper} hint={PRINT_HINT} />
              </Step>
              <StickyAction>
                <Button size="lg" className="w-full" onClick={download}><Download aria-hidden />Download PDF</Button>
              </StickyAction>
            </div>
          )}
        </>
      )}
    </SiteShell>
  );
}
