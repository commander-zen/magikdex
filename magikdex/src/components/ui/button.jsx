import { Slot } from "radix-ui";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn/ui Button. Every size clears the 44px tap floor (WCAG 2.5.8 asks for
// 24; NN/g and Apple ask for 44 on touch).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[15px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        secondary: "bg-raised text-foreground border border-control hover:bg-accent",
        outline: "border border-control bg-transparent text-foreground hover:bg-raised",
        ghost: "bg-transparent text-foreground hover:bg-raised",
        link: "text-accent-foreground underline underline-offset-4 hover:text-foreground",
        destructive: "bg-transparent text-destructive border border-control hover:bg-raised",
      },
      size: {
        default: "min-h-11 px-4",
        lg: "min-h-13 px-5 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button };
