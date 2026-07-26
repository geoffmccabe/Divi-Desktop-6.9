import { useEffect, useState } from "react";
import {
  walletBalance,
  walletStatus,
  validateAddress,
  sendCoins,
  fastSend,
  openUrl,
  explorerTxUrl,
  type Balance,
} from "./api";
import { takeSendTarget } from "./sendTarget";
import { getAskMode } from "./securityPrefs";
import { fmtDivi } from "../status";
import { FastSendTracker } from "./FastSendTracker";
import { BearerPanel } from "./BearerPanel";
import { PinCodeSendPanel } from "./PinCodeSendPanel";
import { ContactPicker } from "./ContactPicker";
import { Identicon } from "./Identicon";
import { findByAddress, isKnownGood, markSent } from "./contacts";

// Above this, we nudge the sender that the recipient will likely wait for a
// confirmation rather than accept instantly. Soft guidance, not a block.
const FAST_SOFT_CAP = 1000;

// Sending real, irreversible DIVI. Flow: fill in, review (explicit confirm),
// unlock only if the wallet requires it (encrypted + ask-on-send), broadcast.
type Stage = "form" | "confirm" | "password" | "sending" | "done";

// A positive number with at most 8 decimals, or null if the text isn't valid.
function parseAmount(s: string): number | null {
  const t = s.trim();
  if (!/^\d*\.?\d{0,8}$/.test(t) || t === "" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The four send types laid out two-across. The standard and fast forms share
// one component (differing only by `fast`); Pin Code and Bearer are their own
// modules. Each card manages its own state independently.
export function SendPanel() {
  return (
    <div className="send-grid">
      <section className="send-card">
        <h3 className="send-card-title">Send</h3>
        <SendForm fast={false} acceptHandoff />
      </section>
      <section className="send-card">
        <h3 className="send-card-title">FAST SEND ⚡</h3>
        <SendForm fast={true} />
      </section>
      <section className="send-card">
        <h3 className="send-card-title">🔒 Pin Code Send</h3>
        <PinCodeSendPanel />
      </section>
      <section className="send-card">
        <h3 className="send-card-title">🎟 Bearer Send</h3>
        <BearerPanel />
      </section>
    </div>
  );
}

// The reusable send form. `fast` picks the fast-vs-standard broadcast path and
// tracker. `acceptHandoff` (standard panel only) consumes the one-shot Contacts
// "Send to" recipient, so two forms on screen don't both swallow it.
function SendForm({ fast, acceptHandoff = false }: { fast: boolean; acceptHandoff?: boolean }) {
  const [stage, setStage] = useState<Stage>("form");
  const [address, setAddress] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [pass, setPass] = useState("");
  const [bal, setBal] = useState<Balance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txid, setTxid] = useState("");
  const [broadcastAt, setBroadcastAt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const b = await walletBalance();
        // Keep the last good balance; never overwrite a real value with a null
        // from a momentarily-busy node (that's what made Send read 0 and block).
        if (alive && b) setBal(b);
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

  // Prefill the recipient when the Contacts panel hands one off (its Send
  // button). Only the standard form consumes it, since takeSendTarget is
  // one-shot and two forms would race to read it.
  useEffect(() => {
    if (!acceptHandoff) return;
    const t = takeSendTarget();
    if (t) setAddress(t.address);
    const onSendTo = () => {
      const n = takeSendTarget();
      if (n) {
        setAddress(n.address);
        setStage("form");
      }
    };
    window.addEventListener("dd69:sendto", onSendTo);
    return () => window.removeEventListener("dd69:sendto", onSendTo);
  }, [acceptHandoff]);

  const contactHit = findByAddress(address);
  const knownGood = isKnownGood(address);
  const amount = parseAmount(amountStr);
  // Only treat it as "over balance" when we actually have a balance to compare
  // against. An unknown/failed read must never block the send; the node is the
  // real authority and will reject a genuine over-spend.
  const overBalance = bal != null && amount != null && amount > bal.spendable;

  const reset = () => {
    setStage("form");
    setAddress("");
    setAmountStr("");
    setPass("");
    setErr(null);
    setTxid("");
    setBroadcastAt(0);
  };

  // Form to confirm: validate the address with the node and the amount locally.
  const review = async () => {
    setErr(null);
    if (amount == null) return setErr("Enter a valid amount (up to 8 decimals).");
    let ok = false;
    try {
      ok = await validateAddress(address.trim());
    } catch (e) {
      return setErr(String(e));
    }
    if (!ok) return setErr("That doesn't look like a valid DIVI address.");
    setStage("confirm");
  };

  // Confirm: decide whether a password is needed, then send.
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
      const id = fast
        ? await fastSend(address.trim(), amount!, passphrase)
        : await sendCoins(address.trim(), amount!, passphrase);
      setTxid(id);
      setBroadcastAt(Date.now());
      markSent(address.trim()); // turns a matching contact known-good (both paths)
      setStage("done");
    } catch (e) {
      setErr(String(e));
      setStage(passphrase != null ? "password" : "confirm");
    }
  };

  if (stage === "done") {
    return (
      <div className="send-panel">
        <div className="send-done">{fast ? "⚡ Fast Sent" : "✓ Sent"} {fmtDivi(amount ?? 0)} DIVI</div>
        {fast && txid ? (
          <FastSendTracker txid={txid} broadcastAt={broadcastAt} />
        ) : (
          <p className="wl-note">Your transaction is on its way. It may take a few minutes to confirm.</p>
        )}
        {txid && (
          <button type="button" className="wl-link" onClick={() => openUrl(explorerTxUrl(txid))}>
            View in Divi Love Scan
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
        <span className="send-label send-to-label">
          To address
          <ContactPicker disabled={stage !== "form"} onPick={(addr) => setAddress(addr)} />
        </span>
        <input
          className="wl-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="D…"
          disabled={stage !== "form"}
          spellCheck={false}
        />
        {contactHit && (
          <span className="send-contact">
            {contactHit.contact.emoji ? (
              <span className="cb-emoji-avatar send-contact-emoji">{contactHit.contact.emoji}</span>
            ) : (
              <Identicon address={contactHit.matched.address} size={20} />
            )}
            <span className="send-contact-name">{contactHit.contact.name}</span>
            {knownGood ? (
              <span className="send-contact-known">✓ known</span>
            ) : (
              <span className="send-contact-new">first time sending here, verify the address</span>
            )}
          </span>
        )}
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
        <span className="send-avail">
          Spendable: {bal ? fmtDivi(bal.spendable) : "—"} DIVI · leave a little for the network fee
        </span>
        {overBalance && <span className="wl-err">More than your spendable balance. The send may be rejected.</span>}
      </label>

      {fast && (
        <p className="wl-note send-fast-note">
          Pays a ~5x priority fee and stamps an on-chain marker, so the recipient instantly recognises it and sees it
          arrive within seconds. Network-wide fraud-check arrives in a later phase.
        </p>
      )}
      {fast && amount != null && amount > FAST_SOFT_CAP && (
        <span className="wl-note">
          Large amount: the recipient may wait for a confirmation (about a minute) before releasing goods.
        </span>
      )}

      {stage === "form" && (
        <button
          type="button"
          className="wl-btn wl-btn-primary"
          onClick={review}
          disabled={amount == null || !address.trim()}
        >
          {fast ? "Review fast send" : "Review send"}
        </button>
      )}

      {stage === "confirm" && (
        <div className="send-confirm">
          <p className="send-confirm-line">
            {fast ? "Fast send" : "Send"} <strong>{fmtDivi(amount ?? 0)} DIVI</strong> to
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
