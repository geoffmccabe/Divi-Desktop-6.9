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
  { id: "agent", label: "My Agent", icon: "agent" },
  { id: "timestamp", label: "Proof of Existence", icon: "timestamp" },
  { id: "collectibles", label: "Divi Collectibles", icon: "collectibles" },
  { id: "tokens", label: "Divi Meta Tokens", icon: "tokens" },
  { id: "governance", label: "Governance", icon: "governance" },
  // A newline in a label wraps the row onto two tight lines (see .nav-item span
  // in index.css). Used where a name is genuinely long rather than to save a
  // few pixels — "Human Readable Addresses" on one line would either squeeze
  // the whole sidebar wider or truncate.
  { id: "hra", label: "Human Readable\nAddresses", icon: "hra" },
  { id: "communityapps", label: "Community Apps", icon: "communityapps" },
  { id: "addressbook", label: "Address Book", icon: "addressbook" },
  { id: "settings", label: "Settings", icon: "settings" },
];
