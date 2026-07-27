// The wallet surface the broker is allowed to reach.
//
// This file exists as a deliberate choke point. The broker imports ONLY from
// here, never from `wallet/api.ts` directly, so the set of wallet calls reachable
// from community-app code is this list and nothing else. Widening it is a visible
// edit to a small file rather than a one-word import change buried in a handler.
//
// Nothing that spends, signs, unlocks, exports a key, or controls the node is
// re-exported here, and nothing of that kind ever should be.

export {
  walletBalance,
  walletAddresses,
  listTransactions,
  recentBlocks,
  networkPeers,
  stakingWallets,
  lotteryInfo,
} from "../wallet/api";

export type { Balance, AddrInfo, Tx, Peer, PeerSnapshot, Block } from "../wallet/api";

import { nodeStatus } from "../bridge";

/**
 * Chain status, narrowed to what an app is entitled to see and hardened against
 * the node being unreachable. The wallet's own rule is never to fabricate node
 * state, so an unreachable node reports as unreachable rather than as zeroes.
 */
export async function nodeStatusSafe(): Promise<{
  phase: string;
  blocks: number | null;
  peers: number | null;
  reachable: boolean;
}> {
  try {
    const s = await nodeStatus();
    return {
      phase: s.phase,
      blocks: s.blocks ?? null,
      peers: s.peers ?? null,
      reachable: true,
    };
  } catch {
    return { phase: "unknown", blocks: null, peers: null, reachable: false };
  }
}
