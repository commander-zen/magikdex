// Global crash handler — see CrashScreen.jsx for why this exists.
//
// Split into its own module purely because a file that exports both a
// component and a plain function breaks React Fast Refresh.
//
// Deliberately plain DOM with no imports: if the crash IS in the theme or a
// shared module, anything this file depended on might be the broken thing.

const BOX = {
  position: "fixed", inset: 0, zIndex: 2147483647,
  background: "#08090c", color: "#e8eaed",
  font: "12px/1.6 ui-monospace, 'Noto Sans Mono', monospace",
  padding: "24px 16px calc(env(safe-area-inset-bottom) + 24px)",
  overflow: "auto", WebkitOverflowScrolling: "touch",
};

function render(target, title, detail) {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, BOX);

  const h = document.createElement("div");
  h.textContent = title;
  Object.assign(h.style, { color: "#e0555f", letterSpacing: "0.14em", marginBottom: 14 });

  const pre = document.createElement("pre");
  pre.textContent = detail;
  Object.assign(pre.style, {
    whiteSpace: "pre-wrap", wordBreak: "break-word",
    margin: 0, font: "inherit", color: "#e8eaed",
  });

  const hint = document.createElement("div");
  hint.textContent = "screenshot this";
  Object.assign(hint.style, { marginTop: 18, color: "#5a6672" });

  wrap.append(h, pre, hint);
  target.appendChild(wrap);
}

// Catches what the boundary cannot: a throw during module evaluation (React never
// mounts, so there is no boundary yet) and unhandled promise rejections.
//
// Guarded on #root still being empty so this never paints over a working app —
// a rejected background fetch should not blank a screen that rendered fine.
export function installGlobalCrashHandler() {
  const root = document.getElementById("root");
  let shown = false;

  const show = (title, detail) => {
    if (shown) return;
    if (root && root.children.length > 0) return; // app mounted — not fatal
    shown = true;
    render(document.body, title, detail);
  };

  window.addEventListener("error", (ev) => {
    const e = ev.error;
    show("TRAINER FAILED TO START", String((e && (e.stack || e.message)) || ev.message || ev));
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    show("TRAINER FAILED TO START", String((r && (r.stack || r.message)) || r));
  });

  // A blank screen with no error at all — the app simply never mounted. Without
  // this the page just stays black and silent, which is the exact state that
  // cost hours.
  setTimeout(() => {
    if (root && root.children.length === 0) {
      show("TRAINER DID NOT MOUNT",
        "No error was reported, and #root is still empty.\n\n" +
        "url: " + location.href + "\n" +
        "ua: " + navigator.userAgent);
    }
  }, 6000);
}
