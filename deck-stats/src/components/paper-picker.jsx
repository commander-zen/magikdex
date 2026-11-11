import { PAPERS } from "@/lib/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function PaperPicker({ value, onChange, hint }) {
  return (
    <div className="mt-6">
      <p id="paper-label" className="mb-2 text-[15px] font-semibold">Paper</p>
      <ToggleGroup type="single" value={value} onValueChange={onChange} aria-labelledby="paper-label">
        {Object.entries(PAPERS).map(([key, p]) => (
          <ToggleGroupItem key={key} value={key}>{p.label}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint && <p className="mt-2 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
