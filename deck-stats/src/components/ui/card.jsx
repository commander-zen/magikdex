import { cn } from "@/lib/utils";

function Card({ className, ...props }) {
  return <div data-slot="card" className={cn("rounded-xl border border-border bg-card text-card-foreground", className)} {...props} />;
}

function CardHeader({ className, ...props }) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1 px-4 pt-4 sm:px-6 sm:pt-6", className)} {...props} />;
}

function CardTitle({ className, as: Comp = "h2", ...props }) {
  return <Comp data-slot="card-title" className={cn("text-xl font-bold leading-tight", className)} {...props} />;
}

function CardDescription({ className, ...props }) {
  return <p data-slot="card-description" className={cn("text-[15px] text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div data-slot="card-content" className={cn("px-4 py-4 sm:px-6 sm:py-5", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
