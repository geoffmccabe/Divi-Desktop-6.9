import { useState, type ChangeEvent } from "react";
import { poeTimestamp, poeVerify, type Proof } from "./api";

// Proof-of-Existence UI. The file NEVER leaves the machine: we read it in the
// browser, hash it with Web Crypto (SHA-256), and send only the 32-byte hash to
// the backend. The chain stores the hash; the block's timestamp proves the file
// existed by then. Nobody can read the file from the chain, only confirm a hash.

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function whenProven(t: number | null): string {
  if (!t) return "unconfirmed (waiting for a block)";
  return new Date(t * 1000).toLocaleString();
}

export function TimestampPanel() {
  // Create
  const [name, setName] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Verify
  const [vName, setVName] = useState<string | null>(null);
  const [vHash, setVHash] = useState<string | null>(null);
  const [vTxid, setVTxid] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [vBusy, setVBusy] = useState(false);
  const [vErr, setVErr] = useState<string | null>(null);

  async function pickCreate(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setTxid(null);
    setName(f.name);
    setHash(await sha256Hex(f));
  }

  async function anchor() {
    if (!hash) return;
    setBusy(true);
    setErr(null);
    try {
      setTxid(await poeTimestamp(hash));
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  async function copyTxid() {
    if (!txid) return;
    try {
      await navigator.clipboard.writeText(txid);
    } catch {
      /* clipboard may be unavailable; the id is still shown */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function pickVerify(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setVErr(null);
    setProof(null);
    setVName(f.name);
    setVHash(await sha256Hex(f));
  }

  async function check() {
    if (!vHash || !vTxid.trim()) return;
    setVBusy(true);
    setVErr(null);
    setProof(null);
    try {
      setProof(await poeVerify(vTxid.trim(), vHash));
    } catch (e) {
      setVErr(String(e));
    }
    setVBusy(false);
  }

  return (
    <div className="timestamp">
      <section className="ts-section">
        <h3 className="ts-head">Create a timestamp</h3>
        <p className="wl-note">
          Prove a file existed today without revealing it. The file stays on your computer — only its
          fingerprint (a SHA-256 hash) goes on the Divi blockchain, and the block’s time is the proof.
        </p>

        <label className="wl-btn ts-file">
          {name ? "Choose a different file" : "Choose a file"}
          <input type="file" onChange={pickCreate} hidden />
        </label>

        {name && hash && (
          <div className="ts-fileinfo">
            <div className="ts-filename">{name}</div>
            <code className="ts-hash">{hash}</code>
          </div>
        )}

        {hash && !txid && (
          <button className="wl-btn wl-btn-primary" disabled={busy} onClick={anchor}>
            {busy ? "Anchoring…" : "Timestamp this file on the blockchain"}
          </button>
        )}
        {err && <p className="wl-err">{err}</p>}

        {txid && (
          <div className="ts-result">
            <p className="wl-note">
              Done. Keep this transaction id — it’s the receipt you’ll use to prove the file later.
            </p>
            <div className="addr-box">
              <code>{txid}</code>
              <button className="wl-btn" onClick={copyTxid}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="ts-section">
        <h3 className="ts-head">Verify a timestamp</h3>
        <p className="wl-note">
          Have a file and a transaction id? Confirm the file matches what was anchored, and see when.
        </p>

        <label className="wl-btn ts-file">
          {vName ? "Choose a different file" : "Choose the file"}
          <input type="file" onChange={pickVerify} hidden />
        </label>
        {vName && <div className="ts-filename">{vName}</div>}

        <input
          className="wl-input"
          placeholder="Transaction id"
          value={vTxid}
          onChange={(e) => setVTxid(e.target.value)}
        />

        <button className="wl-btn wl-btn-primary" disabled={vBusy || !vHash || !vTxid.trim()} onClick={check}>
          {vBusy ? "Checking…" : "Check proof"}
        </button>
        {vErr && <p className="wl-err">{vErr}</p>}

        {proof && (
          <div className={proof.matched ? "ts-proof ts-proof-ok" : "ts-proof ts-proof-bad"}>
            {proof.matched ? (
              <>
                <div className="ts-proof-title">✓ Match</div>
                <div>This file existed by {whenProven(proof.block_time)}.</div>
                <div className="wl-note">{proof.confirmations} confirmations.</div>
              </>
            ) : (
              <>
                <div className="ts-proof-title">✗ No match</div>
                <div>That transaction doesn’t anchor this file’s fingerprint.</div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
