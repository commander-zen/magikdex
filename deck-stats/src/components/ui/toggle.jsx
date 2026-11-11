import { Toggle as TogglePrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// An on/off chip ("Skip basic lands"). aria-pressed comes from Radix.
function Toggle({ className, children, ...props }) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(
        "group inline-flex min-h-11 items-center gap-1.5 rounded-full border border-control bg-card px-4 text-[15px] font-medium text-foreground transition-colors cursor-pointer",
        "hover:bg-raised data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        className,
      )}
      {...props}
    >
      <Check aria-hidden className="hidden size-4 group-data-[state=on]:block" />
      {children}
    </TogglePrimitive.Root>
  );
}

export { Toggle };
