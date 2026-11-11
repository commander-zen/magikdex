import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// 44 × 28 visible, inside a 44px-tall hit area. The off track has a 4:1 edge
// (WCAG 1.4.11); the thumb's position, not only its colour, says on or off.
function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-control bg-background transition-colors",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-default disabled:opacity-45",
        "before:absolute before:-inset-2 before:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-muted-foreground transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
