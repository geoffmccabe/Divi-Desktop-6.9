import { useState } from "react";
import { addressQr, newReceiveAddress } from "./api";
import { playSound } from "../sound";

export function ReceivePanel() {
  const [addr, setAddr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
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

  if (!addr) {
    return (
      <div className="receive">
        <p className="wl-note">Generate an address to receive DIVI. A fresh one each time keeps things private.</p>
        <button className="wl-btn wl-btn-primary" disabled={busy} onClick={generate}>
          {busy ? "Generating…" : "Get a receiving address"}
        </button>
        {err && <p className="wl-err">{err}</p>}
      </div>
    );
  }

  return (
    <div className="receive">
      {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
      <div className="addr-box">
        <code>{addr}</code>
        <button className="wl-btn" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <button className="wl-link" disabled={busy} onClick={generate}>
        New address
      </button>
    </div>
  );
}
