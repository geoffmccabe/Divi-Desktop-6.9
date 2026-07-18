import { useEffect, useState } from "react";
import { diviPrices, type DiviPrices } from "./api";

// Admin-configured DIVI value settings + a shared, cached price fetch so the
// header value and the admin preview don't hammer the APIs independently.

export interface ValueSettings {
  currencies: string[]; // configured fiat codes (uppercase)
  display: string; // which one shows on the Spendable card
  cmcKey: string; // CoinMarketCap API key (CMC is the active source)
  useCoingecko: boolean; // built but off by default — no active DIVI markets there yet
}

const KEY = "dd69.value";
const DEFAULTS: ValueSettings = { currencies: ["USD"], display: "USD", cmcKey: "", useCoingecko: false };

export function getValueSettings(): ValueSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && Array.isArray(v.currencies) && v.currencies.length) return { ...DEFAULTS, ...v };
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

// Value + code split so callers can style the code (e.g. small grey "USD").
export function fiatParts(amount: number, code: string): { value: string; code: string } {
  const n = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// The fiat value of a DIVI amount in the display currency as {value, code}, or
// null if we have no price yet (never fabricated). Re-fetches every 2 min and on
// settings changes.
export function useDiviValue(diviAmount: number | null): { value: string; code: string } | null {
  const [prices, setPrices] = useState<DiviPrices | null>(cache?.data ?? null);
  const [display, setDisplay] = useState(() => getValueSettings().display);

  useEffect(() => {
    let alive = true;
    const load = (force = false) =>
      fetchPrices(force)
        .then((d) => alive && setPrices(d))
        .catch(() => {});
    const onChange = () => {
      setDisplay(getValueSettings().display);
      load(true);
    };
    load();
    const id = setInterval(() => load(), 120000);
    window.addEventListener("dd69-value-changed", onChange);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("dd69-value-changed", onChange);
    };
  }, []);

  if (diviAmount == null || !prices) return null;
  const per = prices.prices[display.toLowerCase()];
  if (per == null) return null;
  return fiatParts(diviAmount * per, display);
}
