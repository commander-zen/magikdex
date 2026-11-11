import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// z-500: above the app's own fixed layers (Brew's takeover and sheets).
// shadcn/ui Sheet, bottom side only: the phone pattern for "pick one of many"
// (focus trapped, Escape and the close button both dismiss, focus returns to
// the button that opened it).
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetContent({ className, children, ...props }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-[500] bg-black/70 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-[501] mx-auto flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-t-xl border border-b-0 border-control bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none",
          "data-[state=open]:animate-[sheet-up_200ms_ease-out]",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-raised hover:text-foreground cursor-pointer">
          <X aria-hidden className="size-5" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }) {
  return <div className={cn("border-b border-border px-4 pb-3 pr-14 pt-4", className)} {...props} />;
}

function SheetTitle({ className, ...props }) {
  return <SheetPrimitive.Title className={cn("text-lg font-bold leading-tight", className)} {...props} />;
}

function SheetDescription({ className, ...props }) {
  return <SheetPrimitive.Description className={cn("text-[15px] text-muted-foreground", className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
