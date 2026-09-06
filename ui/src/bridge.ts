import { invoke, inApp } from "./tauri";

export type NodeStatus = {
  running: boolean;
  phase: string; // stopped | crashed | starting | no-peers | syncing | synced | staking
  headline: string;
  blocks: number | null;
  peers: number | null;
};

export async function nodeStatus(): Promise<NodeStatus> {
  if (inApp()) return invoke<NodeStatus>("node_status");
  return {
    running: false,
    phase: "starting",
    headline: "Not running inside the desktop app.",
    blocks: null,
    peers: null,
  };
}

// First-run setup detection: which track the user is on and what DD2.0 data
// we could reuse. Read-only.
export type SetupInfo = {
  track: "new" | "dd2" | "ready";
  needsSetup: boolean;
  dd69HasChain: boolean;
  dd2HasChain: boolean;
  dd2HasWallet: boolean;
  dd2ChainGb: number;
  sameVolume: boolean;
};

export async function setupInfo(): Promise<SetupInfo> {
  if (inApp()) return invoke<SetupInfo>("setup_info");
  // Browser dev: pretend a fresh new-user install so the panel is previewable.
  return {
    track: "new", needsSetup: true, dd69HasChain: false,
    dd2HasChain: false, dd2HasWallet: false, dd2ChainGb: 0, sameVolume: false,
  };
}

// Try to (re)start the local node — re-runs the idempotent bring-up.
export async function restartNode(): Promise<void> {
  if (inApp()) await invoke<void>("restart_node");
}

export type AppLogEntry = { tsMs: number; msg: string; count: number };
export type NodeLogs = { nodeLog: string; appLog: AppLogEntry[] };

// The node's own log (collapsed) + the app's activity log, for Settings → Logs.
export async function nodeLogs(): Promise<NodeLogs> {
  if (inApp()) return invoke<NodeLogs>("node_logs");
  return { nodeLog: "Not running inside the desktop app.", appLog: [] };
}
