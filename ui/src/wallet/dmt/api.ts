// Divi Meta Tokens — the wallet's data layer.
//
// The indexer that will answer these does not exist yet: the DMT workstream has
// the record parsing and its tests, but the block scanner and state store are
// still to be written (see Divi-Blockchain_6.9 docs/INDEXER-ARCHITECTURE.md,
// "Still to build"). So this file defines the shapes the UI needs and serves
// them from a clearly-labelled stub.
//
// The contract is written up in docs/DMT-WALLET-INTERFACE.md. When the indexer
// lands, ONLY the bodies below change — every component keeps working.
//
// Amounts are ALWAYS integers in the token's smallest unit. Never floats, never
// pre-divided by `decimals`; the UI divides for display only. Getting this wrong
// is how token wallets end up off by powers of ten.

export const DMT_STUB = true;

export interface TokenMeta {
  tokenId: string; // "(height, txIndex)" rendered, e.g. "4131200:3"
  ticker: string;
  name: string;
  /** 0 = indivisible. Displayed as whole units, never with a decimal point. */
  decimals: number;
  totalSupply: string; // integer string: amounts can exceed Number.MAX_SAFE_INTEGER
  maxSupply: string | null; // null = no cap
  supplyLocked: boolean;
  issuer: string;
  mintOpen: boolean;
  genesisTxid: string;
}

export interface TokenBalance {
  tokenId: string;
  amount: string; // smallest unit, integer string
}

export type TokenEventKind = "issue" | "mint" | "transfer-in" | "transfer-out" | "burn";

export interface TokenEvent {
  kind: TokenEventKind;
  tokenId: string;
  counterparty: string | null;
  amount: string;
  height: number;
  txid: string;
  blockTime: number;
}

/**
 * Where the index has got to. The UI must never present balances as live when
 * they aren't, and must refuse to send when the indexer has halted.
 */
export interface SyncState {
  height: number; // last block indexed
  tip: number; // node's chain tip
  fingerprint: string; // per-block chained state fingerprint
  halted: boolean;
  haltReason: string | null;
}

// ---------------------------------------------------------------------------
// Stub data. Obviously fake on purpose — a plausible-looking fake would be worse
// than an obvious one, because it could be mistaken for real holdings.
// ---------------------------------------------------------------------------

const STUB_TOKENS: TokenMeta[] = [
  {
    tokenId: "4131200:3",
    ticker: "EXAMPLE",
    name: "Example Token (not real)",
    decimals: 8,
    totalSupply: "2100000000000000",
    maxSupply: "2100000000000000",
    supplyLocked: true,
    issuer: "DExampleIssuerAddressNotReal00000",
    mintOpen: false,
    genesisTxid: "0".repeat(64),
  },
  {
    tokenId: "4131240:1",
    ticker: "TICKET",
    name: "Sample Event Pass (not real)",
    // Indivisible: you cannot own half a ticket. Renders as whole units.
    decimals: 0,
    totalSupply: "500",
    maxSupply: "500",
    supplyLocked: false,
    issuer: "DExampleIssuerAddressNotReal00000",
    mintOpen: true,
    genesisTxid: "1".repeat(64),
  },
];

const STUB_BALANCES: TokenBalance[] = [
  { tokenId: "4131200:3", amount: "125000000000" }, // 1,250.00000000
  { tokenId: "4131240:1", amount: "3" }, // 3 tickets
];

const delay = <T,>(v: T, ms = 180): Promise<T> =>
  new Promise((res) => setTimeout(() => res(v), ms));

// ---------------------------------------------------------------------------
// The interface. Replace these bodies with calls to the real indexer.
// ---------------------------------------------------------------------------

export const dmtSyncState = (): Promise<SyncState> =>
  delay({
    height: 0,
    tip: 0,
    fingerprint: "",
    halted: false,
    haltReason: null,
  });

export const dmtBalances = (_addresses: string[]): Promise<TokenBalance[]> =>
  delay(DMT_STUB ? STUB_BALANCES : []);

export const dmtTokensMeta = (_tokenIds: string[]): Promise<TokenMeta[]> =>
  delay(DMT_STUB ? STUB_TOKENS : []);

export const dmtHistory = (_addresses: string[], _limit = 50): Promise<TokenEvent[]> =>
  delay([]);

export interface TickerStatus {
  taken: boolean;
  owner: string | null;
  /** Registration price in DIVI. Scales by ticker length (spec §7.3.2). */
  priceDivi: number | null;
}
export const dmtTickerStatus = (_ticker: string): Promise<TickerStatus> =>
  delay({ taken: false, owner: null, priceDivi: null });

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Renders a smallest-unit integer string using the token's decimals.
 *
 * Uses string arithmetic rather than Number: a token with 8 decimals and a large
 * supply exceeds what a double can represent exactly, and silently rounding
 * somebody's balance is not acceptable.
 */
export function formatAmount(amount: string, decimals: number): string {
  const neg = amount.startsWith("-");
  const digits = (neg ? amount.slice(1) : amount).replace(/\D/g, "") || "0";

  if (decimals <= 0) {
    // Indivisible: whole units only, never a decimal point.
    return (neg ? "-" : "") + BigInt(digits).toLocaleString();
  }
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const wholeFmt = BigInt(whole).toLocaleString();
  return (neg ? "-" : "") + (frac ? `${wholeFmt}.${frac}` : wholeFmt);
}

/** Parses user input into a smallest-unit integer string, or null if invalid. */
export function parseAmount(input: string, decimals: number): string | null {
  const s = input.trim();
  if (!s) return null;
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return null;

  const [whole = "0", frac = ""] = s.split(".");
  if (decimals <= 0) {
    // An indivisible token cannot take a fractional amount at all.
    if (frac.length > 0) return null;
    return String(BigInt(whole || "0"));
  }
  if (frac.length > decimals) return null;
  return String(BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac || "0").padEnd(decimals, "0")));
}
