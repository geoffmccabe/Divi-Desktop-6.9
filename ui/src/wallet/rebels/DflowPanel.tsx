// The DFlow panel: what the collector sees, live, and a button that puts the
// whole report on the clipboard for Geoff to paste.
//
// Toggled with `#`. Drawn as one of the game's own panels (see orbit.css,
// .dflow), in the HUD's colour and type, not as a developer overlay: it is
// part of the cockpit while it is open.

import { useEffect, useState } from "react";
import { dflow, STALL_MS } from "./rebelsDflow";

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
        <span>{f(live.seconds, 0)}s · {live.frames} frames</span>
        <div className="dflow-actions">
          <button type="button" onClick={() => void copy()}>{copied === "ok" ? "COPIED" : copied === "fail" ? "COPY FAILED" : "COPY REPORT"}</button>
          <button type="button" onClick={() => dflow.reset()}>RESET</button>
          <button type="button" onClick={onClose}>CLOSE</button>
        </div>
      </div>

      <div className="dflow-grid">
        <section>
          <h5>FRAME</h5>
          <div className="dflow-big">{f(live.fps, 0)} <em>fps</em></div>
          <div>avg <b>{f(live.dtAvg)}ms</b> · worst 5s <b>{f(live.dtMax)}ms</b></div>
          <div>stalls over {STALL_MS}ms <b className={live.stalls ? "warn" : ""}>{live.stalls}</b></div>
          <div>shader compiles <b className={live.compiles ? "warn" : ""}>{live.compiles}</b></div>
        </section>
        <section>
          <h5>OUR TIME, THIS HALF SECOND</h5>
          {live.top.length === 0 && <div className="dflow-dim">nothing yet</div>}
          {live.top.map(([name, ms]) => (
            <div key={name} className="dflow-row">
              <span>{name}</span>
              <i style={{ width: `${Math.min(100, ms * 12)}%` }} />
              <b>{f(ms, 2)}</b>
            </div>
          ))}
        </section>
        <section>
          <h5>IN THE SKY</h5>
          <div>enemies <b>{c.enemies}</b> · drones <b>{c.drones}</b> · flocks <b>{c.flocks}</b></div>
          <div>bullets <b>{c.bullets}</b> · tracers <b>{c.tracers}</b> · beams <b>{c.beams}</b></div>
          <div>coins <b>{c.coins}</b> · gems <b>{c.gems}</b> · junk <b>{c.junk}</b> · torps <b>{c.torps}</b></div>
          <div>peers <b>{c.peers}</b> · hull meshes <b>{c.meshes}</b></div>
        </section>
        <section>
          <h5>RENDERER</h5>
          <div>draw calls <b>{r.calls}</b> · triangles <b>{r.triangles.toLocaleString()}</b></div>
          <div>programs <b>{r.programs}</b> · geometries <b>{r.geometries}</b> · textures <b>{r.textures}</b></div>
          <div>pixel ratio <b>{r.ratio}x</b></div>
        </section>
        <section>
          <h5>ROOM</h5>
          <div>status <b>{live.room}</b></div>
          <div>{live.net.msgs} msgs/½s · {f(live.net.bytes / 1024)} KB/½s</div>
          <div>state message <b>{live.net.state}</b> bytes</div>
        </section>
        <section>
          <h5>AUDIO</h5>
          <div>bus level <b>{f(live.audio, 4)}</b></div>
        </section>
      </div>
      <p className="dflow-foot">
        Fly for a while, make the thing that lags happen, then COPY REPORT and paste it. The report holds five minutes,
        every stall with what was running in it, and a raw half-second table.
      </p>
    </div>
  );
}
