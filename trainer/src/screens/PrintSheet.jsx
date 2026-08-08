import { useEffect, useState } from "react";
import { t } from "../theme.js";
import BadgeCard from "../components/BadgeCard.jsx";
import { getSession, getMyProfile, myDecks } from "../lib/trainer.js";

const mono = { fontFamily: "'Noto Sans Mono', monospace", letterSpacing: "0.06em" };

// PRINT IT, CUT IT, SLEEVE IT.
//
// The card is 63mm x 88mm on paper — the real thing, so it fits a standard sleeve
// and sits in a deck box next to actual cards. That works because the card's
// internals are sized in cqw: give the frame a width in millimetres and every
// font, pad and gap inside resolves to physical units with no separate print
// stylesheet to keep in sync.
//
// No premium tier, no shop, no shipping. Ben's motto is the requirement: easy and
// frictionless. A page that prints is both; an order form is neither.
const COUNTS = [1, 9];

export default function PrintSheet() {
  const [profile, setProfile] = useState(null);
  const [decks, setDecks] = useState([]);
  const [state, setState] = useState("loading");   // loading | ready | signedout | error
  const [err, setErr] = useState(null);
  const [count, setCount] = useState(9);

  useEffect(() => {
    (async () => {
      try {
        const s = await getSession();
        if (!s.userId) { setState("signedout"); return; }
        const { profile: p, error } = await getMyProfile(s.userId);
        if (error) { setErr(error); setState("error"); return; }
        if (!p) { setState("signedout"); return; }
        setProfile(p);
        setDecks((await myDecks(s.userId)).decks);
        setState("ready");
      } catch (e) {
        setErr(e?.message || "couldn't reach the server"); setState("error");
      }
    })();
  }, []);

  return (
    <>
      <style>{`
        /* size:auto respects whatever paper is loaded — a 3x3 grid of 63mm cards
           is 189mm x 264mm, which clears both Letter and A4 at this margin. */
        @page { size: auto; margin: 5mm; }

        @media print {
          .noprint { display: none !important; }
          html, body, #root { background: #fff !important; }
          /* Without this, browsers helpfully strip background colours and the card
             prints as a white rectangle with a QR code floating in it. */
          .print-sheet, .print-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-sheet { padding: 0 !important; }
          .print-cell { outline: 0.2mm dashed #bbb !important; }
        }

        .print-sheet {
          display: grid;
          grid-template-columns: repeat(auto-fit, 63mm);
          justify-content: center;
          background: #fff;
        }
        /* Cards sit edge to edge on purpose: one cut serves two cards. */
        .print-cell { width: 63mm; height: 88mm; outline: 0.2mm dashed #d6d6d6; }
      `}</style>

      <div style={{ minHeight: "100dvh", background: t.base }}>
        <div className="noprint" style={{
          maxWidth: 460, margin: "0 auto", padding: "22px 20px 18px",
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          <a href="/" style={{ ...mono, fontSize: 11, color: t.dim, textDecoration: "none" }}>
            ← back
          </a>

          {state === "loading" && <span style={{ ...mono, fontSize: 12, color: t.dim }}>loading…</span>}

          {state === "signedout" && (
            <span style={{ fontSize: 14, lineHeight: 1.65, color: t.white }}>
              sign in and claim a screen name first — <a href="/" style={{ color: t.accent }}>go back</a>.
            </span>
          )}

          {state === "error" && (
            <div style={{ padding: 12, border: `1px solid ${t.red}`, ...mono, fontSize: 11, color: t.red, lineHeight: 1.7 }}>
              {err}
            </div>
          )}

          {state === "ready" && (
            <>
              <span style={{ fontSize: 14, lineHeight: 1.65, color: t.white }}>
                these print at <strong>63&thinsp;×&thinsp;88&nbsp;mm</strong> — real card size. cut on
                the guides and they fit a standard sleeve.
              </span>

              <div style={{ display: "flex", gap: 8 }}>
                {COUNTS.map(n => (
                  <button key={n} onClick={() => setCount(n)} style={{
                    flex: 1, minHeight: 44, background: "transparent",
                    border: `1px solid ${count === n ? t.accent : t.muted}`,
                    color: count === n ? t.accent : t.dim,
                    ...mono, fontSize: 11, cursor: "pointer",
                  }}>
                    {n === 1 ? "just one" : `${n} per sheet`}
                  </button>
                ))}
              </div>

              <button onClick={() => window.print()} style={{
                minHeight: 46, background: "transparent",
                border: `1px solid ${t.accent}`, color: t.accent,
                ...mono, fontSize: 12, cursor: "pointer",
              }}>
                print
              </button>

              {/* Said once, because it is the one setting that ruins the output and
                  it is off by default in most print dialogs. */}
              <span style={{ ...mono, fontSize: 10, color: t.dim, lineHeight: 1.7 }}>
                in the print dialog, turn ON &ldquo;background graphics&rdquo; and set scale
                to 100% — otherwise the card prints blank and at the wrong size.
              </span>
            </>
          )}
        </div>

        {state === "ready" && (
          <div className="print-sheet" style={{ padding: "0 12px 40px" }}>
            {Array.from({ length: count }, (_, i) => (
              <div className="print-cell" key={i}>
                <BadgeCard card={profile} decks={decks} width="63mm" flat />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
