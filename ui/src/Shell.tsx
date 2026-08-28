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
import { CommunityApps } from "./apps/CommunityApps";
import { BuilderPanel } from "./builder/BuilderPanel";
import { SettingsView } from "./wallet/SettingsView";
import { TimestampPanel } from "./wallet/TimestampPanel";
import { CollectiblesPanel } from "./wallet/CollectiblesPanel";
import { TokensPanel } from "./wallet/TokensPanel";
import { HraPanel } from "./wallet/HraPanel";
import { GovernancePreview } from "./wallet/governance/GovernancePreview";
import { MultisigPanel } from "./wallet/multisig/MultisigPanel";
import "./sidebar-compact.css";
import { AgentPanel } from "./wallet/AgentPanel";
import { NetworkMap } from "./wallet/NetworkMap";
import { PriceChart } from "./wallet/PriceChart";
import { FastReceiveHost } from "./wallet/FastReceiveHost";

const VIEWS: Record<string, ComponentType> = {
  overview: Overview,
  send: SendPanel,
  receive: ReceivePanel,
  history: ActivityList,
  agent: AgentPanel,
  timestamp: TimestampPanel,
  collectibles: CollectiblesPanel,
  tokens: TokensPanel,
  governance: GovernancePreview,
  multisig: MultisigPanel,
  hra: HraPanel,
  appbuilder: BuilderPanel,
  communityapps: CommunityApps,
  addressbook: AddressBook,
  settings: SettingsView,
  network: NetworkMap,
};

// Views reachable without a sidebar entry (e.g. the Peers globe icon).
const EXTRA_TITLES: Record<string, string> = { network: "Network Map", charts: "Charts" };

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

  // Focus mode: an app asked for the whole window, so the sidebar and header
  // fold away to thin tabs. Driven by an event rather than a prop so a panel
  // several levels down can ask for it without threading state through.
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setFocus(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener("dd69:focusmode", on);
    return () => window.removeEventListener("dd69:focusmode", on);
  }, []);
  // Leaving the view that asked for it must always restore the wallet, so no
  // app can leave someone stuck looking at thin strips.
  useEffect(() => { setFocus(false); }, [view]);

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

  // The Contacts panel's Send button jumps to the Send view (SendPanel reads the
  // stashed recipient on its own dd69:sendto listener).
  useEffect(() => {
    const onSendTo = () => setView("send");
    window.addEventListener("dd69:sendto", onSendTo);
    return () => window.removeEventListener("dd69:sendto", onSendTo);
  }, []);

  const Active = VIEWS[view] ?? Overview;
  const label = (NAV.find((n) => n.id === view)?.label ?? EXTRA_TITLES[view] ?? "").replace(/\n/g, " ");

  return (
    <div className={focus ? "shell shell-focus" : "shell"}>
      <FastReceiveHost onGoto={setView} />
      <div className="col-left">
        <button
          type="button"
          className="chrome-tab"
          title="Show the menu"
          aria-label="Show the menu"
          onClick={() => setFocus(false)}
        >
          <Icon name="chevronRight" size={14} />
        </button>
        <Sidebar active={view} onSelect={setView} />
        <aside className="glass-panel status-panel">
          <StatusPanel onOpenNetwork={() => setView("network")} />
        </aside>
      </div>
      <div className="col-right">
        <header className="header-panel">
          <button
            type="button"
            className="chrome-tab"
            title="Show balances"
            aria-label="Show balances"
            onClick={() => setFocus(false)}
          >
            <Icon name="chevronDown" size={13} />
          </button>
          <HeaderBar />
        </header>
        <section className="glass-panel main-panel">
          {view !== "network" && view !== "charts" && (
            <div className="view-title-row">
              <h2 className="view-title">{label}</h2>
              {view === "overview" && (
                <div className="title-actions">
                  <button type="button" className="node-map-btn" onClick={() => setView("charts")}>
                    <span>Charts</span>
                    <span aria-hidden>📈</span>
                  </button>
                  <button type="button" className="node-map-btn" onClick={() => setView("network")}>
                    <span>Node Map</span>
                    <Icon name="globe" size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="view-body" data-view={view}>
            {view === "network" ? (
              <NetworkMap onReturn={() => setView("overview")} />
            ) : view === "charts" ? (
              <PriceChart onReturn={() => setView("overview")} />
            ) : (
              <Active />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
