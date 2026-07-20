import { invoke } from "../tauri";

export interface Balance {
  spendable: number;
  staking: number;
  pending: number;
  immature: number;
}

export interface Tx {
  kind: string; // receive | send | stake | other
  amount: number;
  address: string;
  confirmations: number;
  txid: string;
  time: number;
}

export interface AddrInfo {
  address: string;
  isMain: boolean;
  receives: number;
  sends: number;
  stakes: number;
}

export interface Proof {
  matched: boolean;
  confirmations: number;
  block_time: number | null;
}

export interface StakeWallet {
  address: string;
  size: number;
  stakes: number;
  firstStake: number | null;
  lastStake: number | null;
}
export interface LotteryInfo {
  tip: number;
  nextHeight: number;
  nextEta: number; // unix seconds, estimated
}
export interface LotteryWin {
  address: string;
  big: number;
  small: number;
}

export const walletBalance = () => invoke<Balance | null>("wallet_balance");
// `fee` is left to the staker; `payoutDivi` goes to `payoutAddr`. Nulls fall
// back to the node-side minimum, so a missing price quote can never overspend.
export const poeTimestamp = (
  hash: string,
  fee?: number | null,
  payoutAddr?: string | null,
  payoutDivi?: number | null,
) =>
  invoke<string>("poe_timestamp", {
    hash,
    fee: fee ?? null,
    payoutAddr: payoutAddr?.trim() || null,
    payoutDivi: payoutDivi ?? null,
  });
export const poeVerify = (txid: string, hash: string) => invoke<Proof>("poe_verify", { txid, hash });
export interface Peer {
  ip: string;
  inbound: boolean;
  pingMs: number;
  connSecs: number;
  bytesSent: number;
  bytesRecv: number;
  subver: string;
  height: number;
}
export interface PeerSnapshot {
  peers: Peer[];
  selfIp: string | null;
}
export interface Geo {
  ip: string;
  lat: number;
  lon: number;
  city: string;
  country: string;
  isp?: string;
}
export const networkPeers = () => invoke<PeerSnapshot | null>("network_peers");
export const geolocateIps = (ips: string[]) => invoke<Geo[]>("geolocate_ips", { ips });
export const selfGeo = () => invoke<Geo | null>("self_geo");
export interface Block {
  height: number;
  time: number;
  txids: string[];
  stakeWinner: string | null;
  stakeAmount: number | null;
}
export const recentBlocks = (count: number) => invoke<Block[]>("recent_blocks", { count });
export interface StaleBlock {
  height: number;
  status: string;
  branchLen: number;
}
export interface OrphanReport {
  stale: StaleBlock[];
  tip: number;
  span: number;
  ratePct: number;
}
// ⚠ Costs ~18 seconds on the node and stalls its block processing while it
// runs. On-demand only — never put this on a timer. Without `force` the Rust
// side serves a cached report.
export const chainOrphans = (force = false) => invoke<OrphanReport | null>("chain_orphans", { force });
export interface Probe {
  ip: string;
  online: boolean;
}
export const probePeers = (ips: string[]) => invoke<Probe[]>("probe_peers", { ips });

export const stakingWallets = () => invoke<StakeWallet[]>("staking_wallets");
export const lotteryInfo = () => invoke<LotteryInfo | null>("lottery_info");
export const lotteryWins = (addresses: string[]) => invoke<LotteryWin[]>("lottery_wins", { addresses });
export interface LotteryLeader {
  address: string;
  big: number;
  small: number;
  points: number;
}
export interface LotteryBoard {
  leaders: LotteryLeader[];
  yourBig: number;
  yourSmall: number;
  yourPoints: number;
}
export const lotteryBoard = (addresses: string[]) => invoke<LotteryBoard>("lottery_board", { addresses });
export interface StakeStart {
  staking: boolean;
  needsPassphrase: boolean;
  message: string;
}
export const startStaking = (passphrase?: string) => invoke<StakeStart>("start_staking", { passphrase: passphrase ?? null });
export const walletAddresses = () => invoke<AddrInfo[]>("wallet_addresses");
export const newReceiveAddress = () => invoke<string>("new_receive_address");
export const recentActivity = () => invoke<Tx[]>("recent_activity");
// null = node unreachable; [] = genuinely no (more) transactions.
export const listTransactions = (count: number, from: number) =>
  invoke<Tx[] | null>("list_transactions", { count, from });
export const validateAddress = (address: string) => invoke<boolean>("validate_address", { address });
export const addressQr = (address: string) => invoke<string>("address_qr", { address });
export const openUrl = (url: string) => invoke<void>("open_url", { url });

// ---- Coin maturity ----
export interface Utxo {
  address: string;
  amount: number;
  confirmations: number;
  matured: boolean;
  pct: number; // 0..100
  stakeableAt: number; // unix seconds, 0 once matured
}
export const coinMaturity = () => invoke<Utxo[]>("coin_maturity");

// ---- Wallet password / encryption ----
export interface WalletStatus {
  encrypted: boolean;
  unlocked: boolean;
  stakingOnly: boolean;
  remembered: boolean;
  status: string;
}
export const walletStatus = () => invoke<WalletStatus>("wallet_status");
export const unlockWallet = (passphrase: string, stakingOnly: boolean, seconds: number) =>
  invoke<void>("unlock_wallet", { passphrase, stakingOnly, seconds });
export const lockWallet = () => invoke<void>("lock_wallet");
export const changePassphrase = (oldPass: string, newPass: string) =>
  invoke<void>("change_passphrase", { old: oldPass, new: newPass });
export const encryptWallet = (passphrase: string) => invoke<string>("encrypt_wallet", { passphrase });
export const walletSeed = () => invoke<string>("wallet_seed");
export const rememberPassword = (passphrase: string) => invoke<void>("remember_password", { passphrase });
export const forgetPassword = () => invoke<void>("forget_password");
export const resumeStaking = () => invoke<StakeStart>("resume_staking");
export const sendCoins = (address: string, amount: number, passphrase?: string) =>
  invoke<string>("send_coins", { address, amount, passphrase: passphrase ?? null });

// ---- DIVI price / value ----
export interface DiviPrices {
  prices: Record<string, number>; // lowercase currency code -> price per DIVI
  coingeckoOk: boolean;
  coinmarketcapOk: boolean;
  cmcError?: string | null; // why CoinMarketCap failed, when a key is set
}
export const diviPrices = (currencies: string[], cmcKey: string, useCoingecko: boolean) =>
  invoke<DiviPrices>("divi_prices", { currencies, cmcKey: cmcKey || null, useCoingecko });

// Divi block explorer for a transaction.
export const explorerTxUrl = (txid: string) => `https://chainz.cryptoid.info/divi/tx.dws?${txid}.htm`;
