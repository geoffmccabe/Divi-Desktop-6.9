import { useEffect, useState } from "react";
import { openUrl, type DiviPrices } from "../../wallet/api";
import {
  getValueSettings,
  setValueSettings,
  fetchPrices,
  formatFiat,
  type ValueSettings,
} from "../../wallet/value";

// Admin → Value. Configures DIVI price discovery (CoinMarketCap active,
// CoinGecko built-but-off) and which fiat currencies to offer. The Spendable
// card shows the value in the chosen display currency.

const COMMON = ["USD", "EUR", "GBP", "CRC", "CAD", "AUD", "MXN", "JPY", "CHF", "BRL", "INR", "CNY", "KRW"];

export function ValuePanel() {
  const [s, setS] = useState<ValueSettings>(() => getValueSettings());
  const [add, setAdd] = useState("");
  const [prices, setPrices] = useState<DiviPrices | null>(null);
  const [loading, setLoading] = useState(false);

  // Persist + refresh the shared price cache/preview on any change.
  const update = (partial: Partial<ValueSettings>) => {
    const next = { ...s, ...partial };
    setS(next);
    setValueSettings(next);
  };

  const refresh = () => {
    setLoading(true);
    fetchPrices(true)
      .then(setPrices)
      .catch(() => setPrices(null))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [s.cmcKey, s.useCoingecko, s.currencies.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const addCurrency = (codeRaw: string) => {
    const code = codeRaw.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || s.currencies.includes(code)) return;
    update({ currencies: [...s.currencies, code] });
    setAdd("");
  };

  const removeCurrency = (code: string) => {
    if (s.currencies.length <= 1) return; // keep at least one
    const currencies = s.currencies.filter((c) => c !== code);
    const display = s.display === code ? currencies[0] : s.display;
    update({ currencies, display });
  };

  return (
    <div className="value-panel">
      <section className="style-group">
        <h3>Price sources</h3>
        <p className="set-note">
          DIVI’s price comes from <strong>CoinMarketCap</strong> (needs a free API key). Other
          currencies are converted from USD with live exchange rates, so you can add any fiat without
          extra CMC usage.
        </p>

        <label className="value-field">
          <span className="send-label">CoinMarketCap API key</span>
          <input
            className="wl-input"
            type="password"
            value={s.cmcKey}
            placeholder="Paste your CMC key…"
            onChange={(e) => update({ cmcKey: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="wl-link"
          onClick={() => openUrl("https://coinmarketcap.com/api/")}
        >
          Get a free CoinMarketCap key →
        </button>

        <label className="value-toggle">
          <input
            type="checkbox"
            checked={s.useCoingecko}
            onChange={(e) => update({ useCoingecko: e.target.checked })}
          />
          <span>
            Also use CoinGecko <span className="set-note">(off — DIVI has no active markets there yet)</span>
          </span>
        </label>

        <div className="value-status">
          <span className={prices?.coinmarketcapOk ? "src-ok" : "src-off"}>
            CoinMarketCap {prices?.coinmarketcapOk ? "✓" : "—"}
          </span>
          <span className={prices?.coingeckoOk ? "src-ok" : "src-off"}>
            CoinGecko {prices?.coingeckoOk ? "✓" : s.useCoingecko ? "—" : "off"}
          </span>
          <button type="button" className="wl-link" onClick={refresh} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </section>

      <section className="style-group">
        <h3>Currencies</h3>
        <p className="set-note">Pick the one shown on the Spendable card (the dot).</p>
        <ul className="value-cur-list">
          {s.currencies.map((c) => {
            const per = prices?.prices[c.toLowerCase()];
            return (
              <li key={c} className="value-cur">
                <label className="value-cur-pick">
                  <input
                    type="radio"
                    name="displaycur"
                    checked={s.display === c}
                    onChange={() => update({ display: c })}
                  />
                  <span className="value-cur-code">{c}</span>
                </label>
                <span className="value-cur-price">{per != null ? formatFiat(per, c) + " / DIVI" : "—"}</span>
                <button type="button" className="value-cur-rm" onClick={() => removeCurrency(c)} disabled={s.currencies.length <= 1}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>

        <div className="value-add">
          <select className="wl-input" value="" onChange={(e) => addCurrency(e.target.value)}>
            <option value="">Add a currency…</option>
            {COMMON.filter((c) => !s.currencies.includes(c)).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            className="wl-input"
            value={add}
            placeholder="or ISO code"
            maxLength={3}
            onChange={(e) => setAdd(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && addCurrency(add)}
          />
          <button type="button" className="wl-btn" onClick={() => addCurrency(add)}>Add</button>
        </div>
      </section>
    </div>
  );
}
