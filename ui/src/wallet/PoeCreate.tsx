import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { poeTimestamp, poeVerify } from "./api";
import { fetchPrices } from "./value";
import { addPoeRecord, makeThumb, markPoeConfirmed, poeProjects, PUBLIC_THUMB_MAX } from "./poeHistory";
import { getPoePayout, splitForAnchor } from "./poePayout";

// Create tab: pick a file, see it, anchor its fingerprint on the chain.
// The file never leaves the machine: only the SHA-256 goes out.

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
  // Full-size view of the chosen image, opened by double-clicking the preview.
  const [zoom, setZoom] = useState(false);
  // How the user files this proof. The chain can't remember any of it, so this
  // labelling is the only thing that makes a long list navigable later.
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  // Opt-in shareable preview. It travels in the JSON export, so an artist can
  // publish a browsable set of proofs, and a replacement laptop can show what
  // each proof was of. Off by default: a PoE file is normally private.
  const [sharePreview, setSharePreview] = useState(false);
  const knownProjects = poeProjects();

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

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  // Poll until the anchor lands in a block. Only then is it a proof, never
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

  // Cost and its split come from the admin Payouts settings.
  const payout = getPoePayout();
  const split = splitForAnchor(payout, usdPerDivi, MIN_FEE_DIVI);

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
      const id = await poeTimestamp(
        hash,
        split?.feeDivi ?? null,
        payout.address,
        split?.payoutDivi ?? null,
      );
      setTxid(id);
      // Record it locally so the History tab can show what this proof was FOR;
      // the chain only ever knows the fingerprint.
      const stored = addPoeRecord({
        txid: id,
        hash,
        name: file.name,
        size: file.size,
        mime: file.type,
        width: dims?.w,
        height: dims?.h,
        thumb: await makeThumb(file),
        publicThumb: sharePreview ? await makeThumb(file, PUBLIC_THUMB_MAX) : undefined,
        project: project.trim() || undefined,
        title: title.trim() || undefined,
        createdAt: Date.now(),
      });
      // The proof itself is safe on the chain either way, but if we couldn't
      // write the local record the user loses the ONLY copy of the txid, so say
      // so loudly rather than let it vanish.
      if (!stored) {
        setErr(
          "The proof was broadcast, but this computer's storage is full so it could not be saved to your history. " +
            "Copy the transaction id below and keep it somewhere safe.",
        );
      }
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
            {/* Filing details. The chain remembers none of this, so it is the
                only thing that will make a long list of proofs navigable. */}
            <div style={{ display: "grid", gap: 8, margin: "10px 0" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={{ flex: "1 1 150px", minWidth: 140 }}>
                  <div className="wl-note" style={{ marginBottom: 2 }}>Project (a group)</div>
                  <input
                    className="wl-input"
                    style={{ width: "100%" }}
                    list="poe-projects"
                    placeholder="Legal docs, Digital art…"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                  />
                  <datalist id="poe-projects">
                    {knownProjects.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </label>
                <label style={{ flex: "1 1 150px", minWidth: 140 }}>
                  <div className="wl-note" style={{ marginBottom: 2 }}>Title</div>
                  <input
                    className="wl-input"
                    style={{ width: "100%" }}
                    placeholder={name ?? "What is this?"}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              </div>
              {file?.type.startsWith("image/") && (
                <label style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: "0.75rem" }}>
                  <input
                    type="checkbox"
                    checked={sharePreview}
                    onChange={(e) => setSharePreview(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    Include a shareable preview ({PUBLIC_THUMB_MAX}px)
                    <span className="wl-note">
                      {" "}
                      Saved inside your JSON export so others can browse your proofs, and so a replacement computer can
                      show what each proof was of. The full file is never shared, only this small preview.
                    </span>
                  </span>
                </label>
              )}
            </div>
            <button className="wl-btn wl-btn-primary ts-anchor" disabled={busy} onClick={anchor}>
              {busy ? (
                "Anchoring…"
              ) : (
                <>
                  <span>Timestamp this file</span>
                  <span className="ts-cost">
                    {split
                      ? `${split.totalDivi.toLocaleString(undefined, { maximumFractionDigits: 0 })} DIVI` +
                        (payout.address.trim() ? ` ≈ $${payout.targetUsd.toFixed(2)}` : "")
                      : "cost unavailable"}
                  </span>
                </>
              )}
            </button>
            <p className="wl-note ts-costnote">
              {/* Never imply a price we haven't actually priced. */}
              {!split
                ? "The DIVI price is unavailable, so the cost can't be quoted right now."
                : payout.address.trim()
                  ? `Quoted at the current DIVI price. ${payout.payoutPercent}% supports Divi; the rest goes to the staker who mines the block.`
                  : "No payout address is configured, so this costs only the network minimum."}
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
                <span className="ts-spin" /> Submitted, confirming on the blockchain… (about a
                minute)
              </p>
            )}
            <p className="wl-note">
              Keep this transaction id. It’s the receipt you’ll use to prove the file later. It’s
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
            <img
              className="ts-preview-img ts-preview-zoomable"
              src={preview}
              alt={name ?? "Selected file"}
              onDoubleClick={() => setZoom(true)}
              title="Double-click to view full size"
            />
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

      {/* Portalled to <body>: the app's main area is a .glass-panel, and
          backdrop-filter makes it the containing block for position:fixed
          children, which would otherwise strand this overlay off-screen. */}
      {zoom &&
        preview &&
        createPortal(
          <div className="poe-zoom" onClick={() => setZoom(false)} role="presentation">
            <img src={preview} alt={name ?? "Selected file"} onClick={(e) => e.stopPropagation()} />
            <div className="poe-zoom-bar">
              <span>{name}</span>
              {dims && (
                <span className="muted">
                  {dims.w} × {dims.h} px
                </span>
              )}
              <button className="wl-btn" onClick={() => setZoom(false)}>
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
