// MultiSig: create and operate native N-of-M shared wallets on Divi's own P2SH
// multisig. A spend is proposed here, passed to the co-signers as a text blob,
// signed by each in turn, and broadcast once it has enough signatures.
//
// This build has no PSBT, so co-signers pass the blob by hand (copy/paste). A
// nicer share channel is a later phase; the money-moving parts are all here.

import "./multisig.css";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../Icon";
import { TreasuryStrip } from "./TreasuryStrip";
import {
  multisigList,
  multisigCreate,
  multisigForget,
  multisigPropose,
  multisigSign,
  multisigBroadcast,
  multisigMyPubkey,
  walletStatus,
  explorerTxUrl,
  openUrl,
  type MultisigWallet,
  type PendingSpend,
  type SignResult,
  type MyKey,
} from "../api";

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}
function short(addr: string): string {
  return addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr;
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  return (
    <div className="ms-copybox">
      <div className="ms-copybox-head">
        <span>{label}</span>
        <button type="button" className="ms-mini-btn" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea className="ms-blob" readOnly value={value} rows={3} spellCheck={false} />
    </div>
  );
}

// ── Your wallets ─────────────────────────────────────────────────────────────
function WalletList({ wallets, onForget }: { wallets: MultisigWallet[]; onForget: (a: string) => void }) {
  if (wallets.length === 0) {
    return <p className="wl-note">No shared wallets yet. Create one below.</p>;
  }
  return (
    <ul className="ms-wallet-list">
      {wallets.map((w) => (
        <li key={w.address} className="ms-wallet">
          <div className="ms-wallet-top">
            <span className="ms-wallet-name">{w.label}</span>
            <span className="ms-badge">
              {w.m} of {w.n}
            </span>
          </div>
          <div className="ms-wallet-bal">
            {w.balanceAvailable ? (
              <>
                {fmt(w.balance)} <span className="ms-unit">DIVI</span>
              </>
            ) : (
              <span className="ms-dim">Balance building…</span>
            )}
          </div>
          <div className="ms-wallet-addr ms-mono">{w.address}</div>
          <div className="ms-wallet-actions">
            <button
              type="button"
              className="ms-mini-btn"
              onClick={() => navigator.clipboard?.writeText(w.address)}
            >
              Copy address
            </button>
            <button type="button" className="ms-mini-btn ms-danger" onClick={() => onForget(w.address)}>
              Forget
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Create a shared wallet ───────────────────────────────────────────────────
function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [required, setRequired] = useState(2);
  const [keysText, setKeysText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<MultisigWallet | null>(null);

  const keys = keysText
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);

  const create = async () => {
    setErr(null);
    if (keys.length < 1) return setErr("Add at least one co-signer key or address.");
    if (required < 1 || required > keys.length)
      return setErr(`Signatures required must be between 1 and ${keys.length}.`);
    setBusy(true);
    try {
      const w = await multisigCreate(required, keys, label);
      setMade(w);
      setKeysText("");
      setLabel("");
      onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const [myKey, setMyKey] = useState<MyKey | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const getMyKey = async () => {
    setKeyBusy(true);
    try {
      setMyKey(await multisigMyPubkey());
    } catch {
      /* ignore */
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <div className="ms-form">
      {made && (
        <div className="ms-created">
          <div className="ms-created-title">
            <Icon name="check" size={16} /> Shared wallet created
          </div>
          <div className="ms-mono ms-created-addr">{made.address}</div>
          <p className="wl-note">
            Give this address to anyone who will fund it. Every co-signer should add this same wallet
            (same keys, same required count) so they can help sign spends.
          </p>
        </div>
      )}
      <div className="ms-mykey">
        <button type="button" className="ms-mini-btn" disabled={keyBusy} onClick={getMyKey}>
          {keyBusy ? "…" : "Get my public key to share"}
        </button>
        {myKey && (
          <div className="ms-mykey-out">
            <span className="ms-hint">Send this public key to whoever is building the shared wallet:</span>
            <CopyBox label="My public key" value={myKey.pubkey} />
          </div>
        )}
      </div>
      <label className="ms-field">
        <span className="ms-field-label">Name</span>
        <input
          className="ms-input"
          placeholder="e.g. Foundation treasury"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="ms-field">
        <span className="ms-field-label">Co-signers (one public key per line)</span>
        <textarea
          className="ms-input ms-textarea"
          rows={4}
          spellCheck={false}
          placeholder={"02a1b2…  (each co-signer's public key)\n03c4d5…"}
          value={keysText}
          onChange={(e) => setKeysText(e.target.value)}
        />
        <span className="ms-hint">
          {keys.length} co-signer(s) detected. Others send you their public key with the button
          above; one of your own addresses also works.
        </span>
      </label>
      <label className="ms-field ms-field-inline">
        <span className="ms-field-label">Signatures required to spend</span>
        <input
          className="ms-input ms-num"
          type="number"
          min={1}
          max={Math.max(1, keys.length)}
          value={required}
          onChange={(e) => setRequired(Number(e.target.value))}
        />
        <span className="ms-hint">of {Math.max(keys.length, 1)}</span>
      </label>
      {err && <div className="ms-err">{err}</div>}
      <button type="button" className="wl-btn wl-btn-primary" disabled={busy} onClick={create}>
        {busy ? "Creating…" : "Create shared wallet"}
      </button>
    </div>
  );
}

// ── Propose a spend ──────────────────────────────────────────────────────────
function ProposeForm({ wallets }: { wallets: MultisigWallet[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSpend | null>(null);

  useEffect(() => {
    if (!from && wallets.length) setFrom(wallets[0].address);
  }, [wallets, from]);

  const propose = async () => {
    setErr(null);
    setPending(null);
    const amt = Number(amount);
    if (!from) return setErr("Choose a wallet to spend from.");
    if (!to.trim()) return setErr("Enter a recipient address.");
    if (!(amt > 0)) return setErr("Enter an amount greater than zero.");
    setBusy(true);
    try {
      const p = await multisigPropose(from, to.trim(), amt);
      setPending(p);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (wallets.length === 0) {
    return <p className="wl-note">Create a shared wallet first, then you can propose spends from it.</p>;
  }

  return (
    <div className="ms-form">
      <label className="ms-field">
        <span className="ms-field-label">From wallet</span>
        <select className="ms-input" value={from} onChange={(e) => setFrom(e.target.value)}>
          {wallets.map((w) => (
            <option key={w.address} value={w.address}>
              {w.label} — {short(w.address)} ({w.m} of {w.n})
            </option>
          ))}
        </select>
      </label>
      <label className="ms-field">
        <span className="ms-field-label">Send to</span>
        <input
          className="ms-input"
          placeholder="Recipient Divi address"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      <label className="ms-field ms-field-inline">
        <span className="ms-field-label">Amount</span>
        <input
          className="ms-input ms-num"
          type="number"
          min={0}
          step="0.0001"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="ms-hint">DIVI</span>
      </label>
      {err && <div className="ms-err">{err}</div>}
      <button type="button" className="wl-btn wl-btn-primary" disabled={busy} onClick={propose}>
        {busy ? "Building…" : "Create spend to sign"}
      </button>
      {pending && (
        <div className="ms-pending">
          <p className="wl-note">
            Built a spend of <strong>{fmt(pending.amount)} DIVI</strong> to{" "}
            <span className="ms-mono">{short(pending.to)}</span> (fee {fmt(pending.fee)}). It needs{" "}
            <strong>{pending.required}</strong> signatures. Sign it below, then send this blob to the
            other signers.
          </p>
          <CopyBox label="Pending spend — share with co-signers" value={pending.blob} />
        </div>
      )}
    </div>
  );
}

// ── Sign / broadcast a pending spend ─────────────────────────────────────────
function SignForm() {
  const [blob, setBlob] = useState("");
  const [pass, setPass] = useState("");
  const [encrypted, setEncrypted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<SignResult | null>(null);
  const [txid, setTxid] = useState<string | null>(null);

  useEffect(() => {
    walletStatus()
      .then((s) => setEncrypted(s.encrypted && !s.unlocked))
      .catch(() => {});
  }, []);

  const sign = async () => {
    setErr(null);
    setTxid(null);
    if (!blob.trim()) return setErr("Paste a pending spend first.");
    setBusy(true);
    try {
      const r = await multisigSign(blob.trim(), encrypted ? pass : undefined);
      setRes(r);
      setBlob(r.blob); // keep the newly-signed version for the next signer / broadcast
      setPass("");
      if (!r.added && !r.complete) {
        setErr("Your wallet holds none of this wallet's keys, so it added no signature.");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const broadcast = async () => {
    setErr(null);
    setBusy(true);
    try {
      const id = await multisigBroadcast(blob.trim());
      setTxid(id);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ms-form">
      <label className="ms-field">
        <span className="ms-field-label">Pending spend</span>
        <textarea
          className="ms-input ms-textarea ms-mono"
          rows={3}
          spellCheck={false}
          placeholder="Paste a DVMS1-… pending spend here"
          value={blob}
          onChange={(e) => {
            setBlob(e.target.value);
            setRes(null);
            setTxid(null);
          }}
        />
      </label>
      {encrypted && (
        <label className="ms-field">
          <span className="ms-field-label">Wallet password (to add your signature)</span>
          <input
            className="ms-input"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
      )}
      {res && (
        <div className="ms-tally">
          <div className="ms-tally-bar">
            <div
              className="ms-tally-fill"
              style={{ width: `${Math.min(100, (res.signed / Math.max(res.required, 1)) * 100)}%` }}
            />
          </div>
          <span className="ms-tally-text">
            {res.signed} of {res.required} signatures
            {res.complete ? " — ready to send" : ""}
          </span>
        </div>
      )}
      {err && <div className="ms-err">{err}</div>}
      {txid ? (
        <div className="ms-created">
          <div className="ms-created-title">
            <Icon name="check" size={16} /> Broadcast
          </div>
          <button type="button" className="wl-link" onClick={() => openUrl(explorerTxUrl(txid))}>
            View in Divi Love Scan
          </button>
        </div>
      ) : (
        <div className="ms-btn-row">
          <button type="button" className="wl-btn" disabled={busy} onClick={sign}>
            {busy ? "Working…" : "Add my signature"}
          </button>
          <button
            type="button"
            className="wl-btn wl-btn-primary"
            disabled={busy || !(res?.complete ?? false)}
            onClick={broadcast}
          >
            Send
          </button>
        </div>
      )}
      {res && !res.complete && (
        <div className="ms-pending">
          <CopyBox label="Updated spend — pass to the next signer" value={blob} />
        </div>
      )}
    </div>
  );
}

// ── Panel shell ──────────────────────────────────────────────────────────────
export function MultisigPanel() {
  const [wallets, setWallets] = useState<MultisigWallet[]>([]);

  const refresh = useCallback(() => {
    multisigList()
      .then(setWallets)
      .catch(() => setWallets([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const forget = async (address: string) => {
    try {
      await multisigForget(address);
      refresh();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="ms">
      <TreasuryStrip />

      <p className="wl-note ms-intro">
        Shared wallets that need several people to approve a spend, using Divi's own on-chain
        multisig. Create one, fund its address, then any spend must be signed by the required number
        of co-signers before it can be sent.
      </p>

      <section className="ms-section">
        <h3 className="ms-head">Your shared wallets</h3>
        <WalletList wallets={wallets} onForget={forget} />
      </section>

      <section className="ms-section">
        <h3 className="ms-head">Create a shared wallet</h3>
        <CreateForm onCreated={refresh} />
      </section>

      <section className="ms-section">
        <h3 className="ms-head">Propose a spend</h3>
        <ProposeForm wallets={wallets} />
      </section>

      <section className="ms-section">
        <h3 className="ms-head">Sign or send a pending spend</h3>
        <SignForm />
      </section>
    </div>
  );
}
