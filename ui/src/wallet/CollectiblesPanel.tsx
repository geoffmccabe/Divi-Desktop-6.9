import { useEffect, useState, type ChangeEvent } from "react";
import { nfdMint, nfdView, type NfdMint } from "./api";

// Divi Collectibles (NFDs). Mint a file into an owned, encrypted collectible and
// view the ones you own. The file is encrypted locally before it leaves the
// machine; only the encrypted bundle is stored, and ownership is anchored on the
// Divi chain. Storage is the local stub for now (Arweave arrives in Phase 3).
// The owned list is kept locally until the chain indexer can enumerate them.

interface Item extends NfdMint {
  name: string;
  mime: string;
  ts: number;
}

const STORE_KEY = "nfd.collectibles.v1";

function loadItems(): Item[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]") as Item[];
  } catch {
    return [];
  }
}

// Read a File to raw base64 (strips the data-URL prefix). Handles large files.
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

export function CollectiblesPanel() {
  const [items, setItems] = useState<Item[]>(loadItems);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewSrc, setViewSrc] = useState<string | null>(null);
  const [viewErr, setViewErr] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(items));
  }, [items]);

  async function mintFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const b64 = await fileToBase64(f);
      const res = await nfdMint(b64);
      const item: Item = { ...res, name: f.name, mime: f.type || "application/octet-stream", ts: Date.now() };
      setItems((prev) => [item, ...prev]);
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  async function openItem(it: Item) {
    setViewing(it.arweavePtr);
    setViewSrc(null);
    setViewErr(null);
    try {
      const b64 = await nfdView(it.ownerAddr, it.arweavePtr, it.contentHash);
      setViewSrc(`data:${it.mime};base64,${b64}`);
    } catch (e) {
      setViewErr(String(e));
    }
  }

  function closeView() {
    setViewing(null);
    setViewSrc(null);
    setViewErr(null);
  }

  const active = items.find((i) => i.arweavePtr === viewing) ?? null;

  return (
    <div className="collectibles">
      <section className="ts-section">
        <h3 className="ts-head">Mint a collectible</h3>
        <p className="wl-note">
          Turn a file into a Divi Collectible you own. It’s encrypted on your machine before it’s stored —
          only you can unlock it — and ownership is anchored on the Divi blockchain. Minting spends a small
          network fee (~0.0001 DIVI).
        </p>
        <label className="wl-btn ts-file">
          {busy ? "Minting…" : "Choose a file to mint"}
          <input type="file" onChange={mintFile} hidden disabled={busy} />
        </label>
        {err && <p className="wl-err">{err}</p>}
      </section>

      <section className="ts-section">
        <h3 className="ts-head">My Collectibles</h3>
        {items.length === 0 ? (
          <p className="wl-note">Nothing yet — mint your first collectible above.</p>
        ) : (
          <div className="coll-grid">
            {items.map((it) => (
              <button key={it.arweavePtr} className="coll-card" onClick={() => openItem(it)}>
                <span className="coll-card-name">{it.name}</span>
                <span className="coll-card-meta">owned · tap to unlock</span>
              </button>
            ))}
          </div>
        )}
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
              <p className="wl-note">
                Unlocked {active.name} ({active.mime}). Inline preview is available for images.
              </p>
            )}
            <p className="wl-note coll-owner">Owner: {active.ownerAddr}</p>
          </div>
        </div>
      )}
    </div>
  );
}
