// MultiSig: create and operate native N-of-M shared wallets on Divi's own P2SH
// multisig. A spend is proposed here, passed to the co-signers as a text blob,
// signed by each in turn, and broadcast once it has enough signatures.
//
// Security posture:
//  - A signer always sees the REAL decoded transaction (recipient + amount +
//    fee + change), read from the transaction itself, before approving — never
//    the blob's self-reported labels.
//  - A shared wallet travels as one definition blob so every co-signer builds
//    the identical address (Divi does not sort keys — order matters) and can
//    sign a pasted spend without having set the wallet up beforehand.
//  - Broadcasting takes an explicit confirmation.
// No PSBT in this build, so the blobs are passed by hand (copy/paste).

import "./multisig.css";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../Icon";
import { TreasuryStrip } from "./TreasuryStrip";
import {
  multisigList,
  multisigCreate,
  multisigImport,
  multisigForget,
  multisigPropose,
  multisigSign,
  multisigBroadcast,
  multisigInspect,
  multisigMyPubkey,
  walletStatus,
  explorerTxUrl,
  openUrl,
  type MultisigWallet,
  type PendingSpend,
  type SignResult,
  type SpendPreview,
  type MyKey,
} from "../api";

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}
function short(addr: string): string {
  return addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr;
}

function CopyBox({ label, value, rows = 3 }: { label: string; value: string; rows?: number }) {
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
      <textarea className="ms-blob" readOnly value={value} rows={rows} spellCheck={false} />
    </div>
  );
}

// A verified read-out of what a spend actually does, decoded from the tx.
function SpendReview({ preview }: { preview: SpendPreview }) {
  const recipients = preview.outputs.filter((o) => !o.isChange);
  const change = preview.outputs.find((o) => o.isChange);
  return (
    <div className="ms-review">
      <div className="ms-review-head">
        <Icon name="eye" size={15} /> What this spend does
      </div>
      <div className="ms-review-row">
        <span className="ms-review-k">From shared wallet</span>
        <span className="ms-mono">{short(preview.from)}</span>
      </div>
      {recipients.map((o, i) => (
        <div className="ms-review-row ms-review-pay" key={i}>
          <span className="ms-review-k">Pays</span>
          <span>
            <strong>{fmt(o.amount)} DIVI</strong> to <span className="ms-mono">{short(o.address)}</span>
          </span>
        </div>
      ))}
      {recipients.length === 0 && (
        <div className="ms-review-row ms-warn">No outward payment in this transaction.</div>
      )}
      {change && (
        <div className="ms-review-row">
          <span className="ms-review-k">Change back to wallet</span>
          <span>{fmt(change.amount)} DIVI</span>
        </div>
      )}
      <div className="ms-review-row">
        <span className="ms-review-k">Network fee</span>
        <span>{fmt(preview.fee)} DIVI</span>
      </div>
      <div className="ms-review-row">
        <span className="ms-review-k">Signatures</span>
        <span>
          {preview.signed} of {preview.required}
          {preview.complete ? " — ready to send" : ""}
        </span>
      </div>
    </div>
  );
}

// ── Your public key (utility) ────────────────────────────────────────────────
function MyPubkey() {
  const [myKey, setMyKey] = useState<MyKey | null>(null);
  const [busy, setBusy] = useState(false);
  const get = async () => {
    setBusy(true);
    try {
      setMyKey(await multisigMyPubkey());
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ms-form">
      <p className="wl-note">
        When someone else is building a shared wallet, send them your public key so they can include you.
      </p>
      <button type="button" className="ms-mini-btn ms-self-start" disabled={busy} onClick={get}>
        {busy ? "…" : "Get my public key"}
      </button>
      {myKey && <CopyBox label="My public key — send to the wallet's creator" value={myKey.pubkey} rows={2} />}
    </div>
  );
}

// ── Your wallets ─────────────────────────────────────────────────────────────
function WalletRow({ w, onForget }: { w: MultisigWallet; onForget: (a: string) => void }) {
  const [showBackup, setShowBackup] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="ms-wallet">
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
        <button type="button" className="ms-mini-btn" onClick={() => navigator.clipboard?.writeText(w.address)}>
          Copy address
        </button>
        <button type="button" className="ms-mini-btn" onClick={() => setShowBackup((v) => !v)}>
          {showBackup ? "Hide backup" : "Back up / share"}
        </button>
        <button type="button" className="ms-mini-btn ms-danger" onClick={() => setConfirming(true)}>
          Forget
        </button>
      </div>
      {showBackup && (
        <div className="ms-pending">
          <span className="ms-hint">
            This is the wallet's definition. Save it to recover this wallet later, and give it to every
            co-signer so they add the exact same wallet.
          </span>
          <CopyBox label="Shared-wallet definition" value={w.definition} rows={2} />
        </div>
      )}
      {confirming && (
        <div className="ms-confirm">
          <span>
            Remove <strong>{w.label}</strong> from this app? It stays safe on-chain and can be re-added from
            its definition — but back that up first if you haven't.
          </span>
          <div className="ms-btn-row">
            <button type="button" className="ms-mini-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="ms-mini-btn ms-danger"
              onClick={() => {
                setConfirming(false);
                onForget(w.address);
              }}
            >
              Forget it
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function WalletList({ wallets, onForget }: { wallets: MultisigWallet[]; onForget: (a: string) => void }) {
  if (wallets.length === 0) {
    return <p className="wl-note">No shared wallets yet. Create one, or add one from its definition below.</p>;
  }
  return (
    <ul className="ms-wallet-list">
      {wallets.map((w) => (
        <WalletRow key={w.address} w={w} onForget={onForget} />
      ))}
    </ul>
  );
}

// ── Create a shared wallet ───────────────────────────────────────────────────
function CreateForm({ onChanged }: { onChanged: () => void }) {
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
    if (keys.length < 1) return setErr("Add at least one co-signer public key.");
    if (required < 1 || required > keys.length)
      return setErr(`Signatures required must be between 1 and ${keys.length}.`);
    setBusy(true);
    try {
      const w = await multisigCreate(required, keys, label);
      setMade(w);
      setKeysText("");
      setLabel("");
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
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
            Fund it at that address. Then give the definition below to every co-signer so they add the exact
            same wallet — and keep a copy as your backup.
          </p>
          <CopyBox label="Shared-wallet definition — share with co-signers + back up" value={made.definition} rows={2} />
        </div>
      )}
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
          {keys.length} co-signer(s). Ask each person for their public key (the "Your public key" tool
          above); one of your own addresses also works.
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
      <button type="button" className="wl-btn wl-btn-primary ms-self-start" disabled={busy} onClick={create}>
        {busy ? "Creating…" : "Create shared wallet"}
      </button>
    </div>
  );
}

// ── Add an existing shared wallet (join) ─────────────────────────────────────
function ImportForm({ onChanged }: { onChanged: () => void }) {
  const [def, setDef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const add = async () => {
    setErr(null);
    setOk(null);
    if (!def.trim()) return setErr("Paste a shared-wallet definition.");
    setBusy(true);
    try {
      const w = await multisigImport(def.trim());
      setOk(`Added "${w.label}" (${w.address}).`);
      setDef("");
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ms-form">
      <label className="ms-field">
        <span className="ms-field-label">Shared-wallet definition</span>
        <textarea
          className="ms-input ms-textarea ms-mono"
          rows={2}
          spellCheck={false}
          placeholder="Paste a DVMW1-… definition someone shared with you"
          value={def}
          onChange={(e) => setDef(e.target.value)}
        />
      </label>
      {err && <div className="ms-err">{err}</div>}
      {ok && <div className="ms-ok">{ok}</div>}
      <button type="button" className="wl-btn ms-self-start" disabled={busy} onClick={add}>
        {busy ? "Adding…" : "Add shared wallet"}
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

  const selected = wallets.find((w) => w.address === from);

  const propose = async () => {
    setErr(null);
    setPending(null);
    const amt = Number(amount);
    if (!from) return setErr("Choose a wallet to spend from.");
    if (!to.trim()) return setErr("Enter a recipient address.");
    if (!(amt > 0)) return setErr("Enter an amount greater than zero.");
    setBusy(true);
    try {
      setPending(await multisigPropose(from, to.trim(), amt));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (wallets.length === 0) {
    return <p className="wl-note">Create or add a shared wallet first, then you can propose spends from it.</p>;
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
        {selected && (
          <span className="ms-hint">
            Available: {selected.balanceAvailable ? `${fmt(selected.balance)} DIVI` : "building…"}
          </span>
        )}
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
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="ms-hint">DIVI</span>
      </label>
      {err && <div className="ms-err">{err}</div>}
      <button type="button" className="wl-btn wl-btn-primary ms-self-start" disabled={busy} onClick={propose}>
        {busy ? "Building…" : "Create spend to sign"}
      </button>
      {pending && (
        <div className="ms-pending">
          <p className="wl-note">
            Built a spend that needs <strong>{pending.required}</strong> signatures. Sign it in the next
            section, then send this to the other signers.
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
  const [preview, setPreview] = useState<SpendPreview | null>(null);
  const [res, setRes] = useState<SignResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);

  useEffect(() => {
    walletStatus()
      .then((s) => setEncrypted(s.encrypted && !s.unlocked))
      .catch(() => {});
  }, []);

  // Decode the REAL transaction whenever a plausible blob is present, so the
  // signer sees what they're approving before doing anything.
  useEffect(() => {
    const b = blob.trim();
    if (!b.startsWith("DVMS1-")) {
      setPreview(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      multisigInspect(b)
        .then((p) => live && setPreview(p))
        .catch(() => live && setPreview(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [blob]);

  const sign = async () => {
    setErr(null);
    setTxid(null);
    if (!blob.trim()) return setErr("Paste a pending spend first.");
    setBusy(true);
    try {
      const r = await multisigSign(blob.trim(), encrypted ? pass : undefined);
      setRes(r);
      setBlob(r.blob); // keep the newly-signed version (also re-triggers the preview)
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
    setConfirming(false);
    setBusy(true);
    try {
      setTxid(await multisigBroadcast(blob.trim()));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const complete = preview?.complete ?? res?.complete ?? false;
  const recipients = preview?.outputs.filter((o) => !o.isChange) ?? [];

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
            setConfirming(false);
          }}
        />
      </label>

      {preview && <SpendReview preview={preview} />}

      {encrypted && (
        <label className="ms-field">
          <span className="ms-field-label">Wallet password (to add your signature)</span>
          <input className="ms-input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
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
      ) : confirming ? (
        <div className="ms-confirm">
          <span>
            Send{" "}
            {recipients.map((o, i) => (
              <strong key={i}>
                {fmt(o.amount)} DIVI to {short(o.address)}
                {i < recipients.length - 1 ? ", " : ""}
              </strong>
            ))}
            {preview ? ` (fee ${fmt(preview.fee)})` : ""}? This cannot be undone.
          </span>
          <div className="ms-btn-row">
            <button type="button" className="ms-mini-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="wl-btn wl-btn-primary" disabled={busy} onClick={broadcast}>
              {busy ? "Sending…" : "Confirm send"}
            </button>
          </div>
        </div>
      ) : (
        <div className="ms-btn-row">
          <button type="button" className="wl-btn" disabled={busy || !preview} onClick={sign}>
            {busy ? "Working…" : "Add my signature"}
          </button>
          <button
            type="button"
            className="wl-btn wl-btn-primary"
            disabled={busy || !complete}
            onClick={() => setConfirming(true)}
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
        Shared wallets that need several people to approve a spend, using Divi's own on-chain multisig.
        Create or join one, fund its address, then any spend must be signed by the required number of
        co-signers before it can be sent.
      </p>

      <section className="ms-section">
        <h3 className="ms-head">Your shared wallets</h3>
        <WalletList wallets={wallets} onForget={forget} />
      </section>

      <section className="ms-section">
        <h3 className="ms-head">Your public key</h3>
        <MyPubkey />
      </section>

      <section className="ms-section">
        <h3 className="ms-head">Create a shared wallet</h3>
        <CreateForm onChanged={refresh} />
      </section>

      <section className="ms-section">
        <h3 className="ms-head">Add an existing shared wallet</h3>
        <ImportForm onChanged={refresh} />
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
