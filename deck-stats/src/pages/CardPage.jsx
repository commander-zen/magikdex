// The card page (index.html): one deck in, its Bracket Card out (Ben,
// 2026-11-10: "user puts in a link or pastes in a decklist and gets a
// [card]"). The sheet of nine and the play test print are their own pages.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Download, ExternalLink, Layers, LayoutGrid } from "lucide-react";
import { renderPDF, MAX_CARDS } from "@/lib/card";
import { KEYS, load, store, slug, cardStats, cardSVG, sheetFor, readHandoff } from "@/lib/deck";
import { useFonts, usePaper } from "@/hooks/use-stored";
import { SiteShell, PageIntro, Step, StickyAction } from "@/components/site-shell";
import { DeckForm } from "@/components/deck-form";
import { StyleEditor } from "@/components/style-editor";
import { PaperPicker } from "@/components/paper-picker";
import { PrintPreview } from "@/components/print-preview";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PRINT_HINT = "Print at 100% / actual size, not “fit to page”. Measure the 50 mm bar to check, cut on the marks, then sleeve.";

export default function CardPage() {
  const [card, setCardState] = useState(() => load(KEYS.deck)?.card ?? null);
  const [paper, setPaper] = usePaper();
  const [prefill, setPrefill] = useState(null);
  const [sheetFull, setSheetFull] = useState(false);
  const fonts = useFonts();
  const resultRef = useRef(null);
  const formRef = useRef(null);

  const setCard = next => { setCardState(next); store(KEYS.deck, { card: next }); };

  // A deck sent from magikdex, now and whenever only the fragment changes.
  useEffect(() => {
    const take = () => readHandoff().then(h => {
      if (!h) return;
      setPrefill(h);
      formRef.current?.scrollIntoView({ block: "start" });
    });
    take();
    addEventListener("hashchange", take);
    return () => removeEventListener("hashchange", take);
  }, []);

  function onCard(next) {
    setCard(next);   // one deck, one card: a new deck replaces it
    setSheetFull(false);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function download() {
    renderPDF([sheetFor([card], paper)]).save(`bracket-card-${slug(cardStats(card).title)}.pdf`);
  }

  // Copies this deck onto the sheet page's list, then goes there. The same
  // grade isn't added twice.
  function toSheet() {
    const sheet = load(KEYS.sheet) ?? {};
    const cards = Array.isArray(sheet.cards) ? sheet.cards : [];
    const same = c => c.stats.gradedAt === card.stats.gradedAt && c.stats.deckHash === card.stats.deckHash;
    if (!cards.some(same)) {
      if (cards.length >= MAX_CARDS) { setSheetFull(true); return; }
      store(KEYS.sheet, { cards: [...cards, structuredClone(card)] });
    }
    location.href = "/sheet.html";
  }

  const ready = fonts === "ready";
  return (
    <SiteShell page="card">
      <PageIntro title="Your deck’s power level, on a card.">
        <p>Add a deck and get a Magic-card-sized Bracket Card. Print it, sleeve it, and hand it over before you shuffle.</p>
      </PageIntro>

      {/* Loud on purpose (Ben, 2026-11-10): every number on the card is
          ScryCheck's, and the page says so before it asks for anything. */}
      <a href="https://scrycheck.com/" target="_blank" rel="noopener"
         className="mt-5 flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 hover:border-control">
        <span className="rounded-sm bg-primary px-2 py-1 font-mono text-[12px] font-bold uppercase tracking-wider text-primary-foreground">Graded by ScryCheck</span>
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">The best EDH tool you don&rsquo;t know about (yet).</span>
        <ExternalLink aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">(opens scrycheck.com in a new tab)</span>
      </a>

      <Step n={1} id="step-deck" title="Add your deck">
        <div ref={formRef} className="scroll-mt-4 sm:scroll-mt-24">
          <DeckForm submitLabel={card ? "Make a new card" : "Make my Bracket Card"} onCard={onCard} prefill={prefill} />
        </div>
        {fonts === "error" && (
          <Alert variant="destructive" role="alert" className="mt-4">
            <AlertTriangle aria-hidden />
            <AlertDescription className="text-foreground">The card fonts failed to load. Refresh to try again.</AlertDescription>
          </Alert>
        )}
      </Step>

      {card && ready && (
        <div ref={resultRef} className="scroll-mt-4 sm:scroll-mt-24">
          <Step n={2} id="step-card" title="Your Bracket Card">
            <PrintPreview svg={cardSVG(card)} label={`Bracket Card for ${cardStats(card).title}`} className="max-w-xl" />
            {!card.stats.gradedAt && (
              <Alert variant="warning" className="mt-4">
                <AlertTriangle aria-hidden />
                <AlertDescription className="text-foreground">Undated: make this deck&rsquo;s card again to date its grade.</AlertDescription>
              </Alert>
            )}
            <div className="mt-6">
              <StyleEditor card={card} onChange={setCard} />
            </div>
          </Step>

          <Step n={3} id="step-print" title="Print it">
            <PaperPicker value={paper} onChange={setPaper} hint={PRINT_HINT} />
          </Step>

          <section aria-labelledby="more" className="mt-10">
            <h2 id="more" className="mb-3 text-lg font-bold">More with this deck</h2>
            <ul className="space-y-2">
              <li>
                <NextRow as="button" onClick={toSheet} Icon={LayoutGrid} title="Add it to a sheet of 9" desc="Print several decks’ cards on one page" />
                {sheetFull && (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    Your sheet is full ({MAX_CARDS}). <a href="/sheet.html" className="underline underline-offset-2">Remove a deck there</a> first.
                  </p>
                )}
              </li>
              <li>
                <NextRow href="/playtest.html" Icon={Layers} title="Print play test cards" desc="Every card in this deck, at real size, plus its tokens" />
              </li>
            </ul>
          </section>

          {/* Held in thumb reach the whole time the card is on screen. */}
          <StickyAction>
            <Button size="lg" className="w-full" onClick={download}><Download aria-hidden />Download PDF</Button>
          </StickyAction>
        </div>
      )}
    </SiteShell>
  );
}

// A full-width row that says where it goes.
function NextRow({ as = "a", Icon, title, desc, ...props }) {
  const Comp = as;
  return (
    <Comp {...props} type={as === "button" ? "button" : undefined}
          className="flex w-full min-h-16 items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 text-left hover:border-control hover:bg-raised cursor-pointer">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Icon aria-hidden className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{desc}</span>
      </span>
      <ArrowRight aria-hidden className="size-5 shrink-0 text-primary" />
    </Comp>
  );
}
