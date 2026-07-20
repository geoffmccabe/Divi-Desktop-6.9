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

export const walletBalance = () => invoke<Balance | null>("wallet_balance");
export const poeTimestamp = (hash: string) => invoke<string>("poe_timestamp", { hash });
export const poeVerify = (txid: string, hash: string) => invoke<Proof>("poe_verify", { txid, hash });

// ── Divi Collectibles (NFD) ──────────────────────────────────────────────────
export interface NfdMint {
  txid: string;
  ownerAddr: string;
  contentHash: string;
  arweavePtr: string;
  thumbPtr: string | null;
}
export const nfdMint = (contentB64: string, thumbnailB64?: string, thumbnailMime?: string) =>
  invoke<NfdMint>("nfd_mint", { contentB64, thumbnailB64, thumbnailMime });

export interface ReceiveCode {
  address: string;
  encPubkey: string;
}
export interface NfdTransfer {
  txid: string;
  wrapkeyPtr: string;
}
export const nfdReceiveCode = (address: string) => invoke<ReceiveCode>("nfd_receive_code", { address });
export const nfdTransfer = (
  ownerAddr: string,
  arweavePtr: string,
  mintTxid: string,
  recipientAddr: string,
  recipientEncPubkey: string,
) => invoke<NfdTransfer>("nfd_transfer", { ownerAddr, arweavePtr, mintTxid, recipientAddr, recipientEncPubkey });
export const nfdClaim = (myAddr: string, arweavePtr: string, wrapkeyPtr: string, contentHash: string) =>
  invoke<string>("nfd_claim", { myAddr, arweavePtr, wrapkeyPtr, contentHash });

// ── Admin: fees / treasury + Arweave status ──────────────────────────────────
export interface FeeConfig {
  treasuryAddress: string;
  nfdMint: number;
}
export const nfdFeeConfig = () => invoke<FeeConfig>("nfd_fee_config");
export const nfdSetFeeConfig = (treasuryAddress: string, nfdMint: number) =>
  invoke<void>("nfd_set_fee_config", { treasuryAddress, nfdMint });

export interface RelayStatus {
  relayUrl: string;
  reachable: boolean;
  balanceWinc: string | null;
}
export const nfdRelayStatus = () => invoke<RelayStatus>("nfd_relay_status");
export const nfdView = (ownerAddr: string, arweavePtr: string, contentHash: string) =>
  invoke<string>("nfd_view", { ownerAddr, arweavePtr, contentHash });
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
