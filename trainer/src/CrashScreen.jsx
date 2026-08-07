import { Component } from "react";

// A black screen that reports nothing is the worst failure state this app can
// have — it happened, on a device with no debugger attached, and cost hours of
// guessing because there was no way to ask the phone what broke.
//
// This turns any crash into readable text on the device itself. No Mac, no
// Web Inspector, no USB cable: reload, read, screenshot.
//
// Two mechanisms, because they catch different things:
//   ErrorBoundary (here)      — errors thrown during React render/lifecycle
//   crashHandler.js           — everything else: module-eval errors that stop
//                               React mounting at all, and unhandled rejections
//
// Deliberately plain DOM and inline styles with no imports from the theme: if
// the crash IS in the theme or in a shared module, anything this file depends on
// might be the thing that is broken.

const BOX = {
  position: "fixed", inset: 0, zIndex: 2147483647,
  background: "#08090c", color: "#e8eaed",
  font: "12px/1.6 ui-monospace, 'Noto Sans Mono', monospace",
  padding: "24px 16px calc(env(safe-area-inset-bottom) + 24px)",
  overflow: "auto", WebkitOverflowScrolling: "touch",
};


export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Also log it, so a device that DOES have a console attached gets the full
    // object rather than the stringified version below.
    console.error("[trainer crash]", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    const detail = [
      String(e && (e.stack || e.message || e)),
      this.state.info?.componentStack ? "\ncomponent stack:" + this.state.info.componentStack : "",
    ].join("\n");
    // Rendered as React here (rather than the DOM helper) because at this point
    // React is alive — it is the tree below that failed.
    return (
      <div style={BOX}>
        <div style={{ color: "#e0555f", letterSpacing: "0.14em", marginBottom: 14 }}>
          TRAINER CRASHED
        </div>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, font: "inherit" }}>
          {detail}
        </pre>
        <div style={{ marginTop: 18, color: "#5a6672" }}>screenshot this</div>
      </div>
    );
  }
}
