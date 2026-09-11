// The DFlow panel: what the collector sees, live, and a button that puts the
// whole report on the clipboard for Geoff to paste.
//
// Toggled with `#`. Drawn as one of the game's own panels (see orbit.css,
// .dflow), in the HUD's colour and type, not as a developer overlay: it is
// part of the cockpit while it is open.

import { useEffect, useState } from "react";
import { dflow } from "./rebelsDflow";

export function DflowPanel({ onClose }: { onClose: () => void }) {
  const [live, setLive] = useState(() => dflow.live());
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");

  useEffect(() => {
    const t = setInterval(() => setLive(dflow.live()), 500);
    return () => clearInterval(t);
  }, []);

  const copy = async () => {
    const text = dflow.report();
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      /* Some webviews refuse the clipboard: fall back to a selectable box
         the user can copy by hand. */
      setCopied("fail");
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied("ok"); } catch { /* shown as failed */ }
      ta.remove();
    }
    setTimeout(() => setCopied(""), 2500);
  };

  const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "-");
  const c = live.counts, r = live.render;

  return (
    <div className="dflow" role="dialog" aria-label="DFlow">
      <div className="dflow-head">
        <b>DFLOW</b>
        <span>{f(live.seconds, 0)}s</span>
        <div className="dflow-actions">
          <button type="button" onClick={() => void copy()}>{copied === "ok" ? "COPIED" : copied === "fail" ? "FAILED" : "COPY"}</button>
          <button type="button" onClick={() => dflow.reset()}>RESET</button>
          <button type="button" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="dflow-line"><b>{f(live.fps, 0)}</b> fps · {f(live.dtAvg)}ms · worst {f(live.dtMax, 0)}ms</div>
      <div className="dflow-line">stalls <b className={live.stalls ? "warn" : ""}>{live.stalls}</b> · compiles <b className={live.compiles ? "warn" : ""}>{live.compiles}</b> · calls <b>{r.calls}</b> · progs <b>{r.programs}</b></div>
      <div className="dflow-line">enemies <b>{c.enemies}</b> · drones <b>{c.drones}</b> · bullets <b>{c.bullets}</b> · coins <b>{c.coins}</b> · gems <b>{c.gems}</b></div>
      <div className="dflow-line">room <b>{live.room}</b> · {live.net.msgs} msg/½s · {f(live.net.bytes / 1024)} KB · audio {f(live.audio, 3)}</div>
      {live.top.slice(0, 5).map(([name, ms]) => (
        <div key={name} className="dflow-row">
          <span>{name}</span>
          <i style={{ width: `${Math.min(100, ms * 12)}%` }} />
          <b>{f(ms, 2)}</b>
        </div>
      ))}
    </div>
  );
}
