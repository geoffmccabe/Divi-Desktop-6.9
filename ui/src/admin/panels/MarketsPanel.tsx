import { useEffect, useState } from "react";
import { fetchExchanges, type Exchange } from "../../wallet/exchanges";
import "./markets.css";

// Admin → Markets. The catalog of exchanges the Market Maker feature offers. It is
// shared with every wallet and holds NO secret keys — each user connects their own
// exchange account on their own device. Read-only for now; adding/editing exchanges
// needs a privileged admin write path (the next step) so only the admin can change
// the shared list.
export function MarketsPanel() {
  const [rows, setRows] = useState<Exchange[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchExchanges()
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="value-panel">
      <section className="style-group">
        <h3>Exchanges</h3>
        <p className="set-note">
          The exchanges the Market Maker feature offers. This catalog is shared with every wallet and
          holds no secret keys — each user connects their own account on their own device.
        </p>

        {failed && <p className="set-note">Couldn’t load the catalog right now.</p>}
        {rows === null && !failed && <p className="set-note">Loading…</p>}
        {rows && rows.length === 0 && <p className="set-note">No exchanges yet.</p>}

        {rows && rows.length > 0 && (
          <ul className="mkt-list">
            {rows.map((x) => (
              <li key={x.id} className="mkt-row">
                <div className="mkt-row-head">
                  <span className="mkt-name">{x.name}</span>
                  <span className="mkt-slug">{x.slug}</span>
                  <span className="mkt-state">{x.enabled ? "enabled" : "off"}</span>
                </div>
                <div className="mkt-pairs">{x.pairs.length ? x.pairs.join(", ") : "no pairs yet"}</div>
                <div className="set-note mkt-endpoints">{x.rest_url || "no endpoint set"}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="style-group">
        <h3>Adding exchanges</h3>
        <p className="set-note">
          Editing this shared list needs a secure admin write path, so only you can change it. That’s
          the next step — for now the catalog is read-only here and managed centrally.
        </p>
      </section>
    </div>
  );
}
