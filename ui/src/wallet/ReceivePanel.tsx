import { useEffect, useState } from "react";
import { addressQr, newReceiveAddress, walletAddresses } from "./api";
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

  if (!addr) {
    return (
      <div className="receive">
        <p className="wl-note">Loading your receiving address…</p>
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
      <p className="wl-note">Your main address. For more privacy you can use a fresh one for each payment.</p>
      <button className="wl-link" disabled={busy} onClick={freshAddress}>
        {busy ? "Generating…" : "Use a new address"}
      </button>
      {err && <p className="wl-err">{err}</p>}
    </div>
  );
}
