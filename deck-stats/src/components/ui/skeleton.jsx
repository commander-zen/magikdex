import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }) {
  return <div data-slot="skeleton" aria-hidden className={cn("animate-pulse rounded-md bg-raised", className)} {...props} />;
}

export { Skeleton };
