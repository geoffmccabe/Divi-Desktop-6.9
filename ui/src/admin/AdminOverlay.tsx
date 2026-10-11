import { useRef, useState } from "react";
import type { AdminPanel } from "./registry";
import "./admin-tabs-nav.css";

// A right-side frosted drawer that hosts the registered admin panels. With one
// panel it just shows it; with several it shows a tab row, no code change.
//
// THE PANEL LIST IS PASSED IN, never imported. The desktop app hands over the
// whole registry; the public web page hands over only the panels that work
// there (webPanels.tsx). Importing the registry here instead would put every
// panel, and so the desktop app's own bridge, into the web page's bundle, which
// the boundary guard refuses for good reason.
export function AdminOverlay({
  panels,
  onClose,
  initialPanel,
}: {
  /** The panels this door offers, most important first. */
  panels: AdminPanel[];
  onClose: () => void;
  /** Open straight to this panel, when something sent the person here for it. */
  initialPanel?: string;
}) {
  const [activeId, setActiveId] = useState(
    initialPanel && panels.some((p) => p.id === initialPanel)
      ? initialPanel
      : panels[0].id,
  );
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
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
              {panels.map((p) => (
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
