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
  validateAddress,
  addressBalance,
  addressQr,
  mempoolSnapshot,
  poeVerify,
} from "../wallet/api";

export { hraResolve, hraReverse, hraMarket, hraQuote } from "../wallet/hra/api";

export type { Balance, AddrInfo, Tx, Peer, PeerSnapshot, Block } from "../wallet/api";

import { nodeStatus } from "../bridge";
import { diviPrices, txStatus } from "../wallet/api";
import { getValueSettings } from "../wallet/value";
import { TOKENS } from "../theme/tokens";

/**
 * The wallet's current look, as plain values an app can apply to itself.
 *
 * This exists because of a mistake worth naming. Apps are told to style
 * themselves with the wallet's CSS variables so they follow whatever skin the
 * person is using — but a sandboxed frame does NOT inherit custom properties
 * from the page around it. So every one of those variables was undefined inside
 * the app, and an app doing exactly as instructed came out looking like nothing
 * at all. The advice was right; the variables simply were not there.
 *
 * Read from what is actually applied to the wallet right now rather than from
 * the saved settings, so a skin being edited live is reflected as it changes.
 */
export function currentTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const t of TOKENS) {
    const v = style.getPropertyValue(t.cssVar).trim();
    if (v) out[t.cssVar] = v;
  }
  return out;
}

/**
 * The DIVI price, in the currencies this wallet is set up for.
 *
 * The app never supplies a key and never chooses a source: both come from the
 * wallet's own Value settings. That matters — a key handed over by an app would
 * be an app spending somebody else's CoinMarketCap quota, and a source chosen by
 * an app could be one that prices DIVI about four times too low.
 */
export async function diviPriceSafe(): Promise<{
  prices: Record<string, number>;
  source: string;
  available: boolean;
}> {
  const s = getValueSettings();
  try {
    const r = await diviPrices(s.currencies, s.cmcKey, s.useCoingecko);
    const available = Object.keys(r.prices).length > 0;
    return {
      prices: r.prices,
      source: r.coinmarketcapOk ? "coinmarketcap" : available ? "fallback" : "none",
      available,
    };
  } catch {
    // The wallet's own rule is never to invent a price. No price is honest;
    // a wrong one is not.
    return { prices: {}, source: "none", available: false };
  }
}

/**
 * How far along a payment is.
 *
 * Narrowed to the confirmation count on purpose. The wallet's own version also
 * reports the amount and whether it was sent or received, which would let an app
 * probe transaction ids to learn which ones belong to this person.
 */
export async function paymentProgress(txid: string): Promise<{ confirmations: number }> {
  try {
    const s = await txStatus(txid);
    return { confirmations: s.found ? s.confirmations : 0 };
  } catch {
    return { confirmations: 0 };
  }
}

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
