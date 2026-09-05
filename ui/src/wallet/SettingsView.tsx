import { useState } from "react";
import { PasswordPanel } from "./PasswordPanel";
import { CoinMaturity } from "./CoinMaturity";
import { MyNodes } from "./MyNodes";
import { LogsPanel } from "./LogsPanel";

// Settings: real tabs — one panel shown at a time below a fixed tab row. (It used
// to be a scroll-stack with scroll-spy, which let content slide under the tabs and
// switched tabs while scrolling.)
const TABS = [
  { id: "nodes", label: "My Nodes" },
  { id: "password", label: "Password" },
  { id: "maturity", label: "Coin Maturity" },
  { id: "logs", label: "Logs" },
];

export function SettingsView() {
  const [active, setActive] = useState("nodes");

  return (
    <div className="settings-view">
      <div className="set-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={"set-tab" + (active === t.id ? " set-tab-active" : "")}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="set-body">
        {active === "nodes" && <MyNodes />}
        {active === "password" && <PasswordPanel />}
        {active === "maturity" && <CoinMaturity />}
        {active === "logs" && <LogsPanel />}
      </div>
    </div>
  );
}
