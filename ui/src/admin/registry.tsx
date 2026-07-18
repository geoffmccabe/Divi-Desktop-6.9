// The admin panel registry. Adding a future admin panel (network, node,
// advanced, …) is one entry here — the gear/overlay pick it up automatically.
import type { ReactNode } from "react";
import { StylePanel } from "./panels/StylePanel";
import { ValuePanel } from "./panels/ValuePanel";

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
];
