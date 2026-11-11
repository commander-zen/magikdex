import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Icon + text, so the kind of message never rides on colour alone.
const alertVariants = cva(
  "grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border bg-card px-4 py-3 text-[15px] [&>svg]:mt-0.5 [&>svg]:size-5",
  {
    variants: {
      variant: {
        default: "border-border text-foreground [&>svg]:text-primary",
        destructive: "border-destructive/60 text-foreground [&>svg]:text-destructive",
        warning: "border-warning/60 text-foreground [&>svg]:text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({ className, variant, ...props }) {
  return <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }) {
  return <div data-slot="alert-title" className={cn("col-start-2 font-semibold", className)} {...props} />;
}

function AlertDescription({ className, ...props }) {
  return <div data-slot="alert-description" className={cn("col-start-2 text-muted-foreground", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
