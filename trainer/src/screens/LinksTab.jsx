import { useEffect, useState } from "react";
import { aimTheme as t, aimInput, aimBtn } from "../ui/aim.jsx";
import {
  myLinks, saveLink, clearLink,
  MAX_LINKS, LINK_LABEL_MAX, LINK_VALUE_MAX, LINK_KIND_CHOICES, linkValueProblem,
} from "../lib/trainer.js";

// Neutralised for the AIM window: these screens inherit the page sans now.
// Kept as a spread-in object rather than deleted so the ~20 call sites that
// spread it stay untouched.
const mono = {};

// The back of the card: a linktree for EDH.
//
// This is everything you'd tell someone at the table anyway — Discord, Moxfield,
// socials. It matters more than it looks: a person who scans your QR almost
// certainly does NOT have an account here, and these rows are how they can still
// reach you afterwards without making one. The buddy list is the upgrade, not the
// toll gate.
//
// TWO KINDS, because a Discord username is not a URL. A link is followed; a
// username is copied. Rendering the second as the first costs somebody a failed
// tap at exactly the wrong moment.
//
// The platform list is deliberately open — you type the label. A fixed set of
// named slots would render more tidily and cost a migration every time this hobby
// changes platform, which it does.
export default function LinksTab({ userId, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  async function load() {
    const { links, error } = await myLinks(userId);
    setRows(links); setErr(error); setLoading(false);
  }
  useEffect(() => { load(); }, [userId]);

  // Existing rows, then ONE empty slot — not twelve. Twelve blank forms is a
  // chore that looks like homework; one is an invitation.
  const used = rows.map(r => r.position);
  const nextFree = Array.from({ length: MAX_LINKS }, (_, i) => i + 1)
    .find(p => !used.includes(p));

  if (loading) return <span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {err && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>}

      {rows.map(r => (
        <LinkEditor key={r.position} userId={userId} row={r}
                    onChanged={() => { load(); onChanged?.(); }} />
      ))}

      {nextFree && (
        <LinkEditor key={`new-${nextFree}`} userId={userId}
                    row={{ position: nextFree, label: "", kind: "url", value: "" }}
                    onChanged={() => { load(); onChanged?.(); }} />
      )}

      <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.7 }}>
        these sit on the back of your card, which scrolls and never prints — so put
        anything here you'd say at the table. up to {MAX_LINKS}.
      </span>
    </div>
  );
}

function LinkEditor({ userId, row, onChanged }) {
  const [label, setLabel] = useState(row.label ?? "");
  const [kind, setKind] = useState(row.kind ?? "url");
  const [value, setValue] = useState(row.value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const existing = !!row.label;
  const valueErr = linkValueProblem(kind, value);
  const dirty = label !== (row.label ?? "") || kind !== (row.kind ?? "url") || value !== (row.value ?? "");
  // Both halves required: a label with no destination is a dead row, and a
  // destination with no label renders as a bare URL on the card.
  const complete = label.trim() && value.trim();
  const canSave = dirty && complete && !valueErr && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true); setErr(null);
    const { error } = await saveLink(userId, row.position, {
      label: label.trim(), kind, value: value.trim(),
    });
    setBusy(false);
    if (error) { setErr(error); return; }
    onChanged();
  }

  async function remove() {
    setBusy(true); setErr(null);
    const { error } = await clearLink(userId, row.position);
    setBusy(false);
    if (error) { setErr(error); return; }
    onChanged();
  }

  return (
    <div style={{ border: `1px solid ${t.border}`, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={label} onChange={e => { setErr(null); setLabel(e.target.value.slice(0, LINK_LABEL_MAX)); }}
               placeholder="label — e.g. Moxfield"
               style={{ ...input, flex: 1, minWidth: 0 }} />
        <div style={{ display: "flex", border: `1px solid ${t.muted}`, flex: "0 0 auto" }}>
          {LINK_KIND_CHOICES.map(([v, lbl], i) => {
            const on = kind === v;
            return (
              <button key={v} onClick={() => { setErr(null); setKind(v); }} aria-pressed={on} style={{
                minHeight: 46, padding: "0 10px", cursor: "pointer", border: "none",
                borderLeft: i ? `1px solid ${t.muted}` : "none",
                background: on ? t.accent : "transparent",
                color: on ? t.base : t.dim, ...mono, fontSize: 9,
              }}>{lbl}</button>
            );
          })}
        </div>
      </div>

      <input value={value} onChange={e => { setErr(null); setValue(e.target.value.slice(0, LINK_VALUE_MAX)); }}
             placeholder={kind === "url" ? "https://moxfield.com/users/…" : "your username"}
             autoCapitalize="off" spellCheck={false}
             style={{ ...input, borderColor: valueErr ? t.red : t.muted }} />
      {valueErr && <span style={{ ...mono, fontSize: 10, color: t.red }}>{valueErr}</span>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={save} disabled={!canSave} style={btn(true, !canSave)}>
          {busy ? "…" : existing ? "save" : "add"}
        </button>
        {existing && (
          <button onClick={remove} disabled={busy} style={btn(false, busy)}>remove</button>
        )}
      </div>
      {err && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{err}</span>}
    </div>
  );
}

const input = aimInput;
const btn = aimBtn;
