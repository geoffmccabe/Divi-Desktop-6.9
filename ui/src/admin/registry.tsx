// The admin panel registry. Adding a future admin panel (network, node,
// advanced, …) is one entry here — the gear/overlay pick it up automatically.
import type { ReactNode } from "react";
import { StylePanel } from "./panels/StylePanel";

export interface AdminPanel {
  id: string;
  title: string;
  render: () => ReactNode;
}

export const ADMIN_PANELS: AdminPanel[] = [
  { id: "style", title: "Style", render: () => <StylePanel /> },
];
