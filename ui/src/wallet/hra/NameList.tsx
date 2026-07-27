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
  const [search, setSearch] = useState("");
  // Collapsed by default: several hundred reserve holdings unrolled on open
  // would make the tab unusable for the names somebody actually chose.
  const [showReserve, setShowReserve] = useState(false);

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

  // Names held on behalf of brands and well-known people are kept apart. There
  // are several hundred of them for whoever holds the reserve, and mixed in
  // they would bury the handful somebody actually chose.
  const q = search.trim().toLowerCase();
  const matches = (n: OwnedName) => !q || n.name.toLowerCase().includes(q);
  const chosen = names.filter((n) => !n.fromReserve).filter(matches);
  const reserved = names.filter((n) => n.fromReserve).filter(matches);

  const renderCard = (n: OwnedName) => {
        const isOpen = open === n.name;
        const blocksLeft = Math.max(0, n.expiresHeight - tip);
        const daysLeft = Math.round(blocksLeft / 1440);
        // A perpetual name has no expiry to count down, and showing one would
        // be nonsense: its height is deliberately the largest number there is.
        const expiringSoon = !n.perpetual && tip > 0 && daysLeft <= 30;
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
                {n.perpetual
                  ? "never expires"
                  : tip > 0
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
  };

  const expiring = names.filter(
    (n) => !n.perpetual && tip > 0 && n.expiresHeight > tip && n.expiresHeight - tip <= 30 * 1440
  );

  return (
    <div className="hra-list">
      {/* Names lapse, so a reminder is a requirement rather than a nicety. */}
      {expiring.length > 0 && (
        <div className="hra-banner hra-banner-behind">
          <strong>
            {expiring.length === 1
              ? `${expiring[0].name.toLowerCase()} expires soon.`
              : `${expiring.length} of your names expire within a month.`}
          </strong>{" "}
          Renew before the year is up. After that there is a 90 day grace period where only you can
          renew, and once that passes anyone can take the name.
        </div>
      )}

      {names.length > 8 && (
        <label className="hra-field">
          <span>Find a name</span>
          <input
            className="wl-input mono"
            placeholder="type to filter"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
          />
        </label>
      )}

      {chosen.map(renderCard)}
      {chosen.length === 0 && q !== "" && reserved.length === 0 && (
        <p className="wl-note">Nothing matches “{search.trim()}”.</p>
      )}

      {reserved.length > 0 && (
        <section className="hra-reserve">
          <button
            className="hra-reserve-head"
            onClick={() => setShowReserve(!showReserve)}
            aria-expanded={showReserve}
          >
            {showReserve ? "▾" : "▸"} Held in reserve ({reserved.length.toLocaleString()})
          </button>
          <p className="wl-note hra-dim">
            Brand and well-known-person names, held so nobody can impersonate them. They never
            expire. Send one on when you are satisfied it is going to the right people.
          </p>
          {showReserve && reserved.map(renderCard)}
        </section>
      )}

      {done && <p className="wl-note">{done}</p>}
      {error && <p className="wl-err">{error}</p>}
    </div>
  );
}
