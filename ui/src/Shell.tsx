import { useEffect, useState, type ComponentType } from "react";
import { NAV } from "./nav";
import { resumeStaking } from "./wallet/api";
import { stakingDesired } from "./wallet/stakeWin";
import { togglePrimerPreview } from "./wallet/primerStore";
import { Icon } from "./Icon";
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
import { TokensPanel } from "./wallet/TokensPanel";
import { NetworkMap } from "./wallet/NetworkMap";

const VIEWS: Record<string, ComponentType> = {
  overview: Overview,
  send: SendPanel,
  receive: ReceivePanel,
  history: ActivityList,
  timestamp: TimestampPanel,
  collectibles: CollectiblesPanel,
  tokens: TokensPanel,
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
  // Auto-resume staking on open if it was on before. resumeStaking() uses the
  // password saved in the OS store (if the user opted in) to staking-only unlock
  // an encrypted wallet silently; unencrypted wallets just resume. If nothing is
  // remembered it no-ops — the user starts staking manually and unlocks then.
  useEffect(() => {
    if (stakingDesired()) resumeStaking().catch(() => {});
  }, []);

  const [view, setView] = useState("network");

  // Preview the PrimerLove fast-loader screen (Cmd/Ctrl+Shift+P) until the real
  // download backend drives it. Switches to the network map so it's visible.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        setView("network");
        togglePrimerPreview();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Switching node in My Nodes jumps straight to the network map for that node.
  useEffect(() => {
    const onSwitch = () => setView("network");
    window.addEventListener("dd69:nodeswitch", onSwitch);
    return () => window.removeEventListener("dd69:nodeswitch", onSwitch);
  }, []);

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
          {view !== "network" && (
            <div className="view-title-row">
              <h2 className="view-title">{label}</h2>
              {view === "overview" && (
                <button type="button" className="node-map-btn" onClick={() => setView("network")}>
                  <span>Node Map</span>
                  <Icon name="globe" size={16} />
                </button>
              )}
            </div>
          )}
          <div className="view-body">
            {view === "network" ? <NetworkMap onReturn={() => setView("overview")} /> : <Active />}
          </div>
        </section>
      </div>
    </div>
  );
}
