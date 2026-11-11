import { Accordion as AccordionPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function Accordion(props) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({ className, ...props }) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn("rounded-lg border border-border bg-card data-[state=open]:border-control", className)} {...props} />;
}

// `aside` sits in the header beside the trigger (a remove button), so it is
// never a button inside a button.
function AccordionTrigger({ className, children, aside, ...props }) {
  return (
    <AccordionPrimitive.Header className="flex items-stretch">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group flex min-h-15 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-2 text-left cursor-pointer hover:bg-raised",
          className,
        )}
        {...props}
      >
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </AccordionPrimitive.Trigger>
      {aside}
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({ className, children, ...props }) {
  return (
    <AccordionPrimitive.Content data-slot="accordion-content" className="overflow-hidden" {...props}>
      <div className={cn("px-4 pb-4 pt-1", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
