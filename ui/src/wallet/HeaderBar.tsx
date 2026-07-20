import { useEffect, useRef, useState } from "react";
import { walletBalance, walletAddresses, lotteryInfo, type Balance, type AddrInfo, type LotteryInfo } from "./api";
import { fmtDiviParts } from "../status";
import { AddressDropdown } from "./AddressDropdown";
import { StakingDropdown } from "./StakingDropdown";
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
  const [copied, setCopied] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

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
  const spend = bal ? fmtDiviParts(bal.spendable) : null;
  const fiat = useDiviValue(bal ? bal.spendable : null);

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
        <span className="bl-amt">
          <span className="bl-divi">
            {spend ? (
              <>
                {spend.whole}
                <span className="bl-frac">.{spend.frac}</span>
              </>
            ) : (
              "—"
            )}{" "}
            <em>DIVI</em>
          </span>
          {fiat.state === "unavailable" ? (
            <span className="bl-fiat bl-fiat-missing" title="Set a CoinMarketCap key in Admin → Value, or check the connection.">
              {fiat.reason}
            </span>
          ) : fiat.state === "loading" ? (
            <span className="bl-fiat bl-fiat-missing">…</span>
          ) : (
            <span className="bl-fiat">
              {fiat.value} <span className="bl-fiat-code">{fiat.code}</span>
            </span>
          )}
        </span>
      </div>

      {/* Staking (left) + next lottery (right) */}
      <div className="hdr-panel glass-panel hdr-staking-panel">
        <button type="button" className="hdr-staking-btn" onClick={() => toggle("staking")}>
          <span className="bl-label">
            Staking <span className={"addr-chevron" + (openPanel === "staking" ? " up" : "")}>▾</span>
          </span>
          <span className="bl-amt">
            {bal ? fmtDiviParts(bal.staking).whole : "—"} <em>DIVI</em>
          </span>
        </button>
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
