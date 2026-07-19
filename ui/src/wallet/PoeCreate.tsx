import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { poeTimestamp, poeVerify } from "./api";
import { fetchPrices } from "./value";
import { addPoeRecord, makeThumb, markPoeConfirmed } from "./poeHistory";

// Create tab: pick a file, see it, anchor its fingerprint on the chain.
// The file never leaves the machine — only the SHA-256 goes out.

/** What an anchor should cost the user, in USD. */
const TARGET_USD = 1;
/** Floor, so a bad price feed can never produce a fee the node would reject. */
const MIN_FEE_DIVI = 0.0001;

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const whenProven = (t: number | null) =>
  t ? new Date(t * 1000).toLocaleString() : "unconfirmed (waiting for a block)";

export function PoeCreate({ onFileState }: { onFileState: (hasFile: boolean) => void }) {
  const [name, setName] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null);

  // Price per DIVI in USD, used to quote the anchor cost.
  const [usdPerDivi, setUsdPerDivi] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPrices()
      .then((p) => alive && setUsdPerDivi(p.prices?.usd ?? null))
      .catch(() => {
        /* quote falls back to "cost unavailable" */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  // Poll until the anchor lands in a block. Only then is it a proof — never
  // claim "timestamped" before there is a real block time behind it.
  useEffect(() => {
    if (!txid || !hash || confirmedAt) return;
    let stop = false;
    const tick = async () => {
      try {
        const p = await poeVerify(txid, hash);
        if (!stop && p.matched && p.block_time) {
          setConfirmedAt(p.block_time);
          markPoeConfirmed(txid, p.block_time);
        }
      } catch {
        /* a transient node hiccup shouldn't end the poll */
      }
    };
    tick();
    pollRef.current = window.setInterval(tick, 5000);
    return () => {
      stop = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [txid, hash, confirmedAt]);

  const feeDivi = usdPerDivi && usdPerDivi > 0 ? Math.max(MIN_FEE_DIVI, TARGET_USD / usdPerDivi) : null;

  async function pickCreate(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setTxid(null);
    setConfirmedAt(null);
    setName(f.name);
    setFile(f);
    setDims(null);
    onFileState(true);

    if (preview) URL.revokeObjectURL(preview);
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
      const img = new Image();
      img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = url;
    } else {
      setPreview(null);
    }
    setHash(await sha256Hex(f));
  }

  async function anchor() {
    if (!hash || !file) return;
    setBusy(true);
    setErr(null);
    setConfirmedAt(null);
    try {
      const id = await poeTimestamp(hash, feeDivi);
      setTxid(id);
      // Record it locally so the History tab can show what this proof was FOR;
      // the chain only ever knows the fingerprint.
      addPoeRecord({
        txid: id,
        hash,
        name: file.name,
        size: file.size,
        mime: file.type,
        width: dims?.w,
        height: dims?.h,
        thumb: await makeThumb(file),
        createdAt: Date.now(),
      });
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

  return (
    <div className={"ts-layout" + (file ? " ts-layout-split" : "")}>
      <div className="ts-col-main">
        <label className="wl-btn ts-file">
          {name ? "Choose a different file" : "Choose a file"}
          <input type="file" onChange={pickCreate} hidden />
        </label>

        {name && hash && (
          <div className="ts-fileinfo">
            <div className="ts-hash-label">SHA-256 fingerprint</div>
            <code className="ts-hash">{hash}</code>
          </div>
        )}

        {hash && !txid && (
          <>
            <button className="wl-btn wl-btn-primary ts-anchor" disabled={busy} onClick={anchor}>
              {busy ? (
                "Anchoring…"
              ) : (
                <>
                  <span>Timestamp this file</span>
                  <span className="ts-cost">
                    {feeDivi
                      ? `${feeDivi.toLocaleString(undefined, { maximumFractionDigits: 0 })} DIVI ≈ $${TARGET_USD.toFixed(2)}`
                      : "cost unavailable"}
                  </span>
                </>
              )}
            </button>
            <p className="wl-note ts-costnote">
              {/* Never imply a price we haven't actually priced. */}
              {feeDivi
                ? "Paid as the transaction fee. The quote uses the current DIVI price."
                : "The DIVI price is unavailable, so the cost can't be quoted right now."}
            </p>
          </>
        )}
        {err && <p className="wl-err">{err}</p>}

        {txid && (
          <div className="ts-result">
            {confirmedAt ? (
              <p className="ts-confirmed">✓ Timestamped on {whenProven(confirmedAt)}.</p>
            ) : (
              <p className="ts-pending">
                <span className="ts-spin" /> Submitted — confirming on the blockchain… (about a
                minute)
              </p>
            )}
            <p className="wl-note">
              Keep this transaction id — it’s the receipt you’ll use to prove the file later. It’s
              saved in <strong>My Timestamps</strong> too.
            </p>
            <div className="addr-box">
              <code>{txid}</code>
              <button className="wl-btn" onClick={copyTxid}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>

      {file && (
        <aside className="ts-col-preview">
          {preview ? (
            <img className="ts-preview-img" src={preview} alt={name ?? "Selected file"} />
          ) : (
            <div className="ts-preview-none">
              <span>{(name?.split(".").pop() ?? "file").toUpperCase()}</span>
            </div>
          )}
          <dl className="ts-meta">
            <dt>File</dt>
            <dd title={name ?? ""}>{name}</dd>
            <dt>Size</dt>
            <dd>{fmtBytes(file.size)}</dd>
            <dt>Type</dt>
            <dd>{file.type || "unknown"}</dd>
            {dims && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {dims.w} × {dims.h} px
                </dd>
              </>
            )}
          </dl>
        </aside>
      )}
    </div>
  );
}
