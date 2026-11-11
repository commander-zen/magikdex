import { ArrowDown, ArrowLeftRight, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// "What is magikdex?" — opened by tapping the wordmark on any root screen.
// Short on purpose: what it is, the three gestures, and what it isn't.
// A Radix dialog (2026-11-11): focus is trapped and returns to the wordmark;
// it closes on Got it, the close button, a scrim tap or Escape.
const GESTURES = [
  [ArrowLeftRight, "Swipe to browse"],
  [ArrowUp, "Swipe up to keep a card"],
  [ArrowDown, "Swipe down to see your pile"],
];

export default function AboutSheet({ open, onClose }) {
  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="font-sans text-foreground">
        <SheetHeader className="border-b-0 pb-0">
          <SheetTitle className="font-[Zilla_Slab,serif] text-2xl font-normal">mag&#x0131;kdex is a swipe brewer</SheetTitle>
          <SheetDescription className="mt-2 text-base text-foreground">
            Build Commander decks the way you flip through a binder at 1am: one card at a time, keep what sparks something.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-5 pt-4">
          <ul className="flex list-none flex-col gap-2.5">
            {GESTURES.map(([Glyph, text]) => (
              <li key={text} className="flex items-center gap-3 text-base">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                  <Glyph aria-hidden className="size-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <p className="text-base">
            Search any card with Scryfall syntax, or open your dex: one brew per legend, named however you like.
          </p>
          <p className="text-sm text-muted-foreground">
            It isn&apos;t a Moxfield or Scryfall replacement. Finish, share, and print decks there.
          </p>
          <Button size="lg" variant="secondary" className="press w-full" onClick={onClose}>Got it</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
