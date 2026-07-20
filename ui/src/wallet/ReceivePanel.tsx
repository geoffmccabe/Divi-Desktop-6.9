import { useEffect, useState } from "react";
import { addressQr, newReceiveAddress, walletAddresses, openUrl } from "./api";
import { playSound } from "../sound";

export function ReceivePanel() {
  const [addr, setAddr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Show the wallet's standard (main) address right away — no click needed.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await walletAddresses();
        const main = list.find((a) => a.isMain) ?? list[0];
        if (!alive || !main) return;
        setAddr(main.address);
        setQr(await addressQr(main.address));
      } catch {
        /* leave empty; the fresh-address button still works */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function freshAddress() {
    setBusy(true);
    setErr(null);
    try {
      const a = await newReceiveAddress();
      setAddr(a);
      setQr(await addressQr(a));
      playSound("receive");
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  async function copy() {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
    } catch {
      /* clipboard may be unavailable; the address is still shown */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function emailAddress() {
    if (!addr) return;
    const subject = "My Divi address";
    const body = `Here's my Divi address — you can send DIVI to it:\n\n${addr}\n\nPaste it into your Divi wallet's Send screen to pay me.`;
    openUrl(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  }

  const Explain = (
    <div className="rcv-explain">
      <div className="rcv-explain-title">Getting paid in DIVI</div>
      <p>
        This is your wallet's <strong>address</strong> — think of it like an account number. Anyone
        can send DIVI to it, and it arrives in your wallet.
      </p>
      <p>To receive a payment, share your address any of these ways:</p>
      <ul className="rcv-steps">
        <li>
          <strong>Copy</strong> it and paste it to whoever is paying you.
        </li>
        <li>
          Let them <strong>scan the QR code</strong> with their phone wallet's camera.
        </li>
        <li>
          <strong>Send it by email or Telegram</strong> with the buttons below.
        </li>
      </ul>
      <p className="rcv-safe">
        It's safe to share — an address only lets people <em>send</em> you DIVI, never take it. For
        extra privacy you can <strong>use a new address</strong>; money to any of your addresses
        still lands in this one wallet.
      </p>
    </div>
  );

  if (!addr) {
    return (
      <div className="receive">
        {Explain}
        <p className="wl-note">Loading your receiving address…</p>
        {err && <p className="wl-err">{err}</p>}
      </div>
    );
  }

  return (
    <div className="receive">
      {Explain}
      {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
      <div className="addr-box">
        <code>{addr}</code>
        <button className="wl-btn" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      <div className="rcv-share">
        <button className="wl-btn" onClick={emailAddress}>
          Send by Email
        </button>
        <button className="wl-btn" disabled title="Available once your wallet is linked to DiviGo">
          Send by Telegram
        </button>
        <span className="rcv-share-soon">Telegram coming with DiviGo</span>
      </div>

      <button className="wl-link" disabled={busy} onClick={freshAddress}>
        {busy ? "Generating…" : "Use a new address"}
      </button>
      {err && <p className="wl-err">{err}</p>}
    </div>
  );
}
