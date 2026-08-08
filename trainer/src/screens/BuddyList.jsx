import { useEffect, useState } from "react";
import { t } from "../theme.js";
import {
  myBuddies, addBuddy, setBuddyNote, removeBuddy, blockTrainer,
  normalizeHandle, MET_VENUE_MAX, NOTE_MAX, MET_MODE_CHOICES,
} from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// Your buddy list — the people you've played and swapped cards with.
//
// This is the actual product; the card is the token it passes around. It exists
// for a specific failure: the game already happened, it was good, and there is no
// handle on the other player afterward.
//
// THE NAME IS THE MODEL. This is a Y2K AIM buddy list, not a card collection.
// "Roster" carries slang the product wants no part of; "binder" framed people as
// cards you own, which is the artifact metaphor rather than the social one.
//
// WHAT IT DELIBERATELY IS NOT:
//   · not an encounter log — one row per person, re-saving updates a counter
//     rather than appending, so this can never reconstruct a movement history
//   · not mutual — nobody can see that you saved them, and you cannot see who
//     saved you. "We both added each other" is uncomputable on purpose
//   · not public — nobody&rsquo;s list is readable but its owner&rsquo;s. buddy_count
//     publishes the SIZE and nothing else
export default function BuddyList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [handle, setHandle] = useState("");
  const [where, setWhere] = useState("");
  // Defaults to today, because the overwhelming case is adding someone you just
  // played. Editable because the other case — "I finally remembered to write down
  // that game from March" — is the reason the field exists at all.
  const [when, setWhen] = useState(today);
  const [mode, setMode] = useState("in_person");
  const [busy, setBusy] = useState(false);
  const [addErr, setAddErr] = useState(null);
  const [openKey, setOpenKey] = useState(null);

  async function load() {
    try {
      const { buddies, error } = await myBuddies();
      setRows(buddies);
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
    const { error } = await addBuddy(h, { venue: where, metOn: when, metMode: mode });
    setBusy(false);
    if (error) { setAddErr(error); return; }
    setHandle(""); setWhere(""); setWhen(today()); setMode("in_person");
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

      <span style={cap}>add a buddy</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...mono, fontSize: 16, color: t.dim }}>@</span>
        <input
          value={handle}
          onChange={e => { setAddErr(null); setHandle(normalizeHandle(e.target.value)); }}
          placeholder="their handle" autoCapitalize="off" spellCheck={false}
          style={input}
        />
      </div>
      {/* WHERE WE MET, past tense — a fact about a night that already happened.
          Not to be confused with their "usually found at", which is theirs to
          maintain and changes when they change shops. Conflating the two would
          silently rewrite your record of a game every time they moved. */}
      <input
        value={where}
        onChange={e => setWhere(e.target.value.slice(0, MET_VENUE_MAX))}
        placeholder="where — optional (e.g. Gnome Games commander night)"
        style={input}
      />

      <div style={{ display: "flex", gap: 8 }}>
        {/* DATE ONLY. The column is `date`, so there is no time of day to send
            even if this control offered one — 032 dropped the precision rather
            than hiding it. "We played on the 14th" is the entire use. */}
        <input
          type="date"
          value={when}
          onChange={e => setWhen(e.target.value)}
          aria-label="date met"
          style={{ ...input, flex: 1, minWidth: 0 }}
        />
        <div style={{ display: "flex", border: `1px solid ${t.muted}`, flex: 1 }}>
          {MET_MODE_CHOICES.map(([v, lbl], i) => {
            const on = mode === v;
            return (
              <button key={v} onClick={() => setMode(v)} aria-pressed={on} style={{
                flex: 1, minHeight: 46, cursor: "pointer", border: "none",
                borderLeft: i ? `1px solid ${t.muted}` : "none",
                background: on ? t.accent : "transparent",
                color: on ? t.base : t.dim, ...mono, fontSize: 10,
              }}>{lbl}</button>
            );
          })}
        </div>
      </div>

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
        {busy ? "saving…" : "add buddy"}
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
          your buddy list{rows.length ? ` · ${rows.length}` : ""}
        </span>

        {loading ? (
          <span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span>
        ) : rows.length === 0 ? (
          <span style={{ ...mono, fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
            nobody yet. add the last person you had a good game with — before you
            forget their name.
          </span>
        ) : rows.map(r => (
          <BuddyRow
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

function BuddyRow({ row, open, onToggle, onChanged }) {
  const [note, setNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirm, setConfirm] = useState(null); // null | 'forget' | 'block'

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
              withdraw. Visibility is evaluated at read time, never frozen.

              COPY MATTERS HERE. This said "card no longer shared" — passive voice
              plus "no longer", which describes the RELATIONSHIP and implies an
              action taken toward the reader. It reads as being cut off by someone
              you played a good game with.

              "private profile" describes THEIR STATE instead, which is both
              kinder and more accurate: reachable is false only when visibility is
              private, and that is a setting about everyone, not a decision about
              you. Copy about other people should state what is true of them, not
              imply something about your standing with them. */}
          <span style={{ fontSize: 12, color: row.reachable ? t.white : t.dim }}>
            {row.reachable ? row.display_name : "private profile"}
          </span>
        </span>
        <span style={{ ...dim, textAlign: "right", flexShrink: 0 }}>
          {row.met_count > 1 ? `${row.met_count}×` : ""} {shortDate(row.last_met_at)}
        </span>
      </div>

      {/* Where you met, and whether you were in the same room. Both are your own
          record of that night and survive them going private. */}
      {(row.met_venue || row.met_mode === "online") && (
        <span style={dim}>
          {row.met_mode === "online" ? "online" : "in person"}
          {row.met_venue ? ` · ${row.met_venue}` : ""}
        </span>
      )}

      {/* THE DIRECTORY, SUCH AS IT IS. Where they say to find them, and whether
          they're up for a game — visible to you because you already met them and
          saved them yourself. There is no way to ask this question across all
          trainers; that surface does not exist in the database and adding it
          would be a migration plus a privacy decision, not a screen. */}
      {row.reachable && row.ready_to_pod && (
        <span style={{ ...mono, fontSize: 10, color: t.accent }}>
          ◆ ready to pod up{row.ready_note ? ` · ${row.ready_note}` : ""}
        </span>
      )}
      {row.reachable && row.usually_found_at && (
        <span style={dim}>usually at {row.usually_found_at}</span>
      )}

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
          {/* CONFIRM BEFORE DESTROYING. Both of these were single unconfirmed
              taps sitting next to "save note" at equal visual weight. Forget
              deletes the record of a game you played; block additionally severs
              the edge in BOTH directions and prevents a new one, which deleting a
              row alone cannot undo. */}
          {confirm ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ ...mono, fontSize: 11, color: t.white, lineHeight: 1.6 }}>
                {confirm === "block"
                  ? `block @${row.handle}? they're removed from your list, you're removed from theirs, and neither of you can add the other again.`
                  : `forget @${row.handle}? your note and the dates go with it.`}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn
                  onClick={() => run(() => confirm === "block" ? blockTrainer(row.handle) : removeBuddy(row.handle))}
                  disabled={busy}
                  danger
                >
                  {busy ? "…" : confirm === "block" ? "yes, block" : "yes, forget"}
                </Btn>
                <Btn onClick={() => setConfirm(null)} disabled={busy}>keep</Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn onClick={() => run(() => setBuddyNote(row.handle, note))}
                   disabled={busy || note === (row.note ?? "")} accent>save note</Btn>
              <Btn onClick={() => setConfirm("forget")} disabled={busy}>forget</Btn>
              <Btn onClick={() => setConfirm("block")} disabled={busy} danger>block</Btn>
            </div>
          )}
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

// Today as "YYYY-MM-DD" in the USER'S timezone — which is what <input type="date">
// expects and what the `date` column stores. `toISOString().slice(0,10)` is the
// obvious one-liner and it is WRONG: it converts to UTC first, so anyone west of
// Greenwich adding a buddy after their evening game gets tomorrow's date on it.
function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 032 made these columns `date`, so what arrives is "2026-03-14" and not a
// timestamp. `new Date("2026-03-14")` parses that as UTC MIDNIGHT, which renders
// as the 13th for every user in the Americas — the same off-by-one as above, from
// the other direction. Splitting the string keeps it a plain calendar date, which
// is all it ever was.
function shortDate(ymd) {
  const [y, m, d] = String(ymd ?? "").split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toLowerCase();
}
