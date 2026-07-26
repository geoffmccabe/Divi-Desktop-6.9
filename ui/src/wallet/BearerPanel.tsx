import { useEffect, useState } from "react";
import {
  bearerCreate,
  bearerSweep,
  bearerStatus,
  walletStatus,
  walletBalance,
  newReceiveAddress,
  addressQr,
  type Balance,
} from "./api";
import { getAskMode } from "./securityPrefs";
import { fmtDivi } from "../status";
import { addBearerCode, loadBearerCodes, removeBearerCode, type BearerRecord } from "./bearerCodes";

// Bearer transactions: create a redeemable claim code that anyone holding it can
// sweep, or redeem a code someone gave you. v1 is REVOCABLE — the key stays in
// this wallet, so an unredeemed code can be reclaimed.

type Tab = "create" | "redeem";

function parseAmount(s: string): number | null {
  const t = s.trim();
  if (!/^\d*\.?\d{0,8}$/.test(t) || t === "" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function BearerPanel() {
  const [tab, setTab] = useState<Tab>("create");
  return (
    <div className="bearer-panel">
      <div className="bearer-tabs">
        <button type="button" className={tab === "create" ? "on" : ""} onClick={() => setTab("create")}>
          Create code
        </button>
        <button type="button" className={tab === "redeem" ? "on" : ""} onClick={() => setTab("redeem")}>
          Redeem a code
        </button>
      </div>
      {tab === "create" ? <BearerCreate /> : <BearerRedeem />}
    </div>
  );
}

function BearerCreate() {
  const [amountStr, setAmountStr] = useState("");
  const [pass, setPass] = useState("");
  const [needsPass, setNeedsPass] = useState(false);
  const [bal, setBal] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ code: string; amount: number } | null>(null);
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<BearerRecord[]>(loadBearerCodes());

  useEffect(() => {
    (async () => {
      try {
        const b = await walletBalance();
        if (b) setBal(b);
        const st = await walletStatus();
        setNeedsPass(st.encrypted && !(getAskMode() === "open" && st.unlocked));
      } catch {
        /* leave defaults */
      }
    })();
  }, []);

  const amount = parseAmount(amountStr);

  const create = async () => {
    if (amount == null) return setErr("Enter a valid amount.");
    setBusy(true);
    setErr(null);
    try {
      const res = await bearerCreate(amount, needsPass ? pass : undefined);
      setMade({ code: res.code, amount: res.amount });
      addBearerCode({ code: res.code, amount: res.amount, txid: res.txid, memo: "", createdAt: Date.now() });
      setHistory(loadBearerCodes());
      try {
        setQr(await addressQr(res.code));
      } catch {
        /* QR is optional */
      }
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
      removeBearerCode(txid);
      setHistory(loadBearerCodes());
    } catch (e) {
      setErr(String(e));
    }
  };

  if (made) {
    return (
      <div className="bearer-result">
        <div className="bearer-made-amt">Bearer code for {fmtDivi(made.amount)} DIVI</div>
        <p className="bearer-warn">
          This code is the money. Anyone who has it can claim it. Share it only with the person you mean to pay, over a
          channel you trust.
        </p>
        {qr && <img className="bearer-qr" src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`} alt="code QR" />}
        <div className="bearer-code" title="Click to copy" onClick={() => { navigator.clipboard?.writeText(made.code); setCopied(true); }}>
          {made.code}
        </div>
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => { navigator.clipboard?.writeText(made.code); setCopied(true); }}>
          {copied ? "Copied ✓" : "Copy code"}
        </button>
        <button type="button" className="wl-btn" onClick={() => { setMade(null); setQr(""); setAmountStr(""); setCopied(false); }}>
          Create another
        </button>
        {err && <p className="wl-err">{err}</p>}
      </div>
    );
  }

  return (
    <div className="bearer-form">
      <label className="send-field">
        <span className="send-label">Amount to lock into the code</span>
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
        Revocable: the key stays in this wallet, so you can reclaim an unredeemed code below. Keep amounts modest while
        this is new — the code itself is spendable.
      </p>
      <button type="button" className="wl-btn wl-btn-primary" onClick={create} disabled={busy || amount == null || (needsPass && !pass)}>
        {busy ? "Creating…" : "Create bearer code"}
      </button>
      {err && <p className="wl-err">{err}</p>}

      {history.length > 0 && (
        <div className="bearer-history">
          <div className="bearer-history-title">Codes you created</div>
          {history.map((h) => (
            <div key={h.txid} className="bearer-history-row">
              <span className="bearer-history-amt">{fmtDivi(h.amount)} DIVI</span>
              <button type="button" className="wl-link" onClick={() => { navigator.clipboard?.writeText(h.code); }}>
                copy
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

function BearerRedeem() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [doneTxid, setDoneTxid] = useState("");

  const check = async () => {
    setErr(null);
    setInfo(null);
    try {
      const s = await bearerStatus(code.trim());
      if (s.claimed || !s.funded) setInfo("This code has already been claimed, or was never funded.");
      else setInfo(`Claimable: ${fmtDivi(s.value)} DIVI (${s.confirmations} confirmation${s.confirmations === 1 ? "" : "s"}).`);
    } catch (e) {
      setErr(String(e));
    }
  };

  const redeem = async () => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const dest = await newReceiveAddress();
      const txid = await bearerSweep(code.trim(), dest);
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
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => { setDoneTxid(""); setCode(""); }}>
          Redeem another
        </button>
      </div>
    );
  }

  return (
    <div className="bearer-form">
      <label className="send-field">
        <span className="send-label">Paste the bearer code</span>
        <textarea
          className="wl-input bearer-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="DVB1-…"
          spellCheck={false}
          rows={3}
        />
      </label>
      <div className="send-actions">
        <button type="button" className="wl-btn" onClick={check} disabled={!code.trim()}>
          Check
        </button>
        <button type="button" className="wl-btn wl-btn-primary" onClick={redeem} disabled={busy || !code.trim()}>
          {busy ? "Redeeming…" : "Redeem to my wallet"}
        </button>
      </div>
      {info && <p className="wl-note">{info}</p>}
      {err && <p className="wl-err">{err}</p>}
    </div>
  );
}
