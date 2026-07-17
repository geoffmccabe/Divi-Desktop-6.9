import { useState } from "react";
import { ADMIN_PANELS } from "./registry";

// A right-side frosted drawer that hosts the registered admin panels. With one
// panel it just shows it; with several it shows a tab row — no code change.
export function AdminOverlay({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState(ADMIN_PANELS[0].id);
  const active = ADMIN_PANELS.find((p) => p.id === activeId) ?? ADMIN_PANELS[0];

  return (
    <div className="admin-scrim" onClick={onClose}>
      <aside className="admin-drawer glass-panel" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <div className="admin-tabs">
            {ADMIN_PANELS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={"admin-tab" + (p.id === active.id ? " admin-tab-active" : "")}
                onClick={() => setActiveId(p.id)}
              >
                {p.title}
              </button>
            ))}
          </div>
          <button type="button" className="admin-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="admin-body">{active.render()}</div>
      </aside>
    </div>
  );
}
