// Talking to the points side of the builder service.
//
// Points are bought with DIVI and spent on model usage. The balance is held by
// the service, never by the wallet: this file can read it and start a purchase,
// but nothing here can change a balance. That is deliberate — a balance the
// client could set would not be a balance at all.

import { builderUrl } from "../builder/api";

export interface Tier {
  id: string;
  name: string;
  blurb: string;
  points: number;
  discountPercent: number;
  /** Undiscounted price, so the saving can be shown honestly. */
  listUsd: number;
  usd: number;
  divi: number;
  diviPerPoint: number;
}

export interface Catalogue {
  available: boolean;
  /** A sentence saying what is missing, when buying is not possible. */
  why: string | null;
  pointsPerUsd: number;
  markup: number;
  /** How many DIVI to a dollar, from CoinMarketCap. Null when it has no price. */
  diviPerUsd: number | null;
  /** Always "coinmarketcap". Standing order; see contrib/app-builder/src/price.mjs. */
  priceSource: string;
  treasuryAddress: string | null;
  tiers: Tier[];
}

export interface LedgerLine {
  at: number;
  kind: "purchase" | "spend" | "refund" | "adjust";
  points: number;
  balanceAfter: number;
  detail?: Record<string, unknown>;
}

export interface AccountState {
  account: string;
  balancePoints: number;
  history: LedgerLine[];
}

export type OrderState =
  | "awaiting_payment"
  | "awaiting_confirmations"
  | "paid"
  | "expired";

export interface Order {
  id: string;
  tierId: string;
  tierName: string;
  points: number;
  /** The exact amount to send. Carries a tiny marker that identifies this order. */
  amountDivi: number;
  listDivi: number;
  discountPercent: number;
  address: string;
  state: OrderState;
  expiresAt: number;
  txid: string | null;
  confirmations: number;
  needsConfirmations: number;
  balanceAfter?: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${builderUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `request failed (${res.status})`);
  return body as T;
}

export const catalogue = () => call<Catalogue>("/points/catalogue");

/**
 * Hand the service the CoinMarketCap key the wallet already holds, so DIVI can
 * be priced without anyone configuring the same key twice.
 *
 * CoinMarketCap is the only source, by standing order: the obvious alternative
 * prices DIVI off a thinly traded wrapped token and reads about 4.5x lower,
 * which would sell four times the build time for the same money.
 */
export const setCmcKey = (key: string) =>
  call<{ configured: boolean }>("/cmc-key", { method: "POST", body: JSON.stringify({ key }) });

export const accountState = (account: string) =>
  call<AccountState>(`/points/account?account=${encodeURIComponent(account)}`);

export const startOrder = (account: string, tierId: string) =>
  call<Order>("/points/order", { method: "POST", body: JSON.stringify({ account, tierId }) });

export const readOrder = (id: string) => call<Order>(`/points/order/${id}`);

/**
 * Tell the service which transaction paid for an order. It checks with the Divi
 * node itself and credits the points only once the payment has settled, so
 * calling this with an invented id achieves nothing.
 */
export const claimOrder = (id: string, txid: string) =>
  call<Order>(`/points/order/${id}/claim`, { method: "POST", body: JSON.stringify({ txid }) });
