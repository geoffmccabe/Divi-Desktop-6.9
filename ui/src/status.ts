// Shared status vocabulary + small formatters, used by the status pill, the
// status panel, and activity.

export const PHASE_COLOR: Record<string, string> = {
  staking: "var(--success)",
  synced: "var(--success)",
  syncing: "var(--warning)",
  "no-peers": "var(--warning)",
  starting: "var(--warning)",
  crashed: "var(--destructive)",
  stopped: "var(--muted-foreground)",
  unreachable: "var(--muted-foreground)",
};

export const PHASE_LABEL: Record<string, string> = {
  staking: "Staking",
  synced: "Synced",
  syncing: "Syncing",
  "no-peers": "Connecting",
  starting: "Starting",
  crashed: "Needs repair",
  stopped: "Stopped",
  unreachable: "Starting",
};

export function fmtDivi(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function relTime(unix: number): string {
  if (!unix) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function truncMiddle(s: string, keep = 8): string {
  return s.length <= keep * 2 + 1 ? s : `${s.slice(0, keep)}…${s.slice(-keep)}`;
}
