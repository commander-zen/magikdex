import { IdCard, LayoutGrid, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

// Three top-level pages, so all three are always visible (NN/g: with a few
// top-level destinations, show them; don't bury them in a menu).
const PAGES = [
  { id: "card", href: "/", label: "Card", Icon: IdCard },
  { id: "sheet", href: "/sheet.html", label: "Sheet of 9", Icon: LayoutGrid },
  { id: "playtest", href: "/playtest.html", label: "Play test", Icon: Layers },
];

export function SiteShell({ page, children }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="z-40 border-b sm:sticky sm:top-0 border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:pb-3">
          <a href="/" className="inline-flex min-h-11 items-center gap-2.5 self-start rounded-md sm:self-auto">
            <span aria-hidden className="grid h-7 w-5 place-items-center rounded-[3px] border-2 border-primary">
              <span className="h-2.5 w-1.5 rounded-[1px] bg-primary" />
            </span>
            <span className="font-display text-xl leading-none tracking-tight">Bracket Card</span>
          </a>
          <nav aria-label="Pages">
            <ul className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-card p-1 sm:flex">
              {PAGES.map(({ id, href, label, Icon }) => {
                const current = id === page;
                return (
                  <li key={id}>
                    <a
                      href={href}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-3 text-[13px] font-semibold sm:flex-row sm:gap-2 sm:text-[15px]",
                        current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-raised hover:text-foreground",
                      )}
                    >
                      <Icon aria-hidden className="size-[18px]" />
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 outline-none">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl space-y-2 px-4 py-8 text-sm text-muted-foreground">
          <p>
            Grades by <a className="underline underline-offset-2 hover:text-foreground" href="https://scrycheck.com/" target="_blank" rel="noopener">ScryCheck</a>.
            {" "}Card images and data by <a className="underline underline-offset-2 hover:text-foreground" href="https://scryfall.com/" target="_blank" rel="noopener">Scryfall</a>.
            {" "}Play test cards are for playtesting, not for sale.
          </p>
          <p>
            Bracket Card is unofficial Fan Content permitted under the{" "}
            <a className="underline underline-offset-2 hover:text-foreground" href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noopener">Fan Content Policy</a>.
            {" "}Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
          </p>
        </div>
      </footer>
    </div>
  );
}

// A page's opening: one heading, one line of what it's for.
export function PageIntro({ title, children }) {
  return (
    <div className="pb-2 pt-8 sm:pt-12">
      <h1 className="text-balance text-[2rem] font-bold leading-[1.1] tracking-tight sm:text-[2.5rem]">{title}</h1>
      {children && <div className="mt-3 max-w-[46ch] text-[17px] text-muted-foreground">{children}</div>}
    </div>
  );
}

// A numbered step. The number is in the heading's text too (for screen
// readers the circle is decoration).
export function Step({ n, title, aside, id, children, className }) {
  return (
    <section aria-labelledby={id} className={cn("mt-10", className)}>
      <div className="mb-4 flex items-center gap-3">
        {n != null && (
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent font-mono text-[15px] font-bold text-accent-foreground">
            {n}
          </span>
        )}
        <h2 id={id} className="text-xl font-bold leading-tight">
          {n != null && <span className="sr-only">Step {n}: </span>}
          {title}
        </h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

// The page's one main action, held in thumb reach while you scroll.
export function StickyAction({ children }) {
  return (
    <div className="sticky bottom-0 z-30 -mx-4 mt-6 border-t border-border bg-background/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      {children}
    </div>
  );
}
