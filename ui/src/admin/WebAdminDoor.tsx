// The admin door on a public page.
//
// Nothing here is shown to a player. The gear appears only when the server has
// said that the credential in this browser belongs to an admin (adminAccess.ts),
// and the drawer it opens offers the four panels that work outside the desktop
// app (webPanels.tsx).
//
// THE FIRST VISIT, AND WHY THERE IS A DOOR AT ALL. The server cannot recognise
// an admin who has never typed the secret in this browser, so there has to be
// one way in that does not depend on being recognised yet: /rebels/?admin=1
// shows the gear for that visit alone. It grants nothing. Every panel behind it
// still refuses to save without the secret, exactly as it does in the app, and
// the secret is checked by the database and not by this page. Once it has been
// typed and the server has confirmed it, the gear is simply there on the next
// visit, with no query string, and /rebels/?admin=0 takes it away again.
//
// THE PANELS ARE A SEPARATE CHUNK, loaded when the gear is clicked, so a player
// who will never see the gear never downloads a byte of them.

import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { accountCall } from "../wallet/rebels/rebelsAccount";
import {
  checkRole, doorAsk, forgetRole, rememberedRole, type AdminRole, type DoorAsk,
} from "./adminAccess";
import "./web-admin.css";

const WebAdminPanels = lazy(() => import("./WebAdminPanels"));

/* The gear, drawn here rather than through <Icon> on purpose: the icon
   variables are installed by the desktop app's entry point (main.tsx calls
   applyIcons) and do not exist on the web page, so a masked icon would be an
   invisible button. The shape is the app's own gear, copied from icons.ts, so
   the two doors look like the same door. */
const GEAR = "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z";

function Gear() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d={GEAR} />
    </svg>
  );
}

export function WebAdminDoor() {
  const [ask] = useState<DoorAsk>(() => doorAsk(window.location.search));
  const [role, setRole] = useState<AdminRole | null>(() => (ask === "out" ? null : rememberedRole()));
  const [open, setOpen] = useState(false);

  /* Asked on every load, so an admin secret that has been changed closes the
     door on the next visit without anybody clearing anything. */
  useEffect(() => {
    if (ask === "out") { forgetRole(); setRole(null); return; }
    let alive = true;
    void checkRole(accountCall).then((r) => { if (alive) setRole(r); });
    return () => { alive = false; };
  }, [ask]);

  if (role === null && ask !== "in") return null;

  return (
    <div className="web-admin">
      <button
        type="button"
        aria-label="Open admin settings"
        className="admin-gear web-admin-gear"
        onClick={() => setOpen(true)}
      >
        <Gear />
      </button>
      {open &&
        createPortal(
          <Suspense fallback={null}>
            <WebAdminPanels onClose={() => setOpen(false)} />
          </Suspense>,
          document.body,
        )}
    </div>
  );
}
