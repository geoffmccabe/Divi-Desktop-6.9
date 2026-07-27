import { useState } from "react";
import { hraDelist, hraListForSale, hraRenew, hraSetPrimary, hraTransfer, type OwnedName } from "./api";
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
  const [price, setPrice] = useState("");
  // Default no-cancel window: 720 blocks, about twelve hours. Long enough that a
  // buyer can act without racing, short enough not to trap a seller for days.
  const [lockBlocks, setLockBlocks] = useState("720");
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
        You do not own any names yet. Use the Register a Name tab to claim one.
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
                onClick={() => {
                  // Clear the transfer box when moving between names. Leaving a
                  // typed address behind, on a control that hands a name away
                  // irreversibly, is not a risk worth the convenience.
                  setSendTo("");
                  setPrice("");
                  setLockBlocks("720");
                  setError("");
                  setDone("");
                  setOpen(isOpen ? null : n.name);
                }}
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

                <div className="hra-sell">
                  {n.listedPriceDivi != null ? (
                    <>
                      <p className="wl-note">
                        On the market for <strong>{n.listedPriceDivi.toLocaleString()} DIVI</strong>.
                        Anyone can buy it by paying you directly.
                      </p>
                      <button
                        className="wl-btn"
                        disabled={busy !== ""}
                        onClick={() => run("delist", () => hraDelist(n.name))}
                      >
                        {busy === "delist" ? "Removing…" : "Take off the market"}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="hra-addrow">
                        <label className="hra-field">
                          <span>Sell it for</span>
                          <input
                            className="wl-input"
                            placeholder="DIVI"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            inputMode="decimal"
                          />
                        </label>
                        <label className="hra-field">
                          <span>Cannot cancel for</span>
                          <select
                            className="wl-input"
                            value={lockBlocks}
                            onChange={(e) => setLockBlocks(e.target.value)}
                          >
                            <option value="60">about an hour</option>
                            <option value="720">about twelve hours</option>
                            <option value="1440">about a day</option>
                            <option value="10080">about a week</option>
                          </select>
                        </label>
                      </div>
                      <p className="wl-note hra-dim">
                        You are promising not to withdraw the offer for that long. That promise is
                        what lets somebody buy it without risking their money, so it cannot be
                        skipped.
                      </p>
                      <button
                        className="wl-btn"
                        disabled={busy !== "" || !(Number(price) > 0)}
                        onClick={() =>
                          run("list", () => hraListForSale(n.name, Number(price), Number(lockBlocks)))
                        }
                      >
                        {busy === "list" ? "Listing…" : "Put on the market"}
                      </button>
                    </>
                  )}
                </div>

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
