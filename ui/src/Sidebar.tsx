import { NAV } from "./nav";
import { Icon } from "./Icon";
import { AdminGear } from "./admin/AdminGear";
import logo from "./assets/divi-logo.png";

export function Sidebar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="glass-panel sidebar">
      <div className="sidebar-brand">
        <img className="brand-logo" src={logo} alt="" />
        <h1>Divi Desktop</h1>
        <span className="ver">6.9</span>
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
    </nav>
  );
}
