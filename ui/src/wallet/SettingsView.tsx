import { useEffect, useRef, useState, type ReactNode } from "react";
import { PasswordPanel } from "./PasswordPanel";
import { CoinMaturity } from "./CoinMaturity";
import { MyNodes } from "./MyNodes";

// Settings: stacked panels (Password, Coin Maturity). Chain Health lives in
// the Admin drawer instead — its node check is expensive and admin-only. The
// tab row jumps to a panel by smooth-scrolling to it; you can also just scroll.
const TABS = [
  { id: "nodes", label: "My Nodes" },
  { id: "password", label: "Password" },
  { id: "maturity", label: "Coin Maturity" },
];

export function SettingsView() {
  const [active, setActive] = useState("nodes");
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const jump = (id: string) => {
    setActive(id);
    refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Scroll-spy: keep the active tab in sync as the user scrolls manually.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.getAttribute("data-panel");
        if (id) setActive(id);
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );
    Object.values(refs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const panel = (id: string, node: ReactNode) => (
    <div className="set-panel-wrap" data-panel={id} ref={(el) => (refs.current[id] = el)}>
      {node}
    </div>
  );

  return (
    <div className="settings-view">
      <div className="set-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={"set-tab" + (active === t.id ? " set-tab-active" : "")}
            onClick={() => jump(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {panel("nodes", <MyNodes />)}
      {panel("password", <PasswordPanel />)}
      {panel("maturity", <CoinMaturity />)}

      <section className="set-section">
        <h3 className="set-title">Appearance</h3>
        <p className="set-note">
          For appearance and skins, open the Style editor with the gear in the bottom-right corner.
        </p>
      </section>
    </div>
  );
}
