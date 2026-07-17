import { useEffect, useState } from "react";
import { stakingWallets, lotteryWins, type StakeWallet, type LotteryWin } from "./api";
import { loadNames } from "./addressNames";
import { fmtDivi } from "../status";
import { Icon } from "../Icon";

// Opened from the Staking header panel: every staking address by size, with its
// stake count, first/last stake dates, and big/small lottery wins.
//
// Lottery wins come from scanning historical lottery blocks (getlotteryblockwinners);
// treat them as provisional until verified against a synced mainnet node.

function fmtDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StakeRow({ w, win, name }: { w: StakeWallet; win?: LotteryWin; name?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(w.address);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <li className="stake-row">
      <div className="stake-row-top">
        <span className="stake-size">
          {fmtDivi(w.size)} <em>DIVI</em>
        </span>
        {name && <span className="stake-name">{name}</span>}
        <button type="button" className="icon-btn" title={copied ? "Copied!" : "Copy address"} onClick={copy}>
          <Icon name="copy" size={14} />
        </button>
      </div>
      <div className="stake-full">{w.address}</div>
      <div className="stake-meta">
        <span>{w.stakes.toLocaleString()} stakes</span>
        <span className="stake-win-big">🏆 {win?.big ?? 0} big</span>
        <span className="stake-win-small">🎟 {win?.small ?? 0} small</span>
        <span>first {fmtDate(w.firstStake)}</span>
        <span>last {fmtDate(w.lastStake)}</span>
      </div>
    </li>
  );
}

export function StakingDropdown({ open }: { open: boolean }) {
  const [render, setRender] = useState(open);
  const [wallets, setWallets] = useState<StakeWallet[] | null>(null);
  const [wins, setWins] = useState<Record<string, LotteryWin>>({});
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  // Load the (cheap) wallet list whenever the panel opens; then kick off the
  // (slower) lottery-win scan in the background.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const w = await stakingWallets();
        if (!alive) return;
        setWallets(w);
        if (w.length) {
          setScanning(true);
          const won = await lotteryWins(w.map((x) => x.address));
          if (!alive) return;
          const map: Record<string, LotteryWin> = {};
          for (const x of won) map[x.address] = x;
          setWins(map);
        }
      } catch {
        /* keep whatever we have */
      } finally {
        if (alive) setScanning(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  if (!render) return null;
  const names = loadNames();
  const list = wallets ?? [];

  return (
    <div
      className={"stake-dropdown glass-panel" + (open ? " stake-dropdown-open" : "")}
      onTransitionEnd={() => {
        if (!open) setRender(false);
      }}
    >
      <div className="stake-dropdown-inner">
        {wallets === null ? (
          <p className="wl-empty">Loading staking wallets…</p>
        ) : list.length === 0 ? (
          <p className="wl-empty">No staking coins yet.</p>
        ) : (
          <>
            {scanning && <p className="stake-scan">Counting lottery wins from the chain…</p>}
            <ul className="stake-list">
              {list.map((w) => (
                <StakeRow key={w.address} w={w} win={wins[w.address]} name={names[w.address]} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
