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
export const poeTimestamp = (hash: string) => invoke<string>("poe_timestamp", { hash });
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
export interface Probe {
  ip: string;
  online: boolean;
}
export const probePeers = (ips: string[]) => invoke<Probe[]>("probe_peers", { ips });

export const stakingWallets = () => invoke<StakeWallet[]>("staking_wallets");
export const lotteryInfo = () => invoke<LotteryInfo | null>("lottery_info");
export const lotteryWins = (addresses: string[]) => invoke<LotteryWin[]>("lottery_wins", { addresses });
export const walletAddresses = () => invoke<AddrInfo[]>("wallet_addresses");
export const newReceiveAddress = () => invoke<string>("new_receive_address");
export const recentActivity = () => invoke<Tx[]>("recent_activity");
// null = node unreachable; [] = genuinely no (more) transactions.
export const listTransactions = (count: number, from: number) =>
  invoke<Tx[] | null>("list_transactions", { count, from });
export const validateAddress = (address: string) => invoke<boolean>("validate_address", { address });
export const addressQr = (address: string) => invoke<string>("address_qr", { address });
export const openUrl = (url: string) => invoke<void>("open_url", { url });

// Divi block explorer for a transaction.
export const explorerTxUrl = (txid: string) => `https://chainz.cryptoid.info/divi/tx.dws?${txid}.htm`;
