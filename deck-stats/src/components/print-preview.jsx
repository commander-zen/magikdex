import { cn } from "@/lib/utils";

// The SVG card.js draws: the same layout the PDF is built from, so what you
// see is what prints. Its text comes from escaped strings in card.js.
export function PrintPreview({ svg, label, className }) {
  return (
    <figure className={cn("print-preview rounded-lg border border-border bg-raised p-2 sm:p-3", className)}>
      <div role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}
