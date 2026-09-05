// One place that talks to the Rust backend. Everything else imports invoke()
// from here so there's a single, typed boundary.
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: Invoke } };
  }
}

// Read-only polling commands. Several panels poll these on their own timers
// (status every 5s, transactions every 3s, balance every 8s, …). setInterval
// keeps firing whether or not the last call returned, so when the node stalls
// on a heavy block every timer stacks a fresh socket on top of the stuck one —
// hundreds of them over a slow block, which floods the node's RPC accept loop
// ("RPCAcceptHandler: Invalid argument") and makes the stall worse. Single-
// flight fixes that: while an identical read is already in flight, hand back the
// same promise instead of opening another socket. Mutations are never listed
// here, so anything that changes state always runs on its own.
const SINGLE_FLIGHT = new Set<string>([
  "node_status", "node_logs", "wallet_status", "wallet_balance", "wallet_addresses",
  "address_balance", "coin_maturity", "list_transactions", "recent_activity",
  "recent_blocks", "tx_status", "mempool_snapshot", "mempool_conflicts",
  "chain_orphans", "network_peers", "self_geo", "staking_wallets", "list_nodes",
  "divi_prices", "mm_status", "mm_has_credentials", "ai_status", "bearer_status",
  "escrow_status", "payment_requests_inbox", "lottery_board", "lottery_info",
  "lottery_wins", "hra_pending", "hra_market", "hra_my_names",
]);

const inflight = new Map<string, Promise<unknown>>();

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) return Promise.reject(new Error("Not running inside the desktop app"));
  if (!SINGLE_FLIGHT.has(cmd)) return inv<T>(cmd, args);

  const key = args ? `${cmd}:${JSON.stringify(args)}` : cmd;
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = inv<T>(cmd, args).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const inApp = () => Boolean(window.__TAURI__?.core?.invoke);
