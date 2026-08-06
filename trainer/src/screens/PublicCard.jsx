import { useEffect, useState } from "react";
import { t } from "../theme.js";
import { getPublicCard } from "../lib/trainer.js";

// /t/<handle> — the card a stranger sees after a scan, a shared link, or the
// physical card. No auth: this route works signed out, which is the whole point.
//
// It renders ONLY what get_trainer_card returns. There is no second query and no
// fallback to a table read, so whatever the database decides to withhold is
// withheld here too. A private trainer produces the not-found state below, and
// that state is deliberately identical whether the handle is private or has never
// existed — distinguishing them would turn this page into an existence oracle.
export default function PublicCard({ handle }) {
  const [state, setState] = useState({ loading: true, card: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ loading: true, card: null, error: null });
      try {
        const { card, error } = await getPublicCard(handle);
        if (!cancelled) setState({ loading: false, card, error });
      } catch (e) {
        // try/catch so a thrown failure surfaces as a message. A spinner with no
        // timeout is how you build a screen that hangs forever with no
        // explanation.
        if (!cancelled) setState({ loading: false, card: null, error: e?.message || "couldn't reach the server" });
      }
    })();
    return () => { cancelled = true; };
  }, [handle]);

  const wrap = {
    minHeight: "100dvh", background: t.base,
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 20,
  };
  const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

  if (state.loading) {
    return <div style={wrap}><span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span></div>;
  }

  if (state.error) {
    return (
      <div style={wrap}>
        <span style={{ ...mono, fontSize: 12, color: t.red, maxWidth: 340, lineHeight: 1.7, textAlign: "center" }}>
          {state.error}
        </span>
      </div>
    );
  }

  // NOT FOUND and PRIVATE render identically, on purpose. See the note above.
  if (!state.card) {
    return (
      <div style={wrap}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ ...mono, fontSize: 13, color: t.white }}>@{handle}</span>
          <span style={{ ...mono, fontSize: 12, color: t.dim, lineHeight: 1.7 }}>
            no card here
          </span>
        </div>
      </div>
    );
  }

  const c = state.card;
  // identity_mode is a RENDER FLAG: both axes may hold data, and exactly one is
  // shown. The database deliberately does not choose — it returns both and the
  // flag, so this is the only place the decision is made.
  const axis = c.identity_mode === "legends" ? c.favorite_legends : c.playstyle;
  const axisLabel = c.identity_mode === "legends" ? "legends" : "playstyle";

  return (
    <div style={wrap}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: t.surface,
        border: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column",
      }}>
        {/* Header band */}
        <div style={{
          padding: "18px 20px",
          borderBottom: `1px solid ${t.border}`,
          display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12,
        }}>
          <span style={{ ...mono, fontSize: 20, color: t.accent }}>@{c.handle}</span>
          {c.visibility === "unlisted" && (
            <span style={{ ...mono, fontSize: 9, color: t.dim }}>UNLISTED</span>
          )}
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {c.photo_url ? (
              <img
                src={c.photo_url}
                alt=""
                style={{ width: 56, height: 56, objectFit: "cover", flexShrink: 0, border: `1px solid ${t.border}` }}
              />
            ) : (
              <div style={{
                width: 56, height: 56, flexShrink: 0,
                border: `1px dashed ${t.muted}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                ...mono, fontSize: 18, color: t.muted,
              }}>
                {(c.display_name || c.handle).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 17, color: t.white }}>{c.display_name}</span>
              {c.pronouns && (
                <span style={{ ...mono, fontSize: 11, color: t.dim }}>{c.pronouns}</span>
              )}
            </div>
          </div>

          {c.bio && (
            <span style={{ fontSize: 13, lineHeight: 1.65, color: t.white }}>{c.bio}</span>
          )}

          {/* Arrays come back as [] rather than null, so length is the test. */}
          {axis?.length > 0 && (
            <Field label={axisLabel}>
              {axis.map(v => <Chip key={v}>{v.replace(/_/g, " ")}</Chip>)}
            </Field>
          )}

          {c.philosophy?.length > 0 && (
            <Field label="philosophy">
              {c.philosophy.map(v => <Chip key={v}>{v.replace(/_/g, " ")}</Chip>)}
            </Field>
          )}

          {c.home_region && (
            <Field label="plays around">
              <span style={{ ...mono, fontSize: 12, color: t.white }}>{c.home_region}</span>
            </Field>
          )}
        </div>

        <div style={{
          padding: "12px 20px",
          borderTop: `1px solid ${t.border}`,
          ...mono, fontSize: 10, color: t.dim,
        }}>
          trainer since {String(c.created_at).slice(0, 10)}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{
        fontSize: 9, fontWeight: 500, letterSpacing: "0.18em",
        textTransform: "uppercase", color: t.dim,
      }}>
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>
    </div>
  );
}

function Chip({ children }) {
  return (
    <span style={{
      fontFamily: "'Noto Sans Mono', monospace",
      fontSize: 11, letterSpacing: "0.04em",
      color: t.white,
      border: `1px solid ${t.muted}`,
      padding: "4px 9px",
    }}>
      {children}
    </span>
  );
}
