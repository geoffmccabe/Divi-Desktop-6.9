import { useEffect, useRef, useState } from "react";
import { walletBalance, walletAddresses, type Balance, type AddrInfo } from "./api";
import { fmtDivi } from "../status";
import { AddressDropdown } from "./AddressDropdown";

export function HeaderBar() {
  const [bal, setBal] = useState<Balance | null>(null);
  const [addrs, setAddrs] = useState<AddrInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const b = await walletBalance();
        if (alive && b) setBal(b); // keep last-known on failure
      } catch {
        /* keep last */
      }
      try {
        const a = await walletAddresses();
        if (alive && a.length) setAddrs(a);
      } catch {
        /* keep last */
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (cellRef.current && !cellRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const main = addrs?.find((a) => a.isMain) ?? addrs?.[0] ?? null;

  return (
    <div className="header-bar">
      <div className="header-cell">
        <span className="bl-label">Spendable</span>
        <span className="bl-amt">
          {bal ? fmtDivi(bal.spendable) : "—"} <em>DIVI</em>
        </span>
      </div>
      <div className="header-cell">
        <span className="bl-label">Staking</span>
        <span className="bl-amt">
          {bal ? fmtDivi(bal.staking) : "—"} <em>DIVI</em>
        </span>
      </div>
      <div className="header-cell header-addr-cell" ref={cellRef}>
        <span className="bl-label">My Addresses</span>
        <button type="button" className="addr-toggle" onClick={() => setOpen((o) => !o)}>
          <span className="addr-toggle-text">{main ? main.address : "—"}</span>
          <span className={"addr-chevron" + (open ? " up" : "")}>▾</span>
        </button>
        <AddressDropdown open={open} addresses={addrs} />
      </div>
    </div>
  );
}
