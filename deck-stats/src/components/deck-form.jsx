import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, Link2, ListOrdered, Loader2, Send } from "lucide-react";
import { gradeDeck } from "@/lib/deck";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

// A link or a pasted list → a graded card. All three pages ask the same way.
// `check()` runs before ScryCheck is called and may return an error message
// (e.g. a full sheet), so a request is never spent on a deck that can't be used.
// `prefill` ({ commander, partner, list } or { error }) is a deck sent from
// magikdex: it only fills the form; nothing is graded until the owner taps.
export function DeckForm({ submitLabel, check = () => null, onCard, prefill, ariaLabel = "Your deck" }) {
  const uid = useId();
  const [mode, setMode] = useState("url");
  const [url, setUrl] = useState("");
  const [commander, setCommander] = useState("");
  const [partner, setPartner] = useState("");
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [handoff, setHandoff] = useState(false);
  const errorRef = useRef(null);

  useEffect(() => {
    if (!prefill) return;
    if (prefill.error) { setError(prefill.error); return; }
    setMode("list");
    setCommander(prefill.commander);
    setPartner(prefill.partner);
    setList(prefill.list);
    setHandoff(true);
    setError(null);
  }, [prefill]);

  // Move focus to the error so a screen reader and a thumb both find it.
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function body() {
    if (mode === "url") {
      const u = url.trim();
      if (!u) throw new Error("Paste a Moxfield or Archidekt deck link.");
      return { url: u };
    }
    const commanders = [commander, partner].map(s => s.trim()).filter(Boolean);
    const deckList = list.trim();
    if (!commanders.length) throw new Error("Name your commander.");
    if (!deckList) throw new Error("Paste your deck list.");
    return { commanders, deckList, deckName: commanders.join(" & ") };
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const blocked = check();
    if (blocked) { setError(blocked); return; }
    let b;
    try { b = body(); } catch (err) { setError(err.message); return; }
    setBusy(true);
    try {
      const card = await gradeDeck(b);
      setUrl(""); setCommander(""); setPartner(""); setList(""); setHandoff(false);
      onCard(card);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={ariaLabel} aria-busy={busy} noValidate>
      <Tabs value={mode} onValueChange={m => { setMode(m); setError(null); }}>
        <TabsList aria-label="How to add your deck">
          <TabsTrigger value="url"><Link2 aria-hidden />Deck link</TabsTrigger>
          <TabsTrigger value="list"><ListOrdered aria-hidden />Paste a list</TabsTrigger>
        </TabsList>

        <TabsContent value="url" className="space-y-2">
          <Label htmlFor={`${uid}-url`}>Moxfield or Archidekt link</Label>
          <Input
            id={`${uid}-url`} type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
            placeholder="https://moxfield.com/decks/…" value={url} onChange={e => setUrl(e.target.value)}
            aria-describedby={`${uid}-url-hint`}
          />
          <p id={`${uid}-url-hint`} className="text-sm text-muted-foreground">The deck has to be public.</p>
        </TabsContent>

        <TabsContent value="list" className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`${uid}-cmd`}>Commander</Label>
            <Input id={`${uid}-cmd`} autoComplete="off" autoCapitalize="words" placeholder="Atraxa, Praetors' Voice"
                   value={commander} onChange={e => setCommander(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-partner`}>Partner <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id={`${uid}-partner`} autoComplete="off" autoCapitalize="words" value={partner} onChange={e => setPartner(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-list`}>Deck list</Label>
            <Textarea id={`${uid}-list`} rows={8} autoComplete="off" autoCapitalize="off" spellCheck={false}
                      placeholder={"1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n…"} value={list}
                      onChange={e => setList(e.target.value)} aria-describedby={`${uid}-list-hint`} />
            <p id={`${uid}-list-hint`} className="text-sm text-muted-foreground">One card per line, as Moxfield, Archidekt or MTGA export it.</p>
          </div>
        </TabsContent>
      </Tabs>

      {handoff && (
        <Alert className="mt-5">
          <Send aria-hidden />
          <AlertDescription className="text-foreground">Sent from magıkdex. Check the commander, then make the card.</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" className="mt-5 w-full" disabled={busy}>
        {busy ? <><Loader2 aria-hidden className="animate-spin" />Grading…</> : submitLabel}
      </Button>

      {error && (
        <Alert variant="destructive" role="alert" className="mt-4" tabIndex={-1} ref={errorRef}>
          <AlertCircle aria-hidden />
          <AlertDescription className="text-foreground">{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
