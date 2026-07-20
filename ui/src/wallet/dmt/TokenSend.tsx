import { useEffect, useState } from "react";
import { validateAddress, walletAddresses } from "../api";
import {
  dmtBalances,
  dmtTokensMeta,
  formatAmount,
  parseAmount,
  type TokenBalance,
  type TokenMeta,
} from "./api";

// Send tokens. `canSend` is false whenever the index can't be trusted — stale,
// halted, or (today) not built. A wallet that spends from state it knows may be
// wrong is worse than one that refuses.

export function TokenSend({ canSend }: { canSend: boolean }) {
  const [rows, setRows] = useState<{ bal: TokenBalance; meta: TokenMeta | null }[]>([]);
  const [tokenId, setTokenId] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [addrOk, setAddrOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const addrs = await walletAddresses().catch(() => []);
      const bals = await dmtBalances(addrs.map((a) => a.address));
      const metas = await dmtTokensMeta(bals.map((b) => b.tokenId));
      if (!alive) return;
      const r = bals.map((bal) => ({
        bal,
        meta: metas.find((m) => m.tokenId === bal.tokenId) ?? null,
      }));
      setRows(r);
      if (r.length && !tokenId) setTokenId(r[0].bal.tokenId);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check the destination against the node, debounced. Sending tokens to an
  // address that doesn't exist would lose them with no way back.
  useEffect(() => {
    const a = to.trim();
    if (!a) {
      setAddrOk(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      validateAddress(a)
        .then((ok) => alive && setAddrOk(ok))
        .catch(() => alive && setAddrOk(null));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [to]);

  const sel = rows.find((r) => r.bal.tokenId === tokenId);
  const decimals = sel?.meta?.decimals ?? 0;
  const units = parseAmount(amount, decimals);
  const overBalance = units != null && sel != null && BigInt(units) > BigInt(sel.bal.amount);
  const amountBad = amount.trim() !== "" && units === null;

  return (
    <div className="dmt-form">
      <label className="dmt-field">
        <span>Token</span>
        <select
          className="wl-input"
          value={tokenId}
          onChange={(e) => {
            setTokenId(e.target.value);
            setAmount("");
          }}
          disabled={!rows.length}
        >
          {rows.length === 0 && <option>No tokens held</option>}
          {rows.map(({ bal, meta }) => (
            <option key={bal.tokenId} value={bal.tokenId}>
              {meta?.ticker ?? bal.tokenId} — {formatAmount(bal.amount, meta?.decimals ?? 0)}{" "}
              available
            </option>
          ))}
        </select>
      </label>

      <label className="dmt-field">
        <span>To address</span>
        <input
          className="wl-input"
          placeholder="Divi address"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          spellCheck={false}
        />
      </label>
      {to.trim() && addrOk === false && (
        <p className="wl-err">That isn’t a valid Divi address.</p>
      )}

      <label className="dmt-field">
        <span>
          Amount
          {decimals === 0 && <em className="dmt-hint"> — whole units only</em>}
        </span>
        <input
          className="wl-input"
          placeholder={decimals === 0 ? "e.g. 3" : "0.00"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
      </label>
      {amountBad && (
        <p className="wl-err">
          {decimals === 0
            ? "This token can’t be split — enter a whole number."
            : `Use at most ${decimals} decimal places.`}
        </p>
      )}
      {overBalance && <p className="wl-err">That’s more than you hold.</p>}

      <button
        className="wl-btn wl-btn-primary"
        disabled={!canSend || !sel || !units || units === "0" || overBalance || addrOk !== true}
      >
        Send tokens
      </button>

      {!canSend && (
        <p className="wl-note">
          {/* Deliberately explicit about WHY, rather than a disabled button with
              no explanation. */}
          Sending is unavailable until the token index is running and up to date with the chain.
        </p>
      )}
    </div>
  );
}
