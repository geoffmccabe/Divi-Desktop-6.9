import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { sendCoins, walletStatus } from "../wallet/api";
import { getAskMode } from "../wallet/securityPrefs";
import "./points.css";

// "Purchase with Divi" — the one place anything in the wallet is bought.
//
// Written to be reused: it knows about choices, a price and a DIVI payment, and
// nothing about points. Whatever is being sold passes in the options and gets
// told when the money moved. Selling app themes or a community app later is a
// new caller, not a new modal.
//
// Two deliberate rules, both about not lying to the person paying:
//
//   1. The amount is decided by whoever is selling, not by this component, and
//      is shown exactly as it will be sent. Nothing recalculates it on screen.
//   2. Sending is the wallet's normal send: same password rules, same
//      confirmation step. Buying something here is not a special back door that
//      moves coins more easily than the Send panel would.
//
// It renders into the document body rather than in place because the main panel
// carries a backdrop blur, which traps a fixed-position layer inside it. A
// payment decision does not get to appear as a small box in a corner.

export interface PurchaseOption {
  id: string;
  /** Short name of the thing, e.g. "Builder". */
  name: string;
  /** What you get, e.g. "10,000 points". */
  headline: string;
  /** One line of plain detail. */
  detail?: string;
  amountDivi: number;
  /** Optional flag, e.g. "20% off". */
  badge?: string;
  /** Undiscounted price, shown struck through when it is higher. */
  wasDivi?: number;
  best?: boolean;
}

export interface PurchaseProgress {
  done: boolean;
  note: string;
}

type Stage = "choose" | "confirm" | "password" | "sending" | "settling" | "done";

const POLL_MS = 5000;

export function PurchaseWithDivi({
  options,
  onPrepare,
  onSent,
  onClose,
  unavailable = null,
  footnote,
}: {
  options: PurchaseOption[];
  /** Commit to a choice. Returns exactly what to send, and where. */
  onPrepare: (option: PurchaseOption) => Promise<{ address: string; amountDivi: number }>;
  /** Called after broadcast, then polled, until it reports done. */
  onSent: (option: PurchaseOption, txid: string) => Promise<PurchaseProgress>;
  onClose: () => void;
  unavailable?: string | null;
  footnote?: string;
}) {
  const [stage, setStage] = useState<Stage>(options.length === 1 ? "confirm" : "choose");
  const [picked, setPicked] = useState<PurchaseOption | null>(options.length === 1 ? options[0] : null);
  const [payment, setPayment] = useState<{ address: string; amountDivi: number } | null>(null);
  const [pass, setPass] = useState("");
  const [txid, setTxid] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Keep asking the seller whether the money has settled. Stops as soon as it
  // says so, and never blocks the person from closing the window.
  useEffect(() => {
    if (stage !== "settling" || !picked || !txid) return;
    let live = true;
    const tick = async () => {
      try {
        const p = await onSent(picked, txid);
        if (!live) return;
        setNote(p.note);
        if (p.done) setStage("done");
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [stage, picked, txid, onSent]);

  // Committing to a choice fixes the price with the seller straight away, so
  // the amount on the confirmation screen is the exact amount that will be
  // sent. Showing a rounded figure and sending a different one, even by a
  // rounding error, is the kind of small dishonesty that costs trust.
  const choose = useCallback(async (option: PurchaseOption) => {
    setErr(null);
    setPicked(option);
    setStage("confirm");
    try {
      setPayment(await onPrepare(option));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [onPrepare]);

  // A single option skips the choosing step, so price it on the way in.
  useEffect(() => {
    if (options.length === 1 && !payment && !err) void choose(options[0]);
    // Only ever runs for the single-option case, and only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = useCallback(async () => {
    if (!picked) return;
    setErr(null);
    try {
      // Priced when the choice was made. Falling back here covers the case
      // where that call failed and the person pressed on anyway.
      const prepared = payment ?? (await onPrepare(picked));
      setPayment(prepared);
      const st = await walletStatus();
      const needsPass = st.encrypted && !(getAskMode() === "open" && st.unlocked);
      if (needsPass) return setStage("password");
      await send(prepared);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [picked, payment, onPrepare]);

  const send = async (prepared: { address: string; amountDivi: number }, passphrase?: string) => {
    setStage("sending");
    setErr(null);
    try {
      const id = await sendCoins(prepared.address, prepared.amountDivi, passphrase);
      setTxid(id);
      setNote("Sent. Waiting for the network to confirm it.");
      setStage("settling");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStage(passphrase != null ? "password" : "confirm");
    }
  };

  const body = () => {
    if (unavailable) {
      return (
        <div className="pd-msg">
          <p className="pd-lead">Buying is not available right now.</p>
          <p className="pd-detail">{unavailable}</p>
        </div>
      );
    }

    if (stage === "choose") {
      return (
        <div className="pd-options">
          {options.map((o) => (
            <button key={o.id} type="button" className={`pd-option${o.best ? " pd-option-best" : ""}`} onClick={() => choose(o)}>
              <span className="pd-option-top">
                <span className="pd-option-name">{o.name}</span>
                {o.badge && <span className="pd-badge">{o.badge}</span>}
              </span>
              <span className="pd-option-headline">{o.headline}</span>
              {o.detail && <span className="pd-option-detail">{o.detail}</span>}
              <span className="pd-option-price">
                {o.wasDivi && o.wasDivi > o.amountDivi && (
                  <span className="pd-was">{fmt(o.wasDivi)}</span>
                )}
                {fmt(o.amountDivi)} DIVI
              </span>
            </button>
          ))}
        </div>
      );
    }

    if (!picked) return null;

    if (stage === "confirm") {
      return (
        <div className="pd-msg">
          <p className="pd-lead">{picked.headline}</p>
          {picked.detail && <p className="pd-detail">{picked.detail}</p>}
          <p className="pd-amount">{payment ? `${fmt(payment.amountDivi)} DIVI` : "Pricing…"}</p>
          <p className="pd-detail">
            This sends DIVI from your wallet, exactly like a normal send. Nothing
            moves until you press the button below.
          </p>
        </div>
      );
    }

    if (stage === "password") {
      return (
        <div className="pd-msg">
          <p className="pd-lead">Your wallet is locked</p>
          <p className="pd-detail">Enter your wallet password to send {fmt(payment?.amountDivi ?? 0)} DIVI.</p>
          <input
            className="wl-input pd-input"
            type="password"
            value={pass}
            autoFocus
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && payment) void send(payment, pass);
            }}
            placeholder="Wallet password"
          />
        </div>
      );
    }

    if (stage === "sending") {
      return (
        <div className="pd-msg">
          <p className="pd-lead">Sending…</p>
          <p className="pd-detail">Broadcasting your payment to the Divi network.</p>
        </div>
      );
    }

    if (stage === "settling") {
      return (
        <div className="pd-msg">
          <p className="pd-lead">Payment sent</p>
          <p className="pd-detail">{note || "Waiting for the network to confirm it."}</p>
          <p className="pd-detail pd-quiet">
            You can close this window. It will finish on its own, and what you
            bought appears as soon as the payment settles.
          </p>
        </div>
      );
    }

    return (
      <div className="pd-msg">
        <p className="pd-lead">✓ {picked.headline}</p>
        <p className="pd-detail">{note || "Your purchase is complete."}</p>
      </div>
    );
  };

  const actions = () => {
    if (unavailable) return <button type="button" className="wl-btn" onClick={onClose}>Close</button>;
    switch (stage) {
      case "choose":
        return <button type="button" className="wl-btn" onClick={onClose}>Cancel</button>;
      case "confirm":
        return (
          <>
            {options.length > 1 && (
              <button
                type="button"
                className="wl-btn"
                onClick={() => { setPayment(null); setErr(null); setStage("choose"); }}
              >
                Back
              </button>
            )}
            <button type="button" className="wl-btn" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="wl-btn wl-btn-primary"
              disabled={!payment}
              onClick={() => void commit()}
            >
              {payment ? `Send ${fmt(payment.amountDivi)} DIVI` : "Pricing…"}
            </button>
          </>
        );
      case "password":
        return (
          <>
            <button type="button" className="wl-btn" onClick={() => setStage("confirm")}>Back</button>
            <button
              type="button"
              className="wl-btn wl-btn-primary"
              disabled={!pass}
              onClick={() => payment && void send(payment, pass)}
            >
              Unlock and send
            </button>
          </>
        );
      case "sending":
        return <span className="pd-detail">Please wait…</span>;
      default:
        return <button type="button" className="wl-btn wl-btn-primary" onClick={onClose}>Close</button>;
    }
  };

  return createPortal(
    <div className="pd-veil" role="dialog" aria-modal="true" aria-label="Purchase with Divi">
      <div className="pd-panel">
        <div className="pd-head">
          <h3 className="pd-title">Purchase with Divi</h3>
          <button type="button" className="pd-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="pd-body">
          <div className="pd-main">
            {body()}
            {err && <p className="pd-error">{err}</p>}
            {footnote && stage !== "done" && <p className="pd-foot">{footnote}</p>}
          </div>

          {/* Mascot goes here. Placeholder until the Red Panda artwork exists;
              the space is reserved now so the layout does not shift later. */}
          <div className="pd-mascot" aria-hidden="true">
            <span className="pd-mascot-note">Red Panda</span>
          </div>
        </div>

        <div className="pd-actions">{actions()}</div>
      </div>
    </div>,
    document.body,
  );
}

function fmt(n: number): string {
  // Up to 8 decimals, but no trailing noise on round numbers.
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}
