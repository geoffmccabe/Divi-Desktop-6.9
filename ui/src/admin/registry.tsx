// The admin panel registry. Adding a future admin panel (network, node,
// advanced, …) is one entry here — the gear/overlay pick it up automatically.
import type { ReactNode } from "react";
import { StylePanel } from "./panels/StylePanel";
import { PayoutsPanel } from "./panels/PayoutsPanel";
import { ArweavePanel } from "./panels/ArweavePanel";
import { ValuePanel } from "./panels/ValuePanel";
import { PayoutPanel } from "./panels/PayoutPanel";
import { AiPanel } from "./panels/AiPanel";
import { ChainHealthPanel } from "../wallet/ChainHealthPanel";

export interface AdminPanel {
  id: string;
  title: string;
  /** Dim/darken the app behind the drawer. Default true; the Style panel sets
   *  false so live theme changes are visible in real time. */
  dim?: boolean;
  render: () => ReactNode;
}

export const ADMIN_PANELS: AdminPanel[] = [
  { id: "style", title: "Style", dim: false, render: () => <StylePanel /> },
  { id: "value", title: "Value", render: () => <ValuePanel /> },
  { id: "ai", title: "AI", render: () => <AiPanel /> },
  { id: "payouts", title: "Payouts", render: () => <PayoutPanel /> },
  // Admin-only: the fork check costs the node ~20s, so it is deliberately
  // not somewhere an ordinary user can trigger it repeatedly.
  { id: "chain", title: "Chain", render: () => <ChainHealthPanel /> },
  // NFD (Divi Collectibles) treasury/fees + Arweave, distinct from the node
  // Payouts panel above.
  { id: "nfd-fees", title: "NFD Fees", render: () => <PayoutsPanel /> },
  { id: "arweave", title: "Arweave", render: () => <ArweavePanel /> },
];
