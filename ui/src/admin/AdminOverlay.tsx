import { useRef, useState } from "react";
import { ADMIN_PANELS } from "./registry";
import "./admin-tabs-nav.css";

// A right-side frosted drawer that hosts the registered admin panels. With one
// panel it just shows it; with several it shows a tab row — no code change.
export function AdminOverlay({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState(ADMIN_PANELS[0].id);
  const active = ADMIN_PANELS.find((p) => p.id === activeId) ?? ADMIN_PANELS[0];
  const dim = active.dim !== false;

  // The tab row scrolls when there are more tabs than fit the narrow drawer; the
  // arrows page it. scrollBy is a no-op when everything already fits.
  const tabsRef = useRef<HTMLDivElement>(null);
  const scrollTabs = (dir: number) => tabsRef.current?.scrollBy({ left: dir * 130, behavior: "smooth" });

  return (
    <div className={dim ? "admin-scrim" : "admin-nodim"} onClick={dim ? onClose : undefined}>
      <aside className="admin-drawer glass-panel" onClick={(e) => e.stopPropagation()}>
        <header className="admin-drawer-head">
          <div className="admin-tabs-nav">
            <button type="button" className="admin-tabs-arrow" aria-label="Scroll tabs left" onClick={() => scrollTabs(-1)}>
              ‹
            </button>
            <div className="admin-tabs" ref={tabsRef}>
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
            <button type="button" className="admin-tabs-arrow" aria-label="Scroll tabs right" onClick={() => scrollTabs(1)}>
              ›
            </button>
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
