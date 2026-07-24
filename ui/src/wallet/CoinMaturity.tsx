import { useEffect, useState } from "react";
import { coinMaturity, walletBalance, type Utxo } from "./api";
import { fmtDivi } from "../status";

// How long until a unix time, as "2d 3h 14m" / "48m 12s" — coarse when far off,
// second-by-second when close, so the wait feels alive at the end.
function countdown(unixTarget: number, nowMs: number): string {
  const s = Math.max(0, Math.round(unixTarget - nowMs / 1000));
  if (s === 0) return "ready";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}

export function CoinMaturity() {
  const [utxos, setUtxos] = useState<Utxo[] | null>(null);
  // Staking rewards that are confirmed but still immature don't appear in
  // listunspent, so they can't be itemized — but they show in the balance's
  // "immature" total. We surface that as an aggregate line so the panel matches
  // what the header shows as "maturing".
  const [immature, setImmature] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [u, b] = await Promise.all([coinMaturity(), walletBalance()]);
        if (!alive) return;
        setUtxos(u);
        setImmature(b?.immature ?? 0);
      } catch {
        /* node busy — keep last */
      }
    };
    load();
    const poll = setInterval(load, 30000); // refresh confirmations
    const tick = setInterval(() => setNow(Date.now()), 1000); // live countdown
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const list = utxos ?? [];
  const maturing = list.filter((u) => !u.matured);
  const maturingTotal = maturing.reduce((a, u) => a + u.amount, 0);

  return (
    <section className="set-section">
      <h3 className="set-title">Coin Maturity</h3>
      <p className="set-note">
        In Divi, coins you receive can’t stake right away. Each deposit has to “age” for about{" "}
        <strong>1 hour</strong> before it can join staking — a rule that keeps the network fair.
        Once a coin matures it stakes for good; you only wait again if you move it. Times below are
        approximate.
      </p>

      {utxos === null ? (
        <p className="wl-empty">Loading your coins…</p>
      ) : list.length === 0 && immature <= 0 ? (
        <p className="wl-empty">No coins in this wallet yet.</p>
      ) : (
        <>
          {maturing.length > 0 && (
            <div className="cm-summary">
              {fmtDivi(maturingTotal)} <em>DIVI</em> still maturing across {maturing.length}{" "}
              {maturing.length === 1 ? "deposit" : "deposits"}
            </div>
          )}
          {immature > 0 && (
            <div className="cm-rewards">
              {fmtDivi(immature)} <em>DIVI</em> in recent staking rewards is still maturing — these
              need ~20 confirmations (about 20 minutes) before they can restake.
            </div>
          )}
          <ul className="cm-list">
            {list.map((u, i) => (
              <li key={i} className={"cm-row" + (u.matured ? " cm-mature" : "")}>
                <div className="cm-row-top">
                  <span className="cm-amt">
                    {fmtDivi(u.amount)} <em>DIVI</em>
                  </span>
                  <span className="cm-when">
                    {u.matured ? "Ready to stake ✓" : countdown(u.stakeableAt, now)}
                  </span>
                </div>
                <div className="cm-bar">
                  <div className="cm-bar-fill" style={{ width: `${Math.round(u.pct)}%` }} />
                </div>
                <div className="cm-row-sub">
                  <span>{Math.round(u.pct)}% mature</span>
                  <span>{u.confirmations.toLocaleString()} confirmations</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
