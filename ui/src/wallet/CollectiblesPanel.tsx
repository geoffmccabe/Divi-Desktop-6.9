import { useEffect, useState, type ChangeEvent } from "react";
import { nfdMint, nfdView, nfdReceiveCode, nfdTransfer, nfdClaim, nfdCreateCollection, newReceiveAddress } from "./api";
import { CollectionImport } from "./CollectionImport";

// Divi Collectibles (NFDs). Mint, view, transfer, and receive collectibles. The
// file is encrypted locally before it leaves the machine; only the encrypted
// bundle is stored, and ownership is anchored on the Divi chain. The creator may
// publish an UNENCRYPTED ≤500px preview (WebP). Transfers use a receive-code /
// claim-code handoff until the chain indexer can enumerate + look up on-chain.

export interface Item {
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
  collectionId?: string; // set when this item was minted into a collection
  traits?: Trait[]; // public ERC-721 attributes, kept for the collection view
  tier?: string; // explicit creator-assigned rarity tier (locked schema)
  edition?: number; // 1-based index within its collection
}

// A collection I created (creator-only minting, optional supply cap).
export interface Collection {
  id: string; // the COLLECTION-CREATE txid
  name: string;
  creatorAddr: string; // must fund every mint into it
  maxSupply: number; // 0 = unlimited
  minted: number;
  cover?: string; // data-URL for card display
}

// One ERC-721 trait row (public).
export interface Trait {
  type: string;
  value: string;
}

const STORE_KEY = "nfd.collectibles.v1";
const COLLECTIONS_KEY = "nfd.collections.v1";
const RECV_ADDR_KEY = "nfd.receiveAddr.v1";
const THUMB_MAX_PX = 500;

function loadItems(): Item[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]") as Item[];
  } catch {
    return [];
  }
}

function loadCollections(): Collection[] {
  try {
    return JSON.parse(localStorage.getItem(COLLECTIONS_KEY) || "[]") as Collection[];
  } catch {
    return [];
  }
}

// Trait rarity across a collection's items: percent = (items with this exact
// trait) / (total items shown). Standard ERC-721 trait-frequency rarity.
function traitRarity(items: Item[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const it of items) {
    for (const t of it.traits ?? []) counts.set(`${t.type}=${t.value}`, (counts.get(`${t.type}=${t.value}`) ?? 0) + 1);
  }
  const pct = new Map<string, number>();
  const total = items.length || 1;
  for (const [k, n] of counts) pct.set(k, Math.round((n / total) * 100));
  return pct;
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

export interface Thumb {
  b64: string;
  mime: string;
  dataUrl: string;
}

// Downscale an image to a ≤500px WebP preview (WebP only). null if not possible.
async function makeThumbnail(file: File): Promise<Thumb | null> {
  if (!file.type.startsWith("image/")) return null;
  return makeThumbnailFromBlob(file);
}

// Base64 → ≤500px WebP preview, for the collection importer. null if not possible.
export async function makeThumbnailFromBase64(b64: string, mime: string): Promise<Thumb | null> {
  if (!mime.startsWith("image/")) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return await makeThumbnailFromBlob(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

async function makeThumbnailFromBlob(blob: Blob): Promise<Thumb | null> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
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

// A claim code is fully attacker-authored, so validate it hard before it's
// parsed, stored, rendered, or forwarded to the backend.
const MAX_CLAIM_B64 = 8 * 1024; // codes are tiny (two 64-hex ids + short name)
const NAME_MAX = 200;
const MAX_ITEMS = 5000;
const isHex64 = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);
const isSafeMime = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 100 && /^[a-z]+\/[a-z0-9.+-]+$/i.test(s);
const isDiviAddr = (s: string) => /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{26,48}$/.test(s);

// Parse + strictly validate a pasted claim code. Returns null on anything off.
function parseClaimCode(raw: string): ClaimCode | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_CLAIM_B64) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(atob(trimmed));
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const c = obj as Record<string, unknown>;
  if (!isHex64(c.mintTxid) || !isHex64(c.wrapkeyPtr) || !isSafeMime(c.mime)) return null;
  if (typeof c.name !== "string" || c.name.length === 0 || c.name.length > NAME_MAX) return null;
  return { mintTxid: c.mintTxid, wrapkeyPtr: c.wrapkeyPtr, name: c.name, mime: c.mime };
}

export function CollectiblesPanel() {
  const [tab, setTab] = useState<"collection" | "marketplace" | "builder">("collection");
  const [items, setItems] = useState<Item[]>(loadItems);
  const [collections, setCollections] = useState<Collection[]>(loadCollections);
  const [withThumb, setWithThumb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Mint-into-a-collection: chosen collection ("" = standalone) + public traits.
  const [mintInto, setMintInto] = useState("");
  const [traits, setTraits] = useState<Trait[]>([{ type: "", value: "" }]);
  const [mintTier, setMintTier] = useState(""); // explicit rarity tier (locked schema)

  // Browse a collection (view its items + trait rarity).
  const [browsing, setBrowsing] = useState<string | null>(null);

  // Create-a-collection form.
  const [colName, setColName] = useState("");
  const [colMax, setColMax] = useState("");
  const [colCover, setColCover] = useState<{ b64: string; mime: string; dataUrl: string } | null>(null);
  const [colBusy, setColBusy] = useState(false);
  const [colErr, setColErr] = useState<string | null>(null);

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
    // A poisoned/oversized item must not throw inside the effect and wedge the panel.
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(items));
    } catch {
      /* quota or serialization failure — keep running on in-memory state */
    }
  }, [items]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
    } catch {
      /* ignore */
    }
  }, [collections]);

  // The wallet's stable NFD address (generated once, reused for receive + claim).
  async function myNfdAddress(): Promise<string> {
    const existing = localStorage.getItem(RECV_ADDR_KEY);
    if (existing) return existing;
    const a = await newReceiveAddress();
    localStorage.setItem(RECV_ADDR_KEY, a);
    return a;
  }

  async function pickCover(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setColCover(await makeThumbnail(f));
  }

  async function createCollection() {
    if (!colName.trim()) return;
    setColBusy(true);
    setColErr(null);
    try {
      const creator = await myNfdAddress();
      const max = Math.max(0, Math.floor(Number(colMax) || 0));
      const res = await nfdCreateCollection(creator, colName.trim(), "", max, colCover?.b64, colCover?.mime);
      const col: Collection = { id: res.txid, name: colName.trim(), creatorAddr: res.creatorAddr, maxSupply: max, minted: 0, cover: colCover?.dataUrl };
      setCollections((prev) => [col, ...prev]);
      setColName("");
      setColMax("");
      setColCover(null);
      setMintInto(col.id); // convenient: mint the next file straight into it
    } catch (e) {
      setColErr(String(e));
    }
    setColBusy(false);
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
      const col = collections.find((c) => c.id === mintInto) ?? null;
      let collectionArg;
      let cleanTraits: Trait[] = [];
      const edition = col ? col.minted + 1 : undefined; // 1-based index within the set
      const tier = mintTier.trim() || undefined;
      if (col) {
        cleanTraits = traits.filter((t) => t.type.trim() && t.value.trim()).map((t) => ({ type: t.type.trim(), value: t.value.trim() }));
        const attributes = cleanTraits.map((t) => ({ trait_type: t.type, value: t.value }));
        // Locked traits_ptr schema: name, edition, tier (explicit rarity), attributes.
        const meta: Record<string, unknown> = { name: f.name, edition, attributes };
        if (tier) meta.tier = tier;
        collectionArg = {
          collectionId: col.id,
          creatorAddr: col.creatorAddr,
          traitsJson: JSON.stringify(meta),
        };
      }
      const res = await nfdMint(b64, thumb?.b64, thumb?.mime, collectionArg);
      const item: Item = {
        ...res,
        name: f.name,
        mime: f.type || "application/octet-stream",
        ts: Date.now(),
        thumb: thumb?.dataUrl,
        collectionId: col?.id,
        traits: col ? cleanTraits : undefined,
        tier: col ? tier : undefined,
        edition: col ? edition : undefined,
      };
      setItems((prev) => [item, ...prev]);
      if (col) {
        setCollections((prev) => prev.map((c) => (c.id === col.id ? { ...c, minted: c.minted + 1 } : c)));
        setTraits([{ type: "", value: "" }]);
        setMintTier("");
      }
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
    if (parts.length !== 2 || !isDiviAddr(parts[0]) || !isHex64(parts[1])) {
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
      const code = parseClaimCode(claimIn);
      if (!code) {
        setRecvMsg("That doesn't look like a valid claim code.");
        setRecvBusy(false);
        return;
      }
      if (items.some((i) => i.txid === code.mintTxid)) {
        setRecvMsg("You already have that collectible.");
        setRecvBusy(false);
        return;
      }
      if (items.length >= MAX_ITEMS) {
        setRecvMsg("Your collection is full.");
        setRecvBusy(false);
        return;
      }
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
  const selectedCol = collections.find((c) => c.id === mintInto) ?? null;
  const mintedOut = !!selectedCol && selectedCol.maxSupply > 0 && selectedCol.minted >= selectedCol.maxSupply;

  const browseCol = collections.find((c) => c.id === browsing) ?? null;
  const browseItems = browsing ? items.filter((i) => i.collectionId === browsing) : [];
  const browseRarity = traitRarity(browseItems);

  function setTrait(i: number, patch: Partial<Trait>) {
    setTraits((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "collection", label: "My Collection" },
    { key: "marketplace", label: "Marketplace" },
    { key: "builder", label: "NFD Builder" },
  ];

  return (
    <div className="collectibles">
      <div className="nfd-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={"nfd-tab" + (tab === t.key ? " nfd-tab-active" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "builder" && (
      <>
      <section className="ts-section">
        <h3 className="ts-head">Create a collection</h3>
        <p className="wl-note">
          A collection is a themed set with a fixed supply and shared branding — like an ERC-721 series. Only
          you can mint into it, up to its cap. Items you add can carry public traits (background, rarity, …) so
          marketplaces can browse and rank them, while each original stays encrypted for its owner.
        </p>
        <input className="wl-input" placeholder="Collection name" value={colName} onChange={(e) => setColName(e.target.value)} />
        <input
          className="wl-input"
          placeholder="Max supply (blank or 0 = unlimited)"
          value={colMax}
          inputMode="numeric"
          onChange={(e) => setColMax(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <label className="wl-btn ts-file">
          {colCover ? "Cover image ✓ — change" : "Add a cover image (optional)"}
          <input type="file" accept="image/*" onChange={pickCover} hidden />
        </label>
        <button className="wl-btn wl-btn-primary" disabled={colBusy || !colName.trim()} onClick={createCollection}>
          {colBusy ? "Creating…" : "Create collection"}
        </button>
        {colErr && <p className="wl-err">{colErr}</p>}
      </section>

      <section className="ts-section">
        <h3 className="ts-head">Mint a collectible</h3>
        <p className="wl-note">
          Turn a file into a Divi Collectible you own. It’s encrypted on your machine before it’s stored —
          only you can unlock it — and ownership is anchored on the Divi blockchain. Minting spends a small
          network fee (~0.0001 DIVI).
        </p>
        <label className="coll-field">
          <span>Mint into</span>
          <select className="wl-input" value={mintInto} onChange={(e) => setMintInto(e.target.value)}>
            <option value="">Standalone (no collection)</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.maxSupply > 0 ? ` (${c.minted}/${c.maxSupply})` : ""}
              </option>
            ))}
          </select>
        </label>
        {selectedCol && (
          <div className="coll-traits">
            <label className="coll-field">
              <span>Rarity tier · edition #{selectedCol.minted + 1}</span>
              <input
                className="wl-input"
                list="nfd-tier-suggestions"
                placeholder="e.g. Legendary (public, baked into the mint)"
                value={mintTier}
                onChange={(e) => setMintTier(e.target.value)}
              />
              <datalist id="nfd-tier-suggestions">
                <option value="Common" />
                <option value="Uncommon" />
                <option value="Rare" />
                <option value="Epic" />
                <option value="Legendary" />
                <option value="Mythic" />
              </datalist>
            </label>
            <p className="wl-note">Public traits (optional) — shown to everyone, like ERC-721 attributes.</p>
            {traits.map((t, i) => (
              <div key={i} className="coll-trait-row">
                <input className="wl-input" placeholder="Trait (e.g. Background)" value={t.type} onChange={(e) => setTrait(i, { type: e.target.value })} />
                <input className="wl-input" placeholder="Value (e.g. Nebula)" value={t.value} onChange={(e) => setTrait(i, { value: e.target.value })} />
              </div>
            ))}
            <button className="wl-btn" onClick={() => setTraits((p) => [...p, { type: "", value: "" }])}>
              + Add trait
            </button>
            {mintedOut && <p className="wl-err">This collection is minted out.</p>}
          </div>
        )}
        <label className="coll-check">
          <input type="checkbox" checked={withThumb} onChange={(e) => setWithThumb(e.target.checked)} />
          <span>
            <strong>Publish a public preview</strong> — a small copy (≤{THUMB_MAX_PX}px, WebP) that anyone can
            see. This reveals a <em>low-resolution</em> version publicly; your full-quality original stays
            encrypted and only the owner unlocks it. (Images only.)
          </span>
        </label>
        <label className={"wl-btn ts-file" + (busy || mintedOut ? " wl-btn-disabled" : "")}>
          {busy ? "Minting…" : selectedCol ? `Choose a file to mint into “${selectedCol.name}”` : "Choose a file to mint"}
          <input type="file" onChange={mintFile} hidden disabled={busy || mintedOut} />
        </label>
        {err && <p className="wl-err">{err}</p>}
      </section>

      <CollectionImport
        getMyAddress={myNfdAddress}
        onCollection={(c) => setCollections((prev) => [c, ...prev])}
        onItem={(it) => setItems((prev) => [it, ...prev])}
      />
      </>
      )}

      {tab === "marketplace" && (
      <section className="ts-section">
        <h3 className="ts-head">Marketplace</h3>
        <p className="wl-note">
          Browse collections and their traits. This is the public gallery — you see everyone’s public previews
          and rarity, while each original stays encrypted for its owner. <strong>Browse-only for now</strong>:
          listings and buying/selling come next.
        </p>
        {collections.length === 0 ? (
          <p className="wl-note">No collections yet. Create one in the NFD Builder tab.</p>
        ) : (
          <div className="coll-grid">
            {collections.map((c) => (
              <button key={c.id} className="coll-card" title={c.id} onClick={() => setBrowsing(c.id)}>
                {c.cover ? (
                  <img className="coll-card-thumb" src={c.cover} alt={c.name} />
                ) : (
                  <span className="coll-card-noimg" aria-hidden="true">📦</span>
                )}
                <span className="coll-card-name">{c.name}</span>
                <span className="coll-card-meta">{c.minted}{c.maxSupply > 0 ? ` / ${c.maxSupply}` : ""} minted · browse</span>
              </button>
            ))}
          </div>
        )}
      </section>
      )}

      {tab === "collection" && (
      <>
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
                <span className="coll-card-meta">
                  {it.collectionId ? (collections.find((c) => c.id === it.collectionId)?.name ?? "in a collection") : "owned · tap to open"}
                </span>
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
      </>
      )}

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

      {browseCol && (
        <div className="coll-viewer" onClick={() => setBrowsing(null)}>
          <div className="coll-viewer-inner" onClick={(e) => e.stopPropagation()}>
            <div className="coll-viewer-head">
              <strong>{browseCol.name}</strong>
              <button className="wl-btn" onClick={() => setBrowsing(null)}>
                Close
              </button>
            </div>
            <p className="wl-note">
              {browseCol.minted}{browseCol.maxSupply > 0 ? ` of ${browseCol.maxSupply}` : ""} minted.
              {" "}Rarity is the share of items sharing each trait, across the items in this wallet.
            </p>
            {browseItems.length === 0 ? (
              <p className="wl-note">No items minted into this collection yet.</p>
            ) : (
              <div className="coll-grid">
                {browseItems.map((it) => (
                  <button key={it.txid} className="coll-card" onClick={() => { setBrowsing(null); openItem(it); }}>
                    {it.thumb ? (
                      <img className="coll-card-thumb" src={it.thumb} alt={it.name} />
                    ) : (
                      <span className="coll-card-noimg" aria-hidden="true">🔒</span>
                    )}
                    <span className="coll-card-name">
                      {it.name}
                      {it.edition ? ` · #${it.edition}` : ""}
                    </span>
                    {(it.tier || (it.traits && it.traits.length > 0)) && (
                      <span className="coll-traitchips">
                        {it.tier && <span className="coll-traitchip coll-tierchip">{it.tier}</span>}
                        {(it.traits ?? []).map((t, i) => (
                          <span key={i} className="coll-traitchip">
                            {t.type}: {t.value} · {browseRarity.get(`${t.type}=${t.value}`) ?? 100}%
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
