import { useState } from "react";
import {
  nfdImportOpen, nfdImportReadItem, nfdCreateCollection, nfdMint, nfdPrepareFunding, nfdTxConfirmations,
  nfdPickZip, nfdLaunchOpen, nfdLaunch, type ImportPlan, type LaunchPlan,
} from "./api";
import { makeThumbnailFromBase64, type Item, type Collection } from "./CollectiblesPanel";
import { setTierArtManifest } from "./reveal/tierArt";

// Launch a collection authored in Kinet.ink. The current (v2) export is a single
// .json "launch bundle": a mint-on-demand Perc set, so DD69 creates the
// collection on Divi (with its on-chain rarity config + cover) and opens it for
// minting — buyers mint sealed packs and reveal them later. NOTHING is minted up
// front. The older .zip bundle (per-item pre-mint) is still handled as a fallback.
// See docs/NFD-COLLECTION-IMPORT.md.

interface Props {
  getMyAddress: () => Promise<string>;
  onCollection: (c: Collection) => void;
  onItem: (it: Item) => void;
}

const DUFFS_PER_DIVI = 100_000_000;

// Per-import resume state (zip flow only), keyed by the bundle dir so a re-run continues.
interface Resume {
  collectionId?: string;
  creatorAddr?: string;
  done: number[]; // editions already minted
}
function loadResume(key: string): Resume {
  try {
    return JSON.parse(localStorage.getItem(`nfd.import.${key}`) || "") as Resume;
  } catch {
    return { done: [] };
  }
}
function saveResume(key: string, r: Resume) {
  try {
    localStorage.setItem(`nfd.import.${key}`, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

export function CollectionImport({ getMyAddress, onCollection, onItem }: Props) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Launch (v2 JSON) flow.
  const [launchPlan, setLaunchPlan] = useState<LaunchPlan | null>(null);
  const [maxPacks, setMaxPacks] = useState("0"); // 0 = unlimited
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);

  // Legacy zip flow.
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [prep, setPrep] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const fileName = path ? path.split("/").pop() : "";

  // Open the OS file picker, then read the chosen bundle. The user never sees or
  // types a path. A .json is a launch bundle; a .zip is the legacy importer.
  async function chooseFile() {
    setErr(null);
    setLaunchMsg(null);
    try {
      const picked = await nfdPickZip();
      if (!picked) return; // cancelled
      setPath(picked);
      setPlan(null);
      setLaunchPlan(null);
      setFinished(false);
      setProgress(null);
      setBusy(true);
      if (picked.toLowerCase().endsWith(".json")) {
        setLaunchPlan(await nfdLaunchOpen(picked));
      } else {
        setPlan(await nfdImportOpen(picked));
      }
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  // Create the collection on Divi and open it for minting (no pre-mint).
  async function doLaunch() {
    if (!launchPlan) return;
    setBusy(true);
    setErr(null);
    setLaunchMsg(null);
    try {
      const creator = await getMyAddress();
      const cap = Math.max(0, Math.floor(Number(maxPacks) || 0));
      const res = await nfdLaunch(creator, path, cap);
      // Teach the reveal art registry this collection's tier -> art URLs.
      const byTier: Record<number, string> = {};
      for (const [k, v] of Object.entries(res.tierArt)) byTier[Number(k)] = v;
      setTierArtManifest(res.collectionId, byTier);
      onCollection({
        id: res.collectionId,
        name: res.name,
        creatorAddr: creator,
        maxSupply: cap,
        minted: 0,
        cover: launchPlan.coverUrl || undefined,
        encrypted: false,
      });
      const priceDivi = res.priceDuffs / DUFFS_PER_DIVI;
      setLaunchMsg(`Done ✓ — "${res.name}" is live and open for minting at ${priceDivi} DIVI per pack. See My Collection.`);
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  // ---- legacy zip flow (per-item pre-mint) ----
  async function runImport() {
    if (!plan) return;
    setBusy(true);
    setErr(null);
    setFinished(false);
    const okItems = plan.items.filter((i) => i.ok && i.edition != null);
    const name = plan.collection.name;
    const rkey = plan.importDir;
    const resume = loadResume(rkey);
    try {
      const creator = await getMyAddress();
      if (!resume.collectionId) {
        const col = await nfdCreateCollection(
          creator,
          name,
          plan.collection.description,
          plan.collection.maxSupply,
          plan.collection.coverB64 || undefined,
          plan.collection.coverMime || undefined,
        );
        resume.collectionId = col.txid;
        resume.creatorAddr = col.creatorAddr;
        saveResume(rkey, resume);
        onCollection({
          id: col.txid,
          name,
          creatorAddr: col.creatorAddr,
          maxSupply: plan.collection.maxSupply,
          minted: 0,
          cover: plan.collection.coverB64 ? `data:${plan.collection.coverMime};base64,${plan.collection.coverB64}` : undefined,
          encrypted: plan.collection.encrypted,
        });
      }
      const encrypted = plan.collection.encrypted;
      const collectionId = resume.collectionId!;
      const creatorAddr = resume.creatorAddr!;

      const doneSet = new Set(resume.done);
      const remaining = okItems.length - doneSet.size;

      if (remaining > 0) {
        setPrep("Preparing funds…");
        const fanTxid = await nfdPrepareFunding(creatorAddr, remaining);
        if (fanTxid) {
          for (let i = 0; i < 240; i++) {
            if ((await nfdTxConfirmations(fanTxid)) >= 1) break;
            setPrep(`Preparing funds… (waiting for confirmation ${i + 1})`);
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
        setPrep(null);
      }

      setProgress({ done: doneSet.size, total: okItems.length });
      for (const it of okItems) {
        const edition = it.edition as number;
        if (doneSet.has(edition)) continue;
        const data = await nfdImportReadItem(plan.importDir, edition);
        const preview =
          data.previewB64 && data.previewMime
            ? { b64: data.previewB64, mime: data.previewMime, dataUrl: `data:${data.previewMime};base64,${data.previewB64}` }
            : await makeThumbnailFromBase64(data.originalB64, data.originalMime);
        const meta: Record<string, unknown> = { name: data.name, edition, attributes: data.attributes };
        if (data.tier) meta.tier = data.tier;
        const res = await nfdMint(data.originalB64, data.originalMime, encrypted, preview?.b64, preview?.mime, {
          collectionId,
          creatorAddr,
          traitsJson: JSON.stringify(meta),
        });
        onItem({
          ...res,
          name: data.name,
          mime: data.originalMime,
          ts: Date.now(),
          thumb: preview?.dataUrl,
          collectionId,
          traits: data.attributes.map((a) => ({ type: a.trait_type, value: a.value })),
          tier: data.tier || undefined,
          edition,
          encrypted,
        });
        doneSet.add(edition);
        resume.done = [...doneSet];
        saveResume(rkey, resume);
        setProgress({ done: doneSet.size, total: okItems.length });
      }
      setFinished(true);
    } catch (e) {
      setErr("Stopped: " + String(e) + " — fix and run again to resume where it left off.");
    }
    setPrep(null);
    setBusy(false);
  }

  const okCount = plan?.okCount ?? 0;
  const badCount = plan ? plan.items.length - okCount : 0;
  const priceDivi = launchPlan ? launchPlan.priceDuffs / DUFFS_PER_DIVI : 0;

  return (
    <section className="ts-section">
      <h3 className="ts-head">Launch from Kinet.ink</h3>
      <p className="wl-note">
        Build a collection in Kinet.ink, export its launch file, then choose it below. DD69 creates the
        collection on Divi and opens it for minting — buyers mint sealed packs and reveal them. Nothing is
        minted up front.
      </p>
      <button className="wl-btn wl-btn-primary" disabled={busy} onClick={chooseFile}>
        {busy && !plan && !launchPlan ? "Reading…" : fileName ? `Chosen: ${fileName} — choose another` : "Choose file…"}
      </button>

      {launchPlan && (
        <div className="import-plan" style={{ marginTop: 12 }}>
          <p className="wl-note">
            <strong>{launchPlan.name}</strong> — a blind-pack (Perc) set with {launchPlan.rarity.tierCount} tiers
            {launchPlan.rarity.urCount > 0 ? ` and ${launchPlan.rarity.urCount} ultra-rares` : ""}, from{" "}
            {launchPlan.itemCount} art pieces.
          </p>
          <p className="wl-note">
            Mint price: <strong>{priceDivi} DIVI</strong> per pack.{" "}
            {launchPlan.payoutAddress ? `Paid to ${launchPlan.payoutAddress}.` : "Paid to your own wallet."}
          </p>
          <label style={{ display: "block", margin: "8px 0 4px", fontSize: 13 }}>Max packs (0 = unlimited)</label>
          <input
            className="wl-input"
            type="number"
            min={0}
            value={maxPacks}
            onChange={(e) => setMaxPacks(e.target.value)}
            style={{ maxWidth: 200 }}
          />
          <div style={{ marginTop: 10 }}>
            <button className="wl-btn wl-btn-primary" disabled={busy} onClick={doLaunch}>
              {busy ? "Launching…" : "Create collection & open minting"}
            </button>
          </div>
          {launchMsg && <p className="wl-note" style={{ marginTop: 8 }}>{launchMsg}</p>}
        </div>
      )}

      {plan && (
        <div className="import-plan" style={{ marginTop: 12 }}>
          <p className="wl-note">
            <strong>{plan.collection.name}</strong> — {okCount} item{okCount === 1 ? "" : "s"} ready
            {plan.collection.maxSupply > 0 ? ` of ${plan.collection.maxSupply}` : ""}
            {badCount > 0 ? `, ${badCount} skipped` : ""}.
          </p>
          {plan.warnings.length > 0 && (
            <ul className="import-warn">
              {plan.warnings.slice(0, 20).map((w, i) => (
                <li key={i}>
                  #{w.edition ?? "?"}: {w.error}
                </li>
              ))}
              {plan.warnings.length > 20 && <li>…and {plan.warnings.length - 20} more</li>}
            </ul>
          )}
          {prep && <p className="wl-note">{prep}</p>}
          {progress && (
            <p className="wl-note">
              Minted {progress.done} / {progress.total}
              {progress.done < progress.total ? "…" : ""}
            </p>
          )}
          {finished && <p className="wl-note">Done ✓ — see My Collection and Marketplace.</p>}
          <button className="wl-btn wl-btn-primary" disabled={busy || okCount === 0} onClick={runImport}>
            {busy && progress ? "Publishing…" : progress ? "Resume publishing" : `Create & mint ${okCount} item${okCount === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
      {err && <p className="wl-err">{err}</p>}
    </section>
  );
}
