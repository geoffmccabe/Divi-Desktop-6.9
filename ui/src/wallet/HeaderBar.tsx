import { useEffect, useRef, useState } from "react";
import { walletBalance, walletAddresses, lotteryInfo, type Balance, type AddrInfo, type LotteryInfo } from "./api";
import { nodeStatus } from "../bridge";
import { fmtDiviParts } from "../status";
import { AddressDropdown } from "./AddressDropdown";
import { StakingDropdown, StartStaking } from "./StakingDropdown";
import { LotteryDropdown } from "./LotteryDropdown";
import { LotteryCountdown } from "./LotteryCountdown";
import { useDiviValue } from "./value";
import { Icon } from "../Icon";

type OpenPanel = null | "staking" | "addresses" | "lottery";

export function HeaderBar() {
  const [bal, setBal] = useState<Balance | null>(null);
  const [addrs, setAddrs] = useState<AddrInfo[] | null>(null);
  const [lottery, setLottery] = useState<LotteryInfo | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  /* A balance is only the whole truth once the node has read the whole
     chain. Until then the wallet has not seen the blocks that pay it, so a
     zero means "not counted yet", not "you have nothing". Showing a
     confident 0.00 mid-sync told a user his 10,000 DIVI had vanished when
     it was on chain, unspent, three thousand blocks deep. */
  const [caughtUp, setCaughtUp] = useState<boolean | null>(null);
  /* Not running at all, which is a different problem from being behind. */
  const [nodeDown, setNodeDown] = useState(false);
  const [headline, setHeadline] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Pull a fresh balance immediately (e.g. right after staking starts) so the
  // header can flip to green without waiting for the next 12s poll.
  const refreshBalance = () => {
    walletBalance()
      .then((b) => b && setBal(b))
      .catch(() => {
        /* keep last */
      });
  };

  useEffect(() => {
    let alive = true;
    // Light + frequent: balance and next-lottery timing (cheap RPC calls).
    const pollLight = async () => {
      try {
        const b = await walletBalance();
        if (alive && b) setBal(b);
      } catch {
        /* keep last */
      }
      try {
        const l = await lotteryInfo();
        if (alive && l) setLottery(l);
      } catch {
        /* keep last */
      }
      try {
        const st = await nodeStatus();
        if (alive) {
          /* Only a POSITIVE report changes this. "checking" means the node
             did not answer the sync question this cycle, and "no-peers" is
             about the network, not about the balance being wrong -- neither
             is grounds for wiping a figure that was correct a moment ago.
             Pressing Start Staking used to do exactly that. */
          if (st.phase === "synced" || st.phase === "staking") setCaughtUp(true);
          else if (st.phase === "syncing") setCaughtUp(false);
          // A node that is not RUNNING is not "catching up". Treating every
          // non-synced state as syncing told a user whose node had never
          // started that it was "STILL SYNCING", forever, with nothing
          // syncing — which is worse than the misleading zero it replaced.
          setNodeDown(st.phase === "stopped" || st.phase === "crashed");
          setHeadline(st.headline ?? null);
        }
      } catch {
        /* keep the last answer rather than flapping the notice on and off */
      }
    };
    // Heavy + rare: the per-address tally scans a lot of history, and addresses
    // barely change — so it runs infrequently to spare the node's RPC threads.
    const pollAddrs = async () => {
      try {
        const a = await walletAddresses();
        if (alive && a.length) setAddrs(a);
      } catch {
        /* keep last */
      }
    };
    pollLight();
    pollAddrs();
    const idLight = setInterval(pollLight, 12000);
    const idAddrs = setInterval(pollAddrs, 90000);
    return () => {
      alive = false;
      clearInterval(idLight);
      clearInterval(idAddrs);
    };
  }, []);

  useEffect(() => {
    if (!openPanel) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenPanel(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openPanel]);

  const main = addrs?.find((a) => a.isMain) ?? addrs?.[0] ?? null;
  const syncing = caughtUp === false && !nodeDown;
  const spend = bal ? fmtDiviParts(bal.spendable) : null;
  const fiat = useDiviValue(bal && !syncing ? bal.spendable : null);

  const copyMain = async () => {
    if (!main) return;
    try {
      await navigator.clipboard.writeText(main.address);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const toggle = (p: Exclude<OpenPanel, null>) => setOpenPanel((cur) => (cur === p ? null : p));

  return (
    <div className="header-bar" ref={barRef}>
      {/* Spendable */}
      <div className="hdr-panel glass-panel">
        <span className="bl-label">Spendable</span>
        {/* No figure at all while the node is catching up. A number it cannot
            stand behind is worse than none: a zero reads as "your coins are
            gone" when they are on chain and merely not counted yet. No fiat
            line either, since there is nothing honest to convert. */}
        {nodeDown ? (
          <span className="bl-amt bl-amt-stack">
            <span className="bl-divi bl-down-amt">NODE NOT RUNNING</span>
            <span className="bl-fiat bl-sync-note">
              {headline ?? "Your balance cannot be read until the node starts."}
            </span>
            {/* Its own line. Run together with the reason above it, this ran off
                the edge of the panel and was unreadable. */}
            <span className="bl-fiat bl-sync-note bl-diag-hint">
              Press {navigator.platform.startsWith("Mac") ? "\u2318" : "Ctrl"}-L to copy a
              diagnostic report.
            </span>
          </span>
        ) : syncing ? (
          /* No explanatory second line here. One was added unasked and Geoff
             removed it; the label says enough. */
          <span className="bl-amt bl-amt-stack">
            <span className="bl-divi bl-sync-amt">STILL SYNCING…</span>
          </span>
        ) : (
        <span className="bl-amt bl-amt-stack">
          <span className="bl-divi">
            {spend ? (
              <>
                {spend.whole}
                {spend.frac && <span className="bl-frac">.{spend.frac}</span>}
              </>
            ) : (
              "—"
            )}{" "}
            <em>DIVI</em>
          </span>
          {fiat.state === "unavailable" ? (
            <span
              className="bl-fiat bl-fiat-missing"
              title="Retrying every 30 seconds. Add a CoinMarketCap key in Admin → Value, or check the connection."
            >
              <span className="bl-price-dot bl-price-dot-trying" /> {fiat.reason}
            </span>
          ) : fiat.state === "loading" ? (
            <span className="bl-fiat bl-fiat-missing">
              <span className="bl-price-dot bl-price-dot-trying" /> …
            </span>
          ) : (
            <span className={"bl-fiat bl-fiat-line" + (fiat.recovered ? " bl-fiat-recovered" : "")}>
              {fiat.recovered && <span className="bl-price-dot bl-price-dot-ok" />}
              {fiat.value} <span className="bl-fiat-code">{fiat.code}</span>
              {/* The rate that produced the figure to its left. Smaller, and
                  on the same line -- see .bl-rate, which keeps it there. */}
              <span className="bl-rate">(1 DIVI={fiat.unit})</span>
            </span>
          )}
        </span>
        )}
      </div>

      {/* Staking (left) + next lottery (right) */}
      <div className="hdr-panel glass-panel hdr-staking-panel">
        <div className="hdr-stake-col">
          {/* Status line. The chevron toggles the details dropdown; it no longer
              opens on its own. */}
          <button type="button" className="hdr-staking-btn" onClick={() => toggle("staking")}>
            {nodeDown ? (
              <>
                <span className="bl-label">Staking</span>
                <span className="bl-amt bl-amt-staking bl-down-amt">NODE NOT RUNNING</span>
              </>
            ) : syncing ? (
              /* Mid-sync the wallet has not finished counting, so neither the
                 staking figure nor a "NOT STAKING" alarm would be truthful. */
              <>
                <span className="bl-label">
                  Staking <span className={"addr-chevron" + (openPanel === "staking" ? " up" : "")}>▾</span>
                </span>
                <span className="bl-amt bl-amt-staking bl-sync-amt">STILL SYNCING…</span>
              </>
            ) : bal && bal.staking > 0 ? (
              // Staking: green dot + the amount.
              <>
                <span className="bl-label">
                  <span className="stake-dot on" title="Staking" />
                  Staking <span className={"addr-chevron" + (openPanel === "staking" ? " up" : "")}>▾</span>
                </span>
                <span className="bl-amt bl-amt-staking">
                  {fmtDiviParts(bal.staking).whole} <em>DIVI</em>
                </span>
              </>
            ) : bal && bal.spendable > 0 ? (
              // Has coins but NOT staking — loud red alert so it can't be missed.
              <span className="bl-label">
                <span className="stake-dot alert" />
                <strong className="stake-alert-text">NOT STAKING</strong>
                <span className={"addr-chevron" + (openPanel === "staking" ? " up" : "")}>▾</span>
              </span>
            ) : (
              // No coins yet — neutral.
              <>
                <span className="bl-label">
                  Staking <span className={"addr-chevron" + (openPanel === "staking" ? " up" : "")}>▾</span>
                </span>
                <span className="bl-amt bl-amt-staking">
                  — <em>DIVI</em>
                </span>
              </>
            )}
          </button>
          {/* Start / Stop button lives here in the header now, not inside the
              dropdown. Shown whenever the wallet holds any coins. */}
          {bal && (bal.spendable > 0 || bal.staking > 0) && (
            <div className="hdr-stake-action">
              <StartStaking
                onStarted={() => {
                  setOpenPanel(null);
                  refreshBalance(); // flip the header to green promptly
                }}
              />
            </div>
          )}
        </div>
        <button type="button" className="hdr-lottery-btn" onClick={() => toggle("lottery")}>
          <LotteryCountdown info={lottery} />
          <span className={"addr-chevron" + (openPanel === "lottery" ? " up" : "")}>▾</span>
        </button>
        <StakingDropdown open={openPanel === "staking"} />
        <LotteryDropdown open={openPanel === "lottery"} />
      </div>

      {/* My Addresses */}
      <div className="hdr-panel glass-panel hdr-addr-panel">
        <div className="hdr-addr-head">
          <span className="bl-label">My Addresses</span>
          <button
            type="button"
            className="icon-btn"
            title={copied ? "Copied!" : "Copy deposit address"}
            onClick={copyMain}
            disabled={!main}
          >
            <Icon name="copy" size={15} />
          </button>
        </div>
        <button type="button" className="addr-toggle" onClick={() => toggle("addresses")}>
          <span className="addr-toggle-text">{main ? main.address : "—"}</span>
          <span className={"addr-chevron" + (openPanel === "addresses" ? " up" : "")}>▾</span>
        </button>
        <AddressDropdown open={openPanel === "addresses"} addresses={addrs} />
      </div>
    </div>
  );
}
