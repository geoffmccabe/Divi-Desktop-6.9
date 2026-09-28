import type { ExtraWallet } from "./api";
import { fmtDivi } from "../status";
import { formatFiat, useDiviRate } from "./value";

// The per-wallet list under the header's Spendable figure, opened by the
// chevron right of "DIVI" once a node has extra wallets. Staking Wallet
// first (the node's own), then each extra wallet, each with DIVI and its
// value in the display currency, the way multi-account Solana wallets do.

export function WalletsDropdown({ open, nodeSpendable, wallets }: { open: boolean; nodeSpendable: number; wallets: ExtraWallet[] }) {
  const rate = useDiviRate();
  const fiat = (d: number) => (rate ? formatFiat(d * rate.per, rate.code) : "");
  const total = nodeSpendable + wallets.reduce((s, w) => s + w.divi, 0);
  return (
    <div className={"addr-dropdown" + (open ? " addr-dropdown-open" : "")} aria-hidden={!open}>
      <div className="addr-dropdown-inner">
        <ul className="addr-list">
          <li className="addr-row wd-row">
            <span className="wd-name">Staking Wallet <small>this node</small></span>
            <span className="wd-divi">{fmtDivi(nodeSpendable)} DIVI</span>
            <span className="wd-fiat">{fiat(nodeSpendable)}</span>
          </li>
          {wallets.map((w) => (
            <li key={w.id} className="addr-row wd-row">
              <span className="wd-name">{w.label} <small>{w.addresses.length} address{w.addresses.length === 1 ? "" : "es"}</small></span>
              <span className="wd-divi">{w.balanceKnown ? `${fmtDivi(w.divi)} DIVI` : "unknown"}</span>
              <span className="wd-fiat">{w.balanceKnown ? fiat(w.divi) : ""}</span>
            </li>
          ))}
          <li className="wd-row wd-total">
            <span className="wd-name">All wallets</span>
            <span className="wd-divi">{fmtDivi(total)} DIVI</span>
            <span className="wd-fiat">{fiat(total)}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
