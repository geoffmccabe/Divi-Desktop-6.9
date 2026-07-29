import { useEffect, useRef, useState } from "react";
import { stakingWallets, lotteryWins, startStaking, type StakeWallet, type LotteryWin } from "./api";
import { nodeStatus } from "../bridge";
import { loadNames } from "./addressNames";
import { setStakingDesired, stakingDesired } from "./stakeWin";
import { lockWallet } from "./api";
import { fmtDivi } from "../status";
import { Icon } from "../Icon";
import { InfoDot } from "../InfoDot";

const MATURITY_HELP =
  "Coins you receive must “age” for about 1 hour before they can stake — this keeps staking fair. " +
  "Once mature they stake for good. See Settings → Coin Maturity for a live countdown of each deposit.";

// Animated "…" so a wait reads as "working", never frozen or wrong.
function Ellipsis() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((x) => (x % 3) + 1), 400);
    return () => clearInterval(id);
  }, []);
  return <span>{".".repeat(n)}</span>;
}

// The button reflects the node's CONFIRMED staking state, plus honest transitional
// states. It never claims "Staking" until the node actually reports it — the fix
// for the old ~10s window where it said staking before the node had started.
//   checking → we don't know yet (opening, or waiting for the node to confirm an
//              action). Shows "Checking blockchain…" animated.
//   idle     → confirmed NOT staking. Shows "Start Staking" (+ reason if any).
//   needpass → starting needs the wallet password. Shows the password field.
//   staking  → confirmed staking. Shows "Staking · Click to Stop" (green).
type StakeState = "checking" | "idle" | "needpass" | "staking";

function StartStaking() {
  const [state, setState] = useState<StakeState>(() => (stakingDesired() ? "checking" : "checking"));
  const [pass, setPass] = useState("");
  const [reason, setReason] = useState<string | null>(null); // why it's not staking (idle)
  const [err, setErr] = useState<string | null>(null); // password error
  // While confirming an action, hold "checking" and poll fast until the node's
  // state matches what we're waiting for (or the window elapses).
  const confirm = useRef<{ until: number; target: "on" | "off" } | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number;
    const tick = async () => {
      try {
        const s = await nodeStatus();
        if (alive) {
          const isStaking = s.phase === "staking";
          const c = confirm.current;
          if (c && performance.now() < c.until) {
            if (c.target === "on" && isStaking) {
              confirm.current = null;
              setState("staking");
            } else if (c.target === "off" && !isStaking) {
              confirm.current = null;
              setReason(null);
              setState("idle");
            } else {
              setState("checking"); // still waiting — keep the animated label
            }
          } else {
            confirm.current = null;
            setState((prev) => (prev === "needpass" ? prev : isStaking ? "staking" : "idle"));
            if (!isStaking) setReason(s.headline || null);
          }
        }
      } catch {
        /* keep current state */
      }
      const fast = confirm.current != null && performance.now() < confirm.current.until;
      timer = window.setTimeout(tick, fast ? 1500 : 8000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const go = async (passphrase?: string) => {
    setErr(null);
    setState("checking");
    try {
      const r = await startStaking(passphrase);
      if (r.needsPassphrase) {
        confirm.current = null;
        setState("needpass");
        if (passphrase) setErr("That password didn't work. Try again.");
        return;
      }
      setStakingDesired(true);
      setPass("");
      if (r.staking) {
        confirm.current = null;
        setState("staking");
      } else {
        // Unlocked, but the node hasn't begun staking yet — hold "checking" and
        // let the fast poll confirm when it actually starts (usually seconds).
        confirm.current = { until: performance.now() + 30000, target: "on" };
        setReason(r.message);
      }
    } catch (e) {
      confirm.current = null;
      setReason(String(e));
      setState("idle");
    }
  };

  // Stop = lock the wallet (it was unlocked staking-only). Hold "checking" until
  // the node confirms it's stopped, so the button can't be flipped back by a poll.
  const stop = async () => {
    setStakingDesired(false);
    confirm.current = { until: performance.now() + 20000, target: "off" };
    setState("checking");
    try {
      await lockWallet();
    } catch (e) {
      setErr(String(e));
    }
  };

  if (state === "needpass") {
    return (
      <div className="stake-start">
        <form
          className="stake-start-pass"
          onSubmit={(e) => {
            e.preventDefault();
            if (pass) go(pass);
          }}
        >
          <input
            className="wl-input"
            type="password"
            placeholder="Wallet password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoFocus
          />
          <button type="submit" className="wl-btn wl-btn-primary" disabled={!pass}>
            Unlock &amp; Stake
          </button>
        </form>
        {err && <p className="stake-start-msg">{err}</p>}
      </div>
    );
  }

  return (
    <div className="stake-start">
      <button
        type="button"
        className={"wl-btn " + (state === "staking" ? "wl-btn-staking" : "wl-btn-primary")}
        disabled={state === "checking"}
        onClick={() => (state === "staking" ? stop() : go())}
      >
        {state === "checking" ? (
          <>Checking blockchain<Ellipsis /></>
        ) : state === "staking" ? (
          "Staking · Click to Stop"
        ) : (
          "Start Staking"
        )}
      </button>
      {state === "idle" && reason && (
        <p className="stake-start-msg">
          {reason}
          {/mature/i.test(reason) && <InfoDot text={MATURITY_HELP} />}
        </p>
      )}
    </div>
  );
}

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
        <StartStaking />
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
