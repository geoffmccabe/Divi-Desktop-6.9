import { useEffect, useState, type ChangeEvent } from "react";
import { nfdMint, nfdView, nfdReceiveCode, nfdTransfer, nfdClaim, newReceiveAddress } from "./api";

// Divi Collectibles (NFDs). Mint, view, transfer, and receive collectibles. The
// file is encrypted locally before it leaves the machine; only the encrypted
// bundle is stored, and ownership is anchored on the Divi chain. The creator may
// publish an UNENCRYPTED ≤500px preview (WebP). Transfers use a receive-code /
// claim-code handoff until the chain indexer can enumerate + look up on-chain.

interface Item {
  txid: string; // the mint txid — the NFD's stable id
  ownerAddr: string;
  name: string;
  mime: string;
  ts: number;
  thumb?: string; // data-URL of the public preview, for instant card display
  arweavePtr?: string; // minted-by-me items (for view)
  contentHash?: string; // minted-by-me items
  thumbPtr?: string | null;
  wrapkeyPtr?: string; // present on a CLAIMED item — unlock via claim, not view
}

const STORE_KEY = "nfd.collectibles.v1";
const RECV_ADDR_KEY = "nfd.receiveAddr.v1";
const THUMB_MAX_PX = 500;

function loadItems(): Item[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]") as Item[];
  } catch {
    return [];
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(new Error("could not read that file"));
    r.readAsDataURL(file);
  });
}

// Downscale an image to a ≤500px WebP preview (WebP only). null if not possible.
async function makeThumbnail(file: File): Promise<{ b64: string; mime: string; dataUrl: string } | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, THUMB_MAX_PX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const dataUrl = canvas.toDataURL("image/webp", 0.82);
    if (!dataUrl.startsWith("data:image/webp")) return null;
    const comma = dataUrl.indexOf(",");
    return { mime: "image/webp", b64: dataUrl.slice(comma + 1), dataUrl };
  } catch {
    return null;
  }
}

// A claim code carries everything the recipient needs to unlock a transfer.
interface ClaimCode {
  mintTxid: string;
  wrapkeyPtr: string;
  name: string;
  mime: string;
}

export function CollectiblesPanel() {
  const [items, setItems] = useState<Item[]>(loadItems);
  const [withThumb, setWithThumb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [viewing, setViewing] = useState<string | null>(null);
  const [viewSrc, setViewSrc] = useState<string | null>(null);
  const [viewErr, setViewErr] = useState<string | null>(null);

  // transfer (inside the viewer)
  const [xferCode, setXferCode] = useState("");
  const [xferBusy, setXferBusy] = useState(false);
  const [xferErr, setXferErr] = useState<string | null>(null);
  const [claimCodeOut, setClaimCodeOut] = useState<string | null>(null);

  // receive
  const [recvCode, setRecvCode] = useState<string | null>(null);
  const [claimIn, setClaimIn] = useState("");
  const [recvMsg, setRecvMsg] = useState<string | null>(null);
  const [recvBusy, setRecvBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(items));
  }, [items]);

  // The wallet's stable NFD address (generated once, reused for receive + claim).
  async function myNfdAddress(): Promise<string> {
    const existing = localStorage.getItem(RECV_ADDR_KEY);
    if (existing) return existing;
    const a = await newReceiveAddress();
    localStorage.setItem(RECV_ADDR_KEY, a);
    return a;
  }

  async function mintFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const b64 = await fileToBase64(f);
      const thumb = withThumb ? await makeThumbnail(f) : null;
      const res = await nfdMint(b64, thumb?.b64, thumb?.mime);
      const item: Item = { ...res, name: f.name, mime: f.type || "application/octet-stream", ts: Date.now(), thumb: thumb?.dataUrl };
      setItems((prev) => [item, ...prev]);
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  async function openItem(it: Item) {
    setViewing(it.txid);
    setViewSrc(null);
    setViewErr(null);
    setXferCode("");
    setXferErr(null);
    setClaimCodeOut(null);
    try {
      const b64 = it.wrapkeyPtr
        ? await nfdClaim(it.ownerAddr, it.txid, it.wrapkeyPtr)
        : await nfdView(it.ownerAddr, it.arweavePtr ?? "", it.contentHash ?? "");
      setViewSrc(`data:${it.mime};base64,${b64}`);
    } catch (e) {
      setViewErr(String(e));
    }
  }

  function closeView() {
    setViewing(null);
    setViewSrc(null);
    setViewErr(null);
    setClaimCodeOut(null);
  }

  async function transferTo(it: Item) {
    const parts = xferCode.trim().split("|");
    if (parts.length !== 2 || parts[1].length !== 64) {
      setXferErr("That doesn't look like a receive code.");
      return;
    }
    setXferBusy(true);
    setXferErr(null);
    try {
      const res = await nfdTransfer(it.ownerAddr, it.txid, parts[0], parts[1]);
      const code: ClaimCode = {
        mintTxid: it.txid,
        wrapkeyPtr: res.wrapkeyPtr,
        name: it.name,
        mime: it.mime,
      };
      setClaimCodeOut(btoa(JSON.stringify(code)));
      // we no longer own it
      setItems((prev) => prev.filter((x) => x.txid !== it.txid));
    } catch (e) {
      setXferErr(String(e));
    }
    setXferBusy(false);
  }

  async function showReceiveCode() {
    setRecvBusy(true);
    setRecvMsg(null);
    try {
      const addr = await myNfdAddress();
      const c = await nfdReceiveCode(addr);
      setRecvCode(`${c.address}|${c.encPubkey}`);
    } catch (e) {
      setRecvMsg(String(e));
    }
    setRecvBusy(false);
  }

  async function claimCollectible() {
    setRecvBusy(true);
    setRecvMsg(null);
    try {
      const code = JSON.parse(atob(claimIn.trim())) as ClaimCode;
      const addr = await myNfdAddress();
      const b64 = await nfdClaim(addr, code.mintTxid, code.wrapkeyPtr);
      const item: Item = {
        txid: code.mintTxid,
        ownerAddr: addr,
        wrapkeyPtr: code.wrapkeyPtr,
        name: code.name,
        mime: code.mime,
        ts: Date.now(),
        thumb: code.mime.startsWith("image/") ? `data:${code.mime};base64,${b64}` : undefined,
      };
      setItems((prev) => [item, ...prev]);
      setClaimIn("");
      setRecvMsg("Claimed ✓ — added to My Collectibles.");
    } catch (e) {
      setRecvMsg("Couldn't claim: " + String(e));
    }
    setRecvBusy(false);
  }

  const active = items.find((i) => i.txid === viewing) ?? null;

  return (
    <div className="collectibles">
      <section className="ts-section">
        <h3 className="ts-head">Mint a collectible</h3>
        <p className="wl-note">
          Turn a file into a Divi Collectible you own. It’s encrypted on your machine before it’s stored —
          only you can unlock it — and ownership is anchored on the Divi blockchain. Minting spends a small
          network fee (~0.0001 DIVI).
        </p>
        <label className="coll-check">
          <input type="checkbox" checked={withThumb} onChange={(e) => setWithThumb(e.target.checked)} />
          <span>
            <strong>Publish a public preview</strong> — a small copy (≤{THUMB_MAX_PX}px, WebP) that anyone can
            see. This reveals a <em>low-resolution</em> version publicly; your full-quality original stays
            encrypted and only the owner unlocks it. (Images only.)
          </span>
        </label>
        <label className="wl-btn ts-file">
          {busy ? "Minting…" : "Choose a file to mint"}
          <input type="file" onChange={mintFile} hidden disabled={busy} />
        </label>
        {err && <p className="wl-err">{err}</p>}
      </section>

      <section className="ts-section">
        <h3 className="ts-head">My Collectibles</h3>
        {items.length === 0 ? (
          <p className="wl-note">Nothing yet — mint one above, or claim one you were sent.</p>
        ) : (
          <div className="coll-grid">
            {items.map((it) => (
              <button key={it.txid} className="coll-card" onClick={() => openItem(it)}>
                {it.thumb ? (
                  <img className="coll-card-thumb" src={it.thumb} alt={it.name} />
                ) : (
                  <span className="coll-card-noimg" aria-hidden="true">
                    🔒
                  </span>
                )}
                <span className="coll-card-name">{it.name}</span>
                <span className="coll-card-meta">owned · tap to open</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="ts-section">
        <h3 className="ts-head">Receive a collectible</h3>
        <p className="wl-note">
          Share your receive code with a sender. When they transfer to you, they’ll give you a claim code —
          paste it below to unlock it.
        </p>
        <button className="wl-btn" disabled={recvBusy} onClick={showReceiveCode}>
          Show my receive code
        </button>
        {recvCode && (
          <div className="addr-box">
            <code>{recvCode}</code>
            <button className="wl-btn" onClick={() => navigator.clipboard?.writeText(recvCode)}>
              Copy
            </button>
          </div>
        )}
        <input
          className="wl-input"
          placeholder="Paste a claim code"
          value={claimIn}
          onChange={(e) => setClaimIn(e.target.value)}
        />
        <button className="wl-btn wl-btn-primary" disabled={recvBusy || !claimIn.trim()} onClick={claimCollectible}>
          {recvBusy ? "Working…" : "Claim"}
        </button>
        {recvMsg && <p className="wl-note">{recvMsg}</p>}
      </section>

      {active && (
        <div className="coll-viewer" onClick={closeView}>
          <div className="coll-viewer-inner" onClick={(e) => e.stopPropagation()}>
            <div className="coll-viewer-head">
              <strong>{active.name}</strong>
              <button className="wl-btn" onClick={closeView}>
                Close
              </button>
            </div>
            {viewErr && <p className="wl-err">{viewErr}</p>}
            {!viewSrc && !viewErr && <p className="wl-note">Unlocking…</p>}
            {viewSrc && active.mime.startsWith("image/") && (
              <img className="coll-viewer-img" src={viewSrc} alt={active.name} />
            )}
            {viewSrc && !active.mime.startsWith("image/") && (
              <p className="wl-note">Unlocked {active.name} ({active.mime}).</p>
            )}
            <p className="wl-note coll-owner">
              {active.thumbPtr ? "has a public preview" : "private (no public preview)"}
            </p>

            {claimCodeOut ? (
              <div className="ts-result">
                <p className="wl-note">
                  Transferred. Send this <strong>claim code</strong> to the recipient so they can unlock it:
                </p>
                <div className="addr-box">
                  <code>{claimCodeOut}</code>
                  <button className="wl-btn" onClick={() => navigator.clipboard?.writeText(claimCodeOut)}>
                    Copy
                  </button>
                </div>
              </div>
            ) : (
              <div className="coll-xfer">
                <input
                  className="wl-input"
                  placeholder="Recipient's receive code"
                  value={xferCode}
                  onChange={(e) => setXferCode(e.target.value)}
                />
                <button className="wl-btn wl-btn-primary" disabled={xferBusy || !xferCode.trim()} onClick={() => transferTo(active)}>
                  {xferBusy ? "Transferring…" : "Transfer to this code"}
                </button>
                {xferErr && <p className="wl-err">{xferErr}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
