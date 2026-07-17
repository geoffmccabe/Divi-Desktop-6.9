import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Until devtools are wired up, make any fatal error visible ON the page
// instead of failing to a blank white window.
function showFatal(msg: string) {
  document.body.innerHTML =
    `<pre style="color:#ff8080;background:#15111f;margin:0;padding:24px;` +
    `font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;height:100vh">` +
    `Divi Desktop failed to start:\n\n${msg}</pre>`;
}
window.addEventListener("error", (e) =>
  showFatal(String((e as ErrorEvent).error?.stack || (e as ErrorEvent).message))
);
window.addEventListener("unhandledrejection", (e) =>
  showFatal("Unhandled promise rejection:\n" + String((e as PromiseRejectionEvent).reason))
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
