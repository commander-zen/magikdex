import { useEffect, useState } from "react";
import { bevel, INK, PAPER, SUBTLE, aimBtn } from "../ui/aim.jsx";
import BadgeCard from "../components/BadgeCard.jsx";
import { getSession, getMyProfile } from "../lib/trainer.js";

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

        /* EXACTLY THREE COLUMNS, never auto-fit.
           auto-fit sizes the grid to the VIEWPORT, so nine cards became four or
           five across on a desktop and the on-screen sheet did not match the
           page at all. A proxy sheet is a 3×3 and has to look like one before
           you commit ink to it. 3 × 63mm = 189mm and 3 × 88mm = 264mm, which
           clears both Letter (206 × 269mm printable) and A4 (200 × 287mm) at the
           5mm margin set above — so the fixed grid is also the largest that
           still fits, not an arbitrary choice.
           The column count is overridden inline for the single-card option. */
        .print-sheet {
          display: grid;
          grid-template-columns: repeat(3, 63mm);
          justify-content: center;
          background: #fff;
        }
        /* Cards sit edge to edge on purpose: one cut serves two cards. */
        .print-cell { width: 63mm; height: 88mm; outline: 0.2mm dashed #d6d6d6; }
      `}</style>

      <div style={{ minHeight: "100dvh", background: "#08090c" }}>
        <div className="noprint" style={{ maxWidth: 420, margin: "0 auto", padding: "18px 16px" }}>
          {/* An AIM window, like every other surface in ritual. The page ground
              stays the dark desktop; the window is the paper. */}
          <div style={{
            background: PAPER, border: `2px solid ${INK}`, borderRadius: 12,
            padding: 10, display: "flex", flexDirection: "column", gap: 10,
            boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
          }}>
            <div style={{ ...bevel, padding: "4px 8px 4px 16px", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "'Zilla Slab', serif", fontSize: 22, fontWeight: 600, color: INK }}>
                print &amp; sleeve
              </span>
              <a href="/" aria-label="Back" style={{ fontSize: 16, color: INK, textDecoration: "none", padding: "8px 6px" }}>&larr;</a>
            </div>

            <div style={{ padding: "4px 6px 6px", display: "flex", flexDirection: "column", gap: 12 }}>
              {state === "loading" && <span style={{ fontSize: 15, color: SUBTLE }}>loading…</span>}

              {state === "signedout" && (
                <span style={{ fontSize: 15, lineHeight: 1.6, color: INK }}>
                  sign in and claim a screen name first — <a href="/" style={{ color: "#1e4f8a" }}>go back</a>.
                </span>
              )}

              {state === "error" && (
                <div style={{ padding: 10, border: `2px solid #a3261a`, borderRadius: 8, fontSize: 14, color: "#a3261a", lineHeight: 1.6 }}>
                  {err}
                </div>
              )}

              {state === "ready" && (
                <>
                  <span style={{ fontSize: 15, lineHeight: 1.6, color: INK }}>
                    these print at <strong>63&thinsp;×&thinsp;88&nbsp;mm</strong> — real card size. cut on
                    the guides and they fit a standard sleeve.
                  </span>

                  <div style={{ display: "flex", gap: 8 }}>
                    {COUNTS.map(n => (
                      <button key={n} onClick={() => setCount(n)} style={{
                        ...aimBtn(count === n, false),
                        // The chosen option is pressed IN — an inverted bevel.
                        // On paper chrome a colour change alone is too quiet to
                        // read as state.
                        background: count === n ? "#e6e1d4" : undefined,
                        boxShadow: count === n
                          ? "inset 0 2px 3px rgba(0,0,0,0.28)"
                          : undefined,
                      }}>
                        {n === 1 ? "just one" : "3 × 3 sheet"}
                      </button>
                    ))}
                  </div>

                  <button onClick={() => window.print()} style={{ ...aimBtn(true, false), minHeight: 48 }}>
                    print
                  </button>

                  {/* Said once, because it is the one setting that ruins the output and
                      it is off by default in most print dialogs. */}
                  <span style={{ fontSize: 13, color: SUBTLE, lineHeight: 1.6 }}>
                    in the print dialog, turn ON &ldquo;background graphics&rdquo; and set scale
                    to 100% — otherwise the card prints blank and at the wrong size.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {state === "ready" && (
          <div className="print-sheet" style={{
            padding: "0 12px 40px",
            // One card should not sit in the left column of an empty 3-wide
            // grid — collapse to a single column so it centres.
            gridTemplateColumns: count === 1 ? "63mm" : undefined,
          }}>
            {Array.from({ length: count }, (_, i) => (
              <div className="print-cell" key={i}>
                <BadgeCard card={profile} width="63mm" flat />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
