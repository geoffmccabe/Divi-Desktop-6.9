// Divi Rebels at divi.love/rebels.
//
// The same game the app runs, mounted behind the web door (webDoor.ts). The page
// finds the Divi network as the Scanner has seen it, draws it on the globe with
// the Scanner in London as home, and opens straight onto the game's own launch
// card: LAUNCH is the play button, no account needed. Signing in comes next and
// will be offered, never required.

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import "./web.css";
import { ThemeProvider } from "../theme/ThemeProvider";
import { GlobeMap, type GlobePoint } from "../wallet/GlobeMap";
import { createRebels, RebelsHud, PhoneHud, createTouchInput, setPlatform, type RebelsController } from "../wallet/rebels/platform/coreEntry";
import { prefetchMusic } from "../wallet/rebels/rebelsMusic";
import { createWebDoor } from "./webDoor";
import { loadTowers, SCANNER } from "./webNodes";
import { restoreGuest } from "./pilot";
import { hydrateWebStorage } from "./webStore";

/* ---- ?phone=1: A PREVIEW OF THE PHONE COCKPIT ----
   Touch controls and the phone layout on this same page, for trying on a phone
   before the phone version has its own door (the build agent's B5, which will
   replace this switch with real phone detection and a phone detail setting).
   Without the switch nothing here changes. */
const touch = new URLSearchParams(window.location.search).has("phone") ? createTouchInput() : null;

setPlatform(createWebDoor({ input: touch ?? undefined }));
prefetchMusic();

/** How long to wait for the node list before opening with the Scanner alone. */
const TOWER_WAIT_MS = 6000;

function WebRebels() {
  const [towers, setTowers] = useState<GlobePoint[] | null>(null);
  const [ctl, setCtl] = useState<RebelsController | null>(null);

  useEffect(() => {
    let alive = true;
    const give = (t: GlobePoint[]) => { if (alive) setTowers((cur) => cur ?? t); };
    let timer: ReturnType<typeof setTimeout> | null = null;
    /* The guest and their progress first, so a returning player is the same
       pilot with the same points, items and banked DIVI before the game reads
       anything or joins the room. Only then may a slow node list be given up on. */
    void restoreGuest().then(() => hydrateWebStorage()).then((storage) => {
      if (!alive) return;
      setPlatform(createWebDoor({ storage, input: touch ?? undefined }));
      timer = setTimeout(() => give([SCANNER]), TOWER_WAIT_MS);
      return loadTowers(import.meta.env.BASE_URL).then(give);
    });
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!towers) return;
    const c = createRebels((ip) => {
      const t = towers.find((p) => p.ip === ip);
      return t?.city ? `${t.city}${t.country ? `, ${t.country}` : ""}` : ip;
    });
    setCtl(c);
    return () => c.dispose();
  }, [towers]);

  /* Leaving the cockpit on the web goes back to the launch card: a fresh game
     on the same globe. */
  const again = () => setCtl((cur) => {
    cur?.dispose();
    return createRebels((ip) => towers?.find((p) => p.ip === ip)?.city ?? ip);
  });

  if (!towers) {
    return (
      <div className="web-rebels-wait">
        <span>FINDING THE DIVI NETWORK</span>
      </div>
    );
  }
  return (
    <div className="web-rebels">
      <GlobeMap points={towers} arcs={[]} center={{ lat: SCANNER.lat, lon: SCANNER.lng }} flight={ctl} />
      {ctl && (
        <div className="netmap-game">
          {touch ? <PhoneHud ctl={ctl} touch={touch} onExit={again} /> : <RebelsHud ctl={ctl} onExit={again} />}
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
