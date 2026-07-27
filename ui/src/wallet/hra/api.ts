// Human Readable Addresses (Divi Names) — the wallet's data layer.
//
// Unlike the DMT panel, none of this is a stub: every call reaches the Rust
// supervisor, which reads the chain through this machine's OWN node and keeps a
// local index. There is no remote service anywhere in the path, deliberately —
// a wrong answer here sends somebody's money to a stranger.
//
// Rules, pricing and record encoding live in the vendored `name-registry`
// crate, byte-identical to the chain repo, so the wallet cannot drift from an
// indexer.

import { invoke } from "../../tauri";

export interface NameQuote {
  /** The capitalised form that actually gets registered. */
  canonical: string;
  registrationDivi: number;
  renewalDivi: number;
  /** Short enough to also serve as a DMT token ticker. */
  canBeTicker: boolean;
  /** null when the index cannot answer honestly. Never guess for the user. */
  available: boolean | null;
  owner: string | null;
}

export interface HraSync {
  activated: boolean;
  activationHeight: number;
  scannedHeight: number;
  tip: number;
  caughtUp: boolean;
  namesKnown: number;
  treasuryConfigured: boolean;
  /** False when the node has no full transaction index, so names are unreadable. */
  txindex: boolean;
  note: string;
}

export interface PendingCommit {
  name: string;
  txid: string;
  commitHeight: number;
  blocksRemaining: number;
  ready: boolean;
}

export interface MarketListing {
  name: string;
  seller: string;
  priceDivi: number;
  /** Treasury cut on top of the price. Zero while the market is free. */
  feeDivi: number;
  /** Blocks until the seller may withdraw the listing. Above zero = safe to buy. */
  lockedForBlocks: number;
  isMine: boolean;
}

export interface OwnedName {
  name: string;
  owner: string;
  registeredHeight: number;
  expiresHeight: number;
  /** [key, hex value] pairs, sorted by key. */
  records: [number, string][];
  isPrimary: boolean;
  listedPriceDivi: number | null;
}

// Record keys. These MUST match name-registry's record.rs; they are part of the
// on-chain format, not a UI choice.
export const KEY = {
  DIVI_ADDRESS: 0x01,
  EVM_ADDRESS: 0x02,
  CHAIN_ADDRESS: 0x03,
  ENS_NAME: 0x10,
  TELEGRAM: 0x20,
  X_HANDLE: 0x21,
  EMAIL: 0x22,
  URL: 0x23,
  AVATAR: 0x24,
  PHONE: 0x30,
  PROFILE_PTR: 0x40,
  CUSTOM: 0xff,
} as const;

export interface KeyInfo {
  key: number;
  label: string;
  placeholder: string;
  hint: string;
  /** Text records are typed as text; the rest need their own editor. */
  text: boolean;
}

/** The record types the panel offers, in the order they are shown. */
export const KEY_INFO: KeyInfo[] = [
  {
    key: KEY.DIVI_ADDRESS,
    label: "Divi address",
    placeholder: "D...",
    hint: "Where DIVI sent to this name should go. This is the one that makes the name useful.",
    text: false,
  },
  {
    key: KEY.EVM_ADDRESS,
    label: "Ethereum / EVM address",
    placeholder: "0x...",
    hint: "Works for Ethereum and any EVM chain. Stored the same way ENS stores it, so other wallets can read it.",
    text: false,
  },
  {
    key: KEY.ENS_NAME,
    label: "ENS name",
    placeholder: "yourname.eth",
    hint: "Links your Divi name to your Ethereum name.",
    text: true,
  },
  {
    key: KEY.TELEGRAM,
    label: "Telegram",
    placeholder: "yourhandle",
    hint: "Public. Anyone can read it, forever.",
    text: true,
  },
  {
    key: KEY.X_HANDLE,
    label: "X handle",
    placeholder: "yourhandle",
    hint: "Public. Anyone can read it, forever.",
    text: true,
  },
  {
    key: KEY.EMAIL,
    label: "Email",
    placeholder: "you@example.com",
    hint: "Public and permanent. Expect it to be scraped by spammers.",
    text: true,
  },
  {
    key: KEY.URL,
    label: "Website",
    placeholder: "https://example.com",
    hint: "Public.",
    text: true,
  },
  {
    key: KEY.PHONE,
    label: "Phone",
    placeholder: "not available yet",
    hint: "Blocked on purpose. A phone number on a permanent public chain cannot ever be deleted, and it is a doxxing and SIM-swap risk. A private, encrypted form is planned.",
    text: false,
  },
];

export function keyLabel(key: number): string {
  return KEY_INFO.find((k) => k.key === key)?.label ?? `Record type ${key}`;
}

// ── hex helpers ────────────────────────────────────────────────────────────
// Values travel as hex so any record type round-trips unchanged, including ones
// this build does not understand.

export function textToHex(s: string): string {
  return Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToText(hex: string): string {
  const bytes = hexToBytes(hex);
  if (!bytes) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Not text. Show the hex rather than a row of replacement characters.
    return hex;
  }
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A 0x-prefixed EVM address as the 20 raw bytes the record carries. */
export function evmToHex(addr: string): string | null {
  const s = addr.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(s)) return null;
  return s.toLowerCase();
}

export function hexToEvm(hex: string): string {
  return hex.length === 40 ? `0x${hex}` : hex;
}

/** How a record value should be shown, given its key. */
export function displayValue(key: number, hex: string): string {
  if (key === KEY.EVM_ADDRESS) return hexToEvm(hex);
  if (key === KEY.DIVI_ADDRESS) return "(a Divi address)";
  return hexToText(hex);
}

// ── commands ───────────────────────────────────────────────────────────────

export const hraQuote = (input: string) => invoke<NameQuote>("hra_quote", { input });
export const hraSync = () => invoke<HraSync>("hra_sync");
export const hraPending = () => invoke<PendingCommit[]>("hra_pending");
export const hraMyNames = () => invoke<OwnedName[]>("hra_my_names");
export const hraCommit = (name: string) => invoke<string>("hra_commit", { name });
export const hraRegister = (name: string) => invoke<string>("hra_register", { name });
export const hraForget = (name: string) => invoke<void>("hra_forget", { name });
export const hraSetDiviAddress = (name: string, address: string) =>
  invoke<string>("hra_set_divi_address", { name, address });
export const hraSetRecord = (name: string, key: number, valueHex: string) =>
  invoke<string>("hra_set_record", { name, key, valueHex });
export const hraClearRecord = (name: string, keys: number[]) =>
  invoke<string>("hra_clear_record", { name, keys });
export const hraTransfer = (name: string, newOwner: string) =>
  invoke<string>("hra_transfer", { name, newOwner });
export const hraSetPrimary = (name: string) => invoke<string>("hra_set_primary", { name });
export const hraRenew = (name: string) => invoke<string>("hra_renew", { name });
export const hraResolve = (name: string) => invoke<string | null>("hra_resolve", { name });
export const hraMarket = () => invoke<MarketListing[]>("hra_market");
export const hraListForSale = (name: string, priceDivi: number, minLifetimeBlocks: number) =>
  invoke<string>("hra_list_for_sale", { name, priceDivi, minLifetimeBlocks });
export const hraDelist = (name: string) => invoke<string>("hra_delist", { name });
export const hraBuy = (name: string) => invoke<string>("hra_buy", { name });
