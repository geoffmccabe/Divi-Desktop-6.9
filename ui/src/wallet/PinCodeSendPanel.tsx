import { useEffect, useState } from "react";
import {
  bearerCreate,
  bearerSweep,
  walletStatus,
  walletBalance,
  newReceiveAddress,
  type Balance,
} from "./api";
import { getAskMode } from "./securityPrefs";
import { fmtDivi } from "../status";
import { encryptTicket, decryptTicket, randomPin } from "./pinCrypto";
import { addBearerReceived } from "./bearerCodes";
import { addPinSend, loadPinSends, removePinSend, type PinRecord } from "./pinSends";

// Pin Code Send (v1): a Bearer code whose claim ticket is encrypted with a PIN.
// The sender shares the ticket and (separately) the PIN; the recipient enters
// the PIN to decrypt and claim. Sender pays the fee and can reclaim.

type Tab = "create" | "redeem";

function parseAmount(s: string): number | null {
  const t = s.trim();
  if (!/^\d*\.?\d{0,8}$/.test(t) || t === "" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function PinCodeSendPanel() {
  const [tab, setTab] = useState<Tab>("create");
  return (
    <div className="bearer-panel">
      <div className="bearer-tabs">
        <button type="button" className={tab === "create" ? "on" : ""} onClick={() => setTab("create")}>
          Create
        </button>
        <button type="button" className={tab === "redeem" ? "on" : ""} onClick={() => setTab("redeem")}>
          Redeem
        </button>
      </div>
      {tab === "create" ? <PinCreate /> : <PinRedeem />}
    </div>
  );
}

function PinCreate() {
  const [amountStr, setAmountStr] = useState("");
  const [pass, setPass] = useState("");
  const [needsPass, setNeedsPass] = useState(false);
  const [bal, setBal] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ ticket: string; pin: string; amount: number } | null>(null);
  const [copied, setCopied] = useState("");
  const [history, setHistory] = useState<PinRecord[]>(loadPinSends());

  useEffect(() => {
    (async () => {
      try {
        const b = await walletBalance();
        if (b) setBal(b);
        const st = await walletStatus();
        setNeedsPass(st.encrypted && !(getAskMode() === "open" && st.unlocked));
      } catch {
        /* defaults */
      }
    })();
  }, []);

  const amount = parseAmount(amountStr);

  const create = async () => {
    if (amount == null) return setErr("Enter a valid amount.");
    setBusy(true);
    setErr(null);
    try {
      const pin = randomPin(6);
      const res = await bearerCreate(amount, needsPass ? pass : undefined);
      const ticket = await encryptTicket(res.code, pin);
      setMade({ ticket, pin, amount: res.amount });
      addPinSend({ ticket, code: res.code, amount: res.amount, txid: res.txid, createdAt: Date.now() });
      setHistory(loadPinSends());
      setPass("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const reclaim = async (code: string, txid: string) => {
    setErr(null);
    try {
      const dest = await newReceiveAddress();
      await bearerSweep(code, dest);
      removePinSend(txid);
      setHistory(loadPinSends());
    } catch (e) {
      setErr(String(e));
    }
  };

  const copy = (what: string, val: string) => {
    navigator.clipboard?.writeText(val);
    setCopied(what);
    setTimeout(() => setCopied(""), 1200);
  };

  if (made) {
    return (
      <div className="bearer-result">
        <div className="bearer-made-amt">Pin Code Send for {fmtDivi(made.amount)} DIVI</div>
        <p className="wl-note">
          Give the ticket to your recipient, and tell them the PIN <strong>separately</strong> (a different channel).
          They need both to claim. You can reclaim it below until they do.
        </p>
        <div className="pin-code-big">{made.pin}</div>
        <button type="button" className="wl-btn" onClick={() => copy("pin", made.pin)}>
          {copied === "pin" ? "Copied ✓" : "Copy PIN"}
        </button>
        <div className="bearer-code" title="Click to copy" onClick={() => copy("ticket", made.ticket)}>
          {made.ticket}
        </div>
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => copy("ticket", made.ticket)}>
          {copied === "ticket" ? "Copied ✓" : "Copy ticket"}
        </button>
        <button type="button" className="wl-btn" onClick={() => { setMade(null); setAmountStr(""); }}>
          Create another
        </button>
        {err && <p className="wl-err">{err}</p>}
      </div>
    );
  }

  return (
    <div className="bearer-form">
      <label className="send-field">
        <span className="send-label">Amount to send</span>
        <input
          className="wl-input"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
        />
        <span className="send-avail">Spendable: {bal ? fmtDivi(bal.spendable) : "—"} DIVI</span>
      </label>
      {needsPass && (
        <label className="send-field">
          <span className="send-label">Wallet password</span>
          <input className="wl-input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Wallet password" />
        </label>
      )}
      <p className="wl-note">
        A 6-digit PIN is generated for you. The recipient gets the full amount; you pay the network fee. Share the PIN
        on a channel separate from the ticket.
      </p>
      <button type="button" className="wl-btn wl-btn-primary" onClick={create} disabled={busy || amount == null || (needsPass && !pass)}>
        {busy ? "Creating…" : "Create pin code send"}
      </button>
      {err && <p className="wl-err">{err}</p>}

      {history.length > 0 && (
        <div className="bearer-history">
          <div className="bearer-history-title">Sends you created</div>
          {history.map((h) => (
            <div key={h.txid} className="bearer-history-row">
              <span className="bearer-history-amt">{fmtDivi(h.amount)} DIVI</span>
              <button type="button" className="wl-link" onClick={() => copy("t" + h.txid, h.ticket)}>
                {copied === "t" + h.txid ? "copied" : "copy ticket"}
              </button>
              <button type="button" className="wl-link" onClick={() => reclaim(h.code, h.txid)}>
                reclaim
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PinRedeem() {
  const [ticket, setTicket] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneTxid, setDoneTxid] = useState("");

  const redeem = async () => {
    setBusy(true);
    setErr(null);
    try {
      const code = await decryptTicket(ticket.trim(), pin.trim());
      const dest = await newReceiveAddress();
      const txid = await bearerSweep(code, dest);
      addBearerReceived(txid);
      setDoneTxid(txid);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (doneTxid) {
    return (
      <div className="bearer-result">
        <div className="bearer-made-amt">✓ Redeemed into your wallet</div>
        <p className="wl-note">The coins are sweeping to a fresh address in this wallet. They'll confirm shortly.</p>
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => { setDoneTxid(""); setTicket(""); setPin(""); }}>
          Redeem another
        </button>
      </div>
    );
  }

  return (
    <div className="bearer-form">
      <label className="send-field">
        <span className="send-label">Paste the ticket</span>
        <textarea
          className="wl-input bearer-code-input"
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
          placeholder="DVP1-…"
          spellCheck={false}
          rows={3}
        />
      </label>
      <label className="send-field">
        <span className="send-label">PIN</span>
        <input
          className="wl-input"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="6-digit PIN"
          inputMode="numeric"
        />
      </label>
      <button type="button" className="wl-btn wl-btn-primary" onClick={redeem} disabled={busy || !ticket.trim() || !pin.trim()}>
        {busy ? "Redeeming…" : "Unlock & redeem"}
      </button>
      {err && <p className="wl-err">{err}</p>}
    </div>
  );
}
