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

  // Ask once on mount whether a newer build is published for this OS.
  useEffect(() => {
    updateCheck().then(setUpd).catch(() => {});
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
