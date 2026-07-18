import { useEffect, useState } from "react";
import {
  walletBalance,
  walletStatus,
  validateAddress,
  sendCoins,
  openUrl,
  explorerTxUrl,
  type Balance,
} from "./api";
import { getAskMode } from "./securityPrefs";
import { fmtDivi } from "../status";

// Sending real, irreversible DIVI. Flow: fill in → review (explicit confirm) →
// unlock only if the wallet requires it (encrypted + ask-on-send) → broadcast.
type Stage = "form" | "confirm" | "password" | "sending" | "done";

// A positive number with at most 8 decimals, or null if the text isn't valid.
function parseAmount(s: string): number | null {
  const t = s.trim();
  if (!/^\d*\.?\d{0,8}$/.test(t) || t === "" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function SendPanel() {
  const [stage, setStage] = useState<Stage>("form");
  const [address, setAddress] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [pass, setPass] = useState("");
  const [bal, setBal] = useState<Balance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txid, setTxid] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const b = await walletBalance();
        if (alive) setBal(b);
      } catch {
        /* keep last */
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const amount = parseAmount(amountStr);
  const spendable = bal?.spendable ?? 0;
  const overBalance = amount != null && amount > spendable;

  const reset = () => {
    setStage("form");
    setAddress("");
    setAmountStr("");
    setPass("");
    setErr(null);
    setTxid("");
  };

  // Form → confirm: validate the address with the node and the amount locally.
  const review = async () => {
    setErr(null);
    if (amount == null) return setErr("Enter a valid amount (up to 8 decimals).");
    if (overBalance) return setErr("That's more than your spendable balance.");
    let ok = false;
    try {
      ok = await validateAddress(address.trim());
    } catch (e) {
      return setErr(String(e));
    }
    if (!ok) return setErr("That doesn't look like a valid DIVI address.");
    setStage("confirm");
  };

  // Confirm → decide whether a password is needed, then send.
  const confirmSend = async () => {
    setErr(null);
    try {
      const st = await walletStatus();
      const needsPass = st.encrypted && !(getAskMode() === "open" && st.unlocked);
      if (needsPass) {
        setStage("password");
        return;
      }
      await doSend();
    } catch (e) {
      setErr(String(e));
    }
  };

  const doSend = async (passphrase?: string) => {
    setStage("sending");
    setErr(null);
    try {
      const id = await sendCoins(address.trim(), amount!, passphrase);
      setTxid(id);
      setStage("done");
    } catch (e) {
      setErr(String(e));
      setStage(passphrase != null ? "password" : "confirm");
    }
  };

  if (stage === "done") {
    return (
      <div className="send-panel">
        <div className="send-done">✓ Sent {fmtDivi(amount ?? 0)} DIVI</div>
        <p className="wl-note">Your transaction is on its way. It may take a few minutes to confirm.</p>
        {txid && (
          <button type="button" className="wl-link" onClick={() => openUrl(explorerTxUrl(txid))}>
            View in block explorer
          </button>
        )}
        <button type="button" className="wl-btn wl-btn-primary" onClick={reset}>
          Send another
        </button>
      </div>
    );
  }

  return (
    <div className="send-panel">
      <label className="send-field">
        <span className="send-label">To address</span>
        <input
          className="wl-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="D…"
          disabled={stage !== "form"}
          spellCheck={false}
        />
      </label>

      <label className="send-field">
        <span className="send-label">Amount</span>
        <input
          className="wl-input"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          disabled={stage !== "form"}
        />
        <span className="send-avail">Spendable: {fmtDivi(spendable)} DIVI · leave a little for the network fee</span>
      </label>

      {stage === "form" && (
        <button
          type="button"
          className="wl-btn wl-btn-primary"
          onClick={review}
          disabled={amount == null || !address.trim() || overBalance}
        >
          Review send
        </button>
      )}

      {stage === "confirm" && (
        <div className="send-confirm">
          <p className="send-confirm-line">
            Send <strong>{fmtDivi(amount ?? 0)} DIVI</strong> to
          </p>
          <p className="send-confirm-addr">{address.trim()}</p>
          <p className="send-warn">This can’t be undone. Check the address carefully.</p>
          <div className="send-actions">
            <button type="button" className="wl-btn" onClick={() => setStage("form")}>Back</button>
            <button type="button" className="wl-btn wl-btn-primary" onClick={confirmSend}>Confirm &amp; send</button>
          </div>
        </div>
      )}

      {stage === "password" && (
        <form
          className="send-confirm"
          onSubmit={(e) => {
            e.preventDefault();
            doSend(pass);
          }}
        >
          <p className="send-confirm-line">Enter your wallet password to send.</p>
          <input
            className="wl-input"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoFocus
            placeholder="Wallet password"
          />
          <div className="send-actions">
            <button type="button" className="wl-btn" onClick={() => { setStage("confirm"); setPass(""); }}>Back</button>
            <button type="submit" className="wl-btn wl-btn-primary" disabled={!pass}>Unlock &amp; send</button>
          </div>
        </form>
      )}

      {stage === "sending" && <p className="wl-note">Sending…</p>}
      {err && <p className="wl-err">{err}</p>}
    </div>
  );
}
