import { useEffect, useState } from "react";
import { NAV } from "./nav";
import { Icon } from "./Icon";
import { AdminGear } from "./admin/AdminGear";
import { updateCheck, type UpdateInfo } from "./wallet/api";
import { UpdateModal } from "./UpdateModal";
import logo from "./assets/divi-logo.png";

export function Sidebar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const [upd, setUpd] = useState<UpdateInfo | null>(null);
  const [flashOn, setFlashOn] = useState(false); // toggles the version/UPDATE swap
  const [modal, setModal] = useState(false);

  /* ── HOW OFTEN TO LOOK FOR A RELEASE ──────────────────────────────────
     This used to ask on mount and then once an HOUR. A release published
     while the wallet is open therefore stayed invisible for up to sixty
     minutes, and Geoff hit that twice: "I'm on 13.1 and it's not asking for
     an update", with the new version sitting on the server the whole time.

     What is being fetched is a sixty-byte JSON file. Asking every ten
     minutes costs nothing measurable, and asking again whenever the window
     comes back to the front means that stepping away and returning -- which
     is exactly what someone does while waiting for a build -- picks it up
     at once. */
  useEffect(() => {
    const check = () => updateCheck().then(setUpd).catch(() => {});
    check();
    const id = setInterval(check, 10 * 60 * 1000);
    const onFocus = () => check();
    const onVisible = () => document.visibilityState === "visible" && check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // When an update is available, flash between the version and "UPDATE TO vX".
  useEffect(() => {
    if (!upd?.available) return;
    const id = setInterval(() => setFlashOn((v) => !v), 1300);
    return () => clearInterval(id);
  }, [upd?.available]);

  const canUpdate = !!upd?.available;

  return (
    <nav className="glass-panel sidebar">
      <div className="sidebar-brand">
        <img className="brand-logo" src={logo} alt="" />
        <h1>Divi Desktop</h1>
        {canUpdate ? (
          <button
            type="button"
            className={"ver ver-update" + (flashOn ? " ver-flash" : "")}
            onClick={() => setModal(true)}
            title={`Update available: v${upd?.latest}`}
          >
            {flashOn ? `UPDATE TO v${upd?.latest}` : `v${__APP_VERSION__}`}
          </button>
        ) : (
          <span className="ver">v{__APP_VERSION__}</span>
        )}
      </div>
      <ul className="nav">
        {NAV.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className={"nav-item" + (n.id === active ? " nav-item-active" : "")}
              onClick={() => onSelect(n.id)}
            >
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <AdminGear />
      {modal && upd && <UpdateModal info={upd} onClose={() => setModal(false)} />}
    </nav>
  );
}
