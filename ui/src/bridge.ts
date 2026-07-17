// The renderer's view of the Rust engine, via the Electron preload bridge.
export type NodeStatus = {
  running: boolean;
  phase: string; // stopped | crashed | starting | no-peers | syncing | synced | staking
  headline: string;
  blocks: number | null;
  peers: number | null;
};

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: <T>(cmd: string) => Promise<T> } };
  }
}

export async function nodeStatus(): Promise<NodeStatus> {
  // Tauri shell (withGlobalTauri exposes __TAURI__).
  if (window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke<NodeStatus>("node_status");
  // Plain-browser fallback (headless testing).
  return {
    running: false,
    phase: "starting",
    headline: "Not running inside the desktop app.",
    blocks: null,
    peers: null,
  };
}
