// What a DIVI is worth, in dollars.
//
// STANDING ORDER: CoinMarketCap, and only CoinMarketCap. CoinGecko is never
// consulted here, not even as a fallback, and adding it back would be a bug
// rather than a robustness improvement.
//
// The reason is concrete, not a preference. CoinGecko prices DIVI off a wrapped
// ERC-20 on Uniswap with a few dollars a day of volume, and it currently reads
// about 4.5x LOWER than the CoinMarketCap quote. Selling points off that number
// would hand someone four times the build time they paid for.
//
// Two traps, both of which have already cost real money elsewhere:
//
//   1. Query by SLUG, never by symbol. Several coins list under the DIVI
//      ticker, and a symbol query returns a different, cheaper token.
//   2. The reply is keyed by numeric coin id, not by "DIVI". Reading
//      data["DIVI"] finds nothing at all.
//
// No key, or a failed call, means NO price. Everything that needs one then
// refuses to act. That is the whole point: a missing price must never quietly
// become a wrong price.

const CMC_URL =
  "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=divi&convert=USD";

/** How long a quote is good for. DIVI does not move fast enough to need less. */
export const CACHE_MS = 10 * 60 * 1000;

export class PriceError extends Error {}

/**
 * One DIVI in US dollars, from CoinMarketCap.
 * @param {{apiKey: string, fetchImpl?: typeof fetch}} cfg
 */
export async function fetchDiviUsd({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new PriceError("no CoinMarketCap key is set, so DIVI cannot be priced");

  const res = await fetchImpl(CMC_URL, {
    headers: { "X-CMC_PRO_API_KEY": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new PriceError(`CoinMarketCap returned ${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const price = readSlugQuote(body);
  if (!(price > 0)) throw new PriceError("CoinMarketCap returned no usable DIVI quote");
  return price;
}

/**
 * Pull the USD quote out of a slug reply.
 *
 * Exported because the shape is the part that has broken before: `data` is
 * keyed by the numeric coin id (3441), so there is exactly one entry and it
 * must be read positionally rather than by name.
 */
export function readSlugQuote(body) {
  const data = body?.data;
  if (!data || typeof data !== "object") return 0;
  const entries = Object.values(data);
  if (entries.length !== 1) return 0;
  const price = entries[0]?.quote?.USD?.price;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : 0;
}

/**
 * A cached DIVI price.
 *
 * Holds the last good quote and its age. A failed refresh does NOT throw away
 * the previous one: a brief CoinMarketCap outage should not stop somebody
 * buying, but an old quote is reported with its age so nothing pretends it is
 * fresher than it is.
 */
export class DiviPrice {
  constructor({ apiKey = null, fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.usd = null;
    this.at = 0;
    this.lastError = null;
  }

  setKey(key) {
    this.apiKey = key;
    // A new key deserves a fresh look rather than serving the old number.
    this.at = 0;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  /** One DIVI in dollars, refreshing if the cached one is stale. */
  async usdPerDivi() {
    if (this.usd && this.now() - this.at < CACHE_MS) return this.usd;
    try {
      this.usd = await fetchDiviUsd({ apiKey: this.apiKey, fetchImpl: this.fetchImpl });
      this.at = this.now();
      this.lastError = null;
    } catch (e) {
      this.lastError = e.message;
      // Keep serving the last good quote if there is one; otherwise there is
      // simply no price, and callers must refuse rather than guess.
      if (!this.usd) throw e;
    }
    return this.usd;
  }

  /** How many DIVI to one dollar — the number bundle prices are converted with. */
  async diviPerUsd() {
    const usd = await this.usdPerDivi();
    if (!(usd > 0)) throw new PriceError("DIVI has no usable price");
    return 1 / usd;
  }

  /** For the panel: the number, how old it is, and what went wrong if anything. */
  status() {
    return {
      configured: this.configured,
      usdPerDivi: this.usd,
      ageMs: this.usd ? this.now() - this.at : null,
      source: "coinmarketcap",
      error: this.lastError,
    };
  }
}
