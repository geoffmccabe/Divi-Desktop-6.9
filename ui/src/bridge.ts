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

// Try to (re)start the local node — re-runs the idempotent bring-up.
export async function restartNode(): Promise<void> {
  if (inApp()) await invoke<void>("restart_node");
}
