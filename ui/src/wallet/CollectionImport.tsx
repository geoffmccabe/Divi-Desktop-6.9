import { useState } from "react";
import { nfdImportOpen, nfdImportReadItem, nfdCreateCollection, nfdMint, type ImportPlan } from "./api";
import { makeThumbnailFromBase64, type Item, type Collection } from "./CollectiblesPanel";

// Import a collection authored in Kinet.ink (a .zip of manifest.json + images)
// and publish it into DD69: create the collection, then mint each item into it.
// Resumable — a big batch that fails partway continues instead of restarting.
// See docs/NFD-COLLECTION-IMPORT.md.

interface Props {
  getMyAddress: () => Promise<string>;
  onCollection: (c: Collection) => void;
  onItem: (it: Item) => void;
}

// Per-import resume state, keyed by collection name so a re-run continues.
interface Resume {
  collectionId?: string;
  creatorAddr?: string;
  done: number[]; // editions already minted
}
const resumeKey = (name: string) => `nfd.import.${name}`;
function loadResume(name: string): Resume {
  try {
    return JSON.parse(localStorage.getItem(resumeKey(name)) || "") as Resume;
  } catch {
    return { done: [] };
  }
}
function saveResume(name: string, r: Resume) {
  try {
    localStorage.setItem(resumeKey(name), JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

export function CollectionImport({ getMyAddress, onCollection, onItem }: Props) {
  const [path, setPath] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [finished, setFinished] = useState(false);

  async function openBundle() {
    setBusy(true);
    setErr(null);
    setPlan(null);
    setFinished(false);
    setProgress(null);
    try {
      const p = await nfdImportOpen(path.trim());
      setPlan(p);
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  async function runImport() {
    if (!plan) return;
    setBusy(true);
    setErr(null);
    setFinished(false);
    const okItems = plan.items.filter((i) => i.ok && i.edition != null);
    const name = plan.collection.name;
    const resume = loadResume(name);
    try {
      const creator = await getMyAddress();
      // Create the collection once (resume reuses it).
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
        saveResume(name, resume);
        onCollection({
          id: col.txid,
          name,
          creatorAddr: col.creatorAddr,
          maxSupply: plan.collection.maxSupply,
          minted: 0,
          cover: plan.collection.coverB64 ? `data:${plan.collection.coverMime};base64,${plan.collection.coverB64}` : undefined,
        });
      }
      const collectionId = resume.collectionId!;
      const creatorAddr = resume.creatorAddr!;

      const doneSet = new Set(resume.done);
      setProgress({ done: doneSet.size, total: okItems.length });
      for (const it of okItems) {
        const edition = it.edition as number;
        if (doneSet.has(edition)) continue;
        const data = await nfdImportReadItem(plan.importDir, edition);
        // Provided preview, else auto-generate a ≤500px WebP.
        const preview =
          data.previewB64 && data.previewMime
            ? { b64: data.previewB64, mime: data.previewMime, dataUrl: `data:${data.previewMime};base64,${data.previewB64}` }
            : await makeThumbnailFromBase64(data.originalB64, data.originalMime);
        // Locked traits schema: { name, edition, tier, attributes }.
        const meta: Record<string, unknown> = { name: data.name, edition, attributes: data.attributes };
        if (data.tier) meta.tier = data.tier;
        const res = await nfdMint(data.originalB64, preview?.b64, preview?.mime, {
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
        });
        doneSet.add(edition);
        resume.done = [...doneSet];
        saveResume(name, resume);
        setProgress({ done: doneSet.size, total: okItems.length });
      }
      setFinished(true);
    } catch (e) {
      setErr("Stopped: " + String(e) + " — fix and run again to resume where it left off.");
    }
    setBusy(false);
  }

  const okCount = plan?.okCount ?? 0;
  const badCount = plan ? plan.items.length - okCount : 0;

  return (
    <section className="ts-section">
      <h3 className="ts-head">Import from Kinet.ink</h3>
      <p className="wl-note">
        Publish a collection you built in Kinet.ink. Export it there as a <strong>.zip</strong> (manifest + images),
        then give DD69 the full path to that file. DD69 creates the collection and mints every item into it —
        resuming safely if a big batch is interrupted.
      </p>
      <input
        className="wl-input"
        placeholder="Full path to the .zip (e.g. /Users/you/Downloads/divi-genesis.zip)"
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <button className="wl-btn" disabled={busy || !path.trim()} onClick={openBundle}>
        {busy && !plan ? "Reading…" : "Open bundle"}
      </button>

      {plan && (
        <div className="import-plan">
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
