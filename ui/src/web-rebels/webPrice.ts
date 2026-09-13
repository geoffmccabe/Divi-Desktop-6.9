// The DIVI price on the web: the same number the app uses.
//
// The app's shared price is the newest CoinMarketCap close in the Divi project's
// `divi_price` table (crates/supervisor/src/chart.rs, price_latest), read with
// the public key. A browser can read that table directly, so the web reads the
// very same row. CoinMarketCap or nothing: no price means the stores say so.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabaseProject";
import type { RebelsPrices } from "../wallet/rebels/platform/platform";

const TTL = 60_000;
let cache: { at: number; data: RebelsPrices } | null = null;

export async function fetchWebPrices(fetchFn: typeof fetch = fetch, now = Date.now()): Promise<RebelsPrices> {
  if (cache && now - cache.at < TTL) return cache.data;
  try {
    const r = await fetchFn(
      `${SUPABASE_URL}/rest/v1/divi_price?select=close&close=gt.0&order=ts.desc&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!r.ok) return { prices: {} };
    const rows = await r.json() as Array<{ close?: number }>;
    const usd = Number(rows?.[0]?.close);
    const data: RebelsPrices = { prices: usd > 0 ? { usd } : {} };
    if (usd > 0) cache = { at: now, data };
    return data;
  } catch {
    return { prices: {} };
  }
}

/** For tests: forget the cached price. */
export function forgetWebPrice(): void { cache = null; }
