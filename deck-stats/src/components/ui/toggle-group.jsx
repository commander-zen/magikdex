import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Chips you choose between. The chosen one gets a check as well as the fill,
// so the state never rides on colour alone (WCAG 1.4.1).
function ToggleGroup({ className, ...props }) {
  return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cn("flex flex-wrap gap-2", className)} {...props} />;
}

function ToggleGroupItem({ className, children, ...props }) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "group inline-flex min-h-11 items-center gap-1.5 rounded-full border border-control bg-card px-4 text-[15px] font-medium text-foreground transition-colors cursor-pointer",
        "hover:bg-raised data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        className,
      )}
      {...props}
    >
      <Check aria-hidden className="hidden size-4 group-data-[state=on]:block" />
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
