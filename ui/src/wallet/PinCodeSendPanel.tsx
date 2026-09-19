import { useEffect, useState } from "react";
import {
  escrowCreate,
  escrowStatus,
  escrowClaim,
  escrowRefund,
  walletStatus,
  walletBalance,
  validateAddress,
  type Balance,
} from "./api";
import { getAskMode } from "./securityPrefs";
import { fmtDivi } from "../status";
import { randomCode, addEscrow, loadEscrows, removeEscrow, type EscrowRecord } from "./escrowSends";

// Pin Code Send = on-chain ESCROW (HTLC). The receiver can SEE the money is
// committed to them and that the sender can't pull it back, but can't claim it
// without the release code the sender shares separately (e.g. on delivery).

type Tab = "create" | "redeem";
const REFUND_DAYS = 7; // sender can reclaim after this if never claimed
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${MON[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}`;
}
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
      {tab === "create" ? <EscrowCreate /> : <EscrowRedeem />}
    </div>
  );
}

function EscrowCreate() {
  const [recipient, setRecipient] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [pass, setPass] = useState("");
  const [needsPass, setNeedsPass] = useState(false);
  const [bal, setBal] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ ticket: string; code: string; amount: number; locktime: number } | null>(null);
  const [copied, setCopied] = useState("");
  const [history, setHistory] = useState<EscrowRecord[]>(loadEscrows());

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
    if (!recipient.trim()) return setErr("Enter the recipient's DIVI address.");
    if (amount == null) return setErr("Enter a valid amount.");
    setBusy(true);
    setErr(null);
    try {
      const ok = await validateAddress(recipient.trim());
      if (!ok) {
        setBusy(false);
        return setErr("That recipient address isn't valid.");
      }
      const code = randomCode(14);
      const locktime = Math.floor(Date.now() / 1000) + REFUND_DAYS * 86400;
      const res = await escrowCreate(recipient.trim(), amount, code, locktime, needsPass ? pass : undefined);
      setMade({ ticket: res.ticket, code, amount: res.amount, locktime });
      addEscrow({ ticket: res.ticket, code, recipient: recipient.trim(), amount: res.amount, txid: res.txid, locktime, createdAt: Date.now() });
      setHistory(loadEscrows());
      setPass("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const refund = async (rec: EscrowRecord) => {
    setErr(null);
    try {
      await escrowRefund(rec.ticket, needsPass ? pass : undefined);
      removeEscrow(rec.txid);
      setHistory(loadEscrows());
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
        <div className="bearer-made-amt">Escrow locked: {fmtDivi(made.amount)} DIVI</div>
        <p className="wl-note">
          Send the recipient the <strong>ticket</strong> now, so they can see the money is committed to them and can't
          be pulled back. Give them the <strong>release code</strong> only when you're ready for them to claim (e.g. on
          delivery). If they never claim, you can refund after {fmtDate(made.locktime)}.
        </p>
        <div className="send-label">Ticket (share now)</div>
        <div className="bearer-code" title="Click to copy" onClick={() => copy("ticket", made.ticket)}>
          {made.ticket}
        </div>
        <button type="button" className="wl-btn" onClick={() => copy("ticket", made.ticket)}>
          {copied === "ticket" ? "Copied ✓" : "Copy ticket"}
        </button>
        <div className="send-label">Release code (share on delivery)</div>
        <div className="pin-code-big">{made.code}</div>
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => copy("code", made.code)}>
          {copied === "code" ? "Copied ✓" : "Copy code"}
        </button>
        <button type="button" className="wl-btn" onClick={() => { setMade(null); setRecipient(""); setAmountStr(""); }}>
          Create another
        </button>
        {err && <p className="wl-err">{err}</p>}
      </div>
    );
  }

  return (
    <div className="bearer-form">
      <label className="send-field">
        <span className="send-label">Recipient DIVI address</span>
        <input className="wl-input" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="D…" spellCheck={false} />
      </label>
      <label className="send-field">
        <span className="send-label">Amount</span>
        <input className="wl-input" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="0.00" inputMode="decimal" />
        <span className="send-avail">Spendable: {bal ? fmtDivi(bal.spendable) : "—"} DIVI</span>
      </label>
      {needsPass && (
        <label className="send-field">
          <span className="send-label">Wallet password</span>
          <input className="wl-input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Wallet password" />
        </label>
      )}
      <p className="wl-note">
        Locks the coins on-chain to the recipient. They see it's committed but can't claim without the release code you
        share separately. You can refund after {REFUND_DAYS} days if they never claim. You pay the fee; they get the full
        amount.
      </p>
      <button type="button" className="wl-btn wl-btn-primary" onClick={create} disabled={busy || amount == null || !recipient.trim() || (needsPass && !pass)}>
        {busy ? "Locking…" : "Create escrow"}
      </button>
      {err && <p className="wl-err">{err}</p>}

      {history.length > 0 && (
        <div className="bearer-history">
          <div className="bearer-history-title">Escrows you created</div>
          {history.map((h) => (
            <div key={h.txid} className="bearer-history-row">
              <span className="bearer-history-amt">{fmtDivi(h.amount)} DIVI</span>
              <button type="button" className="wl-link" onClick={() => copy("t" + h.txid, h.ticket)}>
                {copied === "t" + h.txid ? "copied" : "ticket"}
              </button>
              <button type="button" className="wl-link" onClick={() => copy("c" + h.txid, h.code)}>
                {copied === "c" + h.txid ? "copied" : "code"}
              </button>
              <button type="button" className="wl-link" title={`Refund allowed after ${fmtDate(h.locktime)}`} onClick={() => refund(h)}>
                refund
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EscrowRedeem() {
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [needsPass, setNeedsPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const st = await walletStatus();
        setNeedsPass(st.encrypted && !(getAskMode() === "open" && st.unlocked));
      } catch {
        /* default */
      }
    })();
  }, []);

  const check = async () => {
    setErr(null);
    setInfo(null);
    try {
      const s = await escrowStatus(ticket.trim());
      if (s.claimed || !s.funded) {
        setInfo("This escrow has already been claimed, or was never funded.");
      } else {
        setInfo(
          `${fmtDivi(s.amount)} DIVI is locked to you (${s.confirmations} confirmation${s.confirmations === 1 ? "" : "s"}), ` +
            `from ${s.sender}. The sender can only refund it after ${fmtDate(s.locktime)}. Enter the release code to claim.`
        );
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  const claim = async () => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await escrowClaim(ticket.trim(), code.trim(), needsPass ? pass : undefined);
      setDone(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="bearer-result">
        <div className="bearer-made-amt">✓ Claimed into your wallet</div>
        <p className="wl-note">The coins are sweeping to a fresh address in this wallet and will confirm shortly.</p>
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => { setDone(false); setTicket(""); setCode(""); }}>
          Redeem another
        </button>
      </div>
    );
  }

  return (
    <div className="bearer-form">
      <label className="send-field">
        <span className="send-label">Ticket</span>
        <textarea className="wl-input bearer-code-input" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="DVE1-…" spellCheck={false} rows={3} />
      </label>
      <button type="button" className="wl-btn" onClick={check} disabled={!ticket.trim()}>
        Check what's locked
      </button>
      {info && <p className="wl-note">{info}</p>}
      <label className="send-field">
        <span className="send-label">Release code</span>
        <input className="wl-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="the code the sender gave you" spellCheck={false} />
      </label>
      {needsPass && (
        <label className="send-field">
          <span className="send-label">Wallet password</span>
          <input className="wl-input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Wallet password" />
        </label>
      )}
      <button type="button" className="wl-btn wl-btn-primary" onClick={claim} disabled={busy || !ticket.trim() || !code.trim() || (needsPass && !pass)}>
        {busy ? "Claiming…" : "Claim with code"}
      </button>
      {err && <p className="wl-err">{err}</p>}
    </div>
  );
}
