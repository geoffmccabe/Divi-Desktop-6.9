// Divi Rebels on the web: the PROOF page for refactor phase A5.
//
// Not the web version. It exists to prove that the same game the app runs can
// be mounted outside the app with nothing but a door: a globe, a HUD, and a
// stand-in that answers the door's questions. The real web door (LW-SSO
// sign-in, the Scanner's node list, cash-out) replaces the stand-in in Stage B.
// See docs/DIVI-REBELS-REFACTOR-STAGE-A.md.
//
// It never joins the live room unless the address carries ?room=1, so opening
// it by accident can never put a pretend player into the real sky.

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { GlobeMap, type GlobePoint } from "../wallet/GlobeMap";
import { createRebels, RebelsHud, setPlatform, HEADLESS, type RebelsController } from "../wallet/rebels/platform/coreEntry";
import { DEFAULT_ROOM_BASE } from "../wallet/rebels/platform/defaults";

/** The Scanner node in London: where web players will launch from. */
const SCANNER_IP = "109.228.38.104";

/* Four towers: the Scanner as home, and three stand-ins far apart on the
   documentation address range, so nothing here names a real node. */
const TOWERS: GlobePoint[] = [
  { ip: SCANNER_IP, lat: 51.5074, lng: -0.1278, kind: "self", city: "London", country: "United Kingdom" },
  { ip: "203.0.113.10", lat: 40.7128, lng: -74.006, kind: "peer", city: "New York", country: "United States" },
  { ip: "203.0.113.20", lat: 1.3521, lng: 103.8198, kind: "peer", city: "Singapore", country: "Singapore" },
  { ip: "203.0.113.30", lat: -23.5505, lng: -46.6333, kind: "peer", city: "Sao Paulo", country: "Brazil" },
];

const joinLive = new URLSearchParams(location.search).get("room") === "1";

setPlatform({
  ...HEADLESS,
  id: "web-standin",
  identity: {
    name: () => "web pilot",
    joinFields: (selfIp: string) => ({ node: selfIp || "web pilot", name: "web pilot" }),
  },
  /* A reserved name that never resolves, unless asked for the real room. */
  roomBase: joinLive ? DEFAULT_ROOM_BASE : "wss://room.invalid",
});

const labelFor = (ip: string): string => TOWERS.find((t) => t.ip === ip)?.city ?? ip;

function WebRebels() {
  const [ctl, setCtl] = useState<RebelsController | null>(null);
  useEffect(() => {
    const c = createRebels(labelFor);
    setCtl(c);
    return () => c.dispose();
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <GlobeMap points={TOWERS} arcs={[]} center={{ lat: 51.5074, lon: -0.1278 }} flight={ctl} />
      {ctl && (
        <div className="netmap-game">
          <RebelsHud ctl={ctl} onExit={() => { /* nowhere to go back to on this page */ }} />
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <WebRebels />
    </ThemeProvider>
  </React.StrictMode>,
);
