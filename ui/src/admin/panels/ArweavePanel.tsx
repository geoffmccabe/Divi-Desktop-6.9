import { useEffect, useState } from "react";
import { nfdRelayStatus, openUrl, type RelayStatus } from "../../wallet/api";

// Admin: Arweave uploader status + top-up. Operational only — this is the
// Turbo-funded storage account, not the treasury. No keys are shown or held here.

function credits(winc: string | null): string {
  if (!winc) return "—";
  const n = Number(winc);
  if (!isFinite(n)) return winc;
  return `≈ ${(n / 1e12).toLocaleString(undefined, { maximumFractionDigits: 4 })} credits`;
}

export function ArweavePanel() {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      setStatus(await nfdRelayStatus());
    } catch {
      /* leave prior status */
    }
    setBusy(false);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="admin-panel-body">
      <p className="wl-note">
        The Arweave uploader (<code>{status?.relayUrl || "…"}</code>) stores collectibles permanently, paid
        from a Turbo credit balance.
      </p>

      <div className={status?.reachable ? "ts-proof ts-proof-ok" : "ts-proof"}>
        <div className="ts-proof-title">
          {status ? (status.reachable ? "● Online" : "○ Not reachable") : "Checking…"}
        </div>
        <div>Balance: {credits(status?.balanceWinc ?? null)}</div>
        {status && !status.reachable && (
          <p className="wl-note">The uploader isn’t reachable yet — deploy it, or check nfds.divi.love.</p>
        )}
      </div>

      <button className="wl-btn" disabled={busy} onClick={load}>
        {busy ? "Checking…" : "Refresh"}
      </button>
      <button className="wl-btn wl-btn-primary" onClick={() => openUrl("https://turbo.ardrive.net")}>
        Top up with card
      </button>
      <p className="wl-note">
        Top-up opens ArDrive Turbo — log in with the uploader’s funded wallet and buy credits with a
        credit/debit card. The balance above updates on Refresh.
      </p>
    </div>
  );
}
