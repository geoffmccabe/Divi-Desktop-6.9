// The two public community wallets, shown at the top of both the MultiSig and
// Governance panels. Balances are read live from our own node's address index
// (no external explorer). While that index is still building on a first launch,
// each card shows "unavailable" rather than a wrong number.

import { useEffect, useState } from "react";
import { addressBalance, type AddrBalance } from "../api";

interface Wallet {
  label: string;
  address: string;
  note: string;
}

// The Foundation and Charity multisig treasuries (public addresses).
const WALLETS: Wallet[] = [
  {
    label: "Foundation",
    address: "DPhJsztbZafDc1YeyrRqSjmKjkmLJpQpUn",
    note: "Community development treasury",
  },
  {
    label: "Charity",
    address: "DPujt2XAdHyRcZNB5ySZBBVKjzY2uXZGYq",
    note: "Charitable giving treasury",
  },
];

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function short(addr: string): string {
  return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function TreasuryCard({ w }: { w: Wallet }) {
  const [bal, setBal] = useState<AddrBalance | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    addressBalance(w.address)
      .then((b) => live && setBal(b))
      .catch(() => live && setBal({ available: false, balance: 0, message: "Node unreachable" }));
    return () => {
      live = false;
    };
  }, [w.address]);

  const copy = () => {
    navigator.clipboard?.writeText(w.address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };

  return (
    <div className="ms-treasury-card">
      <div className="ms-treasury-head">
        <span className="ms-treasury-label">{w.label}</span>
        <span className="ms-treasury-tag">Public wallet</span>
      </div>
      <div className="ms-treasury-amount">
        {bal == null ? (
          <span className="ms-treasury-dim">Loading…</span>
        ) : bal.available ? (
          <>
            {fmt(bal.balance)} <span className="ms-treasury-unit">DIVI</span>
          </>
        ) : (
          <span className="ms-treasury-dim" title={bal.message}>
            Unavailable
          </span>
        )}
      </div>
      <div className="ms-treasury-note">{w.note}</div>
      <button type="button" className="ms-treasury-addr" onClick={copy} title="Copy address">
        <span className="ms-mono">{short(w.address)}</span>
        <span className="ms-treasury-copy">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

export function TreasuryStrip() {
  return (
    <div className="ms-treasury-strip">
      {WALLETS.map((w) => (
        <TreasuryCard key={w.address} w={w} />
      ))}
    </div>
  );
}
