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
