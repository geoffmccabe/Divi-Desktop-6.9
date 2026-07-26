import { useState } from "react";
import { hraRenew, hraSetPrimary, hraTransfer, type OwnedName } from "./api";
import { NameRecords } from "./NameRecords";

// The names this wallet owns. Everything that changes a name lives behind an
// explicit button: nothing here happens as a side effect of opening a row.

export function NameList({
  names,
  tip,
  loading,
  onChanged,
}: {
  names: OwnedName[];
  tip: number;
  loading: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setError("");
    setDone("");
    try {
      await fn();
      setDone("Sent. It takes effect once the transaction is in a block.");
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  };

  if (loading && names.length === 0) return <p className="wl-note">Looking…</p>;

  if (names.length === 0) {
    return (
      <p className="wl-note">
        You do not own any names yet. Use the Get a Name tab to claim one.
      </p>
    );
  }

  return (
    <div className="hra-list">
      {names.map((n) => {
        const isOpen = open === n.name;
        const blocksLeft = Math.max(0, n.expiresHeight - tip);
        const daysLeft = Math.round(blocksLeft / 1440);
        const expiringSoon = tip > 0 && daysLeft <= 30;
        return (
          <article className={"hra-card" + (isOpen ? " hra-card-open" : "")} key={n.name}>
            <header className="hra-card-head">
              <button
                className="hra-card-title"
                onClick={() => setOpen(isOpen ? null : n.name)}
                aria-expanded={isOpen}
              >
                <span className="mono hra-name">{n.name.toLowerCase()}</span>
                {n.isPrimary && <span className="hra-badge">shown for your address</span>}
                {n.listedPriceDivi != null && (
                  <span className="hra-badge hra-badge-sale">
                    for sale, {n.listedPriceDivi.toLocaleString()} DIVI
                  </span>
                )}
              </button>
              <span className={expiringSoon ? "wl-err" : "wl-note"}>
                {tip > 0
                  ? blocksLeft === 0
                    ? "expired"
                    : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
                  : ""}
              </span>
            </header>

            {isOpen && (
              <div className="hra-card-body">
                <NameRecords name={n} onChanged={onChanged} />

                <div className="hra-actions">
                  <button
                    className="wl-btn"
                    disabled={busy !== "" || n.isPrimary}
                    onClick={() => run("primary", () => hraSetPrimary(n.name))}
                    title="Show this name wherever your address appears"
                  >
                    {n.isPrimary ? "Already your display name" : "Use as my display name"}
                  </button>
                  <button
                    className="wl-btn"
                    disabled={busy !== ""}
                    onClick={() => run("renew", () => hraRenew(n.name))}
                  >
                    {busy === "renew" ? "Renewing…" : "Renew for another year"}
                  </button>
                </div>
                <p className="wl-note hra-dim">
                  Your display name only works if this name already points at the address you are
                  claiming it for. Both directions have to agree, so nobody can make their address
                  show up as somebody else's name.
                </p>

                <div className="hra-transfer">
                  <label className="hra-field">
                    <span>Give this name to someone</span>
                    <input
                      className="wl-input mono"
                      placeholder="their Divi address"
                      value={sendTo}
                      onChange={(e) => setSendTo(e.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <button
                    className="wl-btn"
                    disabled={busy !== "" || !sendTo.trim()}
                    onClick={() => run("transfer", () => hraTransfer(n.name, sendTo.trim()))}
                  >
                    {busy === "transfer" ? "Sending…" : "Send name"}
                  </button>
                  <p className="wl-err">
                    This cannot be undone. Once it is in a block the name belongs to that address and
                    only they can move it back.
                  </p>
                </div>
              </div>
            )}
          </article>
        );
      })}

      {done && <p className="wl-note">{done}</p>}
      {error && <p className="wl-err">{error}</p>}
    </div>
  );
}
