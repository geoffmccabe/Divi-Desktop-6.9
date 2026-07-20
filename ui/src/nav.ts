// The left-sidebar navigation, in the order Geoff specified. Icon names map to
// --icon-<name> CSS vars (see icons.ts). Add/reorder here — the sidebar and
// content router follow automatically.
export interface NavItem {
  id: string;
  label: string;
  icon: string;
}

export const NAV: NavItem[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "send", label: "Send", icon: "send" },
  { id: "receive", label: "Receive", icon: "receive" },
  { id: "history", label: "Transaction History", icon: "history" },
  { id: "payreq", label: "Payment Requests", icon: "receive" },
  { id: "timestamp", label: "Proof of Existence", icon: "timestamp" },
  { id: "collectibles", label: "Divi Collectibles", icon: "collectibles" },
  { id: "addressbook", label: "Address Book", icon: "addressbook" },
  { id: "settings", label: "Settings", icon: "settings" },
];
