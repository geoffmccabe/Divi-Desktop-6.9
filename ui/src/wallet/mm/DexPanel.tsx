// DEX tab: swap eDIVI on Uniswap V2 (eDIVI/WETH on Ethereum). Phase 1 is live
// pricing + quotes read straight from the pool (read-only, via the backend). The
// MetaMask connect + signed swap is the next phase.
//
// Layout: a wide DEX area with two stacked panels. Each panel is a small logo box
// on the left (15%) and the content on the right.

import { useEffect, useMemo, useState } from "react";
import { WagmiProvider, useAccount, useConnect, useDisconnect } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { dexPool, type DexPool } from "../api";
import { evmConfig, dexQueryClient, shortAddr } from "./dexEvm";
import uniswapLogo from "../../assets/uniswap.svg";
import metamaskLogo from "../../assets/metamask.svg";
import "./dex-panel.css";

const usd = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
// Small prices ($0.0004) need significant-digit precision, not 2 decimals.
const usdPrice = (n: number) =>
  n <= 0 ? "-" : "$" + n.toLocaleString(undefined, n >= 1 ? { maximumFractionDigits: 2 } : { maximumSignificantDigits: 4 });
const num = (n: number, dp: number) => n.toLocaleString(undefined, { maximumFractionDigits: dp });

// Uniswap V2 constant-product output, 0.3% fee. Works in human units.
function amountOut(amtIn: number, rIn: number, rOut: number): number {
  if (amtIn <= 0 || rIn <= 0 || rOut <= 0) return 0;
  const inWithFee = amtIn * 0.997;
  return (inWithFee * rOut) / (rIn + inWithFee);
}

function DexInner() {
  const [pool, setPool] = useState<DexPool | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dir, setDir] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("");
  const [slip, setSlip] = useState(1); // slippage tolerance %
  const [diag, setDiag] = useState<string[]>([]); // temporary connection diagnostics

  // MetaMask (mobile via QR in this desktop app), reusing the lw-sso wagmi stack.
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting, error: connectErr } = useConnect();
  const { disconnect } = useDisconnect();
  const mmConnector = connectors.find((c) => c.id === "walletConnect") ?? connectors[0];

  // Surface CSP blocks + websocket errors right in the UI so we can see exactly
  // what the connection is failing on, without needing the dev console.
  useEffect(() => {
    const push = (s: string) => setDiag((d) => [...d, s].slice(-10));
    const onCsp = (e: SecurityPolicyViolationEvent) =>
      push(`CSP blocked ${e.blockedURI || "?"} [${e.effectiveDirective || e.violatedDirective}]`);
    const onErr = (e: ErrorEvent) => { if (e.message) push(`err: ${e.message}`); };
    const onRej = (e: PromiseRejectionEvent) => push(`reject: ${String(e.reason?.message || e.reason).slice(0, 160)}`);
    document.addEventListener("securitypolicyviolation", onCsp);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      document.removeEventListener("securitypolicyviolation", onCsp);
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      dexPool().then((p) => { if (alive) { setPool(p); setErr(null); } }).catch((e) => { if (alive) setErr(String(e)); });
    tick();
    const id = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const priceEth = pool && pool.reserveEdivi > 0 ? pool.reserveWeth / pool.reserveEdivi : 0;
  const priceUsd = priceEth * (pool?.ethUsd ?? 0);
  const liqUsd = pool ? pool.reserveWeth * (pool.ethUsd ?? 0) * 2 : 0;

  const a = parseFloat(amt) || 0;
  const quote = useMemo(() => {
    if (!pool || a <= 0) return null;
    if (dir === "buy") {
      const out = amountOut(a, pool.reserveWeth, pool.reserveEdivi);
      return { out, inUsd: a * (pool.ethUsd ?? 0), outUsd: out * priceUsd };
    }
    const out = amountOut(a, pool.reserveEdivi, pool.reserveWeth);
    return { out, inUsd: a * priceUsd, outUsd: out * (pool.ethUsd ?? 0) };
  }, [pool, a, dir, priceUsd]);

  // The "smart decision" details Uniswap users expect: rate, price impact (how much
  // this trade moves the price - big on a thin pool), and minimum received after
  // slippage tolerance.
  const details = useMemo(() => {
    if (!pool || !quote || a <= 0) return null;
    const rIn = dir === "buy" ? pool.reserveWeth : pool.reserveEdivi;
    const impact = Math.min(100, (a / (rIn + a)) * 100);
    return { impact, minOut: quote.out * (1 - slip / 100), rate: quote.out / a };
  }, [pool, quote, a, dir, slip]);

  return (
    <div className="dex-wrap">
      {/* Uniswap swap panel */}
      <section className="ts-section dex-panel">
        <div className="dex-row">
          <div className="dex-logo-box"><img className="dex-logo" src={uniswapLogo} alt="Uniswap" /><span className="dex-logo-label">UNISWAP</span></div>
          <div className="dex-body">
            <h3 className="ts-head">Swap eDIVI on Uniswap</h3>
            {err && <p className="wl-note mmc-err">Couldn't read the pool: {err}</p>}
            {!pool && !err && <p className="wl-note">Reading the eDIVI / ETH pool…</p>}
            {pool && (
              <>
                <div className="dex-stats">
                  <div><span className="dex-k">eDIVI price</span><span className="dex-v">{priceUsd > 0 ? usdPrice(priceUsd) : `${priceEth.toExponential(3)} ETH`}</span></div>
                  <div><span className="dex-k">Pool liquidity</span><span className="dex-v">{usd(liqUsd)}</span></div>
                  <div><span className="dex-k">In the pool</span><span className="dex-v">{num(pool.reserveEdivi, 0)} eDIVI · {num(pool.reserveWeth, 3)} ETH</span></div>
                </div>

                <div className="dex-swap">
                  <label className="value-field">
                    <span className="send-label">You pay ({dir === "buy" ? "ETH" : "eDIVI"})</span>
                    <input className="wl-input" type="number" min={0} value={amt} placeholder="0.0" onChange={(e) => setAmt(e.target.value)} />
                  </label>
                  <button type="button" className="dex-flip" title="Flip direction" onClick={() => { setDir((d) => (d === "buy" ? "sell" : "buy")); setAmt(""); }}>⇅</button>
                  <label className="value-field">
                    <span className="send-label">You receive ({dir === "buy" ? "eDIVI" : "ETH"})</span>
                    <div className="wl-input dex-out">{quote ? num(quote.out, dir === "buy" ? 0 : 6) : "0.0"}</div>
                  </label>
                </div>

                {quote && details && (
                  <div className="dex-details">
                    <div className="dex-drow"><span>Rate</span><span>1 {dir === "buy" ? "ETH" : "eDIVI"} ≈ {num(details.rate, dir === "buy" ? 0 : 8)} {dir === "buy" ? "eDIVI" : "ETH"}</span></div>
                    <div className="dex-drow"><span>Price impact</span><span className={details.impact >= 5 ? "dex-hi" : ""}>{details.impact.toFixed(2)}%</span></div>
                    <div className="dex-drow"><span>Min received ({slip}% slippage)</span><span>{num(details.minOut, dir === "buy" ? 0 : 6)} {dir === "buy" ? "eDIVI" : "ETH"}</span></div>
                    <div className="dex-drow"><span>Value</span><span>{usd(quote.inUsd)} → {usd(quote.outUsd)}</span></div>
                    <div className="dex-drow"><span>Liquidity provider fee</span><span>0.3%</span></div>
                  </div>
                )}

                <div className="dex-slip">
                  <span className="send-label">Slippage tolerance</span>
                  {[0.5, 1, 3].map((s) => (
                    <button key={s} type="button" className={"dex-slip-btn" + (slip === s ? " dex-slip-on" : "")} onClick={() => setSlip(s)}>{s}%</button>
                  ))}
                </div>

                <p className="wl-note dex-foot">Live from the Uniswap V2 eDIVI / ETH pool on Ethereum. A big price impact means the pool is thin, so smaller trades move the price less.</p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* MetaMask connect panel */}
      <section className="ts-section dex-panel">
        <div className="dex-row">
          <div className="dex-logo-box"><img className="dex-logo" src={metamaskLogo} alt="MetaMask" /><span className="dex-logo-label">METAMASK</span></div>
          <div className="dex-body">
            <h3 className="ts-head">Connect your wallet</h3>
            {isConnected ? (
              <>
                <p className="wl-note gov-wide">Connected: <strong>{shortAddr(address)}</strong></p>
                <button type="button" className="wl-btn dex-connect-btn" onClick={() => disconnect()}>Disconnect</button>
              </>
            ) : (
              <>
                <p className="wl-note gov-wide">
                  Connect your own MetaMask to sign swaps. Your keys never leave your wallet, and this app never holds them.
                  In this desktop app you connect by scanning a QR code with the MetaMask app on your phone.
                </p>
                <button type="button" className="wl-btn wl-btn-primary dex-connect-btn" disabled={connecting || !mmConnector}
                  onClick={() => mmConnector && connect({ connector: mmConnector })}>
                  {connecting ? "Connecting…" : "Connect MetaMask"}
                </button>
                {connectErr && <p className="wl-note mmc-err">Failed to connect to MetaMask. Make sure you approved it on your phone, then try again.</p>}
                {(connectErr || diag.length > 0) && (
                  <details className="dex-details" style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.75rem" }}>Diagnostics (for debugging)</summary>
                    {connectErr && <div className="dex-drow"><span>Error</span><span style={{ maxWidth: "72%", wordBreak: "break-all", textAlign: "right" }}>{connectErr.message}</span></div>}
                    {diag.map((d, i) => <div key={i} className="dex-drow"><span>#{i + 1}</span><span style={{ maxWidth: "72%", wordBreak: "break-all", textAlign: "right" }}>{d}</span></div>)}
                    {diag.length === 0 && !connectErr && <div className="dex-drow"><span>(no blocks recorded)</span><span /></div>}
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// The wagmi/query providers mount only when the DEX tab is shown, so the MetaMask
// SDK does not initialise until the user actually opens DEX.
export function DexPanel() {
  return (
    <WagmiProvider config={evmConfig}>
      <QueryClientProvider client={dexQueryClient}>
        <DexInner />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
