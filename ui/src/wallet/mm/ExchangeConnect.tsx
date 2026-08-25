// Connect-an-exchange setup, per exchange from the catalog. The user pastes a
// trade-only API key; it goes straight to the OS keychain via the Rust backend
// (never stored in the UI), then we verify it with a read-only balance check.
// Collapsible: open by default when nothing is connected yet, collapsed once an
// exchange is registered (so the Run panel is what you see day-to-day).

import { useCallback, useEffect, useState } from "react";
import type { Exchange } from "../exchanges";
import { Icon } from "../../Icon";
import {
  mmHasCredentials,
  mmSaveCredentials,
  mmClearCredentials,
  mmTestConnection,
  type MmBalance,
} from "../api";
import "./exchange-connect.css";

export function ExchangeConnect({ exchanges }: { exchanges: Exchange[] }) {
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  // null = not decided yet; first check sets the default (collapsed if any connected).
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  const check = useCallback(() => {
    Promise.all(
      exchanges.map((x) =>
        mmHasCredentials(x.slug).then((v) => [x.slug, v] as const).catch(() => [x.slug, false] as const),
      ),
    ).then((pairs) => {
      const m = Object.fromEntries(pairs);
      setConnected(m);
      setCollapsed((prev) => (prev === null ? Object.values(m).some(Boolean) : prev));
    });
  }, [exchanges]);

  useEffect(() => { check(); }, [check]);

  const connectedNames = exchanges.filter((x) => connected[x.slug]).map((x) => x.name);
  const isCollapsed = collapsed === true;

  return (
    <section className="ts-section">
      <button type="button" className="mm-collapse-head" onClick={() => setCollapsed((c) => c !== true)}>
        <h3 className="ts-head mm-collapse-title">Connect an exchange</h3>
        <span className="mm-collapse-meta">
          {connectedNames.length > 0 ? `${connectedNames.join(", ")} connected` : "none connected"}
        </span>
        <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={16} />
      </button>

      {!isCollapsed && (
        <div className="mm-collapse-body">
          <p className="wl-note gov-wide">
            Add a <strong>trade-only</strong> API key for an exchange you already use — it stays
            encrypted on this device and can place orders but never withdraw your funds.
          </p>
          <ul className="xc-list">
            {exchanges.map((x) => (
              <ExchangeRow key={x.id} ex={x} onChange={check} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ExchangeRow({ ex, onChange }: { ex: Exchange; onChange: () => void }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [balances, setBalances] = useState<MmBalance[] | null>(null);

  useEffect(() => {
    mmHasCredentials(ex.slug).then(setConnected).catch(() => setConnected(false));
  }, [ex.slug]);

  const saveAndTest = async () => {
    setBusy(true);
    setMsg(null);
    setBalances(null);
    try {
      await mmSaveCredentials(ex.slug, key, secret, pass || undefined);
      const b = await mmTestConnection(ex.slug, ex.connector_type, ex.rest_url ?? "");
      setBalances(b);
      setConnected(true);
      setMsg("Connected — keys verified with a read-only balance check.");
      setKey("");
      setSecret("");
      setPass("");
      onChange();
    } catch (e) {
      setMsg(String(e));
      mmHasCredentials(ex.slug).then(setConnected).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await mmClearCredentials(ex.slug);
      setConnected(false);
      setBalances(null);
      setMsg(null);
      onChange();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="xc-row">
      <div className="xc-row-head">
        <span className="xc-name">{ex.name}</span>
        <span className="xc-pairs">{ex.pairs.join(", ")}</span>
        <span className={connected ? "xc-on" : "xc-off"}>{connected ? "connected" : "not connected"}</span>
        <button type="button" className="wl-btn" onClick={() => setOpen((o) => !o)}>
          {connected ? "Manage" : "Connect"}
        </button>
      </div>

      {open && (
        <div className="xc-form">
          <label className="value-field">
            <span className="send-label">API key</span>
            <input
              className="wl-input"
              value={key}
              placeholder="Trade-only API key"
              onChange={(e) => setKey(e.target.value)}
              onInput={(e) => setKey((e.target as HTMLInputElement).value)}
            />
          </label>
          <label className="value-field">
            <span className="send-label">API secret</span>
            <input
              className="wl-input"
              type="password"
              value={secret}
              placeholder="API secret"
              onChange={(e) => setSecret(e.target.value)}
              onInput={(e) => setSecret((e.target as HTMLInputElement).value)}
            />
          </label>
          <label className="value-field">
            <span className="send-label">Passphrase (only if your exchange requires one)</span>
            <input
              className="wl-input"
              type="password"
              value={pass}
              placeholder="Optional"
              onChange={(e) => setPass(e.target.value)}
              onInput={(e) => setPass((e.target as HTMLInputElement).value)}
            />
          </label>

          <p className="wl-note">
            On the exchange, set this key to <strong>trade-only</strong> and turn withdrawals off. It is
            stored only on this device, in the OS keychain.
          </p>

          <div className="xc-actions">
            <button type="button" className="wl-btn" disabled={busy || !key || !secret} onClick={saveAndTest}>
              {busy ? "Checking…" : "Save & test"}
            </button>
            {connected && (
              <button type="button" className="wl-link" disabled={busy} onClick={disconnect}>
                Disconnect
              </button>
            )}
          </div>

          {msg && <p className="wl-note xc-msg">{msg}</p>}
          {balances && balances.length > 0 && (
            <ul className="xc-bal">
              {balances.map((b) => (
                <li key={b.asset} className="wl-note">
                  {b.asset}: {b.free} free{b.locked ? `, ${b.locked} in orders` : ""}
                </li>
              ))}
            </ul>
          )}
          {balances && balances.length === 0 && (
            <p className="wl-note">Connected, but this account has no balances yet.</p>
          )}
        </div>
      )}
    </li>
  );
}
