import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { GAME_STYLES, MAX_TAGS } from "@/lib/tags";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Game style + play style: what the owner says about their own deck. Not
// optional extras (Ben: "the tags… are a must"): every page that shows a card
// shows these with it. `onChange(next)` receives an updated copy of the card.
export function StyleEditor({ card, onChange }) {
  const uid = useId();
  const [text, setText] = useState("");
  if (!card) return null;

  const tags = card.tags ?? [];
  const full = tags.length >= MAX_TAGS;
  const addTag = raw => {
    const v = String(raw ?? "").trim().toLowerCase();
    if (v && !full && !tags.includes(v)) onChange({ ...card, tags: [...tags, v] });
    setText("");
  };
  const removeTag = tag => onChange({ ...card, tags: tags.filter(t => t !== tag) });

  // Nothing until you type (Ben, in magikdex: "i dont want all the chips just
  // the search bar"). Then the commander's EDHREC themes that match, in
  // EDHREC's rank order. A card saved before themes existed simply has none.
  const q = text.trim().toLowerCase();
  const hits = q ? (card.stats.themes ?? [])
    .filter(t => t.toLowerCase().includes(q) && !tags.includes(t.toLowerCase()))
    .slice(0, 8) : [];

  return (
    <div className="space-y-6">
      <div>
        <p id={`${uid}-gs`} className="mb-2 text-[15px] font-semibold">Game style</p>
        {/* One of four; choosing the chosen one clears it. */}
        <ToggleGroup type="single" value={card.gameStyle || ""} aria-labelledby={`${uid}-gs`}
                     onValueChange={v => onChange({ ...card, gameStyle: v })}>
          {GAME_STYLES.map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>

      <div>
        <Label htmlFor={`${uid}-tag`} className="mb-2">
          Play style <span className="font-normal text-muted-foreground">· {tags.length} of {MAX_TAGS}</span>
        </Label>
        {tags.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-2" aria-label="Your play style tags">
            {tags.map(tag => (
              <li key={tag}>
                <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary bg-accent pl-4 pr-3 text-[15px] font-medium text-accent-foreground hover:bg-raised cursor-pointer">
                  {tag}<X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {full ? (
          <p className="text-sm text-muted-foreground">That&rsquo;s the most a card fits. Remove one to change it.</p>
        ) : (
          <>
            <Input id={`${uid}-tag`} autoComplete="off" autoCapitalize="off" enterKeyHint="done"
                   placeholder="Search themes, or type your own" value={text}
                   onChange={e => setText(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(text); } }}
                   aria-describedby={`${uid}-tag-hint`} />
            <p id={`${uid}-tag-hint`} className="mt-2 text-sm text-muted-foreground">Press Enter to add what you typed.</p>
            {hits.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Matching themes">
                {hits.map(t => (
                  <li key={t}>
                    <button type="button" onClick={() => addTag(t)}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-control bg-card pl-3 pr-4 text-[15px] hover:bg-raised cursor-pointer">
                      <Plus aria-hidden className="size-4 text-primary" />{t.toLowerCase()}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
