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
  document.body.innerHTML =
    `<pre style="color:#ff8080;background:#15111f;margin:0;padding:24px;` +
    `font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;height:100vh">` +
    `Divi Desktop failed to start:\n\n${msg}</pre>`;
}
window.addEventListener("error", (e) =>
  showFatal(String((e as ErrorEvent).error?.stack || (e as ErrorEvent).message))
);

try {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e) {
  showFatal(String(e));
}
