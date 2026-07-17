import { useState, type ComponentType } from "react";
import { NAV } from "./nav";
import { Sidebar } from "./Sidebar";
import { StatusPanel } from "./StatusPanel";
import { HeaderBar } from "./wallet/HeaderBar";
import { Overview } from "./wallet/Overview";
import { SendPanel } from "./wallet/SendPanel";
import { ReceivePanel } from "./wallet/ReceivePanel";
import { ActivityList } from "./wallet/ActivityList";
import { AddressBook } from "./wallet/AddressBook";
import { SettingsView } from "./wallet/SettingsView";
import { TimestampPanel } from "./wallet/TimestampPanel";
import { CollectiblesPanel } from "./wallet/CollectiblesPanel";
import { NetworkMap } from "./wallet/NetworkMap";

const VIEWS: Record<string, ComponentType> = {
  overview: Overview,
  send: SendPanel,
  receive: ReceivePanel,
  history: ActivityList,
  timestamp: TimestampPanel,
  collectibles: CollectiblesPanel,
  addressbook: AddressBook,
  settings: SettingsView,
  network: NetworkMap,
};

// Views reachable without a sidebar entry (e.g. the Peers globe icon).
const EXTRA_TITLES: Record<string, string> = { network: "Network Map" };

// Four independent panels: nav (top-left), node status (bottom-left, chopped
// off the sidebar), balances (top-right header), and the main content.
export function Shell() {
  // Boot into the network map — a nice "finding peers" intro; the map's own
  // Return-to-Overview button (and any nav click) leaves it.
  const [view, setView] = useState("network");
  const Active = VIEWS[view] ?? Overview;
  const label = NAV.find((n) => n.id === view)?.label ?? EXTRA_TITLES[view] ?? "";

  return (
    <div className="shell">
      <div className="col-left">
        <Sidebar active={view} onSelect={setView} />
        <aside className="glass-panel status-panel">
          <StatusPanel onOpenNetwork={() => setView("network")} />
        </aside>
      </div>
      <div className="col-right">
        <header className="header-panel">
          <HeaderBar />
        </header>
        <section className="glass-panel main-panel">
          {view !== "network" && <h2 className="view-title">{label}</h2>}
          <div className="view-body">
            {view === "network" ? <NetworkMap onReturn={() => setView("overview")} /> : <Active />}
          </div>
        </section>
      </div>
    </div>
  );
}
