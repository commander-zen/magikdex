import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Label({ className, ...props }) {
  return <LabelPrimitive.Root data-slot="label" className={cn("block text-[15px] font-semibold leading-snug", className)} {...props} />;
}

export { Label };
