import { useEffect, useState } from "react";
import { dmtTickerStatus, parseAmount, type TickerStatus } from "./api";

// Create a token. The ticker is claimed with commit-reveal (spec §7): you
// publish a commitment, wait ~12 blocks, then reveal. Divi's 60-second blocks
// make that about twelve minutes, against roughly two hours on Bitcoin.
//
// Spec §11.5 is explicit that the wait is presented as PROTECTION, not as an
// apology for a delay — because that is what it is. Without it, anyone watching
// the mempool could see your chosen ticker and register it first.

export function TokenCreate({ canSend }: { canSend: boolean }) {
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [decimals, setDecimals] = useState(8);
  const [supply, setSupply] = useState("");
  const [status, setStatus] = useState<TickerStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const clean = ticker.trim().toUpperCase();

  useEffect(() => {
    if (!clean) {
      setStatus(null);
      return;
    }
    let alive = true;
    setChecking(true);
    const t = setTimeout(() => {
      dmtTickerStatus(clean)
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus(null))
        .finally(() => alive && setChecking(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [clean]);

  const units = parseAmount(supply, decimals);
  const supplyBad = supply.trim() !== "" && units === null;

  return (
    <div className="dmt-form">
      <p className="wl-note">
        Issue your own token on the Divi blockchain: a currency, a run of tickets, membership passes,
        credits, or a community token. You set how it behaves.
      </p>

      <label className="dmt-field">
        <span>Ticker</span>
        <input
          className="wl-input mono"
          placeholder="e.g. MYTOKEN"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          maxLength={16}
          spellCheck={false}
        />
      </label>
      {clean && (
        <p className={status?.taken ? "wl-err" : "wl-note"}>
          {checking
            ? "Checking availability…"
            : status?.taken
              ? `${clean} is already registered.`
              : status?.priceDivi != null
                ? `${clean} is available. Registration costs ${status.priceDivi.toLocaleString()} DIVI.`
                : `Availability and pricing appear here once the token index is running. Shorter tickers cost more.`}
        </p>
      )}

      <label className="dmt-field">
        <span>Token name</span>
        <input
          className="wl-input"
          placeholder="e.g. My Community Token"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
        />
      </label>

      <label className="dmt-field">
        <span>Divisibility</span>
        <select
          className="wl-input"
          value={decimals}
          onChange={(e) => {
            setDecimals(Number(e.target.value));
            setSupply("");
          }}
        >
          <option value={0}>Indivisible — whole units only (tickets, passes, licences)</option>
          <option value={2}>2 decimal places (like pounds and pence)</option>
          <option value={8}>8 decimal places (like DIVI itself)</option>
        </select>
      </label>
      <p className="wl-note dmt-hint">
        {decimals === 0
          ? "Holders can own 3 of these, never 3.5. This can’t be changed later."
          : `Holders can own fractions down to ${decimals} decimal places. This can’t be changed later.`}
      </p>

      <label className="dmt-field">
        <span>Total supply</span>
        <input
          className="wl-input"
          placeholder={decimals === 0 ? "e.g. 500" : "e.g. 21000000"}
          value={supply}
          onChange={(e) => setSupply(e.target.value)}
          inputMode="decimal"
        />
      </label>
      {supplyBad && (
        <p className="wl-err">
          {decimals === 0
            ? "Indivisible tokens need a whole number."
            : `Use at most ${decimals} decimal places.`}
        </p>
      )}

      {/* The wait is the feature. Say so. */}
      <div className="dmt-steps">
        <div className="dmt-steps-head">How claiming a ticker works</div>
        <ol>
          <li>
            <strong>Claim privately.</strong> Your wallet publishes a sealed commitment to the
            ticker — the name itself isn’t revealed.
          </li>
          <li>
            <strong>About twelve minutes pass.</strong> This gap is what stops anyone watching the
            network from seeing your ticker and grabbing it first. On Bitcoin the same protection
            takes around two hours; Divi’s faster blocks make it twelve minutes.
          </li>
          <li>
            <strong>Reveal and issue.</strong> The ticker is recorded as yours, and the token
            exists.
          </li>
        </ol>
      </div>

      <button
        className="wl-btn wl-btn-primary"
        disabled={!canSend || !clean || !name.trim() || !units || units === "0" || status?.taken}
      >
        Claim ticker
      </button>

      {!canSend && (
        <p className="wl-note">
          Creating tokens is unavailable until the token index is running and up to date.
        </p>
      )}
    </div>
  );
}
