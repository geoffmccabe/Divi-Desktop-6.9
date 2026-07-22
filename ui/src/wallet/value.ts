import { useEffect, useState } from "react";
import { diviPrices, type DiviPrices } from "./api";

// Admin-configured DIVI value settings + a shared, cached price fetch so the
// header value and the admin preview don't hammer the APIs independently.

export interface ValueSettings {
  currencies: string[]; // configured fiat codes (uppercase)
  display: string; // which one shows on the Spendable card
  cmcKey: string; // CoinMarketCap API key (optional — CoinGecko needs none)
  useCoingecko: boolean; // ON by default: DIVI trades there and it needs no key
}

const KEY = "dd69.value";
// CoinGecko is ON only as a LAST RESORT, so that an unconfigured wallet shows
// something rather than nothing. Be aware of what it means: CoinGecko prices
// DIVI off the wrapped ERC-20 on Uniswap (~$3/day of volume), which currently
// reads about 4.5x LOWER than the CoinMarketCap quote the Divi community uses.
// For a figure that matches CMC, an admin must add a free CMC key in the Value
// tab; CoinMarketCap then takes precedence. See crates/supervisor/src/price.rs.
const DEFAULTS: ValueSettings = { currencies: ["USD"], display: "USD", cmcKey: "", useCoingecko: true };

export function getValueSettings(): ValueSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && Array.isArray(v.currencies) && v.currencies.length) {
      // The user's saved choices win outright. An earlier version forced
      // CoinGecko back on here whenever no CMC key was stored — which quietly
      // re-checked the box every time the panel reopened, undoing a deliberate
      // "turn CoinGecko off". Never override an explicit setting; a fresh install
      // still starts with CoinGecko on via DEFAULTS.
      return { ...DEFAULTS, ...v };
    }
  } catch {
    /* fall through */
  }
  return DEFAULTS;
}

export function setValueSettings(s: ValueSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("dd69-value-changed"));
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", JPY: "¥", GBP: "£", CNY: "¥", AUD: "A$", CAD: "C$", CHF: "Fr",
  HKD: "HK$", SGD: "S$", SEK: "kr", KRW: "₩", NOK: "kr", NZD: "NZ$", INR: "₹", MXN: "$",
  TWD: "NT$", ZAR: "R", BRL: "R$", DKK: "kr", PLN: "zł", THB: "฿", ILS: "₪", IDR: "Rp",
  CZK: "Kč", TRY: "₺", HUF: "Ft", CLP: "$", PHP: "₱", MYR: "RM", COP: "$", RUB: "₽",
  RON: "lei", PEN: "S/", ARS: "$", VND: "₫", EGP: "£", NGN: "₦", BDT: "৳", PKR: "₨",
  UAH: "₴", KZT: "₸", GHS: "₵", LKR: "₨", NPR: "₨", UYU: "$U", BGN: "лв", CRC: "₡",
  AED: "د.إ", SAR: "﷼", QAR: "﷼", KWD: "د.ك", BHD: "ب.د", OMR: "﷼", MAD: "د.م", DZD: "د.ج",
  KES: "Sh", ETB: "Br", MMK: "K", IQD: "ع.د", VES: "Bs",
};
export const symbolFor = (code: string) => CURRENCY_SYMBOLS[code.toUpperCase()] ?? "";

// How many decimals to show. Normal money gets 2. A sub-cent amount — like the
// price of ONE DIVI (~$0.0013) — would round to "$0.00" at 2 decimals, so below
// a cent we widen to keep ~4 significant figures (0.001332, 0.00004521, …).
// This serves both the per-DIVI price preview and any small balance value.
function decimalsFor(amount: number): number {
  const abs = Math.abs(amount);
  if (abs === 0 || abs >= 0.01) return 2;
  const leadingZeros = Math.floor(-Math.log10(abs)); // 0.001332 → 2
  return Math.min(leadingZeros + 4, 10);
}

// Value + code split so callers can style the code (e.g. small grey "USD").
export function fiatParts(amount: number, code: string): { value: string; code: string } {
  const n = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimalsFor(amount),
  });
  return { value: `${symbolFor(code)}${n}`, code: code.toUpperCase() };
}

export function formatFiat(amount: number, code: string): string {
  const p = fiatParts(amount, code);
  return `${p.value} ${p.code}`;
}

// Module-level cache shared across components; short TTL to stay live but light.
let cache: { at: number; data: DiviPrices } | null = null;
let inflight: Promise<DiviPrices> | null = null;
const TTL = 90_000;

export async function fetchPrices(force = false): Promise<DiviPrices> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  if (inflight) return inflight;
  const s = getValueSettings();
  inflight = diviPrices(s.currencies, s.cmcKey, s.useCoingecko)
    .then((d) => {
      cache = { at: Date.now(), data: d };
      return d;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The fiat value of a DIVI amount, or an explicit reason it can't be shown.
 *
 * This used to return null for every failure, and the header rendered it as
 * `{fiat && ...}` — so a price outage made the value silently VANISH with no
 * explanation, which reads as a bug rather than a missing price. A value is
 * never fabricated, but its absence is now always explained.
 */
export type DiviValue =
  | { state: "ok"; value: string; code: string; recovered?: boolean }
  | { state: "loading" }
  | { state: "unavailable"; reason: string };

/** Normal refresh once a price is flowing. */
const OK_INTERVAL = 120_000;
/** Faster while broken, so a recovery is noticed quickly rather than up to two
 *  minutes later — the point is that it visibly heals itself. */
const RETRY_INTERVAL = 30_000;
/** How long the "it came back" signal stays on screen. */
const RECOVERED_MS = 6_000;

export function useDiviValue(diviAmount: number | null): DiviValue {
  const [prices, setPrices] = useState<DiviPrices | null>(cache?.data ?? null);
  const [display, setDisplay] = useState(() => getValueSettings().display);
  const [failed, setFailed] = useState(false);
  // Set briefly when a price returns after a failure, so the UI can show that
  // it healed rather than silently flipping back as if nothing happened.
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let wasFailing = false;

    const schedule = (broken: boolean) => {
      window.clearTimeout(timer);
      // Retry quickly while broken; settle back to the slow poll once healthy.
      timer = window.setTimeout(() => run(), broken ? RETRY_INTERVAL : OK_INTERVAL);
    };

    const run = (force = false) =>
      fetchPrices(force)
        .then((d) => {
          if (!alive) return;
          setPrices(d);
          setFailed(false);
          if (wasFailing) {
            wasFailing = false;
            setRecovered(true);
            window.setTimeout(() => alive && setRecovered(false), RECOVERED_MS);
          }
          schedule(false);
        })
        .catch(() => {
          if (!alive) return;
          wasFailing = true;
          setFailed(true);
          schedule(true);
        });

    const onChange = () => {
      setDisplay(getValueSettings().display);
      run(true);
    };
    run();
    window.addEventListener("dd69-value-changed", onChange);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("dd69-value-changed", onChange);
    };
  }, []);

  if (diviAmount == null) return { state: "loading" };

  if (!prices) {
    return failed
      ? { state: "unavailable", reason: "Checking price availability" }
      : { state: "loading" };
  }

  const per = prices.prices[display.toLowerCase()];
  if (per == null) {
    // We reached a price source but it doesn't quote this currency — a
    // different problem from being offline, and worth saying so.
    return { state: "unavailable", reason: `No ${display} price` };
  }
  return { state: "ok", ...fiatParts(diviAmount * per, display), recovered };
}
