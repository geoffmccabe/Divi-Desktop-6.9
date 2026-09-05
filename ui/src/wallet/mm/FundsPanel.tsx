// Funds panel: per coin, the icon + name on the left, then Available / Committed /
// Total stacked on the right. "Committed" is what's locked in resting orders, so
// Total = Available + Committed. Balances are fetched by the parent and passed in.

import { type ReactNode } from "react";
import { type MmBalance } from "../api";
import diviCoin from "../../assets/divi-coin.webp";
import "./funds-panel.css";

const fmt = (n: number, dp: number) => n.toLocaleString(undefined, { maximumFractionDigits: dp });

// Tether's brand mark: white ₮ on the teal disc.
const TetherIcon = () => (
  <svg className="funds-coin" viewBox="0 0 40 40" role="img" aria-label="Tether">
    <circle cx="20" cy="20" r="20" fill="#26a17b" />
    <rect x="8.5" y="10.5" width="23" height="4.3" rx="1.2" fill="#fff" />
    <rect x="17.85" y="10.5" width="4.3" height="19" rx="1.2" fill="#fff" />
    <rect x="12" y="17.4" width="16" height="3.7" rx="1.2" fill="#fff" />
  </svg>
);

export function FundsPanel({ symbol, bals }: { symbol: string; bals: MmBalance[] | null }) {
  if (!bals) return null;
  const [base, quote] = symbol.replace("-", "/").split("/");
  const balOf = (a: string) => bals.find((b) => b.asset.toUpperCase() === a.toUpperCase());

  const Coin = ({ asset, icon, dp, pre }: { asset: string; icon: ReactNode; dp: number; pre: string }) => {
    const b = balOf(asset);
    const avail = b?.free ?? 0;
    const committed = b?.locked ?? 0;
    const show = (n: number) => `${pre}${fmt(n, dp)}`;
    return (
      <div className="funds-item">
        <div className="funds-idname">
          {icon}
          <span className="funds-name">{asset}</span>
        </div>
        <div className="funds-cols">
          <div className="funds-line"><span className="funds-k">Available:</span><span className="funds-v">{show(avail)}</span></div>
          <div className="funds-line"><span className="funds-k">Committed:</span><span className="funds-v">{show(committed)}</span></div>
          <div className="funds-line funds-total"><span className="funds-k">Total:</span><span className="funds-v">{show(avail + committed)}</span></div>
        </div>
      </div>
    );
  };

  return (
    <section className="ts-section funds-panel">
      <Coin asset={quote} icon={<TetherIcon />} dp={2} pre="$" />
      <Coin asset={base} icon={<img className="funds-coin" src={diviCoin} alt="" />} dp={0} pre="" />
    </section>
  );
}
