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
export interface CollectionMintArgs {
  collectionId: string;
  creatorAddr: string;
  traitsJson: string; // ERC-721 attributes JSON, public
}
export const nfdMint = (
  contentB64: string,
  thumbnailB64?: string,
  thumbnailMime?: string,
  collection?: CollectionMintArgs,
) =>
  invoke<NfdMint>("nfd_mint", {
    contentB64,
    thumbnailB64,
    thumbnailMime,
    collectionId: collection?.collectionId,
    creatorAddr: collection?.creatorAddr,
    traitsJson: collection?.traitsJson,
  });

export interface ImportPlanItem {
  edition: number | null;
  name: string;
  tier: string | null;
  hasPreview: boolean;
  ok: boolean;
  error: string | null;
}
export interface ImportPlan {
  importDir: string;
  collection: { name: string; description: string; maxSupply: number; coverB64: string | null; coverMime: string | null };
  items: ImportPlanItem[];
  okCount: number;
  warnings: { edition: number | null; error: string }[];
}
export interface ImportItem {
  name: string;
  tier: string | null;
  attributes: { trait_type: string; value: string }[];
  originalB64: string;
  originalMime: string;
  previewB64: string | null;
  previewMime: string | null;
}
export const nfdImportOpen = (zipPath: string) => invoke<ImportPlan>("nfd_import_open", { zipPath });
export const nfdImportReadItem = (importDir: string, edition: number) =>
  invoke<ImportItem>("nfd_import_read_item", { importDir, edition });

export interface NfdCollection {
  txid: string; // the collection id
  metaPtr: string;
  creatorAddr: string;
}
export const nfdCreateCollection = (
  creatorAddr: string,
  name: string,
  description: string,
  maxSupply: number,
  coverB64?: string,
  coverMime?: string,
) =>
  invoke<NfdCollection>("nfd_create_collection", {
    creatorAddr,
    name,
    description,
    maxSupply,
    coverB64,
    coverMime,
  });

export interface ReceiveCode {
  address: string;
  encPubkey: string;
}
export interface NfdTransfer {
  txid: string;
  wrapkeyPtr: string;
}
export const nfdReceiveCode = (address: string) => invoke<ReceiveCode>("nfd_receive_code", { address });
export const nfdTransfer = (ownerAddr: string, mintTxid: string, recipientAddr: string, recipientEncPubkey: string) =>
  invoke<NfdTransfer>("nfd_transfer", { ownerAddr, mintTxid, recipientAddr, recipientEncPubkey });
export const nfdClaim = (myAddr: string, mintTxid: string, wrapkeyPtr: string) =>
  invoke<string>("nfd_claim", { myAddr, mintTxid, wrapkeyPtr });

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
