import { useState } from "react";
import { BalanceCard } from "./BalanceCard";
import { ReceivePanel } from "./ReceivePanel";
import { ActivityList } from "./ActivityList";
import { SendPanel } from "./SendPanel";
import { StatusPanel } from "../StatusPanel";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "receive", label: "Receive" },
  { id: "send", label: "Send" },
  { id: "activity", label: "Activity" },
];

export function WalletView() {
  const [tab, setTab] = useState("overview");

  return (
    <div className="glass-panel wallet">
      <div className="wl-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={"wl-tab" + (t.id === tab ? " wl-tab-active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="wl-content">
        {tab === "overview" && (
          <>
            <BalanceCard />
            <StatusPanel />
          </>
        )}
        {tab === "receive" && <ReceivePanel />}
        {tab === "send" && <SendPanel />}
        {tab === "activity" && <ActivityList />}
      </div>
    </div>
  );
}
