import { cn } from "@/lib/utils";

// 16px text: iOS zooms any focused field under 16px and never zooms back.
function Input({ className, type = "text", ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex min-h-12 w-full rounded-md border border-control bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground/80",
        "focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40",
        "aria-invalid:border-destructive disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
