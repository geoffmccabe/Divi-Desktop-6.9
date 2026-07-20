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

// TRUNCATE, never round. Rounding a balance UP claims money the wallet does not
// have: 930.9999774 rounded to four places is 931, which is simply false.
function truncate4(n: number): number {
  return (n < 0 ? Math.ceil(n * 1e4) : Math.floor(n * 1e4)) / 1e4;
}

export function fmtDivi(n: number): string {
  return truncate4(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

// Split into the whole part (grouped) and a fixed 4-digit fraction, so the UI
// can render the fraction smaller/greyer than the whole number.
//
// This previously did `(n - trunc(n)).toFixed(4).slice(2)`, which broke twice
// over on a balance like 930.9999774: toFixed ROUNDED the fraction to "1.0000",
// and slice(2) then stripped "1." instead of the expected "0.", leaving "000".
// The wallet showed 930.0000 while actually holding 930.9999774.
export function fmtDiviParts(n: number): { whole: string; frac: string } {
  const t = truncate4(n);
  const whole = Math.trunc(t);
  // Derived from the already-truncated value, so it can never carry into the
  // whole number and can never overstate the balance.
  const frac = Math.round(Math.abs(t - whole) * 1e4)
    .toString()
    .padStart(4, "0");
  return { whole: whole.toLocaleString(), frac };
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
