import { useState, type ComponentType } from "react";
import { NAV } from "./nav";
import { Sidebar } from "./Sidebar";
import { StatusPanel } from "./StatusPanel";
import { BalanceCard } from "./wallet/BalanceCard";
import { Overview } from "./wallet/Overview";
import { SendPanel } from "./wallet/SendPanel";
import { ReceivePanel } from "./wallet/ReceivePanel";
import { ActivityList } from "./wallet/ActivityList";
import { AddressBook } from "./wallet/AddressBook";
import { SettingsView } from "./wallet/SettingsView";

const VIEWS: Record<string, ComponentType> = {
  overview: Overview,
  send: SendPanel,
  receive: ReceivePanel,
  history: ActivityList,
  addressbook: AddressBook,
  settings: SettingsView,
};

// Four independent panels: nav (top-left), node status (bottom-left, chopped
// off the sidebar), balances (top-right header), and the main content.
export function Shell() {
  const [view, setView] = useState("overview");
  const Active = VIEWS[view] ?? Overview;
  const label = NAV.find((n) => n.id === view)?.label ?? "";

  return (
    <div className="shell">
      <div className="col-left">
        <Sidebar active={view} onSelect={setView} />
        <aside className="glass-panel status-panel">
          <StatusPanel />
        </aside>
      </div>
      <div className="col-right">
        <header className="glass-panel header-panel">
          <BalanceCard />
        </header>
        <section className="glass-panel main-panel">
          <h2 className="view-title">{label}</h2>
          <div className="view-body">
            <Active />
          </div>
        </section>
      </div>
    </div>
  );
}
