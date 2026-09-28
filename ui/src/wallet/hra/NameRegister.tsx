import { useEffect, useState } from "react";
import {
  hraCommit,
  hraForget,
  hraPending,
  hraQuote,
  hraRegister,
  type NameQuote,
  type PendingCommit,
} from "./api";
import { loadPointings, savePointing, settlePointings, takeHraTarget, type HraTarget } from "../hraTarget";

// Claiming a name is two steps with a wait in between, and the wait is the
// feature, not an apology for a delay. Without it anyone watching the network
// could see the name you want and register it first by paying a bigger fee.
// The gap turns that race into a twelve-block reorg, which nobody can win.
// Divi's one-minute blocks make it about twelve minutes; on Bitcoin the same
// protection takes roughly two hours.

export function NameRegister({
  canRegister,
  onChanged,
}: {
  canRegister: boolean;
  onChanged: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [quote, setQuote] = useState<NameQuote | null>(null);
  const [problem, setProblem] = useState("");
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<PendingCommit[]>([]);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  /* The wallet address the new name should pay to, when the user came here
     from a wallet's Get HRA button. Kept beside the reservation so the wait
     between reserve and register does not lose it. */
  const [target, setTarget] = useState<HraTarget | null>(() => takeHraTarget());
  const [pointings, setPointings] = useState<Record<string, HraTarget>>(() => loadPointings());
  useEffect(() => {
    const on = () => {
      const t = takeHraTarget();
      if (t) setTarget(t);
    };
    window.addEventListener("dd69:gethra", on);
    return () => window.removeEventListener("dd69:gethra", on);
  }, []);

  const loadPending = () =>
    hraPending()
      .then(setPending)
      .catch(() => setPending([]));

  useEffect(() => {
    loadPending();
    const id = setInterval(() => {
      loadPending();
      settlePointings(pending.map((p) => p.name)).then(() => setPointings(loadPointings()));
    }, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const clean = typed.trim();
    if (!clean) {
      setQuote(null);
      setProblem("");
      return;
    }
    let alive = true;
    setChecking(true);
    const t = setTimeout(() => {
      hraQuote(clean)
        .then((q) => {
          if (!alive) return;
          setQuote(q);
          setProblem("");
        })
        .catch((e) => {
          if (!alive) return;
          setQuote(null);
          setProblem(String(e));
        })
        .finally(() => alive && setChecking(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [typed]);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setError("");
    setResult("");
    try {
      const txid = await fn();
      if (typeof txid === "string") setResult(txid);
      await loadPending();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  const alreadyPending = quote ? pending.some((p) => p.name === quote.canonical) : false;

  return (
    <div className="hra-form">
      <p className="wl-note">
        A name is yours to keep, use, and sell. It works as an address people can send DIVI to, and
        it can carry your other details as well.
      </p>

      {target && (
        <div className="hra-target">
          <div className="hra-field">
            <span>Payments to this name will go to</span>
            <span className="mono hra-target-addr">{target.address}</span>
            {target.label && <span className="wl-note">{target.label}</span>}
          </div>
          <p className="wl-note">
            Your node's staking wallet pays the fee and holds the name, so it can renew, manage and
            sell it from here. The name is then pointed at the address above, so anyone paying the
            name pays that wallet.
          </p>
          <button type="button" className="wl-btn" onClick={() => setTarget(null)}>
            Point it at the staking wallet instead
          </button>
        </div>
      )}

      <label className="hra-field">
        <span>Name you want</span>
        <input
          className="wl-input mono"
          placeholder="e.g. geoff"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={32}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>

      {typed.trim() !== "" && (
        <div className="hra-quote">
          {checking && <p className="wl-note">Checking…</p>}
          {!checking && problem && <p className="wl-err">{problem}</p>}
          {!checking && quote && (
            <>
              <p className="hra-canon">
                <span className="mono">{quote.canonical.toLowerCase()}</span>
                {quote.available === false && <span className="hra-taken">already taken</span>}
                {quote.available === true && <span className="hra-free">available</span>}
              </p>
              {quote.available === null && (
                <p className="wl-note">
                  Availability is unknown until the wallet has read the chain. It will not guess.
                </p>
              )}
              {quote.owner && (
                <p className="wl-note">
                  Owned by <span className="mono">{quote.owner}</span>
                </p>
              )}
              <p className="wl-note">
                {quote.registrationDivi.toLocaleString()} DIVI for the first year, then{" "}
                {quote.renewalDivi.toLocaleString()} DIVI a year to keep it. Shorter names cost more,
                which is what stops one person hoarding all the good ones.
              </p>
              {quote.canBeTicker && (
                <p className="wl-note">
                  Short enough to also be used as a token ticker, since names and tickers are one
                  and the same list.
                </p>
              )}
              <p className="wl-note hra-dim">
                Capitals and small letters are the same name here, so nobody can register a
                lookalike of yours. Accented and non-English letters are not allowed at all, for the
                same reason.
              </p>
            </>
          )}
        </div>
      )}

      <div className="hra-steps">
        <div className="hra-steps-head">How claiming works</div>
        <ol>
          <li>
            <strong>Reserve it privately.</strong> Your wallet publishes a sealed version of the
            name. The name itself is not revealed.
          </li>
          <li>
            <strong>About twelve minutes pass.</strong> This gap is what stops anyone watching the
            network from seeing your name and grabbing it first.
          </li>
          <li>
            <strong>Register.</strong> The name is revealed, the fee is paid, and it is recorded as
            yours.
          </li>
        </ol>
      </div>

      <button
        className="wl-btn wl-btn-primary"
        disabled={
          !canRegister ||
          !quote ||
          quote.available === false ||
          alreadyPending ||
          busy !== ""
        }
        onClick={() =>
          quote &&
          run("commit", async () => {
            const txid = await hraCommit(quote.canonical);
            if (target) {
              savePointing(quote.canonical, target);
              setPointings(loadPointings());
            }
            return txid;
          })
        }
      >
        {busy === "commit" ? "Reserving…" : "Reserve this name"}
      </button>

      {alreadyPending && (
        <p className="wl-note">You already have a reservation for that name, below.</p>
      )}

      {pending.length > 0 && (
        <section className="hra-pending">
          <h4 className="hra-sub">Your reservations</h4>
          {pending.map((p) => (
            <div className="hra-pending-row" key={p.name}>
              <span className="mono hra-pending-name">{p.name.toLowerCase()}</span>
              {pointings[p.name] && (
                <span className="wl-note hra-dim" title={pointings[p.name].address}>
                  pays to {pointings[p.name].label || pointings[p.name].address.slice(0, 10) + "…"}
                </span>
              )}
              {p.ready ? (
                <span className="hra-free">ready to register</span>
              ) : (
                <span className="wl-note">
                  {p.blocksRemaining} block{p.blocksRemaining === 1 ? "" : "s"} to go, roughly{" "}
                  {p.blocksRemaining} minute{p.blocksRemaining === 1 ? "" : "s"}
                </span>
              )}
              <div className="hra-pending-actions">
                <button
                  className="wl-btn wl-btn-primary"
                  disabled={!p.ready || !canRegister || busy !== ""}
                  onClick={() => run(`register:${p.name}`, () => hraRegister(p.name))}
                >
                  {busy === `register:${p.name}` ? "Registering…" : "Register"}
                </button>
                <button
                  className="wl-btn"
                  disabled={busy !== ""}
                  onClick={() => run(`forget:${p.name}`, () => hraForget(p.name).then(() => undefined))}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
          <p className="wl-note hra-dim">
            A reservation only exists on this computer until you register it. If you move to another
            machine before registering, it does not come with you.
          </p>
        </section>
      )}

      {result && (
        <p className="wl-note">
          Sent. Transaction <span className="mono">{result.slice(0, 16)}…</span>
        </p>
      )}
      {Object.keys(pointings).filter((n) => !pending.some((p) => p.name === n)).length > 0 && (
        <p className="wl-note hra-dim">
          Once the chain confirms{" "}
          {Object.keys(pointings)
            .filter((n) => !pending.some((p) => p.name === n))
            .map((n) => n.toLowerCase())
            .join(", ")}
          , the wallet will point it at the chosen address by itself.
        </p>
      )}
      {error && <p className="wl-err">{error}</p>}
    </div>
  );
}
