import { useEffect, useState } from "react";
import { t } from "../theme.js";
import {
  myRoster, saveConnection, setConnectionNote, forgetConnection, blockTrainer,
  normalizeHandle, MET_CONTEXT_MAX, NOTE_MAX,
} from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// The roster — people you've played and were willing to swap cards with.
//
// This is the actual product; the card is the token it passes around. The whole
// thing exists because of a specific failure: the game already happened, it was
// good, and there is no handle on the other player afterward.
//
// WHAT IT DELIBERATELY IS NOT:
//   · not an encounter log — one row per person, re-saving updates a counter
//     rather than appending, so this can never reconstruct a movement history
//   · not mutual — nobody can see that you saved them, and you cannot see who
//     saved you. "We both added each other" is uncomputable on purpose
//   · not public — no roster is readable by anyone but its owner. roster_count
//     publishes the SIZE and nothing else
export default function Roster() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [handle, setHandle] = useState("");
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const [addErr, setAddErr] = useState(null);
  const [openKey, setOpenKey] = useState(null);

  async function load() {
    try {
      const { roster, error } = await myRoster();
      setRows(roster);
      setLoadErr(error);
    } catch (e) {
      setLoadErr(e?.message || "couldn't reach the server");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const h = normalizeHandle(handle);
    if (!h || busy) return;
    setBusy(true); setAddErr(null);
    const { error } = await saveConnection(h, where);
    setBusy(false);
    if (error) { setAddErr(error); return; }
    setHandle(""); setWhere("");
    load();
  }

  const input = {
    width: "100%", boxSizing: "border-box", minHeight: 46,
    background: "transparent", color: t.white, ...mono, fontSize: 13,
    border: `1px solid ${t.muted}`, padding: "0 12px", borderRadius: 0, outline: "none",
  };
  const cap = {
    fontSize: 9, fontWeight: 500, letterSpacing: "0.18em",
    textTransform: "uppercase", color: t.dim,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {loadErr && (
        <div style={{ padding: 12, border: `1px solid ${t.red}`, ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>
          {loadErr}
        </div>
      )}

      <span style={cap}>add someone you played</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...mono, fontSize: 16, color: t.dim }}>@</span>
        <input
          value={handle}
          onChange={e => { setAddErr(null); setHandle(normalizeHandle(e.target.value)); }}
          placeholder="their handle" autoCapitalize="off" spellCheck={false}
          style={input}
        />
      </div>
      <input
        value={where}
        onChange={e => setWhere(e.target.value.slice(0, MET_CONTEXT_MAX))}
        placeholder="where — optional (e.g. Gnome Games commander night)"
        style={input}
      />
      <button
        onClick={add}
        disabled={busy || !handle}
        style={{
          minHeight: 46, background: "transparent",
          border: `1px solid ${busy || !handle ? t.muted : t.accent}`,
          color: busy || !handle ? t.dim : t.accent,
          ...mono, fontSize: 12,
          cursor: busy || !handle ? "default" : "pointer",
          opacity: busy || !handle ? 0.55 : 1,
        }}
      >
        {busy ? "saving…" : "add to roster"}
      </button>
      {addErr && <span style={{ ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>{addErr}</span>}
      {/* Saving is unilateral and silent — no request, no approval, no
          notification. Their card is already something they chose to hand out,
          and an accept flow would add friction at exactly the moment the product
          has to have none. */}
      <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.6, marginTop: -10 }}>
        they aren&rsquo;t told, and they can&rsquo;t see that you saved them.
      </span>

      <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={cap}>
          your roster{rows.length ? ` · ${rows.length}` : ""}
        </span>

        {loading ? (
          <span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span>
        ) : rows.length === 0 ? (
          <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
            nobody yet. add the last person you had a good game with — before you
            forget their name.
          </span>
        ) : rows.map(r => (
          <RosterRow
            key={r.handle}
            row={r}
            open={openKey === r.handle}
            onToggle={() => setOpenKey(k => (k === r.handle ? null : r.handle))}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function RosterRow({ row, open, onToggle, onChanged }) {
  const [note, setNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function run(fn) {
    setBusy(true); setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setErr(error); return; }
    onChanged();
  }

  const dim = { ...mono, fontSize: 10, color: t.dim };

  return (
    <div style={{ border: `1px solid ${t.border}`, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div onClick={onToggle} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, cursor: "pointer" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ ...mono, fontSize: 13, color: t.accent }}>@{row.handle}</span>
          {/* Card fields are NULL when they've gone private since you met. You
              keep your own record of the encounter; their card is theirs to
              withdraw. Visibility is evaluated at read time, never frozen. */}
          <span style={{ fontSize: 12, color: row.reachable ? t.white : t.dim }}>
            {row.reachable ? row.display_name : "card no longer shared"}
          </span>
        </span>
        <span style={{ ...dim, textAlign: "right", flexShrink: 0 }}>
          {row.met_count > 1 ? `${row.met_count}×` : ""} {shortDate(row.last_met_at)}
        </span>
      </div>

      {row.met_context && <span style={dim}>{row.met_context}</span>}

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
          {row.reachable && row.playstyle?.length > 0 && (
            <span style={dim}>{row.playstyle.join(" · ").replace(/_/g, " ")}</span>
          )}
          <span style={dim}>first met {shortDate(row.first_met_at)}</span>

          {/* Your private annotation. Never shown to them or to anyone else —
              the only genuinely one-sided field in the schema. */}
          <textarea
            value={note}
            onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder="private note — 'played Voja, wants a rematch'"
            rows={2}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "transparent", color: t.white, ...mono, fontSize: 12,
              border: `1px solid ${t.muted}`, padding: "8px 10px",
              borderRadius: 0, outline: "none", resize: "vertical", lineHeight: 1.6,
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn onClick={() => run(() => setConnectionNote(row.handle, note))}
                 disabled={busy || note === (row.note ?? "")} accent>save note</Btn>
            <Btn onClick={() => run(() => forgetConnection(row.handle))} disabled={busy}>forget</Btn>
            {/* Blocking severs the edge in BOTH directions and stops a new one
                forming — which deleting a row alone cannot do. */}
            <Btn onClick={() => run(() => blockTrainer(row.handle))} disabled={busy} danger>block</Btn>
          </div>
          {err && <span style={{ ...mono, fontSize: 11, color: t.red }}>{err}</span>}
        </div>
      )}
    </div>
  );
}

function Btn({ children, onClick, disabled, accent, danger }) {
  const color = danger ? t.red : accent ? t.accent : t.dim;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 40, padding: "0 14px", background: "transparent",
        border: `1px solid ${disabled ? t.muted : color}`,
        color: disabled ? t.dim : color,
        ...mono, fontSize: 11,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
}
