import { useEffect, useState, type ChangeEvent } from "react";
import { poeVerify, type Proof } from "./api";
import type { PoeRecord } from "./poeHistory";

// Verify tab: does this file match what was anchored by this transaction?
// Arrives either blank, or pre-filled from the History tab.

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const whenProven = (t: number | null) =>
  t ? new Date(t * 1000).toLocaleString() : "unconfirmed (waiting for a block)";

export function PoeVerify({ prefill }: { prefill: PoeRecord | null }) {
  const [vName, setVName] = useState<string | null>(null);
  const [vHash, setVHash] = useState<string | null>(null);
  const [vTxid, setVTxid] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Coming from History: fill the id and clear any previous attempt, so all the
  // user has to do is point at the original file.
  useEffect(() => {
    if (!prefill) return;
    setVTxid(prefill.txid);
    setProof(null);
    setErr(null);
    setVName(null);
    setVHash(null);
  }, [prefill]);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setProof(null);
    setVName(f.name);
    setVHash(await sha256Hex(f));
  }

  async function check() {
    if (!vHash || !vTxid.trim()) return;
    setBusy(true);
    setErr(null);
    setProof(null);
    try {
      setProof(await poeVerify(vTxid.trim(), vHash));
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  // When we know what was originally anchored we can say something far more
  // useful than "no match": specifically that the file differs.
  const expectedName = prefill && prefill.txid === vTxid.trim() ? prefill.name : null;

  return (
    <>
      <p className="wl-note">
        Use your <strong>File</strong> and <strong>Transaction ID</strong> to confirm they match by
        submitting both here.
      </p>

      {prefill && (
        <div className="poe-prefill">
          <div className="poe-prefill-head">Checking your proof of</div>
          <div className="poe-prefill-name">{prefill.name}</div>
          <div className="wl-note">
            Choose the original file below. If it has changed at all since you timestamped it, it
            won’t match.
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="poe-step">1.</span>
        <label className="wl-btn wl-btn-primary ts-file" style={{ margin: 0 }}>
          {vName ? "Choose a different file" : "Upload File"}
          <input type="file" onChange={pick} hidden />
        </label>
      </div>
      {vName && <div className="ts-filename" style={{ marginLeft: 26 }}>{vName}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="poe-step">2.</span>
        <input
          className="wl-input poe-txid"
          style={{ flex: 1 }}
          placeholder="Paste or Type Transaction ID here"
          value={vTxid}
          onChange={(e) => setVTxid(e.target.value)}
        />
      </div>

      <button
        className="wl-btn wl-btn-primary"
        disabled={busy || !vHash || !vTxid.trim()}
        onClick={check}
      >
        {busy ? "Checking…" : "Check proof"}
      </button>
      {err && <p className="wl-err">{err}</p>}

      {proof && (
        // A match that isn't in a block yet proves NOTHING. The transaction can
        // still be dropped or replaced, so it must not wear the success colour.
        // Only a confirmed anchor is a proof.
        <div
          className={
            proof.matched && proof.confirmations > 0
              ? "ts-proof ts-proof-ok"
              : proof.matched
                ? "ts-proof"
                : "ts-proof ts-proof-bad"
          }
        >
          {proof.matched && proof.confirmations < 1 ? (
            <>
              <div className="ts-proof-title">Waiting for a block</div>
              <div>
                This transaction carries the file's fingerprint, but it isn't in a block yet, so it doesn't prove
                anything so far. Check again in a minute.
              </div>
            </>
          ) : proof.matched ? (
            <>
              <div className="ts-proof-title">✓ Match</div>
              <div>This file existed by {whenProven(proof.block_time)}.</div>
              <div className="wl-note">{proof.confirmations} confirmations.</div>
            </>
          ) : (
            <>
              <div className="ts-proof-title">✗ No match</div>
              <div>
                That transaction doesn’t anchor this file’s fingerprint.
                {expectedName && vName && vName !== expectedName && (
                  <> You timestamped <strong>{expectedName}</strong>, this is a different file.</>
                )}
                {expectedName && vName === expectedName && (
                  <> The name matches, so the contents must have changed since you timestamped it.</>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
