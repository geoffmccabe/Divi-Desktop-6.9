import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyIcons } from "./icons";
import { installClickSound } from "./sound";
import "./index.css";

// Install the default icon CSS vars before first paint (a skin overrides them).
applyIcons();
// Instant click tone on any button (waveform/pitch come from the skin).
installClickSound();

function showFatal(msg: string) {
  // Build the DOM, don't interpolate into innerHTML. `msg` is an error stack
  // which can contain attacker-influenced text (a message that flows through an
  // exception), so injecting it as HTML is a DOM-XSS sink. textContent escapes.
  const pre = document.createElement("pre");
  pre.setAttribute(
    "style",
    "color:#ff8080;background:#15111f;margin:0;padding:24px;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;height:100vh",
  );
  pre.textContent = `Divi Desktop failed to start:\n\n${msg}`;
  document.body.replaceChildren(pre);
}
// Browser-generated noise that is not an application failure. "ResizeObserver
// loop completed with undelivered notifications" is emitted by the engine when a
// layout settles over two frames; it is harmless and fires routinely from
// virtualised lists and canvas resizes.
const BENIGN_ERROR = /^ResizeObserver loop/;

// Only blank the screen when the app never came up. Once it has painted, an
// error is logged and the wallet stays usable.
//
// The old behaviour replaced the whole UI on ANY window error, at any point in
// the session, which broke the project's hard rule that the user must never be
// locked out of their own wallet: a stray error twenty minutes in would leave
// them staring at a stack trace with no way back and a running node behind it.
// It matters more now that community apps can raise errors of their own.
function appHasPainted(): boolean {
  const root = document.getElementById("root");
  return !!root && root.childElementCount > 0;
}

window.addEventListener("error", (e) => {
  const ev = e as ErrorEvent;
  if (BENIGN_ERROR.test(ev.message || "")) return;
  const detail = String(ev.error?.stack || ev.message);
  if (appHasPainted()) {
    console.error("[dd69] uncaught error after start:", detail);
    return;
  }
  showFatal(detail);
});

try {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e) {
  showFatal(String(e));
}
