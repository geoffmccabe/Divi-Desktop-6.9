import { useEffect, useState } from "react";
import { walletAddresses } from "../api";
import {
  dmtBalances,
  dmtTokensMeta,
  formatAmount,
  type TokenBalance,
  type TokenMeta,
} from "./api";

// Holdings, one row per token. Note there is no "protect this coin" control
// anywhere here: under the address-balance model nothing can eat a token by
// accident, so a guard would only imply a danger that isn't real (spec §11.3).

export function TokenList() {
  const [rows, setRows] = useState<{ bal: TokenBalance; meta: TokenMeta | null }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const addrs = await walletAddresses().catch(() => []);
        const bals = await dmtBalances(addrs.map((a) => a.address));
        const metas = await dmtTokensMeta(bals.map((b) => b.tokenId));
        if (!alive) return;
        setRows(
          bals.map((bal) => ({
            bal,
            meta: metas.find((m) => m.tokenId === bal.tokenId) ?? null,
          })),
        );
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (err) return <p className="wl-err">{err}</p>;
  if (!rows) return <p className="muted">Loading your tokens…</p>;
  if (!rows.length) {
    return (
      <p className="wl-note">
        No tokens yet. Tokens you’re sent will appear here automatically — there’s nothing to switch
        on and nothing to keep safe from your own wallet.
      </p>
    );
  }

  return (
    <div className="dmt-list">
      <div className="table-scroll">
        <table className="dmt-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Ticker</th>
              <th style={{ textAlign: "right" }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ bal, meta }) => (
              <tr key={bal.tokenId}>
                <td>
                  <div className="dmt-name">{meta?.name ?? "Unknown token"}</div>
                  <div className="dmt-sub mono">{bal.tokenId}</div>
                </td>
                <td>
                  <span className="dmt-ticker">{meta?.ticker ?? "—"}</span>
                  {meta?.decimals === 0 && (
                    <span
                      className="badge dmt-badge-whole"
                      title="This token cannot be divided — you can hold 3, never 3.5."
                    >
                      WHOLE UNITS
                    </span>
                  )}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {/* decimals is a DISPLAY concern only; the stored amount is
                      always an integer in the smallest unit. */}
                  {formatAmount(bal.amount, meta?.decimals ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Spec §11.2: a transfer is an ordinary Divi transaction, so the address
          holding tokens must be able to pay for one. Warn before it bites. */}
      <p className="wl-note dmt-reserve">
        Keep a little DIVI in this wallet. Sending a token is a normal Divi transaction, so it needs
        a small fee — without it, tokens can be received but not moved.
      </p>
    </div>
  );
}
